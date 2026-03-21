import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateDailyRollup,
  type DailyRollupRecord,
  type DailyRollupReport,
} from './daily-rollup.js';
import { detectDrift, DRIFT_THRESHOLDS } from './drift-detector.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<DailyRollupRecord> = {}): DailyRollupRecord {
  return {
    finalBand: 'A',
    initialBand: 'A',
    downgradeReasons: [],
    suppressionReasons: [],
    thresholdVersion: '1.0.0',
    outcome: 'WIN',
    p_final: 0.55,
    p_market_devig: 0.5,
    edge_final: 0.05,
    score: 60,
    book_count: 4,
    clvPercent: 0.02,
    lossAttribution: null,
    marketType: 'moneyline',
    ...overrides,
  };
}

function makeRollup(overrides: Partial<DailyRollupReport> = {}): DailyRollupReport {
  const base = generateDailyRollup('2026-01-15', [
    makeRecord({ outcome: 'WIN', finalBand: 'A' }),
    makeRecord({ outcome: 'LOSS', finalBand: 'A', lossAttribution: 'VARIANCE' }),
    makeRecord({ outcome: 'WIN', finalBand: 'B' }),
  ]);
  return { ...base, ...overrides };
}

// ── Daily Rollup ─────────────────────────────────────────────────────────────

