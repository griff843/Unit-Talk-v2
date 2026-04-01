export type DevigMethod = 'proportional' | 'shin' | 'power' | 'logit';

export type BookProfile = 'retail' | 'market_maker' | 'sharp';
export type LiquidityTier = 'low' | 'medium' | 'high';
export type DataQuality = 'good' | 'partial' | 'suspect';

export interface BookOffer {
  bookId: string;
  bookName: string;
  overOdds: number;
  underOdds: number;
  bookProfile: BookProfile;
  liquidityTier: LiquidityTier;
  dataQuality: DataQuality;
}

export interface DevigedBook {
  bookId: string;
  bookName: string;
  overImplied: number;
  underImplied: number;
  overround: number;
  overFair: number;
  underFair: number;
  devigMethod: DevigMethod;
  rawWeight: number;
  normalizedWeight: number;
}

export interface BookWeightBreakdown {
  bookId: string;
  liquidityWeight: number;
  sharpWeight: number;
  dataQualityWeight: number;
  rawWeight: number;
  normalizedWeight: number;
}

export interface ConsensusResultOk {
  ok: true;
  overConsensus: number;
  underConsensus: number;
  devigMethod: DevigMethod;
  consensusWeights: Record<string, BookWeightBreakdown>;
  books: DevigedBook[];
  booksUsed: number;
}

export interface ConsensusResultFail {
  ok: false;
  reason: ConsensusFailReason;
  reasonDetail: string;
  booksReceived: number;
}

export type ConsensusFailReason =
  | 'INSUFFICIENT_BOOKS'
  | 'INVALID_ODDS'
  | 'ZERO_WEIGHT'
  | 'COMPUTATION_ERROR';

export type ConsensusResult = ConsensusResultOk | ConsensusResultFail;

export interface EdgeResult {
  edge: number;
  ev: number;
  evPercent: number;
}

export const MIN_BOOKS_FOR_CONSENSUS = 2;

export const LIQUIDITY_WEIGHTS: Record<LiquidityTier, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.5
};

export const SHARP_WEIGHTS: Record<BookProfile, number> = {
  retail: 1.0,
  market_maker: 1.2,
  sharp: 1.5
};

export const DATA_QUALITY_WEIGHTS: Record<DataQuality, number> = {
  good: 1.0,
  partial: 0.7,
  suspect: 0.3
};

export const PROBABILITY_MODEL_VERSION = 'prob_v2.0.0_syndicate_layered';

export function roundTo(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

export function americanToImplied(odds: number): number {
  if (odds === 0) {
    return 0.5;
  }

  const implied =
    odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);

  return roundTo(implied, 6);
}

export function calculateOverround(
  overImplied: number,
  underImplied: number
): number {
  return roundTo(overImplied + underImplied, 6);
}

export function proportionalDevig(
  overImplied: number,
  underImplied: number
): { overFair: number; underFair: number; overround: number } | null {
  const overround = calculateOverround(overImplied, underImplied);

  if (overround === 0 || !Number.isFinite(overround)) {
    return null;
  }

  return {
    overFair: roundTo(overImplied / overround, 6),
    underFair: roundTo(underImplied / overround, 6),
    overround
  };
}

/**
 * Shin devig — models bookmaker margin as arising from insider trading.
 *
 * Iteratively solves for the Shin parameter z (the fraction of bettors who are
 * insiders) such that the sum of fair probabilities equals 1.  For n outcomes
 * with implied probabilities p_i and total overround S = sum(p_i):
 *
 *   fair_i = ( sqrt(z^2 + 4*(1-z)*(p_i^2 / S)) - z ) / ( 2*(1-z) )
 *
 * z is found by bisection on [0, 1) so that sum(fair_i) = 1.
 *
 * Generalised here for a 2-outcome market.
 */
export function shinDevig(
  overImplied: number,
  underImplied: number
): { overFair: number; underFair: number; overround: number } | null {
  const overround = calculateOverround(overImplied, underImplied);
  if (overround <= 1 || !Number.isFinite(overround)) {
    // If overround <= 1, there is no margin to remove; fall back to proportional.
    return proportionalDevig(overImplied, underImplied);
  }

  const probs = [overImplied, underImplied];
  const S = overround; // sum of implied probabilities

  function shinFair(z: number): number[] {
    return probs.map(
      (p) =>
        (Math.sqrt(z * z + 4 * (1 - z) * (p * p) / S) - z) / (2 * (1 - z))
    );
  }

  // Bisect to find z such that sum(shinFair(z)) == 1
  let lo = 0;
  let hi = 0.999;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fairProbs = shinFair(mid);
    const sum = fairProbs[0]! + fairProbs[1]!;
    if (sum > 1) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (Math.abs(sum - 1) < 1e-12) break;
  }

  const z = (lo + hi) / 2;
  const fair = shinFair(z);

  const overFair = fair[0]!;
  const underFair = fair[1]!;

  if (!Number.isFinite(overFair) || !Number.isFinite(underFair)) {
    return null;
  }

  return {
    overFair: roundTo(overFair, 6),
    underFair: roundTo(underFair, 6),
    overround
  };
}

