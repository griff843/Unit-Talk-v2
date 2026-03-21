/**
 * Market Signals — model-vs-market separation features
 *
 * Analysis-only module. Computes signal features from provider_offers
 * data for evaluation against actual outcomes.
 */

import {
  americanToImplied,
  proportionalDevig,
} from '../probability/devig.js';
import { getBookProfile } from '../market/book-profiles.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SignalVector {
  weighted_prob: number;
  movement_score: number;
  disagreement_score: number;
  sharp_retail_delta: number;
}

export interface ProviderOfferSlim {
  provider: string;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  snapshot_at: string;
  is_opening: boolean;
  is_closing: boolean;
}

// ── Movement Score ──────────────────────────────────────────────────────────

/**
 * Compute line movement direction.
 * Positive = line moved up (over harder to hit), negative = line moved down.
 * Normalized to [-1, +1] range.
 */
export function computeMovementScore(
  openingOffers: ProviderOfferSlim[],
  closingOffers: ProviderOfferSlim[],
): number {
  const openLines = openingOffers
    .filter((o) => o.line != null)
    .map((o) => o.line!);
  const closeLines = closingOffers
    .filter((o) => o.line != null)
    .map((o) => o.line!);

  if (openLines.length === 0 || closeLines.length === 0) return 0;

  const meanOpen = openLines.reduce((a, b) => a + b, 0) / openLines.length;
  const meanClose =
    closeLines.reduce((a, b) => a + b, 0) / closeLines.length;
  const delta = meanClose - meanOpen;

  // Normalize: 1 point of line movement ≈ 0.2 score
  return Math.max(-1, Math.min(1, delta * 0.2));
}

// ── Disagreement Score ──────────────────────────────────────────────────────

/**
 * Standard deviation of devigged over-probabilities across books.
 * Higher disagreement = more uncertainty in the market.
 */
export function computeDisagreementScore(
  offers: ProviderOfferSlim[],
): number {
  const probs: number[] = [];

  for (const offer of offers) {
    if (offer.over_odds == null || offer.under_odds == null) continue;
    const overImpl = americanToImplied(offer.over_odds);
    const underImpl = americanToImplied(offer.under_odds);
    if (overImpl <= 0 || underImpl <= 0) continue;

    const devigged = proportionalDevig(overImpl, underImpl);
    if (!devigged) continue;
    probs.push(devigged.overFair);
  }

  if (probs.length < 2) return 0;

  const mean = probs.reduce((a, b) => a + b, 0) / probs.length;
  const variance =
    probs.reduce((sum, p) => sum + (p - mean) ** 2, 0) / probs.length;
  return Math.sqrt(variance);
}

// ── Sharp vs Retail Delta ───────────────────────────────────────────────────

/**
 * Average devigged probability for sharp books minus retail books.
 * Positive = sharps are more bullish on the over than retail.
 */
export function computeSharpRetailDelta(
  offers: ProviderOfferSlim[],
): number {
  const sharpProbs: number[] = [];
  const retailProbs: number[] = [];

  for (const offer of offers) {
    if (offer.over_odds == null || offer.under_odds == null) continue;

    const overImpl = americanToImplied(offer.over_odds);
    const underImpl = americanToImplied(offer.under_odds);
    if (overImpl <= 0 || underImpl <= 0) continue;

    const devigged = proportionalDevig(overImpl, underImpl);
    if (!devigged) continue;
    const profile = getBookProfile(offer.provider);

    if (profile.profile === 'sharp') {
      sharpProbs.push(devigged.overFair);
    } else if (profile.profile === 'retail') {
      retailProbs.push(devigged.overFair);
    }
    // market_maker intentionally excluded — it's the middle ground
  }

  if (sharpProbs.length === 0 || retailProbs.length === 0) return 0;

  const sharpMean =
    sharpProbs.reduce((a, b) => a + b, 0) / sharpProbs.length;
  const retailMean =
    retailProbs.reduce((a, b) => a + b, 0) / retailProbs.length;
  return sharpMean - retailMean;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Compute full signal vector for a market from its provider offers.
 */
export function computeSignalVector(
  openingOffers: ProviderOfferSlim[],
  closingOffers: ProviderOfferSlim[],
  allOffers: ProviderOfferSlim[],
): SignalVector {
  // Weighted prob = mean devigged probability from closing offers (or all if no closing)
  const probeOffers = closingOffers.length > 0 ? closingOffers : allOffers;
  let weightedProb = 0.5;
  const fairProbs: number[] = [];
  for (const offer of probeOffers) {
    if (offer.over_odds == null || offer.under_odds == null) continue;
    const overImpl = americanToImplied(offer.over_odds);
    const underImpl = americanToImplied(offer.under_odds);
    if (overImpl <= 0 || underImpl <= 0) continue;
    const dv = proportionalDevig(overImpl, underImpl);
    if (!dv) continue;
    fairProbs.push(dv.overFair);
  }
  if (fairProbs.length > 0) {
    weightedProb =
      fairProbs.reduce((a, b) => a + b, 0) / fairProbs.length;
  }

  return {
    weighted_prob: weightedProb,
    movement_score: computeMovementScore(openingOffers, closingOffers),
    disagreement_score: computeDisagreementScore(allOffers),
    sharp_retail_delta: computeSharpRetailDelta(allOffers),
  };
}
