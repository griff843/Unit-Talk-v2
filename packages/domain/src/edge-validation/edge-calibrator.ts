/**
 * Edge Calibrator — Confidence interval computation for CLV estimates
 *
 * Provides confidence intervals for a set of numeric values (typically CLV deltas).
 * Uses normal approximation (valid for N >= 30) or flags insufficient sample.
 *
 * FAIL-CLOSED: Returns { ok: false, reason } when CI cannot be computed.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 0.9 | 0.95 | 0.99;

export interface CIResult {
  lower: number;
  upper: number;
  mean: number;
  stdErr: number;
  n: number;
  confidenceLevel: ConfidenceLevel;
  method: 'normal_approximation';
}

export type CIFailReason = 'INSUFFICIENT_SAMPLE' | 'EMPTY_INPUT' | 'ZERO_VARIANCE';

export type CIComputeResult =
  | { ok: true; ci: CIResult }
  | { ok: false; reason: CIFailReason; reasonDetail: string; n: number };

// ── Constants ───────────────────────────────────────────────────────────────

/** Minimum sample size for normal approximation to be valid */
export const MIN_CI_SAMPLE = 30;

/** Z-critical values for two-tailed confidence intervals */
const Z_CRIT: Record<ConfidenceLevel, number> = {
  0.9: 1.6449,
  0.95: 1.96,
  0.99: 2.5758,
};

// ── Core Function ───────────────────────────────────────────────────────────

/**
 * Compute a confidence interval for the mean of a set of numeric values.
 *
 * Uses the normal approximation: CI = mean +/- z * (stdDev / sqrt(n))
 * Valid for N >= MIN_CI_SAMPLE (central limit theorem kicks in).
 */
export function computeConfidenceInterval(
  values: number[],
  confidenceLevel: ConfidenceLevel = 0.95,
): CIComputeResult {
  if (values.length === 0) {
    return {
      ok: false,
      reason: 'EMPTY_INPUT',
      reasonDetail: 'No values provided',
      n: 0,
    };
  }

  if (values.length < MIN_CI_SAMPLE) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_SAMPLE',
      reasonDetail: `Need >=${MIN_CI_SAMPLE} values for normal approximation; got ${values.length}`,
      n: values.length,
    };
  }

  const n = values.length;
  const m = sampleMean(values);
  const s = sampleStdDev(values, m);

  if (s < 1e-10) {
    return {
      ok: false,
      reason: 'ZERO_VARIANCE',
      reasonDetail: 'All values are identical — confidence interval has zero width',
      n,
    };
  }

  const stdErr = s / Math.sqrt(n);
  const zCrit = Z_CRIT[confidenceLevel];
  const margin = zCrit * stdErr;

  return {
    ok: true,
    ci: {
      lower: round(m - margin, 6),
      upper: round(m + margin, 6),
      mean: round(m, 6),
      stdErr: round(stdErr, 6),
      n,
      confidenceLevel,
      method: 'normal_approximation',
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sampleMean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sampleStdDev(values: number[], m: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
