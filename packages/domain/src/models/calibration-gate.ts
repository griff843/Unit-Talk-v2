/**
 * Calibration Gate — INIT-3.3.2
 *
 * A model may not promote from shadow-to-active without a current passing
 * CalibrationReport. This module provides the gate evaluation and the
 * CalibrationCertification entity that records approved promotions.
 *
 * Invariants:
 *  - No promotion without a passing CalibrationReport.
 *  - Expired, failed, or absent reports all block promotion.
 *  - All functions are pure and deterministic for replay.
 *  - All promotion decisions emit AuditEvents as append-only records.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CalibrationStatus = 'pass' | 'fail' | 'pending' | 'expired';

export type PromotionDecision = 'approved' | 'blocked';

export type PromotionBlockReason =
  | 'no_calibration_report'
  | 'calibration_failed'
  | 'calibration_expired'
  | 'calibration_pending';

export interface CalibrationMetricResult {
  readonly metric: string;
  readonly threshold: number;
  readonly actual_value: number;
  readonly direction: 'above' | 'below';
  readonly passed: boolean;
}

/**
 * The reproducible evidence that a model's calibration metrics were evaluated
 * at a specific point in time. Status is 'pass' only when ALL metrics pass.
 */
export interface CalibrationReport {
  readonly report_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly evaluated_at_ms: number;
  readonly valid_for_ms: number;
  readonly metric_results: readonly CalibrationMetricResult[];
  readonly status: CalibrationStatus;
}

export interface CalibrationReportThreshold {
  readonly metric: string;
  readonly threshold: number;
  readonly direction: 'above' | 'below';
}

export interface CalibrationReportInput {
  readonly report_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly evaluated_at_ms: number;
  /** Default: 86_400_000 ms (24 h) */
  readonly valid_for_ms?: number;
  readonly thresholds: readonly CalibrationReportThreshold[];
  readonly metrics: Readonly<Record<string, number>>;
}

export interface CalibrationAuditEvent {
  readonly event_type:
    | 'calibration_certification_issued'
    | 'promotion_approved'
    | 'promotion_blocked';
  readonly entity_type: 'model_version';
  /** Stable key: `{model_name}@{model_version}` */
  readonly entity_id: string;
  readonly triggered_at_ms: number;
  readonly block_reason?: PromotionBlockReason;
  readonly report_id?: string;
}

/**
 * Issued when a model's shadow-to-active promotion is approved.
 * Callers must persist this as an append-only record.
 */
export interface CalibrationCertification {
  readonly certification_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly report_id: string;
  readonly certified_at_ms: number;
  readonly valid_until_ms: number;
  readonly status: 'certified';
  readonly audit_event: CalibrationAuditEvent;
}

export interface CalibrationCertificationInput {
  readonly certification_id: string;
  readonly report: CalibrationReport;
  readonly certified_at_ms: number;
}

export interface PromotionGateInput {
  readonly model_name: string;
  readonly model_version: string;
  readonly requested_at_ms: number;
  /** Most recent CalibrationReport for this model version. Null if none exists. */
  readonly calibration_report: CalibrationReport | null;
}

export interface PromotionGateResult {
  readonly model_name: string;
  readonly model_version: string;
  readonly decision: PromotionDecision;
  readonly block_reason: PromotionBlockReason | null;
  readonly report_id: string | null;
  readonly evaluated_at_ms: number;
  readonly audit_event: CalibrationAuditEvent;
}

// ── Functions ─────────────────────────────────────────────────────────────────

const DEFAULT_VALID_FOR_MS = 86_400_000; // 24 h

/**
 * Builds a CalibrationReport from raw metric readings and thresholds.
 *
 * Status is 'pass' only when every configured threshold is satisfied.
 * Unknown metrics (not in thresholds) are silently skipped — callers
 * configure exactly the metrics they care about.
 */
