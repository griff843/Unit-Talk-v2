/**
 * System Health Report
 *
 * Core computation functions for the intelligence pipeline health snapshot.
 * Composes existing modules (evaluation, drift, downgrade)
 * into a unified health report.
 *
 * This module only MEASURES — it does NOT modify any system parameters.
 */

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
  CalibrationMetrics,
  CalibrationCurveSection,
  DowngradeEffectivenessSection,
  SuppressionEffectivenessSection,
  DriftStatusSection,
  CalibrationImpactSection,
  ModelHealthState,
  ModelHealthTransition,
} from './system-health-types.js';
import {
  CALIBRATION_THRESHOLDS,
} from '../probability/calibration.js';
import type { SliceCalibrationMetrics } from '../probability/calibration.js';
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function computeCalibrationMetrics(
  predictions: Array<{ p: number; outcome: 0 | 1 }>,
  numBuckets = 10,
): CalibrationMetrics {
  if (predictions.length === 0) {
    return {
      brierScore: 0,
      logLoss: 0,
      ece: 0,
      reliabilityCurve: [],
      sampleSize: 0,
    };
  }

  const brierScore = round6(
    predictions.reduce((sum, prediction) => sum + (prediction.outcome - prediction.p) ** 2, 0) /
      predictions.length,
  );

  const logLoss = round6(
    predictions.reduce((sum, prediction) => {
      const pClamped = Math.max(1e-7, Math.min(1 - 1e-7, prediction.p));
      return sum - (
        prediction.outcome * Math.log(pClamped) +
        (1 - prediction.outcome) * Math.log(1 - pClamped)
      );
    }, 0) / predictions.length,
  );

  const reliabilityCurve = buildReliabilityCurve(predictions, numBuckets);
  const ece = round6(
    reliabilityCurve.reduce(
      (sum, bucket) => sum + (bucket.count / predictions.length) * Math.abs(bucket.observed - bucket.predicted),
      0,
    ),
  );

  return {
    brierScore,
    logLoss,
    ece,
    reliabilityCurve,
    sampleSize: predictions.length,
  };
}

// ── Model Health State Machine ───────────────────────────────────────────────

/**
 * Evaluate whether the model's health state should transition, and what caused it.
 *
 * Transition rules:
 *   green → watch:    roi_pct < -5% OR any calibration warning
 *   watch → warning:  roi_pct < -10% OR any calibration critical OR drift_warnings > 2
 *   warning → critical: roi_pct < -15% OR ECE > critical threshold
 *   any → green:      roi_pct > 0 AND calibration green AND no active drift
 *   critical for > criticalWindowHours without operator decision: requiresOperatorDecision = true
 *
 * Pure — no I/O, no DB.
 */
