import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
import { generateSystemHealthReport } from './system-health-runner.js';
import { SYSTEM_HEALTH_REPORT_VERSION } from './system-health-types.js';

import type { DriftReport } from '../rollups/drift-detector.js';
import type { SystemHealthRecord } from './system-health-types.js';

// ── Test Data Helpers ───────────────────────────────────────────────────────

function makeRecord(overrides: Partial<SystemHealthRecord> = {}): SystemHealthRecord {
  return {
    finalBand: 'A',
    initialBand: 'A',
    downgradeReasons: [],
    suppressionReasons: [],
    outcome: 'WIN',
    p_final: 0.55,
    p_calibrated: 0.56,
    edge_final: 0.05,
    clvPercent: 0.02,
    ...overrides,
  };
}

function makeRecordSet(): SystemHealthRecord[] {
  return [
    // A+ band: 2 wins, 1 loss
    makeRecord({ finalBand: 'A+', initialBand: 'A+', outcome: 'WIN', p_final: 0.6, p_calibrated: 0.61, edge_final: 0.1, clvPercent: 0.05 }),
    makeRecord({ finalBand: 'A+', initialBand: 'A+', outcome: 'WIN', p_final: 0.62, p_calibrated: 0.63, edge_final: 0.09, clvPercent: 0.03 }),
    makeRecord({ finalBand: 'A+', initialBand: 'A+', outcome: 'LOSS', p_final: 0.58, p_calibrated: 0.59, edge_final: 0.08, clvPercent: -0.01 }),
    // A band: 3 wins, 2 losses
    makeRecord({ finalBand: 'A', initialBand: 'A', outcome: 'WIN', p_final: 0.55, p_calibrated: 0.56, edge_final: 0.06, clvPercent: 0.02 }),
    makeRecord({ finalBand: 'A', initialBand: 'A', outcome: 'WIN', p_final: 0.54, p_calibrated: 0.55, edge_final: 0.05, clvPercent: 0.01 }),
    makeRecord({ finalBand: 'A', initialBand: 'A', outcome: 'WIN', p_final: 0.56, p_calibrated: 0.57, edge_final: 0.07, clvPercent: 0.03 }),
    makeRecord({ finalBand: 'A', initialBand: 'A', outcome: 'LOSS', p_final: 0.53, p_calibrated: 0.54, edge_final: 0.04, clvPercent: -0.02 }),
    makeRecord({ finalBand: 'A', initialBand: 'A', outcome: 'LOSS', p_final: 0.52, p_calibrated: 0.53, edge_final: 0.03, clvPercent: -0.01 }),
    // B band: 2 wins, 3 losses
    makeRecord({ finalBand: 'B', initialBand: 'B', outcome: 'WIN', p_final: 0.51, p_calibrated: 0.52, edge_final: 0.04, clvPercent: 0.01 }),
    makeRecord({ finalBand: 'B', initialBand: 'B', outcome: 'WIN', p_final: 0.5, p_calibrated: 0.51, edge_final: 0.03, clvPercent: 0.005 }),
    makeRecord({ finalBand: 'B', initialBand: 'B', outcome: 'LOSS', p_final: 0.49, p_calibrated: 0.5, edge_final: 0.03, clvPercent: -0.02 }),
    makeRecord({ finalBand: 'B', initialBand: 'B', outcome: 'LOSS', p_final: 0.48, p_calibrated: 0.49, edge_final: 0.02, clvPercent: -0.03 }),
    makeRecord({ finalBand: 'B', initialBand: 'A', outcome: 'LOSS', p_final: 0.47, p_calibrated: 0.48, edge_final: 0.02, clvPercent: -0.01, downgradeReasons: ['uncertainty:cap'] }),
    // C band: 1 win, 2 losses
    makeRecord({ finalBand: 'C', initialBand: 'B', outcome: 'WIN', p_final: 0.48, p_calibrated: 0.49, edge_final: 0.02, clvPercent: 0.005, downgradeReasons: ['clv:low'] }),
    makeRecord({ finalBand: 'C', initialBand: 'C', outcome: 'LOSS', p_final: 0.46, p_calibrated: 0.47, edge_final: 0.015, clvPercent: -0.03 }),
    makeRecord({ finalBand: 'C', initialBand: 'C', outcome: 'LOSS', p_final: 0.45, p_calibrated: 0.46, edge_final: 0.015, clvPercent: -0.04 }),
    // SUPPRESS: 1 win, 3 losses
    makeRecord({ finalBand: 'SUPPRESS', initialBand: 'B', outcome: 'WIN', p_final: 0.44, p_calibrated: 0.45, edge_final: 0.01, clvPercent: 0.005, suppressionReasons: ['clv:very_low'] }),
    makeRecord({ finalBand: 'SUPPRESS', initialBand: 'C', outcome: 'LOSS', p_final: 0.42, p_calibrated: 0.43, edge_final: 0.01, clvPercent: -0.05, suppressionReasons: ['uncertainty:extreme'] }),
    makeRecord({ finalBand: 'SUPPRESS', initialBand: 'B', outcome: 'LOSS', p_final: 0.41, p_calibrated: 0.42, edge_final: 0.005, clvPercent: -0.04, suppressionReasons: ['market_resistance:high'] }),
    makeRecord({ finalBand: 'SUPPRESS', initialBand: 'A', outcome: 'LOSS', p_final: 0.43, p_calibrated: 0.44, edge_final: 0.01, clvPercent: -0.06, suppressionReasons: ['risk:reject'] }),
  ];
}

