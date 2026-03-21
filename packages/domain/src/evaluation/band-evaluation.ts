/**
 * Band Evaluation — Walk-Forward Evaluation by Promotion Band
 *
 * Measures model and band performance across promotion tiers:
 *   - CLV by band
 *   - ROI by band
 *   - Calibration (Brier, log loss) by band
 *   - Sample distribution across bands
 */

import type { ScoredOutcome } from '../outcomes/types.js';
import type { BandOutput, BandTier } from '../bands/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * A scored outcome paired with its band assignment.
 */
export interface BandedOutcome {
  outcome: ScoredOutcome;
  band: BandOutput;
  /** CLV percent if available (from market reaction layer). */
  clvPercent?: number | null;
}

/**
 * Performance metrics for a single band tier.
 */
export interface BandMetrics {
  band: BandTier;
  sample_size: number;
  wins: number;
  losses: number;
  pushes: number;
  hit_rate_pct: number;
  flat_bet_roi_pct: number;
  avg_edge: number;
  avg_p_final: number;
  brier_score: number;
  log_loss: number;
  avg_clv_percent: number | null;
  positive_clv_count: number;
  negative_clv_count: number;
  clv_sample_size: number;
}

/**
 * Full band evaluation report.
 */
export interface BandEvaluationReport {
  report_version: string;
  generated_at: string;
  total_sample_size: number;
  by_band: BandMetrics[];
  band_distribution: Record<BandTier, number>;
  summary: {
    best_roi_band: BandTier | null;
    best_clv_band: BandTier | null;
    best_calibration_band: BandTier | null;
    monotonic_roi: boolean;
    monotonic_clv: boolean;
  };
}

// ── Core Computation ────────────────────────────────────────────────────────

/**
 * Generate a band evaluation report from banded outcomes.
 * @param timestamp - ISO string for generated_at (avoids new Date() impurity)
 */
