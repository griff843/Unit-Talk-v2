/**
 * Book Dispersion Signal
 *
 * Enhanced market disagreement features. Adds range and sharp book count
 * for richer dispersion profiling.
 */

import {
  americanToImplied,
  proportionalDevig,
} from '../probability/devig.js';
import { getBookProfile } from '../market/book-profiles.js';

import type { ProviderOfferSlim } from './market-signals.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DispersionResult {
  dispersion_score: number;
  range: number;
  books_count: number;
  sharp_count: number;
}

// ── Computation ─────────────────────────────────────────────────────────────

/**
 * Compute book dispersion from provider offers.
 * dispersion_score = std dev of devigged over-probabilities.
 * range = max - min fair probability.
 */
export function computeBookDispersion(
  offers: ProviderOfferSlim[],
): DispersionResult {
  const probs: number[] = [];
  let sharpCount = 0;

  for (const offer of offers) {
    if (offer.over_odds == null || offer.under_odds == null) continue;

    const overImpl = americanToImplied(offer.over_odds);
    const underImpl = americanToImplied(offer.under_odds);
    if (overImpl <= 0 || underImpl <= 0) continue;

    const devigged = proportionalDevig(overImpl, underImpl);
    if (!devigged) continue;

    probs.push(devigged.overFair);

    const profile = getBookProfile(offer.provider);
    if (profile.profile === 'sharp') sharpCount++;
  }

  if (probs.length < 2) {
    return {
      dispersion_score: 0,
      range: 0,
      books_count: probs.length,
      sharp_count: sharpCount,
    };
  }

  const mean = probs.reduce((a, b) => a + b, 0) / probs.length;
  const variance =
    probs.reduce((sum, p) => sum + (p - mean) ** 2, 0) / probs.length;
  const stdDev = Math.sqrt(variance);

  const minProb = Math.min(...probs);
  const maxProb = Math.max(...probs);

  return {
    dispersion_score: stdDev,
    range: maxProb - minProb,
    books_count: probs.length,
    sharp_count: sharpCount,
  };
}
