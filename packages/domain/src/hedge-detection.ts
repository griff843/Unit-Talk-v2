export const HEDGE_DETECTION_THRESHOLDS = {
  minArbitragePercentage: 1.0,
  minMiddleGap: 2.0,
  minHedgeDiscrepancy: 3.0,
  lookbackMinutes: 15,
} as const;

export type HedgeOpportunityType = 'arbitrage' | 'middle' | 'hedge';
export type HedgeOpportunityPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ProviderOfferLike {
  id: string;
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  snapshot_at: string;
  created_at: string;
}

export interface HedgeOpportunity {
  providerEventId: string;
  providerParticipantId: string | null;
  marketKey: string;
  bookmakerA: string;
  bookmakerB: string;
  lineA: number;
  lineB: number;
  overOddsA: number;
  underOddsB: number;
  lineDiscrepancy: number;
  impliedProbA: number;
  impliedProbB: number;
  totalImpliedProb: number;
  arbitragePercentage: number;
  profitPotential: number;
  guaranteedProfit: number | null;
  middleGap: number | null;
  winProbability: number | null;
  type: HedgeOpportunityType;
  priority: HedgeOpportunityPriority;
}

export interface HedgeOpportunityPairInput {
  providerEventId: string;
  providerParticipantId: string | null;
  marketKey: string;
  bookmakerA: string;
  bookmakerB: string;
  lineA: number;
  lineB: number;
  overOddsA: number;
  underOddsB: number;
}

export function detectHedgeOpportunities(
  offers: ProviderOfferLike[],
): HedgeOpportunity[] {
  const groupedOffers = groupOffersByMarketTuple(offers);
  const opportunities: HedgeOpportunity[] = [];

  for (const group of groupedOffers.values()) {
    const latestOffersByBookmaker = selectLatestOffersByBookmaker(group);
    if (latestOffersByBookmaker.length < 2) {
      continue;
    }

    for (let i = 0; i < latestOffersByBookmaker.length - 1; i += 1) {
      for (let j = i + 1; j < latestOffersByBookmaker.length; j += 1) {
        const leftOffer = latestOffersByBookmaker[i];
        const rightOffer = latestOffersByBookmaker[j];
        if (!leftOffer || !rightOffer) {
          continue;
        }

        const pair = orderOpportunityPair(leftOffer, rightOffer);

        const opportunity = classifyHedgeOpportunity({
          providerEventId: pair.left.provider_event_id,
          providerParticipantId: pair.left.provider_participant_id,
          marketKey: pair.left.provider_market_key,
          bookmakerA: pair.left.provider_key,
          bookmakerB: pair.right.provider_key,
          lineA: pair.left.line as number,
          lineB: pair.right.line as number,
          overOddsA: pair.left.over_odds as number,
          underOddsB: pair.right.under_odds as number,
        });

        if (opportunity) {
          opportunities.push(opportunity);
        }
      }
    }
  }

  return opportunities;
}

export function classifyHedgeOpportunity(
  pair: HedgeOpportunityPairInput,
): HedgeOpportunity | null {
  if (
    !Number.isFinite(pair.lineA) ||
    !Number.isFinite(pair.lineB) ||
    !Number.isFinite(pair.overOddsA) ||
    !Number.isFinite(pair.underOddsB)
  ) {
    return null;
  }

  const impliedProbA = americanToImpliedProbability(pair.overOddsA);
  const impliedProbB = americanToImpliedProbability(pair.underOddsB);
  if (impliedProbA === null || impliedProbB === null) {
    return null;
  }

  const lineDiscrepancy = roundTo(Math.abs(pair.lineA - pair.lineB), 4);
  const totalImpliedProb = roundTo(impliedProbA + impliedProbB, 6);
  const arbitragePercentage = roundTo((1 - totalImpliedProb) * 100, 4);

  let type: HedgeOpportunityType | null = null;
  let priority: HedgeOpportunityPriority = 'low';
  let guaranteedProfit: number | null = null;
  let middleGap: number | null = null;
  let winProbability: number | null = null;
  let profitPotential = arbitragePercentage;

  if (arbitragePercentage >= HEDGE_DETECTION_THRESHOLDS.minArbitragePercentage) {
    type = 'arbitrage';
    guaranteedProfit = roundTo(arbitragePercentage, 4);
    priority = classifyArbitragePriority(arbitragePercentage);
  } else if (lineDiscrepancy >= HEDGE_DETECTION_THRESHOLDS.minHedgeDiscrepancy) {
    type = 'hedge';
    priority = classifyHedgePriority(lineDiscrepancy);
  } else if (lineDiscrepancy >= HEDGE_DETECTION_THRESHOLDS.minMiddleGap) {
    type = 'middle';
    middleGap = roundTo(lineDiscrepancy, 4);
    winProbability = roundTo(
      calculateMiddleWinProbability(lineDiscrepancy, impliedProbA, impliedProbB),
      6,
    );
    profitPotential = roundTo(winProbability * 100, 4);
    priority = classifyMiddlePriority(lineDiscrepancy);
  } else {
    return null;
  }

  return {
    providerEventId: pair.providerEventId,
    providerParticipantId: pair.providerParticipantId,
    marketKey: pair.marketKey,
    bookmakerA: pair.bookmakerA,
    bookmakerB: pair.bookmakerB,
    lineA: pair.lineA,
    lineB: pair.lineB,
    overOddsA: pair.overOddsA,
    underOddsB: pair.underOddsB,
    lineDiscrepancy,
    impliedProbA: roundTo(impliedProbA, 6),
    impliedProbB: roundTo(impliedProbB, 6),
    totalImpliedProb,
    arbitragePercentage,
    profitPotential,
    guaranteedProfit,
    middleGap,
    winProbability,
    type,
    priority,
  };
}

