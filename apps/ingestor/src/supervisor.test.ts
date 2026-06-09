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
  assert.equal(report.code, 'API_KEY');
  assert.match(report.summary, /autorun is disabled/i);
});

test('evaluateIngestorHealth reports API_KEY when no API key configured', () => {
  const report = evaluateIngestorHealth({
    autorun: true,
    pollIntervalMs: 300000,
    supervisorRunning: true,
    childRunning: true,
    restartCount: 0,
    latestRunStatus: null,
    latestRunStartedAt: null,
    latestOfferCreatedAt: null,
    hasNoApiKey: true,
  });

  assert.equal(report.status, 'down');
  assert.equal(report.code, 'API_KEY');
  assert.match(report.summary, /api key/i);
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
  assert.equal(report.code, 'RUNTIME_DOWN');
  assert.match(report.summary, /child is currently down/i);
});

test('evaluateIngestorHealth reports HUNG_SINGLETON when reaped at startup', () => {
  const report = evaluateIngestorHealth({
    autorun: true,
    pollIntervalMs: 300000,
    supervisorRunning: true,
    childRunning: true,
    restartCount: 0,
    latestRunStatus: null,
    latestRunStartedAt: null,
    latestOfferCreatedAt: null,
    hasHungSingleton: true,
  });

  assert.equal(report.status, 'degraded');
  assert.equal(report.code, 'HUNG_SINGLETON');
  assert.match(report.summary, /hung singleton/i);
});

test('evaluateIngestorHealth reports HUNG_SINGLETON for long-running cycle', () => {
  const now = new Date('2026-04-05T20:00:00.000Z');
  const report = evaluateIngestorHealth(
    {
      autorun: true,
      pollIntervalMs: 300000,
      supervisorRunning: true,
      childRunning: true,
      restartCount: 0,
      latestRunStatus: 'running',
      latestRunStartedAt: '2026-04-05T19:30:00.000Z',
      latestOfferCreatedAt: null,
    },
    now,
  );

  assert.equal(report.status, 'degraded');
  assert.equal(report.code, 'HUNG_SINGLETON');
  assert.match(report.summary, /running for/i);
});

test('evaluateIngestorHealth reports DB_TIMEOUT for statement timeout failure', () => {
  const now = new Date('2026-04-05T20:00:00.000Z');
  const report = evaluateIngestorHealth(
    {
      autorun: true,
      pollIntervalMs: 300000,
      supervisorRunning: true,
      childRunning: true,
      restartCount: 0,
      latestRunStatus: 'failed',
      latestRunStartedAt: '2026-04-05T19:58:00.000Z',
      latestOfferCreatedAt: '2026-04-05T19:56:00.000Z',
      lastFailureReason: 'canceling statement due to statement timeout',
    },
    now,
  );

  assert.equal(report.status, 'degraded');
  assert.equal(report.code, 'DB_TIMEOUT');
  assert.match(report.summary, /timeout/i);
});

test('evaluateIngestorHealth reports NO_SLATE for zero-event cycle', () => {
  const now = new Date('2026-04-05T20:00:00.000Z');
  const report = evaluateIngestorHealth(
    {
      autorun: true,
      pollIntervalMs: 300000,
      supervisorRunning: true,
      childRunning: true,
      restartCount: 0,
      latestRunStatus: 'succeeded',
      latestRunStartedAt: '2026-04-05T19:57:00.000Z',
      latestOfferCreatedAt: '2026-04-05T19:56:00.000Z',
      hasNoSlate: true,
    },
    now,
  );

  assert.equal(report.status, 'degraded');
  assert.equal(report.code, 'NO_SLATE');
  assert.match(report.summary, /0 events/i);
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
  assert.equal(report.code, 'HEALTHY');
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
  assert.equal(degraded.code, 'FAILED_CYCLE');

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
  assert.equal(down.code, 'FAILED_CYCLE');
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
  assert.equal(missingOffers.code, 'STALE_OFFERS');

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
  assert.equal(staleOffers.code, 'STALE_OFFERS');
});