/**
 * Power devig — finds the exponent k such that sum(p_i^k) = 1.
 *
 * Each fair probability is p_i^k.  k > 1 always exists when the overround > 1.
 * Found by bisection on k in [1, 100].
 *
 * The optional `k` parameter is kept for backward compatibility: when provided
 * explicitly, the function uses the given k directly (legacy behaviour).
 * When omitted (undefined), the function solves for the correct k.
 */
export function powerDevig(
  overImplied: number,
  underImplied: number,
  k?: number
): { overFair: number; underFair: number; overround: number } | null {
  const overround = calculateOverround(overImplied, underImplied);

  if (k !== undefined) {
    // Legacy path: use the explicit k value
    const overPower = overImplied ** k;
    const underPower = underImplied ** k;
    const sumPower = overPower + underPower;
    if (sumPower === 0 || !Number.isFinite(sumPower)) return null;
    return {
      overFair: roundTo(overPower / sumPower, 6),
      underFair: roundTo(underPower / sumPower, 6),
      overround
    };
  }

  // Solve for k such that overImplied^k + underImplied^k = 1
  if (overround <= 1 || !Number.isFinite(overround)) {
    return proportionalDevig(overImplied, underImplied);
  }

  let lo = 1.0;
  let hi = 100.0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const sum = overImplied ** mid + underImplied ** mid;
    if (sum > 1) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (Math.abs(sum - 1) < 1e-12) break;
  }

  const solvedK = (lo + hi) / 2;
  const overFair = overImplied ** solvedK;
  const underFair = underImplied ** solvedK;

  if (!Number.isFinite(overFair) || !Number.isFinite(underFair)) {
    return null;
  }

  return {
    overFair: roundTo(overFair, 6),
    underFair: roundTo(underFair, 6),
    overround
  };
}

/**
 * Logit (additive) devig — removes equal log-odds from each outcome.
 *
 * Converts implied probabilities to log-odds (logit), subtracts a constant c
 * from each so that the resulting probabilities sum to 1, then converts back.
 *
 *   logit(p) = ln(p / (1 - p))
 *   fair_logit_i = logit(p_i) - c
 *   fair_i = 1 / (1 + exp(-fair_logit_i))
 *
 * c is found by bisection.
 */
export function logitDevig(
  overImplied: number,
  underImplied: number
): { overFair: number; underFair: number; overround: number } | null {
  const overround = calculateOverround(overImplied, underImplied);
  if (overround <= 1 || !Number.isFinite(overround)) {
    return proportionalDevig(overImplied, underImplied);
  }

  // Guard against extreme probabilities that would produce infinite logits
  if (
    overImplied <= 0 || overImplied >= 1 ||
    underImplied <= 0 || underImplied >= 1
  ) {
    return null;
  }

  const logit = (p: number) => Math.log(p / (1 - p));
  const invLogit = (x: number) => 1 / (1 + Math.exp(-x));

  const overLogit = logit(overImplied);
  const underLogit = logit(underImplied);

  // Bisect for c such that invLogit(overLogit - c) + invLogit(underLogit - c) = 1
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const sum = invLogit(overLogit - mid) + invLogit(underLogit - mid);
    if (sum > 1) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (Math.abs(sum - 1) < 1e-12) break;
  }

  const c = (lo + hi) / 2;
  const overFair = invLogit(overLogit - c);
  const underFair = invLogit(underLogit - c);

  if (!Number.isFinite(overFair) || !Number.isFinite(underFair)) {
    return null;
  }

  return {
    overFair: roundTo(overFair, 6),
    underFair: roundTo(underFair, 6),
    overround
  };
}

export function applyDevig(
  overImplied: number,
  underImplied: number,
  method: DevigMethod
): { overFair: number; underFair: number; overround: number } | null {
  switch (method) {
    case 'proportional':
      return proportionalDevig(overImplied, underImplied);
    case 'shin':
      return shinDevig(overImplied, underImplied);
    case 'power':
      return powerDevig(overImplied, underImplied);
    case 'logit':
      return logitDevig(overImplied, underImplied);
    default:
      return proportionalDevig(overImplied, underImplied);
  }
}

export function calculateBookWeight(
  bookProfile: BookProfile,
  liquidityTier: LiquidityTier,
  dataQuality: DataQuality
): {
  liquidityWeight: number;
  sharpWeight: number;
  dataQualityWeight: number;
  rawWeight: number;
} {
  const liquidityWeight = LIQUIDITY_WEIGHTS[liquidityTier];
  const sharpWeight = SHARP_WEIGHTS[bookProfile];
  const dataQualityWeight = DATA_QUALITY_WEIGHTS[dataQuality];

  return {
    liquidityWeight,
    sharpWeight,
    dataQualityWeight,
    rawWeight: roundTo(liquidityWeight * sharpWeight * dataQualityWeight, 6)
  };
}