export function buildCalibrationReport(input: CalibrationReportInput): CalibrationReport {
  const validForMs = input.valid_for_ms ?? DEFAULT_VALID_FOR_MS;

  const metricResults: CalibrationMetricResult[] = input.thresholds.map((threshold) => {
    const actual = input.metrics[threshold.metric];

    if (actual === undefined) {
      // Metric not present in readings — treat as failed (fail-closed).
      return {
        metric: threshold.metric,
        threshold: threshold.threshold,
        actual_value: NaN,
        direction: threshold.direction,
        passed: false,
      };
    }

    const passed =
      threshold.direction === 'above'
        ? actual <= threshold.threshold
        : actual >= threshold.threshold;

    return {
      metric: threshold.metric,
      threshold: threshold.threshold,
      actual_value: actual,
      direction: threshold.direction,
      passed,
    };
  });

  const allPassed = metricResults.length > 0 && metricResults.every((r) => r.passed);

  return {
    report_id: input.report_id,
    model_name: input.model_name,
    model_version: input.model_version,
    evaluated_at_ms: input.evaluated_at_ms,
    valid_for_ms: validForMs,
    metric_results: metricResults,
    status: allPassed ? 'pass' : 'fail',
  };
}

/**
 * Issues a CalibrationCertification for a model with a passing report.
 *
 * Callers must verify report.status === 'pass' before calling. The
 * certification is valid for the same window as the report.
 */
export function buildCalibrationCertification(
  input: CalibrationCertificationInput,
): CalibrationCertification {
  const entityId = `${input.report.model_name}@${input.report.model_version}`;

  const auditEvent: CalibrationAuditEvent = {
    event_type: 'calibration_certification_issued',
    entity_type: 'model_version',
    entity_id: entityId,
    triggered_at_ms: input.certified_at_ms,
    report_id: input.report.report_id,
  };

  return {
    certification_id: input.certification_id,
    model_name: input.report.model_name,
    model_version: input.report.model_version,
    report_id: input.report.report_id,
    certified_at_ms: input.certified_at_ms,
    valid_until_ms: input.report.evaluated_at_ms + input.report.valid_for_ms,
    status: 'certified',
    audit_event: auditEvent,
  };
}

/**
 * Evaluates whether a model may promote from shadow to active.
 *
 * Gate rules (fail-closed — blocked unless all pass):
 *  1. A CalibrationReport must exist.
 *  2. The report must have status 'pass'.
 *  3. The report must not be expired at the time of promotion request.
 *  4. The report must not be in 'pending' state.
 *
 * All decisions emit an audit event. Callers must persist the audit_event
 * and — when approved — call buildCalibrationCertification to issue the cert.
 */
export function evaluateCalibrationGate(input: PromotionGateInput): PromotionGateResult {
  const entityId = `${input.model_name}@${input.model_version}`;
  const report = input.calibration_report;

  if (report === null) {
    const auditEvent: CalibrationAuditEvent = {
      event_type: 'promotion_blocked',
      entity_type: 'model_version',
      entity_id: entityId,
      triggered_at_ms: input.requested_at_ms,
      block_reason: 'no_calibration_report',
    };
    return {
      model_name: input.model_name,
      model_version: input.model_version,
      decision: 'blocked',
      block_reason: 'no_calibration_report',
      report_id: null,
      evaluated_at_ms: input.requested_at_ms,
      audit_event: auditEvent,
    };
  }

  const isExpired =
    input.requested_at_ms >= report.evaluated_at_ms + report.valid_for_ms;

  let blockReason: PromotionBlockReason | null = null;

  if (report.status === 'pending') {
    blockReason = 'calibration_pending';
  } else if (report.status === 'fail') {
    blockReason = 'calibration_failed';
  } else if (isExpired) {
    blockReason = 'calibration_expired';
  }

  if (blockReason !== null) {
    const auditEvent: CalibrationAuditEvent = {
      event_type: 'promotion_blocked',
      entity_type: 'model_version',
      entity_id: entityId,
      triggered_at_ms: input.requested_at_ms,
      block_reason: blockReason,
      report_id: report.report_id,
    };
    return {
      model_name: input.model_name,
      model_version: input.model_version,
      decision: 'blocked',
      block_reason: blockReason,
      report_id: report.report_id,
      evaluated_at_ms: input.requested_at_ms,
      audit_event: auditEvent,
    };
  }

  // report.status === 'pass' and not expired — approved.
  const auditEvent: CalibrationAuditEvent = {
    event_type: 'promotion_approved',
    entity_type: 'model_version',
    entity_id: entityId,
    triggered_at_ms: input.requested_at_ms,
    report_id: report.report_id,
  };

  return {
    model_name: input.model_name,
    model_version: input.model_version,
    decision: 'approved',
    block_reason: null,
    report_id: report.report_id,
    evaluated_at_ms: input.requested_at_ms,
    audit_event: auditEvent,
  };
}
