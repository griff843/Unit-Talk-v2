/**
 * Provider Execution Quality
 *
 * Per-provider summaries that surface trust scores based on line freshness,
 * closing-line coverage, and CLV. Feeds back into routing decisions.
 *
 * Pure computation — no I/O, no DB, no HTTP, no env reads.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderExecutionRecord {
  /** e.g. 'pinnacle' | 'draftkings' | 'fanduel' | 'sgo' */
  provider: string;
  /** e.g. 'game-line' | 'player-prop' | 'team-prop' */
  marketFamily: string;
  sport: string;
  /** Seconds since line was posted when captured */
  lineAgeAtCapture: number;
  wasClosingLine: boolean;
  /** CLV achieved — positive means beat closing line */
  clvPercent: number | null;
  /** Model edge at time of capture */
  edgeAtCapture: number | null;
  /** ISO timestamp */
  capturedAt: string;
}

export interface ProviderQualitySummary {
  provider: string;
  sport: string;
  marketFamily: string;
  sampleSize: number;
  /** Mean line age in seconds — lower is fresher */
  avgLineAgeSeconds: number;
  /** Fraction of picks that had a closing line available */
  closingLineCoverageRate: number;
  /** Mean CLV across picks that have a CLV value */
  avgClvPercent: number | null;
  /** Fraction of CLV-bearing picks with positive CLV */
  positiveCLVRate: number | null;
  /** 0–1 composite trust score */
  trustScore: number;
  alertLevel: 'green' | 'warning' | 'degraded';
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const PROVIDER_QUALITY_THRESHOLDS = {
  minSampleSize: 10,
  maxLineAgeWarningSeconds: 300,     // > 5 min stale → warning
  maxLineAgeDegradedSeconds: 900,    // > 15 min stale → degraded
  minClosingLineCoverageWarning: 0.6,
  minClosingLineCoverageDegraded: 0.3,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a value in [low, high] → 0–1 (clipped). 1 = best, 0 = worst. */
function normaliseCapped(value: number, worst: number, best: number): number {
  if (best === worst) return 1;
  const raw = (value - worst) / (best - worst);
  return Math.max(0, Math.min(1, raw));
}

function computeAlertLevel(
  avgLineAgeSeconds: number,
  closingLineCoverageRate: number,
): 'green' | 'warning' | 'degraded' {
  const t = PROVIDER_QUALITY_THRESHOLDS;
  if (
    avgLineAgeSeconds > t.maxLineAgeDegradedSeconds ||
    closingLineCoverageRate < t.minClosingLineCoverageDegraded
  ) {
    return 'degraded';
  }
  if (
    avgLineAgeSeconds > t.maxLineAgeWarningSeconds ||
    closingLineCoverageRate < t.minClosingLineCoverageWarning
  ) {
    return 'warning';
  }
  return 'green';
}

/**
 * Compute a 0–1 trust score from three dimensions:
 *   50% closing-line coverage
 *   30% CLV (positive CLV rate, when available)
 *   20% freshness (inverse of line age)
 */
function computeTrustScore(
  closingLineCoverageRate: number,
  positiveCLVRate: number | null,
  avgLineAgeSeconds: number,
): number {
  const t = PROVIDER_QUALITY_THRESHOLDS;

  const coverageScore = closingLineCoverageRate; // already 0–1

  // Freshness: 0 s → 1.0, maxDegradedSeconds → 0.0
  const freshnessScore = normaliseCapped(
    avgLineAgeSeconds,
    t.maxLineAgeDegradedSeconds,
    0,
  );

  // CLV score: if no CLV data treat as neutral (0.5)
  const clvScore = positiveCLVRate != null ? positiveCLVRate : 0.5;

  return 0.5 * coverageScore + 0.3 * clvScore + 0.2 * freshnessScore;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Group records by (provider, sport, marketFamily) and compute a
 * ProviderQualitySummary for each group with >= minSampleSize records.
 */
export function computeProviderQualitySummary(
  records: ProviderExecutionRecord[],
): ProviderQualitySummary[] {
  const t = PROVIDER_QUALITY_THRESHOLDS;

  // Group
  const groups = new Map<string, ProviderExecutionRecord[]>();
  for (const record of records) {
    const key = `${record.provider}||${record.sport}||${record.marketFamily}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const summaries: ProviderQualitySummary[] = [];

  for (const [, bucket] of groups) {
    if (bucket.length < t.minSampleSize) continue;

    const first = bucket[0]!;

    const avgLineAgeSeconds =
      bucket.reduce((sum, r) => sum + r.lineAgeAtCapture, 0) / bucket.length;

    const closingLineCoverageRate =
      bucket.filter(r => r.wasClosingLine).length / bucket.length;

    const clvBucket = bucket.filter(r => r.clvPercent != null);
    const avgClvPercent =
      clvBucket.length > 0
        ? clvBucket.reduce((sum, r) => sum + (r.clvPercent ?? 0), 0) / clvBucket.length
        : null;

    const positiveCLVRate =
      clvBucket.length > 0
        ? clvBucket.filter(r => (r.clvPercent ?? 0) > 0).length / clvBucket.length
        : null;

    const trustScore = computeTrustScore(
      closingLineCoverageRate,
      positiveCLVRate,
      avgLineAgeSeconds,
    );

    const alertLevel = computeAlertLevel(avgLineAgeSeconds, closingLineCoverageRate);

    summaries.push({
      provider: first.provider,
      sport: first.sport,
      marketFamily: first.marketFamily,
      sampleSize: bucket.length,
      avgLineAgeSeconds,
      closingLineCoverageRate,
      avgClvPercent,
      positiveCLVRate,
      trustScore,
      alertLevel,
    });
  }

  return summaries;
}

/**
 * Convert an alert level into a [0, 1] routing trust multiplier.
 * Callers multiply their base confidence by this before routing.
 */
export function providerTrustMultiplier(summary: ProviderQualitySummary): number {
  if (summary.alertLevel === 'degraded') return 0.7;
  if (summary.alertLevel === 'warning') return 0.85;
  return 1.0;
}