function makeDriftReport(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    report_version: 'drift-detector-v1.0',
    date: '2026-03-06',
    baseline_window_size: 7,
    flags: [],
    summary: {
      total_flags: 0,
      critical_count: 0,
      warning_count: 0,
      info_count: 0,
      regime_healthy: true,
    },
    ...overrides,
  };
}

// ── 1. CLV Aggregation Tests ────────────────────────────────────────────────

describe('computeCLVByBand', () => {
  it('computes average CLV per band', () => {
    const records = makeRecordSet();
    const result = computeCLVByBand(records);

    assert.equal(result.length, 4);
    assert.equal(result[0]!.band, 'A+');
    assert.equal(result[1]!.band, 'A');
    assert.equal(result[2]!.band, 'B');
    assert.equal(result[3]!.band, 'C');
  });

  it('computes positive and negative CLV rates', () => {
    const records = makeRecordSet();
    const result = computeCLVByBand(records);

    const aPlus = result.find((r) => r.band === 'A+')!;
    assert.ok(Math.abs(aPlus.positive_clv_rate - 2 / 3) < 0.001);
    assert.ok(Math.abs(aPlus.negative_clv_rate - 1 / 3) < 0.001);
  });

  it('returns null CLV when no CLV records exist', () => {
    const records = [
      makeRecord({ finalBand: 'A+', clvPercent: null }),
      makeRecord({ finalBand: 'A+', clvPercent: null }),
    ];
    const result = computeCLVByBand(records);
    const aPlus = result.find((r) => r.band === 'A+')!;
    assert.equal(aPlus.avg_clv_pct, null);
    assert.equal(aPlus.positive_clv_rate, 0);
    assert.equal(aPlus.negative_clv_rate, 0);
  });

  it('tracks sample sizes correctly', () => {
    const records = makeRecordSet();
    const result = computeCLVByBand(records);

    const aPlusR = result.find((r) => r.band === 'A+');
    const aR = result.find((r) => r.band === 'A');
    const bR = result.find((r) => r.band === 'B');
    const cR = result.find((r) => r.band === 'C');
    assert.ok(aPlusR !== undefined);
    assert.ok(aR !== undefined);
    assert.ok(bR !== undefined);
    assert.ok(cR !== undefined);
    assert.equal(aPlusR.sample_size, 3);
    assert.equal(aR.sample_size, 5);
    assert.equal(bR.sample_size, 5);
    assert.equal(cR.sample_size, 3);
  });
});

// ── 2. ROI Calculation Tests ────────────────────────────────────────────────

