/**
 * Regime Stability Analysis
 *
 * Measures whether the band assignment thresholds produce stable results
 * across time windows. Detects regime drift where the same thresholds
 * yield different band distributions or performance over time.
 */

import type { BandTier } from '../bands/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface WindowSnapshot {
  label: string;
  sample_size: number;
  band_distribution_pct: Record<BandTier, number>;
  roi_by_band: Partial<Record<BandTier, number>>;
  clv_by_band: Partial<Record<BandTier, number | null>>;
  hit_rate_by_band: Partial<Record<BandTier, number>>;
}

export interface StabilityMetric {
  dimension: string;
  /** Coefficient of variation across windows (stddev / mean). Lower = more stable. */
  cv: number;
  max_deviation: number;
  stable: boolean;
}

export interface RegimeStabilityReport {
  report_version: string;
  window_count: number;
  total_sample_size: number;
  windows: WindowSnapshot[];
  distribution_stability: StabilityMetric[];
  roi_stability: StabilityMetric[];
  clv_stability: StabilityMetric[];
  regime: {
    stable: boolean;
    unstable_count: number;
    unstable_dimensions: string[];
  };
}

// ── Configuration ───────────────────────────────────────────────────────────

const CV_STABILITY_THRESHOLD = 0.3;
const MIN_WINDOW_SAMPLES = 5;

// ── Input ───────────────────────────────────────────────────────────────────

export interface RegimeRecord {
  finalBand: BandTier;
  outcome: 'WIN' | 'LOSS' | 'PUSH';
  flatBetResult: number;
  clvPercent?: number | null;
  windowLabel: string;
}

// ── Core Computation ────────────────────────────────────────────────────────

export function analyzeRegimeStability(records: RegimeRecord[]): RegimeStabilityReport {
  const windowGroups = groupByWindow(records);
  const windowLabels = Array.from(windowGroups.keys()).sort();

  const windows: WindowSnapshot[] = windowLabels
    .map((label) => {
      const group = windowGroups.get(label)!;
      return buildWindowSnapshot(label, group);
    })
    .filter((w) => w.sample_size >= MIN_WINDOW_SAMPLES);

  const publishedBands: BandTier[] = ['A+', 'A', 'B', 'C'];

  const distributionStability = publishedBands.map((band) => {
    const values = windows.map((w) => w.band_distribution_pct[band]);
    return computeStability(`distribution:${band}`, values);
  });

  const roiStability = publishedBands
    .map((band) => {
      const values = windows
        .filter((w) => w.roi_by_band[band] !== undefined)
        .map((w) => w.roi_by_band[band]!);
      if (values.length < 2) return null;
      return computeStability(`roi:${band}`, values);
    })
    .filter((s): s is StabilityMetric => s !== null);

  const clvStability = publishedBands
    .map((band) => {
      const values = windows
        .filter((w) => w.clv_by_band[band] != null)
        .map((w) => w.clv_by_band[band]!);
      if (values.length < 2) return null;
      return computeStability(`clv:${band}`, values);
    })
    .filter((s): s is StabilityMetric => s !== null);

  const allMetrics = [...distributionStability, ...roiStability, ...clvStability];
  const unstable = allMetrics.filter((m) => !m.stable);

  return {
    report_version: 'regime-stability-v1.0',
    window_count: windows.length,
    total_sample_size: records.length,
    windows,
    distribution_stability: distributionStability,
    roi_stability: roiStability,
    clv_stability: clvStability,
    regime: {
      stable: unstable.length === 0,
      unstable_count: unstable.length,
      unstable_dimensions: unstable.map((m) => m.dimension),
    },
  };
}

// ── Window Building ─────────────────────────────────────────────────────────

function buildWindowSnapshot(label: string, records: RegimeRecord[]): WindowSnapshot {
  const allBands: BandTier[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'];
  const n = records.length;

  const distribution: Record<BandTier, number> = { 'A+': 0, A: 0, B: 0, C: 0, SUPPRESS: 0 };
  for (const r of records) {
    distribution[r.finalBand]++;
  }
  const distributionPct: Record<BandTier, number> = { 'A+': 0, A: 0, B: 0, C: 0, SUPPRESS: 0 };
  for (const band of allBands) {
    distributionPct[band] = n > 0 ? round4((distribution[band] / n) * 100) : 0;
  }

  const roiByBand: Partial<Record<BandTier, number>> = {};
  const clvByBand: Partial<Record<BandTier, number | null>> = {};
  const hitRateByBand: Partial<Record<BandTier, number>> = {};

  for (const band of allBands) {
    const bandRecords = records.filter((r) => r.finalBand === band);
    if (bandRecords.length === 0) continue;

    const nonPush = bandRecords.filter((r) => r.outcome !== 'PUSH');
    if (nonPush.length > 0) {
      const wins = nonPush.filter((r) => r.outcome === 'WIN').length;
      hitRateByBand[band] = round4((wins / nonPush.length) * 100);

      const wager = nonPush.length * 110;
      const profit = nonPush.reduce((s, r) => s + r.flatBetResult, 0);
      roiByBand[band] = round4((profit / wager) * 100);
    }

    const clvRecords = bandRecords.filter((r) => r.clvPercent != null);
    if (clvRecords.length > 0) {
      clvByBand[band] = round4(
        clvRecords.reduce((s, r) => s + r.clvPercent!, 0) / clvRecords.length,
      );
    }
  }

  return {
    label,
    sample_size: n,
    band_distribution_pct: distributionPct,
    roi_by_band: roiByBand,
    clv_by_band: clvByBand,
    hit_rate_by_band: hitRateByBand,
  };
}

// ── Stability Computation ───────────────────────────────────────────────────

function computeStability(dimension: string, values: number[]): StabilityMetric {
  if (values.length < 2) {
    return { dimension, cv: 0, max_deviation: 0, stable: true };
  }

  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  const cv = avg !== 0 ? Math.abs(stddev / avg) : stddev > 0 ? Infinity : 0;
  const maxDev = Math.max(...values.map((v) => Math.abs(v - avg)));

  return {
    dimension,
    cv: round4(cv),
    max_deviation: round4(maxDev),
    stable: cv < CV_STABILITY_THRESHOLD,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function groupByWindow(records: RegimeRecord[]): Map<string, RegimeRecord[]> {
  const map = new Map<string, RegimeRecord[]>();
  for (const r of records) {
    if (!map.has(r.windowLabel)) map.set(r.windowLabel, []);
    map.get(r.windowLabel)!.push(r);
  }
  return map;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
