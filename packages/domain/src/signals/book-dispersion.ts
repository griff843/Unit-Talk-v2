/**
 * Book Dispersion Signal
 *
 * @alias dispersion_score — delegates to `computeDisagreementScore` in market-signals.ts.
 * That function is the canonical single implementation of population std-dev over devigged
 * over-probabilities. `computeBookDispersion` is preserved for callers that need the richer
 * DispersionResult shape (range, books_count, sharp_count), but its core numeric score is
 * now produced by one shared code path.
 */

import {
  americanToImplied,
  proportionalDevig,
} from '../probability/devig.js';
import { getBookProfile } from '../market/book-profiles.js';
import { computeDisagreementScore } from './market-signals.js';

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
 *
 * `dispersion_score` delegates to `computeDisagreementScore` (market-signals.ts) —
 * the single canonical computation of population std-dev of devigged over-probabilities.
 * Before UTV2-1203 this function contained a duplicate implementation; that body has
 * been removed and replaced with a delegation call so there is exactly one code path.
 *
 * `range`, `books_count`, and `sharp_count` are computed here because they are
 * additional outputs not provided by `computeDisagreementScore`.
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

  const minProb = Math.min(...probs);
  const maxProb = Math.max(...probs);

  return {
    // Canonical single-path computation — delegates to market-signals.ts
    dispersion_score: computeDisagreementScore(offers),
    range: maxProb - minProb,
    books_count: probs.length,
    sharp_count: sharpCount,
  };
}