describe('generateDailyRollup', () => {
  it('returns empty report for zero records', () => {
    const report = generateDailyRollup('2026-01-15', []);
    assert.equal(report.total_picks, 0);
    assert.equal(report.total_wins, 0);
    assert.equal(report.total_losses, 0);
    assert.equal(report.overall_roi_pct, 0);
    assert.deepStrictEqual(report.by_band, []);
    assert.equal(report.report_version, 'daily-rollup-v1.0');
  });

  it('computes overall totals correctly', () => {
    const records = [
      makeRecord({ outcome: 'WIN' }),
      makeRecord({ outcome: 'LOSS', lossAttribution: 'VARIANCE' }),
      makeRecord({ outcome: 'PUSH' }),
      makeRecord({ outcome: 'WIN' }),
    ];
    const report = generateDailyRollup('2026-01-15', records);
    assert.equal(report.total_picks, 4);
    assert.equal(report.total_wins, 2);
    assert.equal(report.total_losses, 1);
    assert.equal(report.total_pushes, 1);
    assert.equal(report.date, '2026-01-15');
  });

  it('computes hit rate excluding pushes', () => {
    const records = [
      makeRecord({ outcome: 'WIN' }),
      makeRecord({ outcome: 'LOSS', lossAttribution: 'VARIANCE' }),
      makeRecord({ outcome: 'PUSH' }),
    ];
    const report = generateDailyRollup('2026-01-15', records);
    assert.equal(report.overall_hit_rate_pct, 50);
  });

  it('produces band-level metrics', () => {
    const records = [
      makeRecord({ finalBand: 'A+', outcome: 'WIN' }),
      makeRecord({ finalBand: 'A+', outcome: 'WIN' }),
      makeRecord({ finalBand: 'A', outcome: 'LOSS', lossAttribution: 'PROJECTION_MISS' }),
      makeRecord({ finalBand: 'B', outcome: 'WIN' }),
    ];
    const report = generateDailyRollup('2026-01-15', records);

    const aPlusBand = report.by_band.find((b) => b.band === 'A+');
    assert.ok(aPlusBand !== undefined);
    assert.equal(aPlusBand.count, 2);
    assert.equal(aPlusBand.wins, 2);
    assert.equal(aPlusBand.hit_rate_pct, 100);

    const aBand = report.by_band.find((b) => b.band === 'A');
    assert.ok(aBand !== undefined);
    assert.equal(aBand.count, 1);
    assert.equal(aBand.losses, 1);
  });

  it('computes band distribution counts', () => {
    const records = [
      makeRecord({ finalBand: 'A+' }),
      makeRecord({ finalBand: 'A' }),
      makeRecord({ finalBand: 'A' }),
      makeRecord({ finalBand: 'B' }),
      makeRecord({ finalBand: 'SUPPRESS' }),
    ];
    const report = generateDailyRollup('2026-01-15', records);
    assert.equal(report.band_distribution['A+'], 1);
    assert.equal(report.band_distribution['A'], 2);
    assert.equal(report.band_distribution['B'], 1);
    assert.equal(report.band_distribution['C'], 0);
    assert.equal(report.band_distribution['SUPPRESS'], 1);
  });

  it('computes attribution counts from loss records', () => {
    const records = [
      makeRecord({ outcome: 'LOSS', lossAttribution: 'PROJECTION_MISS' }),
      makeRecord({ outcome: 'LOSS', lossAttribution: 'VARIANCE' }),
      makeRecord({ outcome: 'LOSS', lossAttribution: 'VARIANCE' }),
      makeRecord({ outcome: 'LOSS', lossAttribution: 'PRICE_MISS' }),
      makeRecord({ outcome: 'WIN' }),
    ];
    const report = generateDailyRollup('2026-01-15', records);
    assert.equal(report.attribution_counts.total_losses, 4);
    assert.equal(report.attribution_counts.projection_miss, 1);
    assert.equal(report.attribution_counts.variance, 2);
    assert.equal(report.attribution_counts.price_miss, 1);
    assert.equal(report.attribution_counts.execution_miss, 0);
  });

  it('counts losses without attribution as unknown', () => {
    const records = [
      makeRecord({ outcome: 'LOSS', lossAttribution: null }),
      makeRecord({ outcome: 'LOSS' }),
    ];
    const report = generateDailyRollup('2026-01-15', records);
    assert.equal(report.attribution_counts.unknown, 2);
  });

  it('computes downgrade counts', () => {
    const records = [
      makeRecord({ initialBand: 'A+', finalBand: 'A+' }),
      makeRecord({ initialBand: 'A+', finalBand: 'A', downgradeReasons: ['uncertainty:high'] }),
      makeRecord({
        initialBand: 'A',
        finalBand: 'SUPPRESS',
        suppressionReasons: ['clv:negative'],
      }),
      makeRecord({ initialBand: 'B', finalBand: 'B' }),
    ];
    const report = generateDailyRollup('2026-01-15', records);
    assert.equal(report.downgrade_counts.total_picks, 4);
    assert.equal(report.downgrade_counts.unchanged, 2);
    assert.equal(report.downgrade_counts.downgraded, 1);
    assert.equal(report.downgrade_counts.suppressed, 1);
    assert.equal(report.downgrade_counts.top_downgrade_reason, 'uncertainty');
    assert.equal(report.downgrade_counts.top_suppression_reason, 'clv');
  });

  it('includes downgrade effectiveness diagnostics', () => {
    const records = [
      makeRecord({
        initialBand: 'A',
        finalBand: 'SUPPRESS',
        suppressionReasons: ['risk:reject'],
        outcome: 'LOSS',
        lossAttribution: 'VARIANCE',
      }),
      makeRecord({ initialBand: 'A', finalBand: 'A', outcome: 'WIN' }),
    ];
    const report = generateDailyRollup('2026-01-15', records);
    assert.ok(report.downgrade_effectiveness !== undefined);
    assert.equal(typeof report.downgrade_effectiveness.suppression_effective, 'boolean');
    assert.equal(typeof report.downgrade_effectiveness.estimated_savings, 'number');
  });

  it('includes CLV data in band summaries', () => {
    const records = [
      makeRecord({ finalBand: 'A', clvPercent: 0.03 }),
      makeRecord({ finalBand: 'A', clvPercent: 0.01 }),
      makeRecord({ finalBand: 'A', clvPercent: null }),
    ];
    const report = generateDailyRollup('2026-01-15', records);
    const aBand = report.by_band.find((b) => b.band === 'A');
    assert.ok(aBand !== undefined);
    assert.ok(aBand.avg_clv_percent !== null);
    assert.equal(aBand.clv_sample_size, 2);
  });

  it('is deterministic — same inputs produce identical reports', () => {
    const records = [
      makeRecord({ finalBand: 'A+', outcome: 'WIN' }),
      makeRecord({ finalBand: 'A', outcome: 'LOSS', lossAttribution: 'VARIANCE' }),
    ];
    const ts = '2026-01-15T00:00:00Z';
    const r1 = generateDailyRollup('2026-01-15', records, ts);
    const r2 = generateDailyRollup('2026-01-15', records, ts);
    assert.equal(r1.total_picks, r2.total_picks);
    assert.equal(r1.overall_roi_pct, r2.overall_roi_pct);
    assert.deepStrictEqual(r1.by_band, r2.by_band);
    assert.deepStrictEqual(r1.attribution_counts, r2.attribution_counts);
    assert.deepStrictEqual(r1.downgrade_counts, r2.downgrade_counts);
  });
});

// ── Drift Detector ───────────────────────────────────────────────────────────

