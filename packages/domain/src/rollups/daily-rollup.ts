/**
 * Daily Metrics Rollup
 *
 * Composes band evaluation, downgrade effectiveness, and attribution
 * into a single deterministic daily report.
 *
 * One report per day, capturing everything the intelligence pipeline
 * produced and how it performed.
 */

import {
  generateBandEvaluation,
  type BandedOutcome,
  type BandMetrics,
} from '../evaluation/band-evaluation.js';
import {
  buildDowngradeRecord,
  analyzeDowngradeEffectiveness,
} from '../evaluation/downgrade-effectiveness.js';

import type { LossClassification } from '../outcomes/loss-attribution.js';
import type { BandTier } from '../bands/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DailyRollupRecord {
  finalBand: BandTier;
  initialBand: BandTier;
  downgradeReasons: string[];
  suppressionReasons: string[];
  thresholdVersion: string;

  outcome: 'WIN' | 'LOSS' | 'PUSH';
  p_final: number;
  p_market_devig: number;
  edge_final: number;
  score: number;
  book_count: number;

  clvPercent?: number | null;
  lossAttribution?: LossClassification | null;
  marketType?: string;
}

export interface DailyBandSummary {
  band: BandTier;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hit_rate_pct: number;
  flat_bet_roi_pct: number;
  avg_edge: number;
  brier_score: number;
  avg_clv_percent: number | null;
  clv_sample_size: number;
}

export interface DailyAttributionCounts {
  total_losses: number;
  projection_miss: number;
  price_miss: number;
  variance: number;
  execution_miss: number;
  news_miss: number;
  correlation_miss: number;
  unknown: number;
}

export interface DailyDowngradeCounts {
  total_picks: number;
  unchanged: number;
  downgraded: number;
  suppressed: number;
  top_downgrade_reason: string | null;
  top_suppression_reason: string | null;
}

export interface DailyRollupReport {
  report_version: string;
  date: string;
  generated_at: string;

  total_picks: number;
  total_wins: number;
  total_losses: number;
  total_pushes: number;
  overall_hit_rate_pct: number;
  overall_roi_pct: number;

  by_band: DailyBandSummary[];
  band_distribution: Record<BandTier, number>;

  downgrade_counts: DailyDowngradeCounts;
  attribution_counts: DailyAttributionCounts;

  downgrade_effectiveness: {
    suppression_effective: boolean;
    downgrade_effective: boolean;
    estimated_savings: number;
  };

  threshold_version: string;
}

// ── Core Computation ────────────────────────────────────────────────────────

export function generateDailyRollup(
  date: string,
  records: DailyRollupRecord[],
  timestamp?: string,
): DailyRollupReport {
  if (records.length === 0) {
    return emptyReport(date, timestamp);
  }

  const wins = records.filter((r) => r.outcome === 'WIN').length;
  const losses = records.filter((r) => r.outcome === 'LOSS').length;
  const pushes = records.filter((r) => r.outcome === 'PUSH').length;
  const nonPush = records.filter((r) => r.outcome !== 'PUSH');
  const hitRatePct = nonPush.length > 0 ? (wins / nonPush.length) * 100 : 0;
  const overallRoi = computeFlatBetRoi(records.map((r) => r.outcome));

  const bandedOutcomes: BandedOutcome[] = records.map(toBandedOutcome);
  const bandEval = generateBandEvaluation(bandedOutcomes, timestamp);

  const byBand: DailyBandSummary[] = bandEval.by_band.map(toBandSummary);

  const downgradeCounts = computeDowngradeCounts(records);
  const attributionCounts = computeAttributionCounts(records);

  const downgradeRecords = records.map((r) =>
    buildDowngradeRecord(
      r.initialBand,
      r.finalBand,
      r.downgradeReasons,
      r.suppressionReasons,
      r.outcome,
    ),
  );
  const effectiveness = analyzeDowngradeEffectiveness(downgradeRecords);

  const thresholdVersion = records[0]?.thresholdVersion ?? 'unknown';

  return {
    report_version: 'daily-rollup-v1.0',
    date,
    generated_at: timestamp ?? new Date().toISOString(),
    total_picks: records.length,
    total_wins: wins,
    total_losses: losses,
    total_pushes: pushes,
    overall_hit_rate_pct: round4(hitRatePct),
    overall_roi_pct: round4(overallRoi),
    by_band: byBand,
    band_distribution: bandEval.band_distribution,
    downgrade_counts: downgradeCounts,
    attribution_counts: attributionCounts,
    downgrade_effectiveness: {
      suppression_effective: effectiveness.diagnostics.suppression_effective,
      downgrade_effective: effectiveness.diagnostics.downgrade_effective,
      estimated_savings: effectiveness.diagnostics.estimated_savings,
    },
    threshold_version: thresholdVersion,
  };
}

// ── Converters ──────────────────────────────────────────────────────────────

function toBandedOutcome(r: DailyRollupRecord): BandedOutcome {
  return {
    outcome: {
      market_key: '',
      event_id: '',
      market_type_id: 0,
      participant_id: null,
      p_final: r.p_final,
      p_market_devig: r.p_market_devig,
      edge_final: r.edge_final,
      score: r.score,
      tier: '',
      book_count: r.book_count,
      line: 0,
      actual_value: 0,
      outcome: r.outcome,
      ...(r.marketType !== undefined ? { market_type_key: r.marketType } : {}),
    },
    band: {
      finalBand: r.finalBand,
      initialBand: r.initialBand,
      downgradeReasons: r.downgradeReasons,
      suppressionReasons: r.suppressionReasons,
      thresholdVersion: r.thresholdVersion,
    },
    ...(r.clvPercent !== undefined ? { clvPercent: r.clvPercent } : {}),
  };
}

