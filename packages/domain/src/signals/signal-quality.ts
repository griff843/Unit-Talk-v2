/**
 * Signal Quality Layer
 *
 * Final pipeline stage: converts blend output into ranked,
 * actionable betting signals with quality scoring and bet sizing.
 *
 * Inputs:  BlendOutput + StatContext
 * Outputs: SignalOutput with edge, Z-score, quality score, bet size
 */

import type { BlendOutput } from '../models/stat-market-blend.js';

// ── Input Context ────────────────────────────────────────────────────────────

export interface StatContext {
  /** Projected stat mean from stat-distribution engine (stat units) */
  expected_value: number;
  /** Model variance from stat-distribution engine (stat units²) */
  variance: number;
  /** Betting line to compare against (stat units) */
  line: number;
  /** Model confidence [0, 1] from stat-distribution engine */
  confidence: number;
}

// ── Output Contract ──────────────────────────────────────────────────────────

export interface SignalOutput {
  /** Edge = P_final - P_market */
  edge: number;
  /** Direction of the edge */
  edge_direction: 'over' | 'under';
  /** |edge| × confidence × Z_score_normalized */
  signal_strength: number;
  /** z = (expected_value - line) / sqrt(variance) — stat-space Z-score */
  z_score: number;
  /** Composite quality score [0, 1] */
  signal_quality_score: number;
  /** Stat model confidence passed through */
  confidence: number;
  /** Fractional Kelly bet size as fraction of bankroll */
  recommended_bet_size: number;
  /** sqrt(variance) / expected_value — coefficient of variation (dimensionless) */
  model_uncertainty: number;
  /** Full blend output for traceability */
  blend: BlendOutput;
  /** Version tag */
  signal_version: string;
}

export type SignalResult =
  | { ok: true; data: SignalOutput }
  | { ok: false; reason: string };

// ── Configuration ────────────────────────────────────────────────────────────

export interface SignalConfig {
  /** Kelly fraction multiplier (0.25 = quarter-Kelly, 0.5 = half-Kelly). Default: 0.25 */
  kelly_fraction?: number;
  /** Minimum edge to produce a signal (default 0.02) */
  min_edge?: number;
  /** Maximum bet size as fraction of bankroll (default 0.05 = 5%) */
  max_bet_size?: number;
}

const DEFAULT_KELLY_FRACTION = 0.25;
const DEFAULT_MIN_EDGE = 0.02;
const DEFAULT_MAX_BET_SIZE = 0.05;
const SIGNAL_VERSION = 'signal-quality-v1.1';

// ── Core Computation ─────────────────────────────────────────────────────────

/**
 * Compute signal quality from blend output and stat projection context.
 */
export function computeSignalQuality(
  blend: BlendOutput,
  stat: StatContext,
  config: SignalConfig = {},
): SignalResult {
  // ── Validation ──────────────────────────────────────────────────────────
  if (stat.variance <= 0) {
    return {
      ok: false,
      reason: `Invalid variance: ${stat.variance} (must be > 0)`,
    };
  }
  if (stat.confidence < 0 || stat.confidence > 1) {
    return {
      ok: false,
      reason: `Invalid confidence: ${stat.confidence} (must be [0, 1])`,
    };
  }
  if (blend.p_final <= 0 || blend.p_final >= 1) {
    return {
      ok: false,
      reason: `Invalid p_final: ${blend.p_final} (must be in (0,1))`,
    };
  }
  if (stat.expected_value <= 0) {
    return {
      ok: false,
      reason: `Invalid expected_value: ${stat.expected_value} (must be > 0)`,
    };
  }
  if (stat.line < 0) {
    return {
      ok: false,
      reason: `Invalid line: ${stat.line} (must be >= 0)`,
    };
  }

  const kellyFraction = config.kelly_fraction ?? DEFAULT_KELLY_FRACTION;
  const minEdge = config.min_edge ?? DEFAULT_MIN_EDGE;
  const maxBetSize = config.max_bet_size ?? DEFAULT_MAX_BET_SIZE;

  if (kellyFraction <= 0 || kellyFraction > 1) {
    return {
      ok: false,
      reason: `Invalid kelly_fraction: ${kellyFraction} (must be in (0, 1])`,
    };
  }

  // ── Edge ────────────────────────────────────────────────────────────────
  const edge = round4(blend.p_final - blend.p_market);
  const edgeDirection: 'over' | 'under' = edge >= 0 ? 'over' : 'under';

  // ── Z-Score (stat-space) ────────────────────────────────────────────────
  const sigma = Math.sqrt(stat.variance);
  const zScore = round4((stat.expected_value - stat.line) / sigma);

  // ── Model Uncertainty ───────────────────────────────────────────────────
  const modelUncertainty = round4(sigma / stat.expected_value);

  // ── Signal Strength ─────────────────────────────────────────────────────
  const zNormalized = Math.abs(zScore) / (1 + Math.abs(zScore));
  const signalStrength = round4(
    Math.abs(edge) * stat.confidence * zNormalized,
  );

  // ── Signal Quality Score ──────────────────────────────────────────────
  const edgeComponent = clamp(Math.abs(edge) / 0.1, 0, 1);
  const confidenceComponent = stat.confidence;
  const zComponent = clamp(Math.abs(zScore) / 3, 0, 1);
  const uncertaintyPenalty = 1 - clamp(modelUncertainty / 2, 0, 0.5);

  const qualityScore = round4(
    0.3 * edgeComponent +
      0.25 * confidenceComponent +
      0.25 * zComponent +
      0.2 * uncertaintyPenalty,
  );

  // ── Recommended Bet Size ──────────────────────────────────────────────
  let betSize = 0;
  if (Math.abs(edge) >= minEdge) {
    const kellyFull = edge / (1 - blend.p_market);
    betSize = round4(clamp(kellyFull * kellyFraction, 0, maxBetSize));
  }

  return {
    ok: true,
    data: {
      edge,
      edge_direction: edgeDirection,
      signal_strength: signalStrength,
      z_score: zScore,
      signal_quality_score: qualityScore,
      confidence: round4(stat.confidence),
      recommended_bet_size: betSize,
      model_uncertainty: modelUncertainty,
      blend,
      signal_version: SIGNAL_VERSION,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
