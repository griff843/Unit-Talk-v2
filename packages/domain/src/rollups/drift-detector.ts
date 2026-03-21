/**
 * Drift Detector
 *
 * Compares today's daily rollup to a trailing baseline and emits
 * drift flags when metrics deviate beyond thresholds.
 *
 * 6 drift categories: ROI, CLV, calibration, distribution,
 * suppression rate, and attribution drift.
 */

import type { DailyRollupReport, DailyBandSummary } from './daily-rollup.js';
import type { BandTier } from '../bands/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DriftFlag {
  category: DriftCategory;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  current: number;
  baseline: number;
  deviation: number;
  band?: BandTier;
}

export type DriftCategory =
  | 'roi_drift'
  | 'clv_drift'
  | 'calibration_drift'
  | 'distribution_drift'
  | 'suppression_rate_drift'
  | 'attribution_drift';

export interface DriftReport {
  report_version: string;
  date: string;
  baseline_window_size: number;
  flags: DriftFlag[];
  summary: {
    total_flags: number;
    critical_count: number;
    warning_count: number;
    info_count: number;
    regime_healthy: boolean;
  };
}

// ── Thresholds ──────────────────────────────────────────────────────────────

export const DRIFT_THRESHOLDS = {
  roi_warning: 15,
  roi_critical: 30,
  clv_warning: 0.03,
  clv_critical: 0.06,
  brier_warning: 0.05,
  brier_critical: 0.1,
  distribution_warning: 15,
  distribution_critical: 30,
  suppression_warning: 10,
  suppression_critical: 25,
  attribution_warning: 20,
} as const;

// ── Core Computation ────────────────────────────────────────────────────────

export function detectDrift(today: DailyRollupReport, baseline: DailyRollupReport[]): DriftReport {
  const flags: DriftFlag[] = [];

  if (baseline.length === 0 || today.total_picks === 0) {
    return buildReport(today.date, baseline.length, flags);
  }

  checkRoiDrift(today, baseline, flags);
  checkClvDrift(today, baseline, flags);
  checkCalibrationDrift(today, baseline, flags);
  checkDistributionDrift(today, baseline, flags);
  checkSuppressionDrift(today, baseline, flags);
  checkAttributionDrift(today, baseline, flags);

  return buildReport(today.date, baseline.length, flags);
}

// ── Drift Checks ────────────────────────────────────────────────────────────

function checkRoiDrift(
  today: DailyRollupReport,
  baseline: DailyRollupReport[],
  flags: DriftFlag[],
): void {
  const baselineRoi = avgOf(baseline, (r) => r.overall_roi_pct);
  const deviation = Math.abs(today.overall_roi_pct - baselineRoi);

  if (deviation >= DRIFT_THRESHOLDS.roi_critical) {
    flags.push({
      category: 'roi_drift',
      severity: 'critical',
      message: `Overall ROI deviated ${deviation.toFixed(1)}pp from baseline`,
      current: today.overall_roi_pct,
      baseline: baselineRoi,
      deviation,
    });
  } else if (deviation >= DRIFT_THRESHOLDS.roi_warning) {
    flags.push({
      category: 'roi_drift',
      severity: 'warning',
      message: `Overall ROI deviated ${deviation.toFixed(1)}pp from baseline`,
      current: today.overall_roi_pct,
      baseline: baselineRoi,
      deviation,
    });
  }

  const publishedBands: BandTier[] = ['A+', 'A', 'B', 'C'];
  for (const band of publishedBands) {
    const todayBand = today.by_band.find((b) => b.band === band);
    if (!todayBand || todayBand.count === 0) continue;

    const baselineBandRois = baseline
      .map((r) => r.by_band.find((b) => b.band === band))
      .filter((b): b is DailyBandSummary => b != null && b.count > 0)
      .map((b) => b.flat_bet_roi_pct);

    if (baselineBandRois.length === 0) continue;
    const baselineBandRoi = mean(baselineBandRois);
    const bandDeviation = Math.abs(todayBand.flat_bet_roi_pct - baselineBandRoi);

    if (bandDeviation >= DRIFT_THRESHOLDS.roi_critical) {
      flags.push({
        category: 'roi_drift',
        severity: 'critical',
        message: `Band ${band} ROI deviated ${bandDeviation.toFixed(1)}pp from baseline`,
        current: todayBand.flat_bet_roi_pct,
        baseline: baselineBandRoi,
        deviation: bandDeviation,
        band,
      });
    } else if (bandDeviation >= DRIFT_THRESHOLDS.roi_warning) {
      flags.push({
        category: 'roi_drift',
        severity: 'warning',
        message: `Band ${band} ROI deviated ${bandDeviation.toFixed(1)}pp from baseline`,
        current: todayBand.flat_bet_roi_pct,
        baseline: baselineBandRoi,
        deviation: bandDeviation,
        band,
      });
    }
  }
}

