/**
 * Calibration Types
 *
 * Contracts for probability calibration input/output,
 * calibration configuration, and evaluation results.
 */

import type { BandTier } from '../bands/types.js';

/** Input to the calibration engine. */
export interface CalibrationInput {
  /** Raw model probability (0,1). */
  p_final: number;
  /** Publication band tier. */
  band: Exclude<BandTier, 'SUPPRESS'>;
  /** Optional market type for group-specific calibration. */
  marketType?: string;
  /** Optional sport for group-specific calibration. */
  sport?: string;
}

/** Output from the calibration engine. */
export interface CalibrationOutput {
  /** Calibrated probability (0,1). */
  p_calibrated: number;
  /** Version of the calibration config used. */
  calibrationVersion: string;
  /** Delta between calibrated and raw: p_calibrated - p_final. */
  delta: number;
}

/** A single bin in the reliability curve / Platt scaling table. */
export interface CalibrationBin {
  /** Lower bound of the bin (inclusive). */
  lower: number;
  /** Upper bound of the bin (exclusive, except last bin). */
  upper: number;
  /** Observed win rate in this bin from historical data. */
  observedRate: number;
  /** Number of samples that informed this bin. */
  sampleSize: number;
}

/** Platt scaling parameters: p_calibrated = sigmoid(a * logit(p) + b). */
export interface PlattParams {
  a: number;
  b: number;
}

/** Full calibration configuration for a single scope (global or per-band). */
export interface CalibrationConfig {
  /** Calibration method used. */
  method: 'platt' | 'histogram' | 'identity';
  /** Platt scaling parameters (if method = 'platt'). */
  plattParams?: PlattParams;
  /** Histogram bins (if method = 'histogram'). */
  bins?: CalibrationBin[];
}

/** Top-level calibration profile containing global + per-band configs. */
export interface CalibrationProfile {
  /** Version identifier. */
  version: string;
  /** Default calibration applied to all bands. */
  global: CalibrationConfig;
  /** Optional per-band overrides. */
  byBand?: Partial<Record<Exclude<BandTier, 'SUPPRESS'>, CalibrationConfig>>;
}

/** A single reliability curve bucket for visualization/analysis. */
export interface ReliabilityBucket {
  /** Bin midpoint (predicted probability). */
  predicted: number;
  /** Observed win rate in this bin. */
  observed: number;
  /** Number of samples in this bin. */
  count: number;
  /** Bin lower bound. */
  lower: number;
  /** Bin upper bound. */
  upper: number;
}

/** Calibration metrics for a set of predictions. */
export interface CalibrationMetrics {
  /** Brier score (lower = better). */
  brierScore: number;
  /** Log loss (lower = better). */
  logLoss: number;
  /** Expected Calibration Error (lower = better). */
  ece: number;
  /** Reliability curve buckets. */
  reliabilityCurve: ReliabilityBucket[];
  /** Sample size (non-push outcomes). */
  sampleSize: number;
}

/** Comparison of pre- and post-calibration metrics. */
export interface CalibrationComparison {
  /** Metrics using raw p_final. */
  preCal: CalibrationMetrics;
  /** Metrics using p_calibrated. */
  postCal: CalibrationMetrics;
  /** Improvement deltas (negative = improvement for error metrics). */
  improvement: {
    brierDelta: number;
    logLossDelta: number;
    eceDelta: number;
  };
  /** True if calibration improved or preserved Brier score. */
  brierImproved: boolean;
  /** True if log loss did not materially worsen (< 0.01 increase). */
  logLossAcceptable: boolean;
}

/** Outcome record used for calibration analysis. */
export interface CalibrationOutcomeRecord {
  /** Raw model probability. */
  p_final: number;
  /** Calibrated probability. */
  p_calibrated: number;
  /** Actual outcome. */
  outcome: 'WIN' | 'LOSS' | 'PUSH';
  /** Band tier. */
  band: Exclude<BandTier, 'SUPPRESS'>;
}
