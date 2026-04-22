import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryModelRegistryRepository,
  InMemoryModelHealthSnapshotRepository,
} from '@unit-talk/db';
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

    // The InMemory repo always sets snapshot_at = now(), so we can't control it.
    // Instead, we set `transitionAt` in metadata to 48h ago — this is what the
    // scanner reads as lastTransitionAt, which drives the criticalWindowHours check.
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
      metadata: { newState: 'critical', transitionAt: fortyEightHoursAgo },
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

function silentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