function checkClvDrift(
  today: DailyRollupReport,
  baseline: DailyRollupReport[],
  flags: DriftFlag[],
): void {
  const publishedBands: BandTier[] = ['A+', 'A', 'B', 'C'];

  for (const band of publishedBands) {
    const todayBand = today.by_band.find((b) => b.band === band);
    if (!todayBand || todayBand.avg_clv_percent === null) continue;

    const baselineClvs = baseline
      .map((r) => r.by_band.find((b) => b.band === band))
      .filter((b): b is DailyBandSummary => b != null && b.avg_clv_percent !== null)
      .map((b) => b.avg_clv_percent!);

    if (baselineClvs.length === 0) continue;
    const baselineClv = mean(baselineClvs);
    const deviation = Math.abs(todayBand.avg_clv_percent - baselineClv);

    if (deviation >= DRIFT_THRESHOLDS.clv_critical) {
      flags.push({
        category: 'clv_drift',
        severity: 'critical',
        message: `Band ${band} CLV deviated ${(deviation * 100).toFixed(2)}% from baseline`,
        current: todayBand.avg_clv_percent,
        baseline: baselineClv,
        deviation,
        band,
      });
    } else if (deviation >= DRIFT_THRESHOLDS.clv_warning) {
      flags.push({
        category: 'clv_drift',
        severity: 'warning',
        message: `Band ${band} CLV deviated ${(deviation * 100).toFixed(2)}% from baseline`,
        current: todayBand.avg_clv_percent,
        baseline: baselineClv,
        deviation,
        band,
      });
    }
  }
}

function checkCalibrationDrift(
  today: DailyRollupReport,
  baseline: DailyRollupReport[],
  flags: DriftFlag[],
): void {
  const publishedBands: BandTier[] = ['A+', 'A', 'B', 'C'];

  for (const band of publishedBands) {
    const todayBand = today.by_band.find((b) => b.band === band);
    if (!todayBand || todayBand.count === 0) continue;

    const baselineBriers = baseline
      .map((r) => r.by_band.find((b) => b.band === band))
      .filter((b): b is DailyBandSummary => b != null && b.count > 0)
      .map((b) => b.brier_score);

    if (baselineBriers.length === 0) continue;
    const baselineBrier = mean(baselineBriers);

    const worsening = todayBand.brier_score - baselineBrier;
    if (worsening <= 0) continue;

    if (worsening >= DRIFT_THRESHOLDS.brier_critical) {
      flags.push({
        category: 'calibration_drift',
        severity: 'critical',
        message: `Band ${band} Brier score worsened by ${worsening.toFixed(4)}`,
        current: todayBand.brier_score,
        baseline: baselineBrier,
        deviation: worsening,
        band,
      });
    } else if (worsening >= DRIFT_THRESHOLDS.brier_warning) {
      flags.push({
        category: 'calibration_drift',
        severity: 'warning',
        message: `Band ${band} Brier score worsened by ${worsening.toFixed(4)}`,
        current: todayBand.brier_score,
        baseline: baselineBrier,
        deviation: worsening,
        band,
      });
    }
  }
}