describe('computeROIByBand', () => {
  it('computes flat-bet ROI per band', () => {
    const records = makeRecordSet();
    const result = computeROIByBand(records);

    assert.equal(result.length, 4);
    const aPlus = result.find((r) => r.band === 'A+')!;
    // A+ band: 2W 1L → profit = 200 - 110 = 90, wager = 3*110 = 330 → ROI ~27.27%
    assert.ok(Math.abs(aPlus.roi_pct - (90 / 330) * 100) < 1);
  });

  it('handles all-win band correctly', () => {
    const records = [
      makeRecord({ finalBand: 'A+', outcome: 'WIN' }),
      makeRecord({ finalBand: 'A+', outcome: 'WIN' }),
    ];
    const result = computeROIByBand(records);
    const aPlus = result.find((r) => r.band === 'A+')!;
    assert.ok(Math.abs(aPlus.roi_pct - (200 / 220) * 100) < 1);
  });

  it('handles all-loss band correctly', () => {
    const records = [
      makeRecord({ finalBand: 'B', outcome: 'LOSS' }),
      makeRecord({ finalBand: 'B', outcome: 'LOSS' }),
    ];
    const result = computeROIByBand(records);
    const b = result.find((r) => r.band === 'B')!;
    assert.equal(b.roi_pct, -100);
  });

  it('returns 0 ROI for empty band', () => {
    const records = [makeRecord({ finalBand: 'A+', outcome: 'WIN' })];
    const result = computeROIByBand(records);
    const b = result.find((r) => r.band === 'B')!;
    assert.equal(b.roi_pct, 0);
    assert.equal(b.sample_size, 0);
  });

  it('excludes pushes from ROI calculation', () => {
    const records = [
      makeRecord({ finalBand: 'A', outcome: 'WIN' }),
      makeRecord({ finalBand: 'A', outcome: 'PUSH' }),
    ];
    const result = computeROIByBand(records);
    const a = result.find((r) => r.band === 'A')!;
    assert.ok(Math.abs(a.roi_pct - (100 / 110) * 100) < 1);
  });
});

// ── 3. Calibration Metric Correctness ───────────────────────────────────────

describe('computeCalibrationCurve', () => {
  it('computes Brier score for binary outcomes', () => {
    const records = [
      makeRecord({ outcome: 'WIN', p_final: 0.8 }),
      makeRecord({ outcome: 'LOSS', p_final: 0.3 }),
    ];
    const result = computeCalibrationCurve(records);
    assert.ok(Math.abs(result.brier_score - 0.065) < 0.001);
    assert.equal(result.sample_size, 2);
  });

  it('returns reliability buckets', () => {
    const records = makeRecordSet().filter((r) => r.outcome !== 'PUSH');
    const result = computeCalibrationCurve(records);

    assert.equal(result.reliability_buckets.length, 10);
    for (const bucket of result.reliability_buckets) {
      assert.ok('predicted' in bucket);
      assert.ok('observed' in bucket);
      assert.ok('count' in bucket);
      assert.ok('lower' in bucket);
      assert.ok('upper' in bucket);
    }
  });

  it('returns empty section for no records', () => {
    const result = computeCalibrationCurve([]);
    assert.equal(result.brier_score, 0);
    assert.equal(result.log_loss, 0);
    assert.equal(result.ece, 0);
    assert.equal(result.reliability_buckets.length, 0);
    assert.equal(result.sample_size, 0);
  });

  it('excludes pushes from calibration', () => {
    const records = [
      makeRecord({ outcome: 'WIN', p_final: 0.7 }),
      makeRecord({ outcome: 'PUSH', p_final: 0.5 }),
    ];
    const result = computeCalibrationCurve(records);
    assert.equal(result.sample_size, 1);
  });
});

// ── 4. Distribution Sanity Checks ───────────────────────────────────────────

describe('computeBandDistribution', () => {
  it('counts picks per band', () => {
    const records = makeRecordSet();
    const result = computeBandDistribution(records);

    assert.equal(result.total_picks, 20);
    const dist = Object.fromEntries(result.distribution.map((d) => [d.band, d.frequency]));
    assert.equal(dist['A+'], 3);
    assert.equal(dist['A'], 5);
    assert.equal(dist['B'], 5);
    assert.equal(dist['C'], 3);
    assert.equal(dist['SUPPRESS'], 4);
  });

  it('computes suppression and downgrade rates', () => {
    const records = makeRecordSet();
    const result = computeBandDistribution(records);

    assert.ok(Math.abs(result.suppression_rate_pct - 20) < 1);
    assert.ok(Math.abs(result.downgrade_rate_pct - 10) < 1);
  });

  it('detects collapsed distribution', () => {
    const records = Array.from({ length: 10 }, () =>
      makeRecord({ finalBand: 'A', initialBand: 'A' }),
    );
    const result = computeBandDistribution(records);
    assert.equal(result.collapsed_warning, true);
  });

  it('does not flag balanced distribution as collapsed', () => {
    const records = makeRecordSet();
    const result = computeBandDistribution(records);
    assert.equal(result.collapsed_warning, false);
  });
});

