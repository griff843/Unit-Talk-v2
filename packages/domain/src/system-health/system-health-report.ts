/**
 * System Health Report
 *
 * Core computation functions for the intelligence pipeline health snapshot.
 * Composes existing modules (calibration, evaluation, drift, downgrade)
 * into a unified health report.
 *
 * This module only MEASURES — it does NOT modify any system parameters.
 */

import { computeCalibrationMetrics } from '../calibration/analysis.js';
import {
  buildDowngradeRecord,
  analyzeDowngradeEffectiveness,
} from '../evaluation/downgrade-effectiveness.js';

import type {
  SystemHealthRecord,
  BandCLVMetrics,
  BandROIMetrics,
  BandDistributionSection,
  BandDistributionMetrics,
  CalibrationCurveSection,
  DowngradeEffectivenessSection,
  SuppressionEffectivenessSection,
  DriftStatusSection,
  CalibrationImpactSection,
} from './system-health-types.js';
import type { BandTier } from '../bands/types.js';
import type { DriftReport } from '../rollups/drift-detector.js';

// ── Constants ───────────────────────────────────────────────────────────────

const PUBLISHED_BANDS: ReadonlyArray<Exclude<BandTier, 'SUPPRESS'>> = ['A+', 'A', 'B', 'C'];
const ALL_BANDS: readonly BandTier[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'];

// ── 1. CLV by Band ──────────────────────────────────────────────────────────

export function computeCLVByBand(records: SystemHealthRecord[]): BandCLVMetrics[] {
  return PUBLISHED_BANDS.map((band) => {
    const bandRecords = records.filter((r) => r.finalBand === band);
    const clvRecords = bandRecords.filter((r) => r.clvPercent != null);

    if (clvRecords.length === 0) {
      return {
        band,
        avg_clv_pct: null,
        positive_clv_rate: 0,
        negative_clv_rate: 0,
        sample_size: bandRecords.length,
      };
    }

    const avgClv = mean(clvRecords.map((r) => r.clvPercent!));
    const positiveCount = clvRecords.filter((r) => r.clvPercent! > 0).length;
    const negativeCount = clvRecords.filter((r) => r.clvPercent! < 0).length;

    return {
      band,
      avg_clv_pct: round4(avgClv),
      positive_clv_rate: round4(positiveCount / clvRecords.length),
      negative_clv_rate: round4(negativeCount / clvRecords.length),
      sample_size: bandRecords.length,
    };
  });
}

// ── 2. ROI by Band ──────────────────────────────────────────────────────────

export function computeROIByBand(records: SystemHealthRecord[]): BandROIMetrics[] {
  return PUBLISHED_BANDS.map((band) => {
    const bandRecords = records.filter((r) => r.finalBand === band);
    const roi = computeFlatBetRoiPct(bandRecords.map((r) => r.outcome));

    return {
      band,
      roi_pct: round4(roi),
      sample_size: bandRecords.length,
    };
  });
}

// ── 3. Calibration Curve ────────────────────────────────────────────────────

export function computeCalibrationCurve(records: SystemHealthRecord[]): CalibrationCurveSection {
  const binary = records.filter((r) => r.outcome !== 'PUSH');

  if (binary.length === 0) {
    return {
      brier_score: 0,
      log_loss: 0,
      ece: 0,
      reliability_buckets: [],
      sample_size: 0,
    };
  }

  const predictions = binary.map((r) => ({
    p: r.p_final,
    outcome: (r.outcome === 'WIN' ? 1 : 0) as 0 | 1,
  }));

  const metrics = computeCalibrationMetrics(predictions, 10);

  return {
    brier_score: metrics.brierScore,
    log_loss: metrics.logLoss,
    ece: metrics.ece,
    reliability_buckets: metrics.reliabilityCurve,
    sample_size: metrics.sampleSize,
  };
}

// ── 4. Band Distribution ────────────────────────────────────────────────────

export function computeBandDistribution(records: SystemHealthRecord[]): BandDistributionSection {
  const total = records.length;

  const distribution: BandDistributionMetrics[] = ALL_BANDS.map((band) => {
    const count = records.filter((r) => r.finalBand === band).length;
    return {
      band,
      frequency: count,
      frequency_pct: total > 0 ? round4((count / total) * 100) : 0,
    };
  });

  const suppressedCount = records.filter((r) => r.finalBand === 'SUPPRESS').length;
  const downgradedCount = records.filter(
    (r) => r.finalBand !== r.initialBand && r.finalBand !== 'SUPPRESS',
  ).length;

  const suppressionRate = total > 0 ? (suppressedCount / total) * 100 : 0;
  const downgradeRate = total > 0 ? (downgradedCount / total) * 100 : 0;

  const nonSuppressed = total - suppressedCount;
  const collapsed =
    nonSuppressed > 0
      ? distribution
          .filter((d) => d.band !== 'SUPPRESS')
          .some((d) => d.frequency / nonSuppressed > 0.5)
      : false;

  return {
    distribution,
    total_picks: total,
    suppression_rate_pct: round4(suppressionRate),
    downgrade_rate_pct: round4(downgradeRate),
    collapsed_warning: collapsed,
  };
}

// ── 5. Downgrade Effectiveness ──────────────────────────────────────────────

export function computeDowngradeEffectiveness(
  records: SystemHealthRecord[],
): DowngradeEffectivenessSection {
  const downgradeRecords = records.map((r) =>
    buildDowngradeRecord(r.initialBand, r.finalBand, r.downgradeReasons, r.suppressionReasons, r.outcome),
  );

  const report = analyzeDowngradeEffectiveness(downgradeRecords);

  const reasonCounts = new Map<string, number>();
  for (const r of records) {
    for (const reason of r.downgradeReasons) {
      const category = reason.split(':')[0]!;
      reasonCounts.set(category, (reasonCounts.get(category) ?? 0) + 1);
    }
  }

  const downgrade_reason_counts = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    loss_prevention_rate: report.suppressed.total > 0 ? report.suppressed.loss_rate_pct : 0,
    estimated_savings: report.diagnostics.estimated_savings,
    downgrade_reason_counts,
    downgrade_effective: report.diagnostics.downgrade_effective,
  };
}

