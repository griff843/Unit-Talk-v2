import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHealthDetail,
  calculateRestartDelayMs,
  createInitialState,
  normalizeCommand,
} from './api-supervisor.js';

test('api supervisor normalizes supported commands and defaults to status', () => {
  assert.equal(normalizeCommand('start'), 'start');
  assert.equal(normalizeCommand('RUN'), 'run');
  assert.equal(normalizeCommand(undefined), 'status');
  assert.equal(normalizeCommand('bogus'), 'status');
});

test('api supervisor initial state captures pid and starts without a child', () => {
  const state = createInitialState(new Date('2026-04-21T13:00:00.000Z'), 1234);

  assert.equal(state.supervisorPid, 1234);
  assert.equal(state.childPid, null);
  assert.equal(state.status, 'init');
  assert.equal(state.startedAt, '2026-04-21T13:00:00.000Z');
  assert.equal(state.restartCount, 0);
});

test('api supervisor restart backoff is exponential and capped', () => {
  assert.equal(calculateRestartDelayMs(0), 5000);
  assert.equal(calculateRestartDelayMs(1), 7500);
  assert.equal(calculateRestartDelayMs(4), 25313);
  assert.equal(calculateRestartDelayMs(10), 30000);
  assert.equal(calculateRestartDelayMs(99), 30000);
});

test('api supervisor health detail reports durable database heartbeat truth', () => {
  const detail = buildHealthDetail(
    {
      persistenceMode: 'database',
      runtimeMode: 'fail_closed',
      dbReachable: true,
    },
    200,
  );

  assert.equal(detail, 'HTTP 200, persistence=database, runtime=fail_closed, dbReachable=yes');
});