function checkDistributionDrift(
  today: DailyRollupReport,
  baseline: DailyRollupReport[],
  flags: DriftFlag[],
): void {
  const allBands: BandTier[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'];
  const todayTotal = today.total_picks;
  if (todayTotal === 0) return;

  for (const band of allBands) {
    const todayPct = (today.band_distribution[band] / todayTotal) * 100;

    const baselinePcts = baseline
      .filter((r) => r.total_picks > 0)
      .map((r) => (r.band_distribution[band] / r.total_picks) * 100);

    if (baselinePcts.length === 0) continue;
    const baselinePct = mean(baselinePcts);
    const deviation = Math.abs(todayPct - baselinePct);

    if (deviation >= DRIFT_THRESHOLDS.distribution_critical) {
      flags.push({
        category: 'distribution_drift',
        severity: 'critical',
        message: `Band ${band} distribution shifted ${deviation.toFixed(1)}pp`,
        current: todayPct,
        baseline: baselinePct,
        deviation,
        band,
      });
    } else if (deviation >= DRIFT_THRESHOLDS.distribution_warning) {
      flags.push({
        category: 'distribution_drift',
        severity: 'warning',
        message: `Band ${band} distribution shifted ${deviation.toFixed(1)}pp`,
        current: todayPct,
        baseline: baselinePct,
        deviation,
        band,
      });
    }
  }
}

function checkSuppressionDrift(
  today: DailyRollupReport,
  baseline: DailyRollupReport[],
  flags: DriftFlag[],
): void {
  if (today.downgrade_counts.total_picks === 0) return;

  const todayRate =
    (today.downgrade_counts.suppressed / today.downgrade_counts.total_picks) * 100;

  const baselineRates = baseline
    .filter((r) => r.downgrade_counts.total_picks > 0)
    .map((r) => (r.downgrade_counts.suppressed / r.downgrade_counts.total_picks) * 100);

  if (baselineRates.length === 0) return;
  const baselineRate = mean(baselineRates);
  const deviation = Math.abs(todayRate - baselineRate);

  if (deviation >= DRIFT_THRESHOLDS.suppression_critical) {
    flags.push({
      category: 'suppression_rate_drift',
      severity: 'critical',
      message: `Suppression rate changed ${deviation.toFixed(1)}pp`,
      current: todayRate,
      baseline: baselineRate,
      deviation,
    });
  } else if (deviation >= DRIFT_THRESHOLDS.suppression_warning) {
    flags.push({
      category: 'suppression_rate_drift',
      severity: 'warning',
      message: `Suppression rate changed ${deviation.toFixed(1)}pp`,
      current: todayRate,
      baseline: baselineRate,
      deviation,
    });
  }
}

function checkAttributionDrift(
  today: DailyRollupReport,
  baseline: DailyRollupReport[],
  flags: DriftFlag[],
): void {
  if (today.attribution_counts.total_losses === 0) return;

  const categories = [
    'projection_miss',
    'price_miss',
    'variance',
    'execution_miss',
    'news_miss',
    'correlation_miss',
    'unknown',
  ] as const;

  for (const cat of categories) {
    const todayPct =
      (today.attribution_counts[cat] / today.attribution_counts.total_losses) * 100;

    const baselinePcts = baseline
      .filter((r) => r.attribution_counts.total_losses > 0)
      .map((r) => (r.attribution_counts[cat] / r.attribution_counts.total_losses) * 100);

    if (baselinePcts.length === 0) continue;
    const baselinePct = mean(baselinePcts);
    const deviation = Math.abs(todayPct - baselinePct);

    if (deviation >= DRIFT_THRESHOLDS.attribution_warning) {
      flags.push({
        category: 'attribution_drift',
        severity: 'warning',
        message: `${cat} attribution share shifted ${deviation.toFixed(1)}pp`,
        current: todayPct,
        baseline: baselinePct,
        deviation,
      });
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildReport(date: string, baselineSize: number, flags: DriftFlag[]): DriftReport {
  const criticalCount = flags.filter((f) => f.severity === 'critical').length;
  const warningCount = flags.filter((f) => f.severity === 'warning').length;
  const infoCount = flags.filter((f) => f.severity === 'info').length;

  return {
    report_version: 'drift-detector-v1.0',
    date,
    baseline_window_size: baselineSize,
    flags,
    summary: {
      total_flags: flags.length,
      critical_count: criticalCount,
      warning_count: warningCount,
      info_count: infoCount,
      regime_healthy: criticalCount === 0,
    },
  };
}

function avgOf(reports: DailyRollupReport[], fn: (r: DailyRollupReport) => number): number {
  if (reports.length === 0) return 0;
  return reports.reduce((s, r) => s + fn(r), 0) / reports.length;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
