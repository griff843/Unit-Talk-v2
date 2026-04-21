/**
 * Provider execution quality trust scoring.
 *
 * Pure computation — derives per-provider trust signals from aggregated
 * execution quality reports (e.g. from ExecutionQualityRepository).
 * Outputs trust multipliers suitable for consensus weighting and routing.
 *
 * No DB access. Inputs come from the DB layer.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderAlertLevel = 'green' | 'warning' | 'degraded';

/** Minimal shape accepted from DB-layer execution quality reports */
export interface ProviderQualityInput {
  providerKey: string;
  sportKey: string | null;
  marketFamily: string;
  sampleSize: number;
  avgLineDelta: number | null;
  winRate: number | null;
  roi: number | null;
}

/** Trust assessment for a single provider */
export interface ProviderTrustScore {
  providerKey: string;
  alertLevel: ProviderAlertLevel;
  /** Multiplier to apply to this provider's consensus weight: [0.70, 1.00] */
  trustMultiplier: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const MIN_SAMPLE_SIZE = 10;
const WARNING_LINE_DELTA = 5;   // absolute avg line-delta pts → warning
const DEGRADED_LINE_DELTA = 15; // absolute avg line-delta pts → degraded

export const TRUST_MULTIPLIERS: Record<ProviderAlertLevel, number> = {
  green: 1.0,
  warning: 0.85,
  degraded: 0.70,
};

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute a trust score for one execution quality report row.
 * The trust multiplier is applied to the provider's weight during
 * consensus computation (see sharp-consensus.ts).
 */
export function computeProviderTrustScore(
  input: ProviderQualityInput,
): ProviderTrustScore {
  const { providerKey, sampleSize, avgLineDelta } = input;

  if (sampleSize < MIN_SAMPLE_SIZE || avgLineDelta === null) {
    return {
      providerKey,
      alertLevel: 'green',
      trustMultiplier: TRUST_MULTIPLIERS.green,
      reason: 'insufficient sample — no adjustment',
    };
  }

  const delta = Math.abs(avgLineDelta);

  if (delta >= DEGRADED_LINE_DELTA) {
    return {
      providerKey,
      alertLevel: 'degraded',
      trustMultiplier: TRUST_MULTIPLIERS.degraded,
      reason: `avg line delta ${delta.toFixed(1)} pts ≥ ${DEGRADED_LINE_DELTA} — degraded`,
    };
  }

  if (delta >= WARNING_LINE_DELTA) {
    return {
      providerKey,
      alertLevel: 'warning',
      trustMultiplier: TRUST_MULTIPLIERS.warning,
      reason: `avg line delta ${delta.toFixed(1)} pts ≥ ${WARNING_LINE_DELTA} — warning`,
    };
  }

  return {
    providerKey,
    alertLevel: 'green',
    trustMultiplier: TRUST_MULTIPLIERS.green,
    reason: `avg line delta ${delta.toFixed(1)} pts — healthy`,
  };
}

/**
 * Build a provider → trust multiplier map from a set of quality reports.
 *
 * When a provider appears across multiple sport/market rows, the worst
 * (lowest) multiplier is used — fail-closed on degradation.
 *
 * The returned map is suitable for passing into computeSharpConsensus()
 * as the providerTrustContext parameter.
 */
export function buildProviderTrustContext(
  reports: ProviderQualityInput[],
): Record<string, number> {
  const context: Record<string, number> = {};

  for (const report of reports) {
    const { providerKey, trustMultiplier } = computeProviderTrustScore(report);
    const existing = context[providerKey] ?? 1.0;
    context[providerKey] = Math.min(existing, trustMultiplier);
  }

  return context;
}

/**
 * Summarize trust levels across all providers for ops reporting.
 * Returns entries sorted ascending by trust (worst first).
 */
export function summarizeProviderTrust(
  reports: ProviderQualityInput[],
): ProviderTrustScore[] {
  const context = buildProviderTrustContext(reports);

  return Object.entries(context)
    .map(([providerKey, multiplier]) => {
      const alertLevel: ProviderAlertLevel =
        multiplier <= TRUST_MULTIPLIERS.degraded
          ? 'degraded'
          : multiplier < TRUST_MULTIPLIERS.green
            ? 'warning'
            : 'green';
      return {
        providerKey,
        alertLevel,
        trustMultiplier: multiplier,
        reason:
          alertLevel === 'green'
            ? 'healthy'
            : `trust reduced to ${multiplier.toFixed(2)}`,
      };
    })
    .sort((a, b) => a.trustMultiplier - b.trustMultiplier);
}