function toBandSummary(m: BandMetrics): DailyBandSummary {
  return {
    band: m.band,
    count: m.sample_size,
    wins: m.wins,
    losses: m.losses,
    pushes: m.pushes,
    hit_rate_pct: m.hit_rate_pct,
    flat_bet_roi_pct: m.flat_bet_roi_pct,
    avg_edge: m.avg_edge,
    brier_score: m.brier_score,
    avg_clv_percent: m.avg_clv_percent,
    clv_sample_size: m.clv_sample_size,
  };
}

// ── Sub-computations ────────────────────────────────────────────────────────

function computeDowngradeCounts(records: DailyRollupRecord[]): DailyDowngradeCounts {
  const bandOrder: BandTier[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'];

  let unchanged = 0;
  let downgraded = 0;
  let suppressed = 0;
  const downgradeReasonCounts = new Map<string, number>();
  const suppressionReasonCounts = new Map<string, number>();

  for (const r of records) {
    const initialIdx = bandOrder.indexOf(r.initialBand);
    const finalIdx = bandOrder.indexOf(r.finalBand);

    if (r.finalBand === 'SUPPRESS' && r.initialBand !== 'SUPPRESS') {
      suppressed++;
      for (const reason of r.suppressionReasons) {
        const cat = reason.split(':')[0]!;
        suppressionReasonCounts.set(cat, (suppressionReasonCounts.get(cat) ?? 0) + 1);
      }
    } else if (finalIdx > initialIdx) {
      downgraded++;
      for (const reason of r.downgradeReasons) {
        const cat = reason.split(':')[0]!;
        downgradeReasonCounts.set(cat, (downgradeReasonCounts.get(cat) ?? 0) + 1);
      }
    } else {
      unchanged++;
    }
  }

  const topDowngrade = topEntry(downgradeReasonCounts);
  const topSuppression = topEntry(suppressionReasonCounts);

  return {
    total_picks: records.length,
    unchanged,
    downgraded,
    suppressed,
    top_downgrade_reason: topDowngrade,
    top_suppression_reason: topSuppression,
  };
}

function computeAttributionCounts(records: DailyRollupRecord[]): DailyAttributionCounts {
  const lossRecords = records.filter((r) => r.outcome === 'LOSS');
  const counts: DailyAttributionCounts = {
    total_losses: lossRecords.length,
    projection_miss: 0,
    price_miss: 0,
    variance: 0,
    execution_miss: 0,
    news_miss: 0,
    correlation_miss: 0,
    unknown: 0,
  };

  for (const r of lossRecords) {
    const attr = r.lossAttribution ?? 'UNKNOWN';
    switch (attr) {
      case 'PROJECTION_MISS':
        counts.projection_miss++;
        break;
      case 'PRICE_MISS':
        counts.price_miss++;
        break;
      case 'VARIANCE':
        counts.variance++;
        break;
      case 'EXECUTION_MISS':
        counts.execution_miss++;
        break;
      case 'NEWS_MISS':
        counts.news_miss++;
        break;
      case 'CORRELATION_MISS':
        counts.correlation_miss++;
        break;
      default:
        counts.unknown++;
        break;
    }
  }

  return counts;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeFlatBetRoi(outcomes: Array<'WIN' | 'LOSS' | 'PUSH'>): number {
  const nonPush = outcomes.filter((o) => o !== 'PUSH');
  if (nonPush.length === 0) return 0;
  let profit = 0;
  for (const o of nonPush) {
    profit += o === 'WIN' ? 100 : -110;
  }
  return (profit / (nonPush.length * 110)) * 100;
}

function topEntry(map: Map<string, number>): string | null {
  if (map.size === 0) return null;
  let best: [string, number] | null = null;
  for (const entry of map.entries()) {
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best ? best[0] : null;
}

function emptyReport(date: string, timestamp?: string): DailyRollupReport {
  return {
    report_version: 'daily-rollup-v1.0',
    date,
    generated_at: timestamp ?? new Date().toISOString(),
    total_picks: 0,
    total_wins: 0,
    total_losses: 0,
    total_pushes: 0,
    overall_hit_rate_pct: 0,
    overall_roi_pct: 0,
    by_band: [],
    band_distribution: { 'A+': 0, A: 0, B: 0, C: 0, SUPPRESS: 0 },
    downgrade_counts: {
      total_picks: 0,
      unchanged: 0,
      downgraded: 0,
      suppressed: 0,
      top_downgrade_reason: null,
      top_suppression_reason: null,
    },
    attribution_counts: {
      total_losses: 0,
      projection_miss: 0,
      price_miss: 0,
      variance: 0,
      execution_miss: 0,
      news_miss: 0,
      correlation_miss: 0,
      unknown: 0,
    },
    downgrade_effectiveness: {
      suppression_effective: false,
      downgrade_effective: false,
      estimated_savings: 0,
    },
    threshold_version: 'unknown',
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
