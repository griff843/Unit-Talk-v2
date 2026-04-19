import assert from 'node:assert/strict';
import test from 'node:test';

import { DeterminismValidator } from './determinism-validator.js';

import type { LifecycleTrace } from './replay-lifecycle-runner.js';

function pick(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    status: 'queued',
    promotion_status: 'qualified',
    settlement_status: null,
    settlement_result: null,
    posted_to_discord: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function trace(overrides: Partial<LifecycleTrace> = {}): LifecycleTrace {
  return {
    pickId: 'pick-1',
    from: 'validated',
    to: 'queued',
    timestamp: '2026-01-01T00:00:00.000Z',
    writerRole: 'promoter',
    traceId: `trace-${Math.random()}`,
    ...overrides,
  };
}

test('DeterminismValidator treats at-limit identical canonical payloads as deterministic', () => {
  const leftHash = DeterminismValidator.computeHash(
    1,
    new Map([['pick-1', pick('pick-1', { updated_at: '2026-01-01T00:00:01.000Z' })]]),
    [trace({ traceId: 'run-a-trace' })]
  );
  const rightHash = DeterminismValidator.computeHash(
    1,
    new Map([['pick-1', pick('pick-1', { updated_at: '2026-01-01T00:00:02.000Z' })]]),
    [trace({ traceId: 'run-b-trace' })]
  );

  assert.equal(leftHash, rightHash);
  assert.equal(DeterminismValidator.verify(leftHash, rightHash), true);
});

test('DeterminismValidator fails just-above boundary output divergence', () => {
  const baselineHash = DeterminismValidator.computeHash(
    1,
    new Map([['pick-1', pick('pick-1')]]),
    [trace()]
  );
  const divergentHash = DeterminismValidator.computeHash(
    2,
    new Map([['pick-1', pick('pick-1')]]),
    [trace()]
  );

  assert.notEqual(baselineHash, divergentHash);
  assert.equal(DeterminismValidator.verify(baselineHash, divergentHash), false);
});

test('DeterminismValidator fails just-below score and lifecycle divergence', () => {
  const baselineHash = DeterminismValidator.computeHash(
    1,
    new Map([['pick-1', pick('pick-1', { settlement_result: 'win' })]]),
    [trace({ to: 'settled' })]
  );
  const divergentHash = DeterminismValidator.computeHash(
    1,
    new Map([['pick-1', pick('pick-1', { settlement_result: 'loss' })]]),
    [trace({ to: 'settled' })]
  );

  assert.equal(DeterminismValidator.verify(baselineHash, divergentHash), false);
});

test('DeterminismValidator preserves pass state for nearly-identical run ordering', () => {
  const first = DeterminismValidator.computeHash(
    2,
    new Map([
      ['pick-b', pick('pick-b')],
      ['pick-a', pick('pick-a')],
    ]),
    [
      trace({ pickId: 'pick-b', timestamp: '2026-01-01T00:00:01.000Z' }),
      trace({ pickId: 'pick-a', timestamp: '2026-01-01T00:00:01.000Z' }),
    ]
  );
  const second = DeterminismValidator.computeHash(
    2,
    new Map([
      ['pick-a', pick('pick-a')],
      ['pick-b', pick('pick-b')],
    ]),
    [
      trace({ pickId: 'pick-a', timestamp: '2026-01-01T00:00:01.000Z' }),
      trace({ pickId: 'pick-b', timestamp: '2026-01-01T00:00:01.000Z' }),
    ]
  );

  assert.equal(DeterminismValidator.verify(first, second), true);
});
