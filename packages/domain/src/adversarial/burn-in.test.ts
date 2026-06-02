import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BurnInError, runBurnIn } from './burn-in.js';
import type { BurnInScenario } from './burn-in.types.js';

const startedAt = '2026-06-01T12:00:00.000Z';
const detectedAt = '2026-06-01T12:01:00.000Z';
const replayedAt = '2026-06-01T12:02:00.000Z';
const escalatedAt = '2026-06-01T12:03:00.000Z';
const completedAt = '2026-06-01T12:04:00.000Z';

test('passes a deterministic burn-in scenario when escalation counts and replay match', () => {
  const scenario: BurnInScenario = {
    id: 'line-fabrication-burn-in',
    name: 'Line fabrication quarantine',
    expectedEscalations: 1,
    expectedNonEscalations: 0,
    snapshots: [
      {
        source: 'provider-a',
        capturedAt: startedAt,
        payload: {
          eventId: 'event-1',
          offer: { market: 'points', selection: 'player-a', line: 24.5, odds: -110 },
          marketConsensus: { line: 21.5 },
        },
      },
    ],
  };

  const result = runBurnIn({
    id: 'burn-in-run-1',
    scenarios: [scenario],
    startedAt,
    detectedAt,
    replayedAt,
    escalatedAt,
    completedAt,
  });

  assert.equal(result.runId, 'burn-in-run-1');
  assert.equal(result.status, 'pass');
  assert.equal(result.escalations, 1);
  assert.equal(result.nonEscalations, 0);
  assert.equal(result.replayStable, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.scenarios.length, 1);
  assert.equal(result.scenarios[0]?.status, 'pass');
  assert.equal(result.scenarios[0]?.findings.length, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scenarios), true);
});

test('pauses on expected-count violations without treating replay as unstable', () => {
  const scenario: BurnInScenario = {
    id: 'bad-expectation',
    name: 'Mismatched expectation',
    expectedEscalations: 2,
    expectedNonEscalations: 0,
    snapshots: [
      {
        source: 'provider-a',
        capturedAt: startedAt,
        payload: {
          eventId: 'event-2',
          offer: { market: 'rebounds', selection: 'player-b', line: 8.5, odds: -110 },
          marketConsensus: { line: 8 },
        },
      },
    ],
  };

  const result = runBurnIn({
    scenarios: [scenario],
    startedAt,
    detectedAt,
    replayedAt,
    escalatedAt,
    completedAt,
  });

  assert.equal(result.status, 'violation_paused');
  assert.equal(result.replayStable, true);
  assert.equal(result.escalations, 0);
  assert.equal(result.nonEscalations, 1);
  assert.equal(result.violations.length, 2);
  assert.match(result.violations[0] ?? '', /expected 2 escalations, observed 0/);
});

test('fails closed when the burn-in clock reset budget is exceeded', () => {
  const scenario: BurnInScenario = {
    id: 'clock-budget',
    name: 'Clock reset budget',
    expectedEscalations: 0,
    expectedNonEscalations: 1,
    snapshots: [
      {
        source: 'provider-a',
        capturedAt: startedAt,
        payload: {
          eventId: 'event-3',
          offer: { market: 'assists', selection: 'player-c', line: 5.5, odds: -105 },
          marketConsensus: { line: 5.5 },
        },
      },
    ],
  };

  const result = runBurnIn({
    scenarios: [scenario],
    startedAt,
    detectedAt,
    replayedAt,
    escalatedAt,
    completedAt,
    clockResetCount: 2,
    maxClockResetCount: 1,
  });

  assert.equal(result.status, 'fail');
  assert.match(result.violations[0] ?? '', /clock reset count 2 exceeded max 1/);
});

test('rejects malformed burn-in inputs before running detectors', () => {
  assert.throws(
    () => runBurnIn({
      scenarios: [],
      startedAt,
      detectedAt,
      replayedAt,
      escalatedAt,
      completedAt,
    }),
    BurnInError,
  );

  assert.throws(
    () => runBurnIn({
      scenarios: [{
        id: 'empty',
        name: 'Empty',
        expectedEscalations: 0,
        expectedNonEscalations: 0,
        snapshots: [],
      }],
      startedAt,
      detectedAt,
      replayedAt,
      escalatedAt,
      completedAt,
    }),
    BurnInError,
  );
});
