/**
 * Loss Attribution — pure classification of loss causes.
 *
 * Ported from unit-talk-production/apps/api/src/analysis/outcomes/loss-attribution.ts
 * Adapted to V2 naming conventions. Pure computation — no I/O, no DB, no side effects.
 *
 * Classification priority:
 *   1. No feature snapshot → UNKNOWN
 *   2. CLV at bet or close < -3% → PRICE_MISS
 *   3. |EV| < 3% → VARIANCE
 *   4. EV > 0 → PROJECTION_MISS (positive EV but loss)
 *   5. EV < 0 → PROJECTION_MISS (negative EV not caught by PRICE_MISS)
 *   6. Fallback → UNKNOWN
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type LossClassification =
  | 'PROJECTION_MISS'
  | 'VARIANCE'
  | 'EXECUTION_MISS'
  | 'NEWS_MISS'
  | 'CORRELATION_MISS'
  | 'PRICE_MISS'
  | 'UNKNOWN';

export interface LossAttributionInput {
  /** Expected value % from model (e.g., 5.2 means +5.2% EV) */
  ev: number;
  /** CLV at bet placement (%) */
  clv_at_bet: number;
  /** CLV at market close (%) */
  clv_at_close: number;
  /** Whether feature snapshot data was available for classification */
  has_feature_snapshot: boolean;
}

export interface LossAttributionOutput {
  classification: LossClassification;
  notes: string[];
}

export interface LossAttributionSummary {
  total_losses: number;
  by_category: Array<{
    category: LossClassification;
    count: number;
    pct: number;
  }>;
  top_category: LossClassification;
  actionable_insights: Array<{
    category: LossClassification;
    count: number;
    pct: number;
    recommendation: string;
  }>;
  version: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const CLV_THRESHOLD = -3;
const VARIANCE_THRESHOLD = 3;

const RECOMMENDATIONS: Record<LossClassification, string> = {
  PROJECTION_MISS:
    'Review stat projection model accuracy; model overestimates edge',
  VARIANCE: 'Within expected bounds; no action needed',
  EXECUTION_MISS: 'Improve bet execution timing and line capture',
  NEWS_MISS: 'Enhance news/injury monitoring pipeline',
  CORRELATION_MISS: 'Improve correlation controls in portfolio engine',
  PRICE_MISS:
    'Improve line timing or closing line capture; market moved against position',
  UNKNOWN: 'Instrument feature snapshots for better attribution',
};

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Classify a single loss into one of 7 categories.
 * Pure function — deterministic, no side effects.
 */
export function classifyLoss(input: LossAttributionInput): LossAttributionOutput {
  const { ev, clv_at_bet, clv_at_close, has_feature_snapshot } = input;
  const notes: string[] = [];

  // Priority 1: No feature snapshot → cannot classify
  if (!has_feature_snapshot) {
    notes.push('no_feature_snapshot_available');
    return { classification: 'UNKNOWN', notes };
  }

  // Priority 2: Price miss — CLV significantly negative
  if (clv_at_close < CLV_THRESHOLD || clv_at_bet < CLV_THRESHOLD) {
    notes.push(
      `clv_at_bet=${clv_at_bet.toFixed(2)}%,clv_at_close=${clv_at_close.toFixed(2)}%`,
    );
    return { classification: 'PRICE_MISS', notes };
  }

  // Priority 3: Variance — EV close to zero, normal variance
  if (Math.abs(ev) < VARIANCE_THRESHOLD) {
    notes.push(`ev=${ev.toFixed(2)}% within variance bounds`);
    return { classification: 'VARIANCE', notes };
  }

  // Priority 4: Projection miss — positive EV but loss occurred
  if (ev > 0) {
    notes.push(`ev=${ev.toFixed(2)}% but outcome=loss`);
    return { classification: 'PROJECTION_MISS', notes };
  }

  // Priority 5: Projection miss — negative EV not caught by price threshold
  if (ev < 0) {
    notes.push(`negative_ev=${ev.toFixed(2)}%`);
    return { classification: 'PROJECTION_MISS', notes };
  }

  // Fallback: should not reach (ev === 0 caught by VARIANCE), but fail-closed
  notes.push('fallback_classification');
  return { classification: 'UNKNOWN', notes };
}

// ── Summary ─────────────────────────────────────────────────────────────────

/**
 * Aggregate loss classifications into a summary report.
 */
export function summarizeLossAttributions(
  attributions: LossAttributionOutput[],
): LossAttributionSummary {
  const total = attributions.length;

  if (total === 0) {
    return {
      total_losses: 0,
      by_category: [],
      top_category: 'UNKNOWN',
      actionable_insights: [],
      version: 'loss-attribution-v1.0',
    };
  }

  // Count by category
  const counts = new Map<LossClassification, number>();
  for (const a of attributions) {
    counts.set(a.classification, (counts.get(a.classification) ?? 0) + 1);
  }

  // Build by_category sorted by count desc
  const by_category = Array.from(counts.entries())
    .map(([category, count]) => ({
      category,
      count,
      pct: round4((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const top_category = by_category[0]!.category;

  // Actionable insights for categories that have recommendations
  const actionable_insights = by_category.map(({ category, count, pct }) => ({
    category,
    count,
    pct,
    recommendation: RECOMMENDATIONS[category],
  }));

  return {
    total_losses: total,
    by_category,
    top_category,
    actionable_insights,
    version: 'loss-attribution-v1.0',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