// ── 5. Downgrade Effectiveness Logic ────────────────────────────────────────

describe('computeDowngradeEffectiveness', () => {
  it('computes loss prevention metrics', () => {
    const records = makeRecordSet();
    const result = computeDowngradeEffectiveness(records);

    assert.ok('loss_prevention_rate' in result);
    assert.ok('estimated_savings' in result);
    assert.ok('downgrade_reason_counts' in result);
    assert.ok('downgrade_effective' in result);
  });

  it('tracks downgrade reason counts', () => {
    const records = makeRecordSet();
    const result = computeDowngradeEffectiveness(records);

    const reasons = result.downgrade_reason_counts;
    assert.ok(reasons.length > 0);
    for (const r of reasons) {
      assert.ok('reason' in r);
      assert.ok('count' in r);
      assert.ok(r.count > 0);
    }
  });

  it('returns zero savings when no downgrades exist', () => {
    const records = [
      makeRecord({ finalBand: 'A', initialBand: 'A', outcome: 'WIN' }),
      makeRecord({ finalBand: 'B', initialBand: 'B', outcome: 'LOSS' }),
    ];
    const result = computeDowngradeEffectiveness(records);
    assert.ok(Math.abs(result.estimated_savings) < 0.00001);
  });
});

// ── 6. Suppression Effectiveness ────────────────────────────────────────────

describe('computeSuppressionEffectiveness', () => {
  it('computes hypothetical ROI for suppressed picks', () => {
    const records = makeRecordSet();
    const result = computeSuppressionEffectiveness(records);

    assert.ok(result.suppressed_hypothetical_roi_pct < 0);
    assert.equal(result.suppressed_count, 4);
  });

  it('marks suppression as effective when ROI is negative', () => {
    const records = makeRecordSet();
    const result = computeSuppressionEffectiveness(records);
    assert.equal(result.suppression_effective, true);
  });

  it('marks suppression as NOT effective when ROI is positive', () => {
    const records = [
      makeRecord({ finalBand: 'SUPPRESS', initialBand: 'B', outcome: 'WIN', suppressionReasons: ['test'] }),
      makeRecord({ finalBand: 'SUPPRESS', initialBand: 'B', outcome: 'WIN', suppressionReasons: ['test'] }),
    ];
    const result = computeSuppressionEffectiveness(records);
    assert.equal(result.suppression_effective, false);
    assert.ok(result.suppressed_hypothetical_roi_pct > 0);
  });

  it('handles no suppressed picks', () => {
    const records = [makeRecord({ finalBand: 'A', outcome: 'WIN' })];
    const result = computeSuppressionEffectiveness(records);
    assert.equal(result.suppressed_count, 0);
    assert.equal(result.suppression_effective, true);
  });
});

// ── 7. Drift Flags ──────────────────────────────────────────────────────────

describe('computeDriftStatus', () => {
  it('returns stable when no drift report provided', () => {
    const result = computeDriftStatus(null);
    assert.equal(result.regime_stability, 'stable');
    assert.equal(result.drift_warnings, 0);
    assert.equal(result.drift_critical_flags, 0);
  });

  it('classifies healthy regime as stable', () => {
    const drift = makeDriftReport();
    const result = computeDriftStatus(drift);
    assert.equal(result.regime_stability, 'stable');
  });

  it('classifies warnings', () => {
    const drift = makeDriftReport({
      flags: [
        { category: 'roi_drift', severity: 'warning', message: 'ROI drifted', current: -5, baseline: 2, deviation: 7 },
      ],
      summary: { total_flags: 1, critical_count: 0, warning_count: 1, info_count: 0, regime_healthy: true },
    });
    const result = computeDriftStatus(drift);
    assert.equal(result.regime_stability, 'warning');
    assert.equal(result.drift_warnings, 1);
  });

  it('classifies critical flags', () => {
    const drift = makeDriftReport({
      flags: [
        { category: 'roi_drift', severity: 'critical', message: 'ROI collapsed', current: -40, baseline: 2, deviation: 42 },
      ],
      summary: { total_flags: 1, critical_count: 1, warning_count: 0, info_count: 0, regime_healthy: false },
    });
    const result = computeDriftStatus(drift);
    assert.equal(result.regime_stability, 'critical');
    assert.equal(result.drift_critical_flags, 1);
  });
});

// ── 8. Calibration Impact ───────────────────────────────────────────────────