describe('detectDrift', () => {
  it('returns empty flags for empty baseline', () => {
    const today = makeRollup();
    const report = detectDrift(today, []);
    assert.deepStrictEqual(report.flags, []);
    assert.equal(report.summary.regime_healthy, true);
    assert.equal(report.baseline_window_size, 0);
  });

  it('returns empty flags when today has zero picks', () => {
    const today = makeRollup({ total_picks: 0 });
    const baseline = [makeRollup()];
    const report = detectDrift(today, baseline);
    assert.deepStrictEqual(report.flags, []);
  });

  it('detects ROI drift at warning level', () => {
    const today = makeRollup({ overall_roi_pct: 30 });
    const baseline = [makeRollup({ overall_roi_pct: 10 }), makeRollup({ overall_roi_pct: 12 })];
    const report = detectDrift(today, baseline);
    const roiFlags = report.flags.filter((f) => f.category === 'roi_drift');
    assert.ok(roiFlags.length >= 1);
    const overallRoi = roiFlags.find((f) => !f.band);
    assert.ok(overallRoi !== undefined);
    assert.equal(overallRoi.severity, 'warning');
  });

  it('detects ROI drift at critical level', () => {
    const today = makeRollup({ overall_roi_pct: 50 });
    const baseline = [makeRollup({ overall_roi_pct: 10 }), makeRollup({ overall_roi_pct: 10 })];
    const report = detectDrift(today, baseline);
    const roiFlags = report.flags.filter((f) => f.category === 'roi_drift' && !f.band);
    assert.equal(roiFlags.length, 1);
    assert.equal(roiFlags[0]!.severity, 'critical');
    assert.equal(report.summary.regime_healthy, false);
  });

  it('detects suppression rate drift', () => {
    const today = makeRollup({
      downgrade_counts: {
        total_picks: 100,
        unchanged: 50,
        downgraded: 10,
        suppressed: 40,
        top_downgrade_reason: null,
        top_suppression_reason: null,
      },
    });
    const baseline = [
      makeRollup({
        downgrade_counts: {
          total_picks: 100,
          unchanged: 80,
          downgraded: 10,
          suppressed: 10,
          top_downgrade_reason: null,
          top_suppression_reason: null,
        },
      }),
    ];
    const report = detectDrift(today, baseline);
    const suppressionFlags = report.flags.filter((f) => f.category === 'suppression_rate_drift');
    assert.equal(suppressionFlags.length, 1);
    assert.equal(suppressionFlags[0]!.severity, 'critical');
  });

  it('detects distribution drift', () => {
    const today = makeRollup({
      total_picks: 100,
      band_distribution: { 'A+': 50, A: 20, B: 20, C: 5, SUPPRESS: 5 },
    });
    const baseline = [
      makeRollup({
        total_picks: 100,
        band_distribution: { 'A+': 10, A: 30, B: 30, C: 20, SUPPRESS: 10 },
      }),
    ];
    const report = detectDrift(today, baseline);
    const distFlags = report.flags.filter((f) => f.category === 'distribution_drift');
    assert.ok(distFlags.length >= 1);
    const aPlusFlag = distFlags.find((f) => f.band === 'A+');
    assert.ok(aPlusFlag !== undefined);
    assert.equal(aPlusFlag.severity, 'critical');
  });

  it('detects attribution drift', () => {
    const today = makeRollup({
      attribution_counts: {
        total_losses: 10,
        projection_miss: 8,
        price_miss: 1,
        variance: 1,
        execution_miss: 0,
        news_miss: 0,
        correlation_miss: 0,
        unknown: 0,
      },
    });
    const baseline = [
      makeRollup({
        attribution_counts: {
          total_losses: 10,
          projection_miss: 3,
          price_miss: 3,
          variance: 2,
          execution_miss: 1,
          news_miss: 1,
          correlation_miss: 0,
          unknown: 0,
        },
      }),
    ];
    const report = detectDrift(today, baseline);
    const attrFlags = report.flags.filter((f) => f.category === 'attribution_drift');
    assert.ok(attrFlags.length >= 1);
    assert.equal(attrFlags[0]!.severity, 'warning');
  });

  it('does not flag when within thresholds', () => {
    const today = makeRollup({ overall_roi_pct: 10 });
    const baseline = [makeRollup({ overall_roi_pct: 8 }), makeRollup({ overall_roi_pct: 12 })];
    const report = detectDrift(today, baseline);
    const overallRoiFlags = report.flags.filter((f) => f.category === 'roi_drift' && !f.band);
    assert.equal(overallRoiFlags.length, 0);
  });

  it('counts flag severities in summary', () => {
    const today = makeRollup({ overall_roi_pct: 50 });
    const baseline = [makeRollup({ overall_roi_pct: 10 })];
    const report = detectDrift(today, baseline);
    assert.equal(report.summary.total_flags, report.flags.length);
    assert.equal(
      report.summary.critical_count,
      report.flags.filter((f) => f.severity === 'critical').length,
    );
    assert.equal(
      report.summary.warning_count,
      report.flags.filter((f) => f.severity === 'warning').length,
    );
  });

  it('marks regime unhealthy when critical flags exist', () => {
    const today = makeRollup({ overall_roi_pct: 50 });
    const baseline = [makeRollup({ overall_roi_pct: 10 })];
    const report = detectDrift(today, baseline);
    assert.equal(report.summary.regime_healthy, false);
  });

  it('has correct report metadata', () => {
    const today = makeRollup({ date: '2026-01-15' });
    const baseline = [makeRollup(), makeRollup()];
    const report = detectDrift(today, baseline);
    assert.equal(report.report_version, 'drift-detector-v1.0');
    assert.equal(report.date, '2026-01-15');
    assert.equal(report.baseline_window_size, 2);
  });

  it('drift thresholds are exported and immutable', () => {
    assert.equal(DRIFT_THRESHOLDS.roi_warning, 15);
    assert.equal(DRIFT_THRESHOLDS.roi_critical, 30);
    assert.equal(DRIFT_THRESHOLDS.brier_warning, 0.05);
    assert.equal(DRIFT_THRESHOLDS.suppression_warning, 10);
    assert.equal(DRIFT_THRESHOLDS.attribution_warning, 20);
  });
});
