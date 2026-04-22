import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryModelRegistryRepository,
  InMemoryModelHealthSnapshotRepository,
} from '@unit-talk/db';
import { evaluateModelHealthState } from '@unit-talk/domain';
import { runModelHealthScan } from './model-health-scanner.js';
import type { ModelHealthAlert } from './model-health-scanner.js';

function makeDeps() {
  return {
    modelRegistry: new InMemoryModelRegistryRepository(),
    modelHealthSnapshots: new InMemoryModelHealthSnapshotRepository(),
  };
}

describe('runModelHealthScan', () => {
  test('returns zero counts when no champion models exist', async () => {
    const deps = makeDeps();
    const result = await runModelHealthScan(deps, { logger: silentLogger() });
    assert.equal(result.scanned, 0);
    assert.equal(result.alerts, 0);
    assert.equal(result.errors, 0);
  });

  test('scans a healthy champion model and writes a snapshot', async () => {
    const deps = makeDeps();
    await deps.modelRegistry.create({
      modelName: 'nba-spread-v1',
      version: '1.0',
      sport: 'NBA',
      marketFamily: 'spread',
      status: 'champion',
    });

    const result = await runModelHealthScan(deps, { logger: silentLogger() });
    assert.equal(result.scanned, 1);
    assert.equal(result.alerts, 0);
    assert.equal(result.errors, 0);
  });

  test('does not fire alert when model is green (roi > 0, no drift)', async () => {
    const deps = makeDeps();
    const champion = await deps.modelRegistry.create({
      modelName: 'nba-total-v1',
      version: '1.0',
      sport: 'NBA',
      marketFamily: 'total',
      status: 'champion',
    });

    // Seed a healthy snapshot
    await deps.modelHealthSnapshots.create({
      modelId: champion.id,
      sport: 'NBA',
      marketFamily: 'total',
      roi: 3.5,
      calibrationScore: 0.18,
      driftScore: 0.1,
      sampleSize: 200,
      alertLevel: 'none',
    });

    const fired: ModelHealthAlert[] = [];
    const result = await runModelHealthScan(deps, {
      logger: silentLogger(),
      onAlert: async (a) => { fired.push(a); },
    });

    assert.equal(result.scanned, 1);
    assert.equal(fired.length, 0);
  });

  test('fires warning alert when roi drops below -5%', async () => {
    const deps = makeDeps();
    const champion = await deps.modelRegistry.create({
      modelName: 'nhl-ml-v1',
      version: '1.0',
      sport: 'NHL',
      marketFamily: 'moneyline',
      status: 'champion',
    });

    // Seed snapshot with degraded ROI
    await deps.modelHealthSnapshots.create({
      modelId: champion.id,
      sport: 'NHL',
      marketFamily: 'moneyline',
      roi: -7.0,
      calibrationScore: 0.22,
      driftScore: 0.2,
      sampleSize: 150,
      alertLevel: 'none',
      metadata: { newState: 'green' },
    });

    const fired: ModelHealthAlert[] = [];
    await runModelHealthScan(deps, {
      logger: silentLogger(),
      onAlert: async (a) => { fired.push(a); },
    });

    assert.ok(fired.length > 0, 'expected alert to fire');
    const alert = fired[0]!;
    assert.ok(
      alert.alertLevel === 'warning' || alert.newState === 'watch',
      `expected warning or watch, got alertLevel=${alert.alertLevel} state=${alert.newState}`,
    );
  });

  test('fires critical alert when roi drops below -15%', async () => {
    const deps = makeDeps();
    const champion = await deps.modelRegistry.create({
      modelName: 'mlb-spread-v1',
      version: '1.0',
      sport: 'MLB',
      marketFamily: 'spread',
      status: 'champion',
    });

    // Seed with warning state so we can transition to critical
    await deps.modelHealthSnapshots.create({
      modelId: champion.id,
      sport: 'MLB',
      marketFamily: 'spread',
      roi: -18.0,
      calibrationScore: 0.34,
      driftScore: 0.3,
      sampleSize: 300,
      alertLevel: 'warning',
      metadata: { newState: 'warning' },
    });

    const fired: ModelHealthAlert[] = [];
    await runModelHealthScan(deps, {
      logger: silentLogger(),
      onAlert: async (a) => { fired.push(a); },
    });

    assert.ok(fired.length > 0, 'expected critical alert');
    const alert = fired[0]!;
    assert.equal(alert.alertLevel, 'critical');
    assert.equal(alert.newState, 'critical');
  });

  test('requiresOperatorDecision is set when critical window exceeded', async () => {
    const deps = makeDeps();
    const champion = await deps.modelRegistry.create({
      modelName: 'nba-prop-v1',
      version: '1.0',
      sport: 'NBA',
      marketFamily: 'player_prop',
      status: 'champion',
    });

    // transitionAt is a first-class typed field on ModelHealthSnapshotCreateInput.
    // The InMemory repo merges it into metadata.transitionAt, which readTransitionAt()
    // reads back. snapshot_at is always now() and is irrelevant to the window check.
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await deps.modelHealthSnapshots.create({
      modelId: champion.id,
      sport: 'NBA',
      marketFamily: 'player_prop',
      roi: -20.0,
      calibrationScore: 0.35,
      driftScore: 0.4,
      sampleSize: 400,
      alertLevel: 'critical',
      transitionAt: fortyEightHoursAgo,
      metadata: { newState: 'critical' },
    });

    const fired: ModelHealthAlert[] = [];
    await runModelHealthScan(deps, {
      criticalWindowHours: 24,
      logger: silentLogger(),
      onAlert: async (a) => { fired.push(a); },
    });

    assert.ok(fired.length > 0, 'expected alert for model stuck in critical');
    const alert = fired[0]!;
    assert.equal(alert.alertLevel, 'critical');
    assert.equal(alert.requiresOperatorDecision, true, 'expected requiresOperatorDecision after 48h in critical');
  });

  test('explicit slices override default sport scanning', async () => {
    const deps = makeDeps();
    await deps.modelRegistry.create({
      modelName: 'nfl-spread-v1',
      version: '1.0',
      sport: 'NFL',
      marketFamily: 'spread',
      status: 'champion',
    });

    // Only scan NBA (which has no models) via explicit slices
    const result = await runModelHealthScan(deps, {
      slices: [{ sport: 'NBA', marketFamily: 'spread' }],
      logger: silentLogger(),
    });

    assert.equal(result.scanned, 0, 'should not scan NFL when only NBA slice provided');
  });

  test('non-champion models are not scanned', async () => {
    const deps = makeDeps();
    await deps.modelRegistry.create({
      modelName: 'nba-spread-challenger',
      version: '1.0',
      sport: 'NBA',
      marketFamily: 'spread',
      status: 'challenger',
    });

    const result = await runModelHealthScan(deps, { logger: silentLogger() });
    assert.equal(result.scanned, 0);
  });

  test('multiple champion models across sports are all scanned', async () => {
    const deps = makeDeps();
    await deps.modelRegistry.create({
      modelName: 'nba-spread-v1',
      version: '1.0',
      sport: 'NBA',
      marketFamily: 'spread',
      status: 'champion',
    });
    await deps.modelRegistry.create({
      modelName: 'nfl-spread-v1',
      version: '1.0',
      sport: 'NFL',
      marketFamily: 'spread',
      status: 'champion',
    });

    const result = await runModelHealthScan(deps, { logger: silentLogger() });
    assert.equal(result.scanned, 2);
  });
});

