import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildCalibrationReport,
  buildCalibrationCertification,
  evaluateCalibrationGate,
  type CalibrationReport,
  type CalibrationReportInput,
  type PromotionGateInput,
} from './calibration-gate.js';

const BASE_THRESHOLDS = [
  { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
  { metric: 'hit_rate', threshold: 0.45, direction: 'below' as const },
];

const PASSING_METRICS = { brier_score: 0.20, hit_rate: 0.52 };
const FAILING_METRICS = { brier_score: 0.31, hit_rate: 0.52 };

const BASE_REPORT_INPUT: CalibrationReportInput = {
  report_id: 'rpt-001',
  model_name: 'nba-spread-v3',
  model_version: '3.1.0',
  evaluated_at_ms: 1_000_000,
  valid_for_ms: 86_400_000,
  thresholds: BASE_THRESHOLDS,
  metrics: PASSING_METRICS,
};

function makePassingReport(): CalibrationReport {
  return buildCalibrationReport(BASE_REPORT_INPUT);
}

function makeFailingReport(): CalibrationReport {
  return buildCalibrationReport({ ...BASE_REPORT_INPUT, metrics: FAILING_METRICS });
}

// ── buildCalibrationReport ────────────────────────────────────────────────────

describe('buildCalibrationReport', () => {
  it('status is pass when all metrics satisfy thresholds', () => {
    const report = makePassingReport();
    assert.equal(report.status, 'pass');
    assert.equal(report.metric_results.length, 2);
    assert.ok(report.metric_results.every((r) => r.passed));
  });

  it('status is fail when any metric breaches threshold', () => {
    const report = makeFailingReport();
    assert.equal(report.status, 'fail');
    assert.equal(report.metric_results.filter((r) => !r.passed).length, 1);
  });

  it('fails closed when a metric is missing from readings', () => {
    const report = buildCalibrationReport({
      ...BASE_REPORT_INPUT,
      metrics: { hit_rate: 0.52 }, // brier_score absent
    });
    assert.equal(report.status, 'fail');
    const brier = report.metric_results.find((r) => r.metric === 'brier_score');
    assert.equal(brier?.passed, false);
  });

  it('defaults valid_for_ms to 24 h when not provided', () => {
    const { valid_for_ms: _, ...rest } = BASE_REPORT_INPUT;
    const report = buildCalibrationReport(rest);
    assert.equal(report.valid_for_ms, 86_400_000);
  });

  it('exactly at threshold passes (strictly gt/lt, not >=/<= breach)', () => {
    const report = buildCalibrationReport({
      ...BASE_REPORT_INPUT,
      metrics: { brier_score: 0.25, hit_rate: 0.45 },
    });
    assert.equal(report.status, 'pass');
  });

  it('above-direction metric fails when actual > threshold', () => {
    const report = buildCalibrationReport({
      ...BASE_REPORT_INPUT,
      metrics: { brier_score: 0.30, hit_rate: 0.52 },
    });
    const brier = report.metric_results.find((r) => r.metric === 'brier_score');
    assert.equal(brier?.passed, false);
  });

  it('below-direction metric fails when actual < threshold', () => {
    const report = buildCalibrationReport({
      ...BASE_REPORT_INPUT,
      metrics: { brier_score: 0.20, hit_rate: 0.40 },
    });
    const hr = report.metric_results.find((r) => r.metric === 'hit_rate');
    assert.equal(hr?.passed, false);
  });

  it('is deterministic — same input produces identical result', () => {
    const r1 = buildCalibrationReport(BASE_REPORT_INPUT);
    const r2 = buildCalibrationReport(BASE_REPORT_INPUT);
    assert.deepEqual(r1, r2);
  });
});

// ── buildCalibrationCertification ────────────────────────────────────────────

describe('buildCalibrationCertification', () => {
  it('issues a certified certification from a passing report', () => {
    const report = makePassingReport();
    const cert = buildCalibrationCertification({
      certification_id: 'cert-001',
      report,
      certified_at_ms: 1_500_000,
    });
    assert.equal(cert.status, 'certified');
    assert.equal(cert.model_name, report.model_name);
    assert.equal(cert.model_version, report.model_version);
    assert.equal(cert.report_id, report.report_id);
    assert.equal(cert.certified_at_ms, 1_500_000);
  });

  it('valid_until_ms = report.evaluated_at_ms + report.valid_for_ms', () => {
    const report = makePassingReport();
    const cert = buildCalibrationCertification({
      certification_id: 'cert-002',
      report,
      certified_at_ms: 1_000_000,
    });
    assert.equal(cert.valid_until_ms, report.evaluated_at_ms + report.valid_for_ms);
  });

  it('emits calibration_certification_issued audit event', () => {
    const report = makePassingReport();
    const cert = buildCalibrationCertification({
      certification_id: 'cert-003',
      report,
      certified_at_ms: 1_200_000,
    });
    assert.equal(cert.audit_event.event_type, 'calibration_certification_issued');
    assert.equal(cert.audit_event.entity_type, 'model_version');
    assert.equal(cert.audit_event.entity_id, 'nba-spread-v3@3.1.0');
    assert.equal(cert.audit_event.triggered_at_ms, 1_200_000);
    assert.equal(cert.audit_event.report_id, report.report_id);
  });
});

// ── evaluateCalibrationGate — normal paths ────────────────────────────────────

describe('evaluateCalibrationGate', () => {
  const BASE_GATE: PromotionGateInput = {
    model_name: 'nba-spread-v3',
    model_version: '3.1.0',
    requested_at_ms: 1_500_000,
    calibration_report: null,
  };

  it('blocks when no report exists', () => {
    const result = evaluateCalibrationGate(BASE_GATE);
    assert.equal(result.decision, 'blocked');
    assert.equal(result.block_reason, 'no_calibration_report');
    assert.equal(result.report_id, null);
  });

  it('approves when report is pass and not expired', () => {
    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      calibration_report: makePassingReport(),
    });
    assert.equal(result.decision, 'approved');
    assert.equal(result.block_reason, null);
  });

  it('blocks when report status is fail', () => {
    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      calibration_report: makeFailingReport(),
    });
    assert.equal(result.decision, 'blocked');
    assert.equal(result.block_reason, 'calibration_failed');
  });

  it('blocks when report is expired', () => {
    const report = makePassingReport(); // evaluated_at_ms=1_000_000, valid_for_ms=86_400_000
    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      requested_at_ms: 1_000_000 + 86_400_000, // exactly at expiry boundary
      calibration_report: report,
    });
    assert.equal(result.decision, 'blocked');
    assert.equal(result.block_reason, 'calibration_expired');
  });

  it('approves when requested_at_ms is just before expiry', () => {
    const report = makePassingReport();
    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      requested_at_ms: 1_000_000 + 86_400_000 - 1,
      calibration_report: report,
    });
    assert.equal(result.decision, 'approved');
  });

  it('blocks when report status is pending', () => {
    const report: CalibrationReport = { ...makePassingReport(), status: 'pending' };
    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      calibration_report: report,
    });
    assert.equal(result.decision, 'blocked');
    assert.equal(result.block_reason, 'calibration_pending');
  });

  it('approved result emits promotion_approved audit event', () => {
    const report = makePassingReport();
    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      calibration_report: report,
    });
    assert.equal(result.audit_event.event_type, 'promotion_approved');
    assert.equal(result.audit_event.entity_id, 'nba-spread-v3@3.1.0');
    assert.equal(result.audit_event.report_id, report.report_id);
  });

  it('blocked result emits promotion_blocked audit event with block_reason', () => {
    const result = evaluateCalibrationGate(BASE_GATE);
    assert.equal(result.audit_event.event_type, 'promotion_blocked');
    assert.equal(result.audit_event.block_reason, 'no_calibration_report');
  });

  it('is deterministic — same input produces identical result', () => {
    const report = makePassingReport();
    const r1 = evaluateCalibrationGate({ ...BASE_GATE, calibration_report: report });
    const r2 = evaluateCalibrationGate({ ...BASE_GATE, calibration_report: report });
    assert.deepEqual(r1, r2);
  });
});