export function evaluateModelHealthState(
  report: import('./system-health-types.js').SystemHealthReport,
  currentState: ModelHealthState,
  criticalWindowHours: number = 24,
  lastTransitionAt?: string,
): { newState: ModelHealthState; trigger: ModelHealthTransition | null } {
  // Aggregate ROI across all published bands
  const roiValues = report.roiByBand
    .filter((b) => b.sample_size > 0)
    .map((b) => b.roi_pct);
  const avgRoi = roiValues.length > 0 ? mean(roiValues) : 0;

  // Calibration state
  const cal = report.calibrationMetrics;
  const calibrationCritical =
    cal.sample_size >= CALIBRATION_THRESHOLDS.minSampleForAlert &&
    (cal.ece >= CALIBRATION_THRESHOLDS.ece.critical ||
      cal.brier_score >= CALIBRATION_THRESHOLDS.brier.critical ||
      cal.log_loss >= CALIBRATION_THRESHOLDS.logLoss.critical);

  const calibrationWarning =
    cal.sample_size >= CALIBRATION_THRESHOLDS.minSampleForAlert &&
    !calibrationCritical &&
    (cal.ece >= CALIBRATION_THRESHOLDS.ece.warning ||
      cal.brier_score >= CALIBRATION_THRESHOLDS.brier.warning ||
      cal.log_loss >= CALIBRATION_THRESHOLDS.logLoss.warning);

  const driftWarnings = report.driftStatus.drift_warnings;

  // ── Recovery path: any state → green ──────────────────────────────────────
  const isHealthy = avgRoi > 0 && !calibrationWarning && !calibrationCritical && driftWarnings === 0;
  if (isHealthy && currentState !== 'green') {
    return {
      newState: 'green',
      trigger: {
        fromState: currentState,
        toState: 'green',
        triggeredBy: 'roi',
        reason: `Recovery: avgRoi=${round2(avgRoi)}%, calibration green, no drift`,
        requiresOperatorDecision: false,
      },
    };
  }

  // ── Degradation paths ──────────────────────────────────────────────────────

  if (currentState === 'green') {
    if (avgRoi < -5) {
      return {
        newState: 'watch',
        trigger: {
          fromState: 'green',
          toState: 'watch',
          triggeredBy: 'roi',
          reason: `avgRoi=${round2(avgRoi)}% < -5%`,
          requiresOperatorDecision: false,
        },
      };
    }
    if (calibrationWarning) {
      return {
        newState: 'watch',
        trigger: {
          fromState: 'green',
          toState: 'watch',
          triggeredBy: 'calibration',
          reason: `Calibration warning: ECE=${round4(cal.ece)}, Brier=${round4(cal.brier_score)}, LogLoss=${round4(cal.log_loss)}`,
          requiresOperatorDecision: false,
        },
      };
    }
  }

  if (currentState === 'watch') {
    if (avgRoi < -10) {
      return {
        newState: 'warning',
        trigger: {
          fromState: 'watch',
          toState: 'warning',
          triggeredBy: 'roi',
          reason: `avgRoi=${round2(avgRoi)}% < -10%`,
          requiresOperatorDecision: false,
        },
      };
    }
    if (calibrationCritical) {
      return {
        newState: 'warning',
        trigger: {
          fromState: 'watch',
          toState: 'warning',
          triggeredBy: 'calibration',
          reason: `Calibration critical: ECE=${round4(cal.ece)}, Brier=${round4(cal.brier_score)}, LogLoss=${round4(cal.log_loss)}`,
          requiresOperatorDecision: false,
        },
      };
    }
    if (driftWarnings > 2) {
      return {
        newState: 'warning',
        trigger: {
          fromState: 'watch',
          toState: 'warning',
          triggeredBy: 'drift',
          reason: `drift_warnings=${driftWarnings} > 2`,
          requiresOperatorDecision: false,
        },
      };
    }
  }

  if (currentState === 'warning') {
    if (avgRoi < -15) {
      return {
        newState: 'critical',
        trigger: {
          fromState: 'warning',
          toState: 'critical',
          triggeredBy: 'roi',
          reason: `avgRoi=${round2(avgRoi)}% < -15%`,
          requiresOperatorDecision: false,
        },
      };
    }
    if (cal.ece >= CALIBRATION_THRESHOLDS.ece.critical) {
      return {
        newState: 'critical',
        trigger: {
          fromState: 'warning',
          toState: 'critical',
          triggeredBy: 'calibration',
          reason: `ECE=${round4(cal.ece)} >= critical threshold ${CALIBRATION_THRESHOLDS.ece.critical}`,
          requiresOperatorDecision: false,
        },
      };
    }
  }

  // ── Critical window check (re-alert if stuck critical) ────────────────────
  if (currentState === 'critical' && lastTransitionAt != null) {
    const elapsedMs = Date.now() - new Date(lastTransitionAt).getTime();
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    if (elapsedHours > criticalWindowHours) {
      return {
        newState: 'critical',
        trigger: {
          fromState: 'critical',
          toState: 'critical',
          triggeredBy: 'roi',
          reason: `Still critical after ${round2(elapsedHours)}h (window=${criticalWindowHours}h) — operator decision required`,
          requiresOperatorDecision: true,
        },
      };
    }
  }

  // No transition
  return { newState: currentState, trigger: null };
}

// ── Model Review Packet ──────────────────────────────────────────────────────

