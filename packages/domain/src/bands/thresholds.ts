/**
 * Band Thresholds
 *
 * Centralized, versioned threshold definitions for promotion band calibration.
 * All band assignment and downgrade logic references these thresholds.
 */

import type { BandTier, BandLiquidityTier } from './types.js';

/** Bump this when any threshold value changes. */
export const THRESHOLD_VERSION = '1.0.0';

/**
 * Minimum edge required for each initial band tier.
 */
export const EDGE_THRESHOLDS: Record<Exclude<BandTier, 'SUPPRESS'>, number> = {
  'A+': 0.08,
  A: 0.05,
  B: 0.03,
  C: 0.015,
};

/**
 * Minimum selection score (0-100) for each initial band tier.
 * Null means no score requirement for that tier.
 */
export const SELECTION_SCORE_THRESHOLDS: Record<Exclude<BandTier, 'SUPPRESS'>, number | null> = {
  'A+': 85,
  A: 70,
  B: 50,
  C: null,
};

/**
 * Uncertainty caps: if uncertainty exceeds the cap for a band,
 * the pick is downgraded to the next lower band.
 */
export const UNCERTAINTY_CAPS: Record<Exclude<BandTier, 'SUPPRESS'>, number> = {
  'A+': 0.1,
  A: 0.15,
  B: 0.25,
  C: 0.35,
};

/** Uncertainty above this value forces suppression regardless of band. */
export const UNCERTAINTY_SUPPRESS_THRESHOLD = 0.45;

/** CLV forecast thresholds. */
export const CLV_THRESHOLDS = {
  suppressBelow: -0.15,
  downgradeBelow: -0.05,
} as const;

/**
 * Liquidity-based band caps.
 * Picks with the given liquidity tier cannot exceed the specified band.
 */
export const LIQUIDITY_BAND_CAPS: Record<BandLiquidityTier, BandTier> = {
  high: 'A+',
  medium: 'A',
  low: 'B',
  unknown: 'C',
};

/** Market resistance threshold for one-band downgrade. */
export const MARKET_RESISTANCE_DOWNGRADE_THRESHOLD = 0.7;

/** Market resistance above this forces suppression. */
export const MARKET_RESISTANCE_SUPPRESS_THRESHOLD = 0.9;

/**
 * Compare two bands. Returns negative if a is higher, positive if b is higher, 0 if equal.
 */
export function compareBands(a: BandTier, b: BandTier): number {
  const order: BandTier[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'];
  return order.indexOf(a) - order.indexOf(b);
}

/**
 * Return the lower of two bands (further from A+).
 */
export function lowerBand(a: BandTier, b: BandTier): BandTier {
  return compareBands(a, b) >= 0 ? a : b;
}

/**
 * Downgrade a band by one step. SUPPRESS stays SUPPRESS.
 */
export function downgradeOneStep(band: BandTier): BandTier {
  const order: BandTier[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'];
  const idx = order.indexOf(band);
  return idx < order.length - 1 ? order[idx + 1]! : 'SUPPRESS';
}