describe('evaluateModelHealthState — critical window (domain proof)', () => {
  test('requiresOperatorDecision is true when critical state exceeds window threshold', () => {
    // Build a minimal proxy report with negative ROI so recovery never fires.
    // Calibration and drift are healthy so no other transition applies.
    // The ONLY path that should match is the critical-window re-alert at lines 556-572.
    const report = buildCriticalProxyReport(-20, 0.2, 0);

    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { newState, trigger } = evaluateModelHealthState(
      report,
      'critical',
      24,
      fortyEightHoursAgo,
    );

    assert.equal(newState, 'critical');
    assert.ok(trigger !== null, 'expected a trigger to fire');
    assert.equal(trigger!.requiresOperatorDecision, true);
  });

  test('requiresOperatorDecision is false when critical state is within window threshold', () => {
    const report = buildCriticalProxyReport(-20, 0.2, 0);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { newState, trigger } = evaluateModelHealthState(
      report,
      'critical',
      24,
      twoHoursAgo,
    );

    // Should not fire requiresOperatorDecision — still within window
    assert.equal(newState, 'critical');
    assert.ok(trigger === null, 'expected no trigger within window');
  });
});

function buildCriticalProxyReport(roi: number, brierScore: number, driftWarnings: number) {
  return {
    report_version: 'system-health-v1.0',
    generated_at: new Date().toISOString(),
    total_records: 100,
    clvByBand: [{ band: 'A+' as const, avg_clv_pct: null, positive_clv_rate: 0, negative_clv_rate: 0, sample_size: 100 }],
    roiByBand: [{ band: 'A+' as const, roi_pct: roi, sample_size: 100 }],
    calibrationMetrics: { brier_score: brierScore, log_loss: 0, ece: 0, reliability_buckets: [], sample_size: 100 },
    bandDistribution: { distribution: [], total_picks: 100, suppression_rate_pct: 0, downgrade_rate_pct: 0, collapsed_warning: false },
    downgradeEffectiveness: { loss_prevention_rate: 0, estimated_savings: 0, downgrade_reason_counts: [], downgrade_effective: true },
    suppressionEffectiveness: { suppressed_hypothetical_roi_pct: 0, suppressed_hypothetical_clv_pct: null, suppression_effective: true, suppressed_count: 0 },
    driftStatus: { drift_warnings: driftWarnings, drift_critical_flags: 0, regime_stability: 'stable' as const, flags: [] },
    calibrationImpact: {
      pre_calibration: { brierScore, logLoss: 0, ece: 0, reliabilityCurve: [], sampleSize: 100 },
      post_calibration: { brierScore, logLoss: 0, ece: 0, reliabilityCurve: [], sampleSize: 100 },
      brier_improvement: 0, log_loss_delta: 0, monotonicity_preserved: true, calibration_helped: false,
    },
  };
}

function silentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