export interface ModelReviewPacket {
  modelId: string;
  weekWindow: { start: string; end: string };
  generatedAt: string;
  overallHealth: { roi_pct: number; calibration_alert_level: string };
  sliceBreakdown: SliceCalibrationMetrics[];
  roiByBand: BandROIMetrics[];
  driftStatus: DriftStatusSection;
  recommendedAction: 'none' | 'review' | 'demote' | 'investigate';
}

/**
 * Bundle all health signals for a model into a single weekly review artifact.
 *
 * Pure — no I/O, no DB. Deterministic given the same inputs.
 */
export function generateModelReviewPacket(
  report: import('./system-health-types.js').SystemHealthReport,
  modelId: string,
  sliceMetrics: SliceCalibrationMetrics[],
  weekWindow: { start: string; end: string },
): ModelReviewPacket {
  const cal = report.calibrationMetrics;

  // Derive alert level from report calibration metrics (uses CALIBRATION_THRESHOLDS)
  let calibration_alert_level: string = 'green';
  if (
    cal.sample_size >= CALIBRATION_THRESHOLDS.minSampleForAlert &&
    (cal.ece >= CALIBRATION_THRESHOLDS.ece.critical ||
      cal.brier_score >= CALIBRATION_THRESHOLDS.brier.critical ||
      cal.log_loss >= CALIBRATION_THRESHOLDS.logLoss.critical)
  ) {
    calibration_alert_level = 'critical';
  } else if (
    cal.sample_size >= CALIBRATION_THRESHOLDS.minSampleForAlert &&
    (cal.ece >= CALIBRATION_THRESHOLDS.ece.warning ||
      cal.brier_score >= CALIBRATION_THRESHOLDS.brier.warning ||
      cal.log_loss >= CALIBRATION_THRESHOLDS.logLoss.warning)
  ) {
    calibration_alert_level = 'warning';
  }

  // Aggregate ROI across bands
  const roiValues = report.roiByBand.filter((b) => b.sample_size > 0).map((b) => b.roi_pct);
  const avgRoi = roiValues.length > 0 ? mean(roiValues) : 0;

  // Determine recommended action
  let recommendedAction: ModelReviewPacket['recommendedAction'] = 'none';
  if (
    avgRoi < -15 ||
    calibration_alert_level === 'critical' ||
    report.driftStatus.drift_critical_flags > 0
  ) {
    recommendedAction = 'demote';
  } else if (
    avgRoi < -5 ||
    calibration_alert_level === 'warning' ||
    report.driftStatus.drift_warnings > 2
  ) {
    recommendedAction = 'investigate';
  } else if (avgRoi < 0 || calibration_alert_level !== 'green') {
    recommendedAction = 'review';
  }

  return {
    modelId,
    weekWindow,
    generatedAt: new Date().toISOString(),
    overallHealth: { roi_pct: round4(avgRoi), calibration_alert_level },
    sliceBreakdown: sliceMetrics,
    roiByBand: report.roiByBand,
    driftStatus: report.driftStatus,
    recommendedAction,
  };
}

function buildReliabilityCurve(
  predictions: Array<{ p: number; outcome: 0 | 1 }>,
  numBuckets: number,
): CalibrationCurveSection['reliability_buckets'] {
  const bucketWidth = 1 / numBuckets;
  const buckets: CalibrationCurveSection['reliability_buckets'] = [];

  for (let index = 0; index < numBuckets; index += 1) {
    const lower = index * bucketWidth;
    const upper = (index + 1) * bucketWidth;
    const inBucket = predictions.filter(
      (prediction) =>
        prediction.p >= lower &&
        (index === numBuckets - 1 ? prediction.p <= upper : prediction.p < upper),
    );
    const count = inBucket.length;
    const predicted =
      count > 0 ? inBucket.reduce((sum, prediction) => sum + prediction.p, 0) / count : lower + bucketWidth / 2;
    const observed =
      count > 0 ? inBucket.reduce((sum, prediction) => sum + prediction.outcome, 0) / count : 0;

    buckets.push({
      predicted: round6(predicted),
      observed: round6(observed),
      count,
      lower: round6(lower),
      upper: round6(upper),
    });
  }

  return buckets;
}