export function generateBandEvaluation(
  records: BandedOutcome[],
  timestamp?: string,
): BandEvaluationReport {
  const byBandGroup = groupByBand(records);
  const allBands: BandTier[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'];

  const byBand: BandMetrics[] = allBands.map((band) => {
    const group = byBandGroup.get(band) ?? [];
    return computeBandMetrics(band, group);
  });

  const distribution: Record<BandTier, number> = { 'A+': 0, A: 0, B: 0, C: 0, SUPPRESS: 0 };
  for (const r of records) {
    distribution[r.band.finalBand]++;
  }

  const withSamples = byBand.filter((m) => m.sample_size > 0);
  const bestRoi = findBest(withSamples, (m) => m.flat_bet_roi_pct);
  const bestClv = findBest(
    withSamples.filter((m) => m.avg_clv_percent !== null),
    (m) => m.avg_clv_percent ?? -Infinity,
  );
  const bestCalibration = findBest(
    withSamples.filter((m) => m.brier_score > 0),
    (m) => -m.brier_score,
  );

  const publishedBands = byBand.filter((m) => m.band !== 'SUPPRESS' && m.sample_size > 0);
  const monotonicRoi = isMonotonic(publishedBands.map((m) => m.flat_bet_roi_pct));
  const monotonicClv = isMonotonic(
    publishedBands.filter((m) => m.avg_clv_percent !== null).map((m) => m.avg_clv_percent!),
  );

  return {
    report_version: 'band-evaluation-v1.0',
    generated_at: timestamp ?? new Date().toISOString(),
    total_sample_size: records.length,
    by_band: byBand,
    band_distribution: distribution,
    summary: {
      best_roi_band: bestRoi?.band ?? null,
      best_clv_band: bestClv?.band ?? null,
      best_calibration_band: bestCalibration?.band ?? null,
      monotonic_roi: monotonicRoi,
      monotonic_clv: monotonicClv,
    },
  };
}

// ── Metric Functions ────────────────────────────────────────────────────────

function computeBandMetrics(band: BandTier, records: BandedOutcome[]): BandMetrics {
  if (records.length === 0) {
    return emptyMetrics(band);
  }

  const wins = records.filter((r) => r.outcome.outcome === 'WIN').length;
  const losses = records.filter((r) => r.outcome.outcome === 'LOSS').length;
  const pushes = records.filter((r) => r.outcome.outcome === 'PUSH').length;
  const nonPush = records.filter((r) => r.outcome.outcome !== 'PUSH');

  const hitRatePct = nonPush.length > 0 ? (wins / nonPush.length) * 100 : 0;
  const flatBetRoi = computeFlatBetRoiPct(records.map((r) => r.outcome.outcome));

  const avgEdge = mean(records.map((r) => r.outcome.edge_final));
  const avgPFinal = mean(records.map((r) => r.outcome.p_final));

  const brier = computeBrierScore(records);
  const ll = computeLogLoss(records);

  const clvRecords = records.filter((r) => r.clvPercent != null);
  const avgClv = clvRecords.length > 0 ? mean(clvRecords.map((r) => r.clvPercent!)) : null;
  const posClv = clvRecords.filter((r) => r.clvPercent! > 0).length;
  const negClv = clvRecords.filter((r) => r.clvPercent! < 0).length;

  return {
    band,
    sample_size: records.length,
    wins,
    losses,
    pushes,
    hit_rate_pct: round4(hitRatePct),
    flat_bet_roi_pct: round4(flatBetRoi),
    avg_edge: round4(avgEdge),
    avg_p_final: round4(avgPFinal),
    brier_score: round4(brier),
    log_loss: round4(ll),
    avg_clv_percent: avgClv !== null ? round4(avgClv) : null,
    positive_clv_count: posClv,
    negative_clv_count: negClv,
    clv_sample_size: clvRecords.length,
  };
}

function computeBrierScore(records: BandedOutcome[]): number {
  const binary = records.filter((r) => r.outcome.outcome !== 'PUSH');
  if (binary.length === 0) return 0;
  const sum = binary.reduce((s, r) => {
    const y = r.outcome.outcome === 'WIN' ? 1 : 0;
    return s + (y - r.outcome.p_final) ** 2;
  }, 0);
  return sum / binary.length;
}

function computeLogLoss(records: BandedOutcome[]): number {
  const binary = records.filter((r) => r.outcome.outcome !== 'PUSH');
  if (binary.length === 0) return 0;
  const eps = 1e-7;
  const sum = binary.reduce((s, r) => {
    const y = r.outcome.outcome === 'WIN' ? 1 : 0;
    const p = Math.max(eps, Math.min(1 - eps, r.outcome.p_final));
    return s - (y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }, 0);
  return sum / binary.length;
}

function computeFlatBetRoiPct(outcomes: Array<'WIN' | 'LOSS' | 'PUSH'>): number {
  const nonPush = outcomes.filter((o) => o !== 'PUSH');
  if (nonPush.length === 0) return 0;
  const wager = 110;
  let profit = 0;
  for (const o of nonPush) {
    profit += o === 'WIN' ? 100 : -110;
  }
  return (profit / (nonPush.length * wager)) * 100;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function groupByBand(records: BandedOutcome[]): Map<BandTier, BandedOutcome[]> {
  const map = new Map<BandTier, BandedOutcome[]>();
  for (const r of records) {
    const band = r.band.finalBand;
    if (!map.has(band)) map.set(band, []);
    map.get(band)!.push(r);
  }
  return map;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function isMonotonic(values: number[]): boolean {
  if (values.length < 2) return true;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > values[i - 1]! + 0.001) return false;
  }
  return true;
}

function findBest<T extends { band: BandTier }>(
  items: T[],
  scorer: (item: T) => number,
): T | null {
  if (items.length === 0) return null;
  return items.reduce((best, item) => (scorer(item) > scorer(best) ? item : best));
}

function emptyMetrics(band: BandTier): BandMetrics {
  return {
    band,
    sample_size: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    hit_rate_pct: 0,
    flat_bet_roi_pct: 0,
    avg_edge: 0,
    avg_p_final: 0,
    brier_score: 0,
    log_loss: 0,
    avg_clv_percent: null,
    positive_clv_count: 0,
    negative_clv_count: 0,
    clv_sample_size: 0,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