export function computeConsensus(
  offers: BookOffer[],
  method: DevigMethod = 'proportional'
): ConsensusResult {
  if (offers.length < MIN_BOOKS_FOR_CONSENSUS) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_BOOKS',
      reasonDetail: `Need ${MIN_BOOKS_FOR_CONSENSUS} books, got ${offers.length}`,
      booksReceived: offers.length
    };
  }

  const devigedBooks: DevigedBook[] = [];
  const weightBreakdowns: Record<string, BookWeightBreakdown> = {};
  let totalWeight = 0;
  let invalidBooks = 0;

  for (const offer of offers) {
    if (!Number.isFinite(offer.overOdds) || !Number.isFinite(offer.underOdds)) {
      invalidBooks += 1;
      continue;
    }

    const overImplied = americanToImplied(offer.overOdds);
    const underImplied = americanToImplied(offer.underOdds);

    if (
      overImplied <= 0 ||
      underImplied <= 0 ||
      overImplied >= 1 ||
      underImplied >= 1
    ) {
      invalidBooks += 1;
      continue;
    }

    const devigResult = applyDevig(overImplied, underImplied, method);
    if (!devigResult) {
      invalidBooks += 1;
      continue;
    }

    const { overFair, underFair, overround } = devigResult;
    const weights = calculateBookWeight(
      offer.bookProfile,
      offer.liquidityTier,
      offer.dataQuality
    );

    totalWeight += weights.rawWeight;

    devigedBooks.push({
      bookId: offer.bookId,
      bookName: offer.bookName,
      overImplied,
      underImplied,
      overround,
      overFair,
      underFair,
      devigMethod: method,
      rawWeight: weights.rawWeight,
      normalizedWeight: 0
    });

    weightBreakdowns[offer.bookId] = {
      bookId: offer.bookId,
      liquidityWeight: weights.liquidityWeight,
      sharpWeight: weights.sharpWeight,
      dataQualityWeight: weights.dataQualityWeight,
      rawWeight: weights.rawWeight,
      normalizedWeight: 0
    };
  }

  if (devigedBooks.length < MIN_BOOKS_FOR_CONSENSUS) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_BOOKS',
      reasonDetail: `Need ${MIN_BOOKS_FOR_CONSENSUS} valid books, got ${devigedBooks.length} (${invalidBooks} invalid)`,
      booksReceived: offers.length
    };
  }

  if (totalWeight === 0 || !Number.isFinite(totalWeight)) {
    return {
      ok: false,
      reason: 'ZERO_WEIGHT',
      reasonDetail: 'Total book weight is zero or invalid',
      booksReceived: offers.length
    };
  }

  for (const book of devigedBooks) {
    book.normalizedWeight = roundTo(book.rawWeight / totalWeight, 6);
    const breakdown = weightBreakdowns[book.bookId];
    if (breakdown) {
      breakdown.normalizedWeight = book.normalizedWeight;
    }
  }

  let overConsensus = 0;
  let underConsensus = 0;
  for (const book of devigedBooks) {
    overConsensus += book.overFair * book.normalizedWeight;
    underConsensus += book.underFair * book.normalizedWeight;
  }

  const consensusSum = overConsensus + underConsensus;
  if (consensusSum > 0 && Math.abs(consensusSum - 1) > 0.0001) {
    overConsensus /= consensusSum;
    underConsensus /= consensusSum;
  }

  if (!Number.isFinite(overConsensus) || !Number.isFinite(underConsensus)) {
    return {
      ok: false,
      reason: 'COMPUTATION_ERROR',
      reasonDetail: 'Consensus computation produced non-finite values',
      booksReceived: offers.length
    };
  }

  return {
    ok: true,
    overConsensus: roundTo(overConsensus, 6),
    underConsensus: roundTo(underConsensus, 6),
    devigMethod: method,
    consensusWeights: weightBreakdowns,
    books: devigedBooks,
    booksUsed: devigedBooks.length
  };
}

export function calculateEdge(
  pModel: number,
  pMarket: number,
  decimalOdds: number
): EdgeResult {
  const edge = roundTo(pModel - pMarket, 6);
  const payout = decimalOdds - 1;
  const ev = roundTo(pModel * payout - (1 - pModel), 6);
  const evPercent = roundTo(ev * 100, 4);

  return { edge, ev, evPercent };
}

export function calculateCLVProb(
  entryDevigProb: number,
  closingDevigProb: number
): number {
  return roundTo(closingDevigProb - entryDevigProb, 6);
}
