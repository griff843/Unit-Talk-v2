/**
 * Real Edge Service — model probability vs devigged market consensus
 *
 * This replaces the confidence delta ("fake edge") with a real edge
 * calculation that compares the model's win probability against the
 * devigged Pinnacle sharp line or multi-book consensus.
 *
 * Real edge = model_probability - devigged_market_probability
 *
 * Where:
 * - model_probability = pick.confidence (capper's estimated win probability)
 * - devigged_market_probability = Pinnacle or consensus devigged line
 *
 * If Pinnacle data is available, use Pinnacle (sharpest line).
 * If not, fall back to multi-book consensus.
 * If no market data, fall back to confidence delta (legacy behavior).
 *
 * Issue: UTV2-198 (Sprint D)
 */

import type { ProviderOfferRepository } from '@unit-talk/db';
import { americanToImplied, proportionalDevig, roundTo, classifyContrarianism, type ContrarySignal } from '@unit-talk/domain';

export interface RealEdgeResult {
  /** Real edge: model probability - market probability */
  realEdge: number;
  /** Model's estimated win probability (from confidence) */
  modelProbability: number;
  /** Market's devigged probability for this side */
  marketProbability: number;
  /** Source of market probability */
  marketSource: 'pinnacle' | 'consensus' | 'sgo' | 'confidence-delta';
  /** Number of books in consensus (1 for single-book) */
  bookCount: number;
  /** Whether the model has positive edge vs market */
  hasRealEdge: boolean;
  /** Contrarian classification — present when model diverges from market */
  contrarySignal?: ContrarySignal;
}

export interface RealEdgeOptions {
  /** Capper's confidence (0-1 win probability estimate) */
  confidence: number;
  /** Normalized market key for looking up offers */
  marketKey: string;
  /** The pick's selection side (for over/under resolution) */
  selection: string;
  /** Submitted American odds (for confidence delta fallback) */
  submittedOdds: number;
  /** Provider offers repository */
  providerOffers: ProviderOfferRepository;
}

/**
 * Compute real edge against market consensus.
 *
 * Priority order:
 * 1. Pinnacle devigged line (sharpest available)
 * 2. Multi-book devigged consensus (DK + FD + MGM average)
 * 3. SGO devigged line (existing single-provider)
 * 4. Confidence delta fallback (confidence - implied from submitted odds)
 */
export async function computeRealEdge(
  options: RealEdgeOptions,
): Promise<RealEdgeResult> {
  const { confidence, marketKey, selection, submittedOdds, providerOffers } = options;

  // Try Pinnacle first (sharpest line)
  const pinnacleEdge = await tryProviderEdge(
    confidence, marketKey, selection, 'odds-api:pinnacle', providerOffers,
  );
  if (pinnacleEdge) {
    const marketSource = 'pinnacle' as const;
    const contrarySignal = classifyContrarianism(pinnacleEdge.modelProbability, pinnacleEdge.marketProbability, marketSource);
    return { ...pinnacleEdge, marketSource, contrarySignal };
  }

  // Try multi-book consensus
  const consensusEdge = await tryConsensusEdge(
    confidence, marketKey, selection, providerOffers,
  );
  if (consensusEdge) {
    const contrarySignal = classifyContrarianism(consensusEdge.modelProbability, consensusEdge.marketProbability, consensusEdge.marketSource);
    return { ...consensusEdge, contrarySignal };
  }

  // Try SGO (existing single provider)
  const sgoEdge = await tryProviderEdge(
    confidence, marketKey, selection, 'sgo', providerOffers,
  );
  if (sgoEdge) {
    const marketSource = 'sgo' as const;
    const contrarySignal = classifyContrarianism(sgoEdge.modelProbability, sgoEdge.marketProbability, marketSource);
    return { ...sgoEdge, marketSource, contrarySignal };
  }

  // Fallback: confidence delta (not real edge, but better than nothing)
  const impliedFromOdds = americanToImplied(submittedOdds);
  const confidenceDelta = roundTo(confidence - impliedFromOdds, 6);
  const contrarySignal = classifyContrarianism(confidence, impliedFromOdds, 'confidence-delta');

  return {
    realEdge: confidenceDelta,
    modelProbability: confidence,
    marketProbability: impliedFromOdds,
    marketSource: 'confidence-delta',
    bookCount: 0,
    hasRealEdge: confidenceDelta > 0,
    contrarySignal,
  };
}

/**
 * Try to compute edge against a single provider's devigged line.
 */
async function tryProviderEdge(
  confidence: number,
  marketKey: string,
  selection: string,
  providerKey: string,
  providerOffers: ProviderOfferRepository,
): Promise<Omit<RealEdgeResult, 'marketSource'> | null> {
  const participantKey = resolveSelectionParticipantKey(marketKey, selection);
  const matching = await providerOffers.findLatestByMarketKey(
    marketKey,
    providerKey,
    participantKey,
  );

  if (!matching) return null;
  if (!Number.isFinite(matching.over_odds) || !Number.isFinite(matching.under_odds)) return null;

  const overImplied = americanToImplied(matching.over_odds as number);
  const underImplied = americanToImplied(matching.under_odds as number);
  const devigged = proportionalDevig(overImplied, underImplied);
  if (!devigged) return null;

  const marketProbability = resolveSelectionFairProbability(marketKey, selection, devigged);

  const realEdge = roundTo(confidence - marketProbability, 6);

  return {
    realEdge,
    modelProbability: confidence,
    marketProbability,
    bookCount: 1,
    hasRealEdge: realEdge > 0,
  };
}

/**
 * Compute edge against multi-book consensus (average devigged probability).
 */
async function tryConsensusEdge(
  confidence: number,
  marketKey: string,
  selection: string,
  providerOffers: ProviderOfferRepository,
): Promise<RealEdgeResult | null> {
  const consensusProviders = [
    'odds-api:pinnacle',
    'odds-api:draftkings',
    'odds-api:fanduel',
    'odds-api:betmgm',
  ];

  let totalProb = 0;
  let bookCount = 0;

  for (const providerKey of consensusProviders) {
    const participantKey = resolveSelectionParticipantKey(marketKey, selection);
    const matching = await providerOffers.findLatestByMarketKey(
      marketKey,
      providerKey,
      participantKey,
    );

    if (!matching) continue;
    if (!Number.isFinite(matching.over_odds) || !Number.isFinite(matching.under_odds)) continue;

    const overImplied = americanToImplied(matching.over_odds as number);
    const underImplied = americanToImplied(matching.under_odds as number);
    const devigged = proportionalDevig(overImplied, underImplied);
    if (!devigged) continue;

    totalProb += resolveSelectionFairProbability(marketKey, selection, devigged);
    bookCount++;
  }

  if (bookCount < 2) return null; // Need at least 2 books for consensus

  const consensusProb = totalProb / bookCount;
  const realEdge = roundTo(confidence - consensusProb, 6);

  return {
    realEdge,
    modelProbability: confidence,
    marketProbability: consensusProb,
    marketSource: 'consensus',
    bookCount,
    hasRealEdge: realEdge > 0,
  };
}

function resolveSelectionParticipantKey(marketKey: string, selection: string): string | null | undefined {
  if (marketKey !== 'moneyline') {
    return undefined;
  }

  const normalized = selection.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveSelectionFairProbability(
  marketKey: string,
  selection: string,
  devigged: { overFair: number; underFair: number },
): number {
  if (marketKey === 'moneyline') {
    return devigged.overFair;
  }

  return /\bunder\b/i.test(selection) ? devigged.underFair : devigged.overFair;
}
