/**
 * System Health Runner
 *
 * Orchestrates all health check computations into a single deterministic report.
 * This is the primary entry point for the system health snapshot.
 */

import {
  computeCLVByBand,
  computeROIByBand,
  computeCalibrationCurve,
  computeBandDistribution,
  computeDowngradeEffectiveness,
  computeSuppressionEffectiveness,
  computeDriftStatus,
  computeCalibrationImpact,
} from './system-health-report.js';
import { SYSTEM_HEALTH_REPORT_VERSION } from './system-health-types.js';

import type { SystemHealthRecord, SystemHealthReport } from './system-health-types.js';
import type { DriftReport } from '../rollups/drift-detector.js';

/**
 * Generate a complete system health snapshot report.
 *
 * Deterministic: same inputs always produce the same output
 * (except for the `generated_at` timestamp).
 *
 * @param records - Resolved pick records with full pipeline data.
 * @param driftReport - Optional drift detection report (from drift-detector module).
 * @param timestamp - Optional fixed timestamp for deterministic output.
 */
export function generateSystemHealthReport(
  records: SystemHealthRecord[],
  driftReport: DriftReport | null = null,
  timestamp?: string,
): SystemHealthReport {
  return {
    report_version: SYSTEM_HEALTH_REPORT_VERSION,
    generated_at: timestamp ?? new Date().toISOString(),
    total_records: records.length,

    clvByBand: computeCLVByBand(records),
    roiByBand: computeROIByBand(records),
    calibrationMetrics: computeCalibrationCurve(records),
    bandDistribution: computeBandDistribution(records),
    downgradeEffectiveness: computeDowngradeEffectiveness(records),
    suppressionEffectiveness: computeSuppressionEffectiveness(records),
    driftStatus: computeDriftStatus(driftReport),
    calibrationImpact: computeCalibrationImpact(records),
  };
}