// ── 6. Suppression Effectiveness ────────────────────────────────────────────

export function computeSuppressionEffectiveness(
  records: SystemHealthRecord[],
): SuppressionEffectivenessSection {
  const suppressed = records.filter((r) => r.finalBand === 'SUPPRESS');

  if (suppressed.length === 0) {
    return {
      suppressed_hypothetical_roi_pct: 0,
      suppressed_hypothetical_clv_pct: null,
      suppression_effective: true,
      suppressed_count: 0,
    };
  }

  const hypotheticalRoi = computeFlatBetRoiPct(suppressed.map((r) => r.outcome));

  const clvRecords = suppressed.filter((r) => r.clvPercent != null);
  const hypotheticalClv = clvRecords.length > 0 ? mean(clvRecords.map((r) => r.clvPercent!)) : null;

  const effective = hypotheticalRoi < 0;

  return {
    suppressed_hypothetical_roi_pct: round4(hypotheticalRoi),
    suppressed_hypothetical_clv_pct: hypotheticalClv !== null ? round4(hypotheticalClv) : null,
    suppression_effective: effective,
    suppressed_count: suppressed.length,
  };
}

// ── 7. Drift Status ─────────────────────────────────────────────────────────

export function computeDriftStatus(driftReport: DriftReport | null): DriftStatusSection {
  if (!driftReport) {
    return {
      drift_warnings: 0,
      drift_critical_flags: 0,
      regime_stability: 'stable',
      flags: [],
    };
  }

  const warnings = driftReport.summary.warning_count;
  const criticals = driftReport.summary.critical_count;

  let stability: 'stable' | 'warning' | 'critical';
  if (criticals > 0) {
    stability = 'critical';
  } else if (warnings > 0) {
    stability = 'warning';
  } else {
    stability = 'stable';
  }

  return {
    drift_warnings: warnings,
    drift_critical_flags: criticals,
    regime_stability: stability,
    flags: driftReport.flags.map((f) => ({
      category: f.category,
      severity: f.severity,
      message: f.message,
    })),
  };
}

// ── 8. Calibration Impact ───────────────────────────────────────────────────

export function computeCalibrationImpact(records: SystemHealthRecord[]): CalibrationImpactSection {
  const binary = records.filter((r) => r.outcome !== 'PUSH');

  if (binary.length === 0) {
    const emptyMetrics = { brierScore: 0, logLoss: 0, ece: 0, reliabilityCurve: [], sampleSize: 0 };
    return {
      pre_calibration: emptyMetrics,
      post_calibration: emptyMetrics,
      brier_improvement: 0,
      log_loss_delta: 0,
      monotonicity_preserved: true,
      calibration_helped: false,
    };
  }

  const prePredictions = binary.map((r) => ({
    p: r.p_final,
    outcome: (r.outcome === 'WIN' ? 1 : 0) as 0 | 1,
  }));

  const postPredictions = binary.map((r) => ({
    p: r.p_calibrated,
    outcome: (r.outcome === 'WIN' ? 1 : 0) as 0 | 1,
  }));

  const preCal = computeCalibrationMetrics(prePredictions);
  const postCal = computeCalibrationMetrics(postPredictions);

  const brierImprovement = round6(preCal.brierScore - postCal.brierScore);
  const logLossDelta = round6(postCal.logLoss - preCal.logLoss);

  const monotonicityPreserved = checkCalibrationMonotonicity(records);

  return {
    pre_calibration: preCal,
    post_calibration: postCal,
    brier_improvement: brierImprovement,
    log_loss_delta: logLossDelta,
    monotonicity_preserved: monotonicityPreserved,
    calibration_helped: brierImprovement > 0,
  };
}

/**
 * Verify that calibration preserves probability ordering across bands.
 * Higher bands should still have higher average calibrated probabilities.
 */
function checkCalibrationMonotonicity(records: SystemHealthRecord[]): boolean {
  const bandAvgs: Array<{ band: string; avgPCal: number }> = [];

  for (const band of PUBLISHED_BANDS) {
    const bandRecords = records.filter((r) => r.finalBand === band && r.outcome !== 'PUSH');
    if (bandRecords.length === 0) continue;
    const avg = mean(bandRecords.map((r) => r.p_calibrated));
    bandAvgs.push({ band, avgPCal: avg });
  }

  if (bandAvgs.length < 2) return true;

  for (let i = 1; i < bandAvgs.length; i++) {
    if (bandAvgs[i]!.avgPCal > bandAvgs[i - 1]!.avgPCal + 0.001) {
      return false;
    }
  }

  return true;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
