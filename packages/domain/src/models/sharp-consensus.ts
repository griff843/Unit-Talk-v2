/**
 * Sharp Weighted Consensus
 *
 * Computes two separate consensus values:
 * - p_equal: equal-weight average of devigged probabilities
 * - p_sharp: sharp-weighted average (sharp=1.5, mm=1.2, retail=1.0)
 *
 * The divergence (p_sharp - p_equal) reveals where sharp books
 * disagree with the broader market.
 */

import {
  americanToImplied,
  proportionalDevig,
} from '../probability/devig.js';
import { getBookProfile } from '../market/book-profiles.js';

import type { ProviderOfferSlim } from '../signals/market-signals.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SharpConsensusResult {
  p_equal: number;
  p_sharp: number;
  sharp_weight_score: number;
  sharp_direction: number;
  books_used: number;
}

// ── Weight Constants ────────────────────────────────────────────────────────

const SHARP_WEIGHTS: Record<string, number> = {
  sharp: 1.5,
  market_maker: 1.2,
  retail: 1.0,
};

// ── Computation ─────────────────────────────────────────────────────────────

/**
 * Compute equal-weight and sharp-weighted consensus from provider offers.
 * Returns null if fewer than 2 usable books.
 */
export function computeSharpConsensus(
  offers: ProviderOfferSlim[],
): SharpConsensusResult | null {
  const bookProbs: { prob: number; weight: number }[] = [];

  for (const offer of offers) {
    if (offer.over_odds == null || offer.under_odds == null) continue;

    const overImpl = americanToImplied(offer.over_odds);
    const underImpl = americanToImplied(offer.under_odds);
    if (overImpl <= 0 || underImpl <= 0) continue;

    const devigged = proportionalDevig(overImpl, underImpl);
    if (!devigged) continue;

    const profile = getBookProfile(offer.provider);
    const weight = SHARP_WEIGHTS[profile.profile] ?? 1.0;

    bookProbs.push({ prob: devigged.overFair, weight });
  }

  if (bookProbs.length === 0) return null;

  // Equal-weight consensus
  const p_equal =
    bookProbs.reduce((sum, b) => sum + b.prob, 0) / bookProbs.length;

  // Sharp-weighted consensus
  const totalWeight = bookProbs.reduce((sum, b) => sum + b.weight, 0);
  const p_sharp =
    bookProbs.reduce((sum, b) => sum + b.prob * b.weight, 0) / totalWeight;

  const delta = p_sharp - p_equal;

  return {
    p_equal,
    p_sharp,
    sharp_weight_score: Math.abs(delta),
    sharp_direction: delta === 0 ? 0 : delta > 0 ? 1 : -1,
    books_used: bookProbs.length,
  };
}
