/**
 * Edge Decay Detector — applies significance testing across consecutive performance cohorts
 * to detect degradation in model edge (model_alpha_bps).
 *
 * Pure computation: no I/O, no DB, no HTTP, no env.
 *
 * Detection model:
 *   For each consecutive cohort pair, a two-sample z-test compares mean model_alpha_bps
 *   across attributed records. A significant negative delta (p < significance_level and
 *   |delta| > min_delta_bps) marks that pair as decaying. When consecutive decaying pairs
 *   reach the threshold, the signal escalates.
 *
 * Reproducibility: given the same PerformanceCohort inputs and threshold,
 * detectEdgeDecay always returns the same EdgeDecaySignal.
 *
 * Fail closed: returns { ok: false } when cohorts are invalid or count < min_cohorts.
 * Returns status: 'insufficient_data' when cohorts lack attributed records for testing.
 * Never silently returns no_signal when data is missing.
 */

import type { PerformanceCohort } from '../cohorts/performance-cohort.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EdgeDecayThreshold {
  /** Minimum number of cohorts required for detection. */
  readonly min_cohorts: number;
  /** p-value threshold for significance (one-tailed decay test). */
  readonly significance_level: number;
  /** Minimum absolute delta in mean model alpha (bps) to consider practically significant. */
  readonly min_delta_bps: number;
  /** Consecutive significant pairs required to escalate. */
  readonly consecutive_to_escalate: number;
}

export type EdgeDecayStatus = 'no_signal' | 'degrading' | 'recovering' | 'insufficient_data';

/** Result of a consecutive-pair significance test. */
export interface CohortSignificanceResult {
  readonly earlier_cohort_id: string;
  readonly later_cohort_id: string;
  readonly earlier_mean_model_alpha_bps: number;
  readonly later_mean_model_alpha_bps: number;
  /** later_mean - earlier_mean (negative = decay). */
  readonly delta_model_alpha_bps: number;
  /** z-score for the difference; null when variance is zero or n < 2. */
  readonly z_score: number | null;
  /** One-tailed p-value (P(Z ≤ z)); null when z_score is null. */
  readonly p_value: number | null;
  readonly is_significant: boolean;
}

export interface EdgeDecaySignal {
  readonly detector_version: string;
  readonly cohort_ids: readonly string[];
  readonly status: EdgeDecayStatus;
  /** All consecutive pairs that met both the statistical and practical threshold. */
  readonly significant_comparisons: readonly CohortSignificanceResult[];
  /** Linear trend slope in model_alpha_bps per cohort (negative = decay trend). */
  readonly trend_slope_bps_per_cohort: number | null;
  /** True when should_escalate threshold is met; first-class escalation event. */
  readonly should_escalate: boolean;
  readonly threshold: EdgeDecayThreshold;
  readonly is_reproducible: boolean;
}

export type DetectEdgeDecayResult =
  | { ok: true; signal: EdgeDecaySignal }
  | { ok: false; reason: string };

// ── Constants ─────────────────────────────────────────────────────────────────

export const DETECTOR_VERSION = '1.0.0';

export const DEFAULT_EDGE_DECAY_THRESHOLD: EdgeDecayThreshold = {
  min_cohorts: 2,
  significance_level: 0.05,
  min_delta_bps: 50,
  consecutive_to_escalate: 1,
};

// ── Core detection ────────────────────────────────────────────────────────────

/**
 * Detect edge decay across consecutive performance cohorts.
 * Fail-closed: returns { ok: false } when cohorts are invalid or insufficient.
 */
export function detectEdgeDecay(
  cohorts: readonly PerformanceCohort[],
  threshold: EdgeDecayThreshold = DEFAULT_EDGE_DECAY_THRESHOLD,
): DetectEdgeDecayResult {
  const errors = validateCohorts(cohorts, threshold);
  if (errors.length > 0) {
    return { ok: false, reason: errors.join('; ') };
  }

  const cohort_ids = cohorts.map((c) => c.cohort_id);

  // Extract attributed alpha values and compute stats per cohort.
  const cohortStats = cohorts.map((c) => {
    const alphas = extractAttributedAlpha(c);
    return { cohort_id: c.cohort_id, stats: computeStats(alphas) };
  });

  // Fail closed when any cohort has no attributed records.
  const anyInsufficient = cohortStats.some((cs) => cs.stats.n === 0);
  if (anyInsufficient) {
    return {
      ok: true,
      signal: {
        detector_version: DETECTOR_VERSION,
        cohort_ids,
        status: 'insufficient_data',
        significant_comparisons: [],
        trend_slope_bps_per_cohort: null,
        should_escalate: false,
        threshold,
        is_reproducible: false,
      },
    };
  }

  // Consecutive-pair significance tests.
  const comparisons: CohortSignificanceResult[] = [];
  for (let i = 0; i < cohortStats.length - 1; i++) {
    const earlier = cohortStats[i]!;
    const later = cohortStats[i + 1]!;
    const delta = later.stats.mean - earlier.stats.mean;
    const { z_score, p_value, is_significant } = twoSampleZTest(
      earlier.stats,
      later.stats,
      threshold.significance_level,
      threshold.min_delta_bps,
    );
    comparisons.push({
      earlier_cohort_id: earlier.cohort_id,
      later_cohort_id: later.cohort_id,
      earlier_mean_model_alpha_bps: round4(earlier.stats.mean),
      later_mean_model_alpha_bps: round4(later.stats.mean),
      delta_model_alpha_bps: round4(delta),
      z_score,
      p_value,
      is_significant,
    });
  }

  const significant_comparisons = comparisons.filter((c) => c.is_significant);

  // Linear trend slope across cohort means.
  const means = cohortStats.map((cs) => cs.stats.mean);
  const trend_slope_bps_per_cohort = computeTrendSlope(means);

  // Consecutive escalation check.
  let maxConsecutive = 0;
  let current = 0;
  for (const comp of comparisons) {
    if (comp.is_significant) {
      current++;
      if (current > maxConsecutive) maxConsecutive = current;
    } else {
      current = 0;
    }
  }
  const should_escalate = maxConsecutive >= threshold.consecutive_to_escalate;

  let status: EdgeDecayStatus;
  if (should_escalate) {
    status = 'degrading';
  } else if (
    trend_slope_bps_per_cohort !== null &&
    trend_slope_bps_per_cohort > 0 &&
    significant_comparisons.length === 0
  ) {
    status = 'recovering';
  } else {
    status = 'no_signal';
  }

  const is_reproducible = cohortStats.every((cs) => cs.stats.n >= 2);

  return {
    ok: true,
    signal: {
      detector_version: DETECTOR_VERSION,
      cohort_ids,
      status,
      significant_comparisons,
      trend_slope_bps_per_cohort:
        trend_slope_bps_per_cohort !== null ? round4(trend_slope_bps_per_cohort) : null,
      should_escalate,
      threshold,
      is_reproducible,
    },
  };
}

