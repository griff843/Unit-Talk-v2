/**
 * System Health Snapshot Types
 *
 * Type definitions for the intelligence pipeline health report.
 * This module only measures the system — it does NOT modify any
 * models, thresholds, or calibration parameters.
 */
import type { BandTier } from '../bands/types.js';

// ── Report Version ──────────────────────────────────────────────────────────

export const SYSTEM_HEALTH_REPORT_VERSION = 'system-health-v1.0';

// ── Input Record ────────────────────────────────────────────────────────────

/**
 * A single resolved pick with all pipeline fields needed for the health snapshot.
 */
export interface SystemHealthRecord {
  /** Final assigned band. */
  finalBand: BandTier;
  /** Initial band before downgrades. */
  initialBand: BandTier;
  /** Downgrade reason codes. */
  downgradeReasons: string[];
  /** Suppression reason codes. */
  suppressionReasons: string[];
  /** Actual outcome. */
  outcome: 'WIN' | 'LOSS' | 'PUSH';
  /** Model final probability. */
  p_final: number;
  /** Calibrated probability (post-calibration). */
  p_calibrated: number;
  /** Model edge vs market. */
  edge_final: number;
  /** CLV percent if available. */
  clvPercent?: number | null;
}

export interface ReliabilityBucket {
  predicted: number;
  observed: number;
  count: number;
  lower: number;
  upper: number;
}

export interface CalibrationMetrics {
  brierScore: number;
  logLoss: number;
  ece: number;
  reliabilityCurve: ReliabilityBucket[];
  sampleSize: number;
}

// ── Section Types ───────────────────────────────────────────────────────────

/** CLV metrics for a single band. */
export interface BandCLVMetrics {
  band: Exclude<BandTier, 'SUPPRESS'>;
  avg_clv_pct: number | null;
  positive_clv_rate: number;
  negative_clv_rate: number;
  sample_size: number;
}

/** ROI metrics for a single band. */
export interface BandROIMetrics {
  band: Exclude<BandTier, 'SUPPRESS'>;
  roi_pct: number;
  sample_size: number;
}

/** Band distribution metrics. */
export interface BandDistributionMetrics {
  band: BandTier;
  frequency: number;
  frequency_pct: number;
}

/** Full band distribution section. */
export interface BandDistributionSection {
  distribution: BandDistributionMetrics[];
  total_picks: number;
  suppression_rate_pct: number;
  downgrade_rate_pct: number;
  /** True if any band has > 50% of non-suppressed picks. */
  collapsed_warning: boolean;
}

/** Calibration curve section. */
export interface CalibrationCurveSection {
  brier_score: number;
  log_loss: number;
  ece: number;
  reliability_buckets: ReliabilityBucket[];
  sample_size: number;
}

/** Downgrade effectiveness section. */
export interface DowngradeEffectivenessSection {
  loss_prevention_rate: number;
  estimated_savings: number;
  downgrade_reason_counts: Array<{ reason: string; count: number }>;
  downgrade_effective: boolean;
}

/** Suppression effectiveness section. */
export interface SuppressionEffectivenessSection {
  suppressed_hypothetical_roi_pct: number;
  suppressed_hypothetical_clv_pct: number | null;
  suppression_effective: boolean;
  suppressed_count: number;
}

/** Drift status section. */
export interface DriftStatusSection {
  drift_warnings: number;
  drift_critical_flags: number;
  regime_stability: 'stable' | 'warning' | 'critical';
  flags: Array<{ category: string; severity: string; message: string }>;
}

/** Calibration impact section. */
export interface CalibrationImpactSection {
  pre_calibration: CalibrationMetrics;
  post_calibration: CalibrationMetrics;
  brier_improvement: number;
  log_loss_delta: number;
  monotonicity_preserved: boolean;
  calibration_helped: boolean;
}

// ── Full Report ─────────────────────────────────────────────────────────────

/**
 * The complete system health snapshot report.
 * Deterministic given the same input records and drift baseline.
 */
export interface SystemHealthReport {
  report_version: string;
  generated_at: string;
  total_records: number;

  clvByBand: BandCLVMetrics[];
  roiByBand: BandROIMetrics[];
  calibrationMetrics: CalibrationCurveSection;
  bandDistribution: BandDistributionSection;
  downgradeEffectiveness: DowngradeEffectivenessSection;
  suppressionEffectiveness: SuppressionEffectivenessSection;
  driftStatus: DriftStatusSection;
  calibrationImpact: CalibrationImpactSection;
}