export function americanToImpliedProbability(americanOdds: number): number | null {
  if (!Number.isFinite(americanOdds) || americanOdds === 0) {
    return null;
  }

  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  }

  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function classifyArbitragePriority(
  profitPotential: number,
): HedgeOpportunityPriority {
  if (profitPotential >= 5.0) {
    return 'critical';
  }
  if (profitPotential >= 2.0) {
    return 'high';
  }
  if (profitPotential >= 1.0) {
    return 'medium';
  }
  return 'low';
}

function classifyMiddlePriority(lineDiscrepancy: number): HedgeOpportunityPriority {
  if (lineDiscrepancy >= 5.0) {
    return 'critical';
  }
  if (lineDiscrepancy >= 4.0) {
    return 'high';
  }
  if (lineDiscrepancy >= 3.0) {
    return 'medium';
  }
  return 'low';
}

function classifyHedgePriority(lineDiscrepancy: number): HedgeOpportunityPriority {
  if (lineDiscrepancy >= 5.0) {
    return 'high';
  }
  if (lineDiscrepancy >= 4.0) {
    return 'medium';
  }
  if (lineDiscrepancy >= 3.0) {
    return 'low';
  }
  return 'low';
}

function calculateMiddleWinProbability(
  middleGap: number,
  impliedProbA: number,
  impliedProbB: number,
): number {
  const baseProbability = Math.min(0.8, middleGap / 10);
  const avgImpliedProb = (impliedProbA + impliedProbB) / 2;
  return baseProbability * (1 - avgImpliedProb * 0.5);
}

function groupOffersByMarketTuple(offers: ProviderOfferLike[]) {
  const groups = new Map<string, ProviderOfferLike[]>();

  for (const offer of offers) {
    const key = [
      offer.provider_event_id,
      offer.provider_market_key,
      offer.provider_participant_id ?? 'null',
    ].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.push(offer);
    } else {
      groups.set(key, [offer]);
    }
  }

  return groups;
}

function selectLatestOffersByBookmaker(offers: ProviderOfferLike[]) {
  const latestByBookmaker = new Map<string, ProviderOfferLike>();

  for (const offer of [...offers].sort(compareOffersDescending)) {
    if (!latestByBookmaker.has(offer.provider_key)) {
      latestByBookmaker.set(offer.provider_key, offer);
    }
  }

  return [...latestByBookmaker.values()];
}

function orderOpportunityPair(left: ProviderOfferLike, right: ProviderOfferLike) {
  const leftLine = left.line ?? Number.NaN;
  const rightLine = right.line ?? Number.NaN;

  if (leftLine < rightLine) {
    return { left, right };
  }

  if (rightLine < leftLine) {
    return { left: right, right: left };
  }

  return left.provider_key <= right.provider_key
    ? { left, right }
    : { left: right, right: left };
}

function compareOffersDescending(left: ProviderOfferLike, right: ProviderOfferLike) {
  const snapshotComparison = right.snapshot_at.localeCompare(left.snapshot_at);
  if (snapshotComparison !== 0) {
    return snapshotComparison;
  }

  const createdComparison = right.created_at.localeCompare(left.created_at);
  if (createdComparison !== 0) {
    return createdComparison;
  }

  return right.id.localeCompare(left.id);
}

function roundTo(value: number, decimals: number) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