// ── Statistical helpers ───────────────────────────────────────────────────────

interface SampleStats {
  mean: number;
  variance: number;
  n: number;
}

function extractAttributedAlpha(cohort: PerformanceCohort): number[] {
  return cohort.attribution_records
    .filter((r) => r.confidence !== 'insufficient_data')
    .map((r) => r.model_component_bps);
}

function computeStats(values: number[]): SampleStats {
  const n = values.length;
  if (n === 0) return { mean: 0, variance: 0, n: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n === 1) return { mean, variance: 0, n };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { mean, variance, n };
}

function twoSampleZTest(
  earlier: SampleStats,
  later: SampleStats,
  sigLevel: number,
  minDeltaBps: number,
): { z_score: number | null; p_value: number | null; is_significant: boolean } {
  const delta = later.mean - earlier.mean;

  // Practical significance gate: must exceed minimum absolute delta for decay.
  if (delta >= -minDeltaBps) {
    // Not a meaningful decay regardless of statistics.
    if (earlier.n < 2 || later.n < 2) {
      return { z_score: null, p_value: null, is_significant: false };
    }
    const se = Math.sqrt(earlier.variance / earlier.n + later.variance / later.n);
    const z_score = se === 0 ? null : round4(delta / se);
    const p_value = z_score !== null ? round6(normalCdf(z_score)) : null;
    return { z_score, p_value, is_significant: false };
  }

  if (earlier.n < 2 || later.n < 2) {
    // Cannot compute variance — treat as significant only when delta is very large.
    const is_significant = delta < -minDeltaBps;
    return { z_score: null, p_value: null, is_significant };
  }

  const se = Math.sqrt(earlier.variance / earlier.n + later.variance / later.n);
  if (se === 0) {
    // Constant distributions: decay is significant when delta exceeds threshold.
    return { z_score: null, p_value: null, is_significant: delta < -minDeltaBps };
  }

  const z_score = round4(delta / se);
  const p_value = round6(normalCdf(z_score));
  const is_significant = p_value < sigLevel;
  return { z_score, p_value, is_significant };
}

function computeTrendSlope(means: number[]): number | null {
  const n = means.length;
  if (n < 2) return null;
  const xMean = (n - 1) / 2;
  const yMean = means.reduce((s, v) => s + v, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    numerator += dx * ((means[i] ?? 0) - yMean);
    denominator += dx * dx;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

// ── Standard normal CDF approximation (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7) ──

const SQRT2 = Math.SQRT2;

function approxErf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

function normalCdf(z: number): number {
  return 0.5 * (1 + approxErf(z / SQRT2));
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateCohorts(
  cohorts: readonly PerformanceCohort[],
  threshold: EdgeDecayThreshold,
): string[] {
  const errors: string[] = [];

  if (!Array.isArray(cohorts)) {
    errors.push('EDGE_DECAY_COHORTS_NOT_ARRAY');
    return errors;
  }
  if (cohorts.length < threshold.min_cohorts) {
    errors.push(
      `EDGE_DECAY_INSUFFICIENT_COHORTS: need ${threshold.min_cohorts}, got ${cohorts.length}`,
    );
  }

  for (const cohort of cohorts) {
    if (!cohort?.cohort_id) {
      errors.push('EDGE_DECAY_INVALID_COHORT: missing cohort_id');
      continue;
    }
    if (!Array.isArray(cohort.attribution_records)) {
      errors.push(`EDGE_DECAY_INVALID_COHORT ${cohort.cohort_id}: missing attribution_records`);
    }
  }

  if (cohorts.length >= 2) {
    const ids = cohorts.map((c) => c.cohort_id).filter((id): id is string => Boolean(id));
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      errors.push(`EDGE_DECAY_DUPLICATE_COHORT_IDS: ${[...new Set(dupes)].join(', ')}`);
    }
  }

  return errors;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function round6(v: number): number {
  return Math.round(v * 1000000) / 1000000;
}
