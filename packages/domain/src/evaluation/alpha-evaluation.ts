/**
 * Alpha Evaluation Engine
 *
 * Evaluates stat projection model performance:
 *   - Brier score
 *   - Log loss
 *   - ECE (Expected Calibration Error)
 *   - Confidence bucket accuracy
 *   - Stat alpha buckets (P_stat - P_market)
 */

import type { MarketReactionOutput } from '../market/market-reaction.js';
import type { BlendOutput } from '../models/stat-market-blend.js';

// ── Input Types ──────────────────────────────────────────────────────────────

export interface EvaluationRecord {
  /** Blend output from stat-market-blend */
  blend: BlendOutput;
  /** Actual outcome: 1=over hit, 0=under hit */
  outcome: 0 | 1;
  /** Sport for grouping */
  sport?: string;
  /** Market type for grouping */
  market_type?: string;
  /** Market reaction data */
  market_reaction?: MarketReactionOutput;
}

// ── Output Contract ──────────────────────────────────────────────────────────

export interface AlphaBucket {
  label: string;
  min_alpha: number;
  max_alpha: number;
  count: number;
  wins: number;
  losses: number;
  hit_rate: number;
  avg_alpha: number;
  avg_p_stat: number;
  avg_p_market: number;
  roi_pct: number;
}

export interface ConfidenceBucket {
  label: string;
  min_prob: number;
  max_prob: number;
  count: number;
  actual_hit_rate: number;
  predicted_avg: number;
  calibration_error: number;
}

export interface MarketReactionMetrics {
  reaction_sample_size: number;
  reaction_alignment_rate: number;
  avg_clv_value: number;
  avg_reaction_strength: number;
  positive_clv_count: number;
  negative_clv_count: number;
}

export interface AlphaEvaluationReport {
  sample_size: number;
  brier_score: number;
  log_loss: number;
  ece: number;
  confidence_buckets: ConfidenceBucket[];
  alpha_buckets: AlphaBucket[];
  by_sport: Record<string, { brier_score: number; log_loss: number; sample_size: number }>;
  by_market_type: Record<string, { brier_score: number; log_loss: number; sample_size: number }>;
  market_reaction?: MarketReactionMetrics;
}

// ── Configuration ────────────────────────────────────────────────────────────

const ALPHA_BUCKET_EDGES = [-Infinity, -0.05, -0.02, 0.02, 0.05, Infinity];
const ALPHA_BUCKET_LABELS = [
  'bearish (<-0.05)',
  'slight bearish (-0.05 to -0.02)',
  'agreement (-0.02 to 0.02)',
  'slight bullish (0.02 to 0.05)',
  'bullish (>0.05)',
];

const CONFIDENCE_BUCKET_EDGES = [0, 0.35, 0.45, 0.55, 0.65, 1.01];
const CONFIDENCE_BUCKET_LABELS = ['<0.35', '0.35-0.45', '0.45-0.55', '0.55-0.65', '0.65+'];

// ── Core Computation ─────────────────────────────────────────────────────────

export function computeAlphaEvaluation(records: EvaluationRecord[]): AlphaEvaluationReport {
  if (records.length === 0) {
    return emptyReport();
  }

  const brierScore = computeBrierScore(records);
  const logLoss = computeLogLoss(records);
  const confidenceBuckets = computeConfidenceBuckets(records);
  const ece = computeECE(confidenceBuckets, records.length);
  const alphaBuckets = computeAlphaBuckets(records);
  const bySport = groupedMetrics(records, (r) => r.sport ?? 'unknown');
  const byMarketType = groupedMetrics(records, (r) => r.market_type ?? 'unknown');
  const marketReaction = computeMarketReactionMetrics(records);

  return {
    sample_size: records.length,
    brier_score: round4(brierScore),
    log_loss: round4(logLoss),
    ece: round4(ece),
    confidence_buckets: confidenceBuckets,
    alpha_buckets: alphaBuckets,
    by_sport: bySport,
    by_market_type: byMarketType,
    ...(marketReaction !== undefined ? { market_reaction: marketReaction } : {}),
  };
}

// ── Metric Functions ─────────────────────────────────────────────────────────

export function computeBrierScore(records: EvaluationRecord[]): number {
  if (records.length === 0) return 0;
  const sum = records.reduce((s, r) => s + (r.outcome - r.blend.p_final) ** 2, 0);
  return sum / records.length;
}

export function computeLogLoss(records: EvaluationRecord[]): number {
  if (records.length === 0) return 0;
  const eps = 1e-7;
  const sum = records.reduce((s, r) => {
    const p = Math.max(eps, Math.min(1 - eps, r.blend.p_final));
    return s - (r.outcome * Math.log(p) + (1 - r.outcome) * Math.log(1 - p));
  }, 0);
  return sum / records.length;
}