// ── ADVERSARIAL VALIDATION — INIT-3.3.2 requirement: failing model must be blocked ──

describe('evaluateCalibrationGate — adversarial validation', () => {
  const BASE_GATE: PromotionGateInput = {
    model_name: 'nba-spread-v3',
    model_version: '3.1.0',
    requested_at_ms: 1_500_000,
    calibration_report: null,
  };

  it('[ADVERSARIAL] failing model rejected — promotion blocked, cannot go active', () => {
    // Inject failing calibration: brier_score above threshold
    const failingReport = buildCalibrationReport({
      report_id: 'adv-fail-001',
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      evaluated_at_ms: 1_000_000,
      valid_for_ms: 86_400_000,
      thresholds: [{ metric: 'brier_score', threshold: 0.25, direction: 'above' }],
      metrics: { brier_score: 0.38 }, // inject: above threshold → fail
    });

    assert.equal(failingReport.status, 'fail', 'calibration report must be fail');

    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      calibration_report: failingReport,
    });

    assert.equal(result.decision, 'blocked', 'failing model must not be promoted');
    assert.equal(result.block_reason, 'calibration_failed', 'block reason must be calibration_failed');
    assert.equal(result.audit_event.event_type, 'promotion_blocked');

    // Confirm cannot issue certification for a failing report by demonstrating
    // the gate hard-blocks — only approved gate results should lead to certification.
    assert.notEqual(result.decision, 'approved', 'promotion must never be approved for a failing model');
  });

  it('[ADVERSARIAL] multi-metric failure — all violations present, model blocked', () => {
    const failingReport = buildCalibrationReport({
      report_id: 'adv-fail-002',
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      evaluated_at_ms: 1_000_000,
      valid_for_ms: 86_400_000,
      thresholds: [
        { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
        { metric: 'hit_rate', threshold: 0.45, direction: 'below' as const },
      ],
      metrics: { brier_score: 0.40, hit_rate: 0.30 }, // inject both failures
    });

    assert.equal(failingReport.status, 'fail');
    assert.equal(failingReport.metric_results.filter((r) => !r.passed).length, 2);

    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      calibration_report: failingReport,
    });

    assert.equal(result.decision, 'blocked');
    assert.equal(result.block_reason, 'calibration_failed');
  });

  it('[ADVERSARIAL] expired passing report — model blocked even though it once passed', () => {
    const oncePassing = buildCalibrationReport({
      report_id: 'adv-expired-001',
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      evaluated_at_ms: 1_000_000,
      valid_for_ms: 3_600_000, // 1 h window
      thresholds: [{ metric: 'brier_score', threshold: 0.25, direction: 'above' }],
      metrics: { brier_score: 0.20 }, // passed at evaluation time
    });

    assert.equal(oncePassing.status, 'pass');

    // Request 2 h later — window has lapsed
    const result = evaluateCalibrationGate({
      ...BASE_GATE,
      requested_at_ms: 1_000_000 + 7_200_000,
      calibration_report: oncePassing,
    });

    assert.equal(result.decision, 'blocked', 'expired report must block even if it once passed');
    assert.equal(result.block_reason, 'calibration_expired');
  });
});
