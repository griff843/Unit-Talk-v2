import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRestartDelayMs,
  createInitialSupervisorState,
  evaluateIngestorHealth,
} from './supervisor.js';

test('createInitialSupervisorState seeds a starting supervisor state', () => {
  const now = new Date('2026-04-05T20:00:00.000Z');
  const state = createInitialSupervisorState(now, 4242);

  assert.equal(state.supervisorPid, 4242);
  assert.equal(state.childPid, null);
  assert.equal(state.status, 'starting');
  assert.equal(state.startedAt, '2026-04-05T20:00:00.000Z');
  assert.equal(state.restartCount, 0);
});

test('calculateRestartDelayMs exponentially backs off and caps', () => {
  assert.equal(calculateRestartDelayMs(0), 1000);
  assert.equal(calculateRestartDelayMs(1), 2000);
  assert.equal(calculateRestartDelayMs(4), 16000);
  assert.equal(calculateRestartDelayMs(8), 30000);
});

test('evaluateIngestorHealth fails closed when autorun is disabled', () => {
  const report = evaluateIngestorHealth({
    autorun: false,
    pollIntervalMs: 300000,
    supervisorRunning: true,
    childRunning: true,
    restartCount: 0,
    latestRunStatus: 'succeeded',
    latestRunStartedAt: new Date().toISOString(),
    latestOfferCreatedAt: new Date().toISOString(),
  });

  assert.equal(report.status, 'down');
  assert.match(report.summary, /autorun is disabled/i);
});

test('evaluateIngestorHealth is degraded when supervisor is up but child is down', () => {
  const report = evaluateIngestorHealth({
    autorun: true,
    pollIntervalMs: 300000,
    supervisorRunning: true,
    childRunning: false,
    restartCount: 3,
    latestRunStatus: null,
    latestRunStartedAt: null,
    latestOfferCreatedAt: null,
  });

  assert.equal(report.status, 'degraded');
  assert.match(report.summary, /child is currently down/i);
});

test('evaluateIngestorHealth is healthy when cycle and offers are fresh', () => {
  const now = new Date('2026-04-05T20:00:00.000Z');
  const report = evaluateIngestorHealth(
    {
      autorun: true,
      pollIntervalMs: 300000,
      supervisorRunning: true,
      childRunning: true,
      restartCount: 1,
      latestRunStatus: 'succeeded',
      latestRunStartedAt: '2026-04-05T19:57:00.000Z',
      latestOfferCreatedAt: '2026-04-05T19:56:00.000Z',
    },
    now,
  );

  assert.equal(report.status, 'healthy');
  assert.match(report.summary, /look healthy/i);
});

test('evaluateIngestorHealth degrades on failed cycle and drops down when stale', () => {
  const now = new Date('2026-04-05T20:00:00.000Z');

  const degraded = evaluateIngestorHealth(
    {
      autorun: true,
      pollIntervalMs: 300000,
      supervisorRunning: true,
      childRunning: true,
      restartCount: 0,
      latestRunStatus: 'failed',
      latestRunStartedAt: '2026-04-05T19:58:00.000Z',
      latestOfferCreatedAt: '2026-04-05T19:58:00.000Z',
    },
    now,
  );

  assert.equal(degraded.status, 'degraded');

  const down = evaluateIngestorHealth(
    {
      autorun: true,
      pollIntervalMs: 300000,
      supervisorRunning: true,
      childRunning: true,
      restartCount: 0,
      latestRunStatus: 'failed',
      latestRunStartedAt: '2026-04-05T19:20:00.000Z',
      latestOfferCreatedAt: '2026-04-05T19:20:00.000Z',
    },
    now,
  );

  assert.equal(down.status, 'down');
});

test('evaluateIngestorHealth degrades when offers are missing and drops down when offer freshness is stale', () => {
  const now = new Date('2026-04-05T20:00:00.000Z');

  const missingOffers = evaluateIngestorHealth(
    {
      autorun: true,
      pollIntervalMs: 300000,
      supervisorRunning: true,
      childRunning: true,
      restartCount: 0,
      latestRunStatus: 'succeeded',
      latestRunStartedAt: '2026-04-05T19:58:00.000Z',
      latestOfferCreatedAt: null,
    },
    now,
  );

  assert.equal(missingOffers.status, 'degraded');

  const staleOffers = evaluateIngestorHealth(
    {
      autorun: true,
      pollIntervalMs: 300000,
      supervisorRunning: true,
      childRunning: true,
      restartCount: 0,
      latestRunStatus: 'succeeded',
      latestRunStartedAt: '2026-04-05T19:58:00.000Z',
      latestOfferCreatedAt: '2026-04-05T19:10:00.000Z',
    },
    now,
  );

  assert.equal(staleOffers.status, 'down');
});