function computeConfidenceBuckets(records: EvaluationRecord[]): ConfidenceBucket[] {
  return CONFIDENCE_BUCKET_LABELS.map((label, i) => {
    const min = CONFIDENCE_BUCKET_EDGES[i]!;
    const max = CONFIDENCE_BUCKET_EDGES[i + 1]!;
    const inBucket = records.filter((r) => r.blend.p_final >= min && r.blend.p_final < max);
    const count = inBucket.length;
    const wins = inBucket.filter((r) => r.outcome === 1).length;
    const actualHitRate = count > 0 ? wins / count : 0;
    const predictedAvg =
      count > 0 ? inBucket.reduce((s, r) => s + r.blend.p_final, 0) / count : (min + max) / 2;
    const calibrationError = Math.abs(actualHitRate - predictedAvg);

    return {
      label,
      min_prob: min,
      max_prob: max,
      count,
      actual_hit_rate: round4(actualHitRate),
      predicted_avg: round4(predictedAvg),
      calibration_error: round4(calibrationError),
    };
  });
}

function computeECE(buckets: ConfidenceBucket[], totalN: number): number {
  if (totalN === 0) return 0;
  return buckets.reduce((sum, b) => sum + (b.count / totalN) * b.calibration_error, 0);
}

function computeAlphaBuckets(records: EvaluationRecord[]): AlphaBucket[] {
  return ALPHA_BUCKET_LABELS.map((label, i) => {
    const min = ALPHA_BUCKET_EDGES[i]!;
    const max = ALPHA_BUCKET_EDGES[i + 1]!;
    const inBucket = records.filter((r) => r.blend.stat_alpha >= min && r.blend.stat_alpha < max);
    const count = inBucket.length;
    const wins = inBucket.filter((r) => r.outcome === 1).length;
    const losses = count - wins;
    const hitRate = count > 0 ? wins / count : 0;
    const avgAlpha =
      count > 0 ? inBucket.reduce((s, r) => s + r.blend.stat_alpha, 0) / count : 0;
    const avgPStat = count > 0 ? inBucket.reduce((s, r) => s + r.blend.p_stat, 0) / count : 0;
    const avgPMarket =
      count > 0 ? inBucket.reduce((s, r) => s + r.blend.p_market, 0) / count : 0;

    // ROI: assume flat bet on over when alpha > 0, under when alpha < 0
    const expectedWins = inBucket.reduce((s, r) => s + r.blend.p_market, 0);
    const roiPct = count > 0 ? ((wins - expectedWins) / count) * 100 : 0;

    return {
      label,
      min_alpha: min === -Infinity ? -1 : min,
      max_alpha: max === Infinity ? 1 : max,
      count,
      wins,
      losses,
      hit_rate: round4(hitRate),
      avg_alpha: round4(avgAlpha),
      avg_p_stat: round4(avgPStat),
      avg_p_market: round4(avgPMarket),
      roi_pct: round4(roiPct),
    };
  });
}

function groupedMetrics(
  records: EvaluationRecord[],
  keyFn: (r: EvaluationRecord) => string,
): Record<string, { brier_score: number; log_loss: number; sample_size: number }> {
  const groups: Record<string, EvaluationRecord[]> = {};
  for (const r of records) {
    const k = keyFn(r);
    (groups[k] ??= []).push(r);
  }
  const result: Record<string, { brier_score: number; log_loss: number; sample_size: number }> = {};
  for (const [k, recs] of Object.entries(groups)) {
    result[k] = {
      brier_score: round4(computeBrierScore(recs)),
      log_loss: round4(computeLogLoss(recs)),
      sample_size: recs.length,
    };
  }
  return result;
}

function computeMarketReactionMetrics(
  records: EvaluationRecord[],
): MarketReactionMetrics | undefined {
  const withReaction = records.filter((r) => r.market_reaction != null);
  if (withReaction.length === 0) return undefined;

  const n = withReaction.length;
  const aligned = withReaction.filter((r) => r.market_reaction!.reaction_alignment).length;
  const avgClv = withReaction.reduce((s, r) => s + r.market_reaction!.clv_value, 0) / n;
  const avgStrength =
    withReaction.reduce((s, r) => s + r.market_reaction!.reaction_strength, 0) / n;
  const posClv = withReaction.filter((r) => r.market_reaction!.clv_value > 0).length;
  const negClv = withReaction.filter((r) => r.market_reaction!.clv_value < 0).length;

  return {
    reaction_sample_size: n,
    reaction_alignment_rate: round4(aligned / n),
    avg_clv_value: round4(avgClv),
    avg_reaction_strength: round4(avgStrength),
    positive_clv_count: posClv,
    negative_clv_count: negClv,
  };
}

function emptyReport(): AlphaEvaluationReport {
  return {
    sample_size: 0,
    brier_score: 0,
    log_loss: 0,
    ece: 0,
    confidence_buckets: [],
    alpha_buckets: [],
    by_sport: {},
    by_market_type: {},
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