describe('computeCalibrationImpact', () => {
  it('compares pre and post calibration metrics', () => {
    const records = makeRecordSet();
    const result = computeCalibrationImpact(records);

    assert.ok('pre_calibration' in result);
    assert.ok('post_calibration' in result);
    assert.ok('brier_improvement' in result);
    assert.ok('log_loss_delta' in result);
    assert.ok('monotonicity_preserved' in result);
    assert.ok('calibration_helped' in result);
  });

  it('detects positive brier improvement', () => {
    const records = [
      makeRecord({ outcome: 'WIN', p_final: 0.5, p_calibrated: 0.9 }),
      makeRecord({ outcome: 'LOSS', p_final: 0.5, p_calibrated: 0.1 }),
    ];
    const result = computeCalibrationImpact(records);
    assert.ok(result.brier_improvement > 0);
    assert.equal(result.calibration_helped, true);
  });

  it('detects negative brier improvement (calibration hurt)', () => {
    const records = [
      makeRecord({ outcome: 'WIN', p_final: 0.9, p_calibrated: 0.5 }),
      makeRecord({ outcome: 'LOSS', p_final: 0.1, p_calibrated: 0.5 }),
    ];
    const result = computeCalibrationImpact(records);
    assert.ok(result.brier_improvement < 0);
    assert.equal(result.calibration_helped, false);
  });

  it('handles empty records', () => {
    const result = computeCalibrationImpact([]);
    assert.equal(result.brier_improvement, 0);
    assert.equal(result.monotonicity_preserved, true);
    assert.equal(result.calibration_helped, false);
  });
});

// ── 9. Deterministic Report Generation ──────────────────────────────────────

describe('generateSystemHealthReport', () => {
  it('produces a complete report with all sections', () => {
    const records = makeRecordSet();
    const report = generateSystemHealthReport(records, null, '2026-03-06T12:00:00Z');

    assert.equal(report.report_version, SYSTEM_HEALTH_REPORT_VERSION);
    assert.equal(report.generated_at, '2026-03-06T12:00:00Z');
    assert.equal(report.total_records, 20);

    assert.ok(report.clvByBand !== undefined);
    assert.ok(report.roiByBand !== undefined);
    assert.ok(report.calibrationMetrics !== undefined);
    assert.ok(report.bandDistribution !== undefined);
    assert.ok(report.downgradeEffectiveness !== undefined);
    assert.ok(report.suppressionEffectiveness !== undefined);
    assert.ok(report.driftStatus !== undefined);
    assert.ok(report.calibrationImpact !== undefined);
  });

  it('is deterministic given the same inputs', () => {
    const records = makeRecordSet();
    const ts = '2026-03-06T12:00:00Z';
    const report1 = generateSystemHealthReport(records, null, ts);
    const report2 = generateSystemHealthReport(records, null, ts);
    assert.deepStrictEqual(report1, report2);
  });

  it('handles empty input', () => {
    const report = generateSystemHealthReport([], null, '2026-03-06T12:00:00Z');
    assert.equal(report.total_records, 0);
    assert.ok(report.clvByBand.every((b) => b.sample_size === 0));
    assert.ok(report.roiByBand.every((b) => b.roi_pct === 0));
    assert.equal(report.calibrationMetrics.sample_size, 0);
    assert.equal(report.bandDistribution.total_picks, 0);
  });

  it('integrates drift report when provided', () => {
    const records = makeRecordSet();
    const drift = makeDriftReport({
      flags: [
        { category: 'roi_drift', severity: 'warning', message: 'test', current: 0, baseline: 10, deviation: 10 },
      ],
      summary: { total_flags: 1, critical_count: 0, warning_count: 1, info_count: 0, regime_healthy: true },
    });
    const report = generateSystemHealthReport(records, drift, '2026-03-06T12:00:00Z');
    assert.equal(report.driftStatus.drift_warnings, 1);
    assert.equal(report.driftStatus.regime_stability, 'warning');
  });

  it('validates ROI directional ordering (A+ >= A >= B >= C)', () => {
    const records = makeRecordSet();
    const report = generateSystemHealthReport(records, null, '2026-03-06T12:00:00Z');

    const rois = report.roiByBand;
    const aPlusRoi = rois.find((r) => r.band === 'A+')!.roi_pct;
    const cRoi = rois.find((r) => r.band === 'C')!.roi_pct;
    assert.ok(aPlusRoi > cRoi);
  });
});
