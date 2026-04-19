import assert from 'node:assert/strict';
import test from 'node:test';

import { InvariantAssertionEngine } from './assertion-engine.js';

import type { AssertorFn, PostScenarioState } from './types.js';

function state(overrides: Partial<PostScenarioState> = {}): PostScenarioState {
  return {
    scenarioId: 'assertion-test',
    lifecycleTrace: [],
    finalPickState: [],
    publishRecords: [],
    publishCallCount: 0,
    suppressedAlertCount: 0,
    errors: [],
    activatedFaults: [],
    recapRecords: [],
    settlementCheckCount: 0,
    freezeViolationDetected: false,
    ...overrides,
  };
}

test('InvariantAssertionEngine fails explicitly when no expectation is registered', () => {
  const [result] = InvariantAssertionEngine.runAssertions(
    [
      {
        assertionId: 'missing-expectation',
        invariant: 'NO_SILENT_SKIP',
        description: 'Missing assertor must fail',
      },
    ],
    state(),
    new Map()
  );

  assert.equal(result?.pass, false);
  assert.match(result?.failureReason ?? '', /No assertor registered/);
});

test('InvariantAssertionEngine returns mixed results for partial assertion failures', () => {
  const assertors = new Map<string, AssertorFn>([
    ['pass', InvariantAssertionEngine.noErrors('pass')],
    ['fail', InvariantAssertionEngine.publishCallCount('fail', 1)],
  ]);

  const results = InvariantAssertionEngine.runAssertions(
    [
      { assertionId: 'pass', invariant: 'NO_UNEXPECTED_ERRORS', description: 'No errors' },
      { assertionId: 'fail', invariant: 'NO_DUPLICATE_PUBLISH', description: 'One publish' },
    ],
    state(),
    assertors
  );

  assert.deepEqual(
    results.map(result => result.pass),
    [true, false]
  );
  assert.match(results[1]?.failureReason ?? '', /Expected 1 publish/);
});

test('InvariantAssertionEngine reports no violations for empty fault injection state', () => {
  const results = InvariantAssertionEngine.runAssertions(
    [
      {
        assertionId: 'no-errors',
        invariant: 'NO_UNEXPECTED_ERRORS',
        description: 'No errors must occur',
      },
      {
        assertionId: 'no-publishes',
        invariant: 'NO_DUPLICATE_PUBLISH',
        description: 'No publish receipts',
      },
    ],
    state(),
    new Map<string, AssertorFn>([
      ['no-errors', InvariantAssertionEngine.noErrors('no-errors')],
      ['no-publishes', InvariantAssertionEngine.publishRecordCount('no-publishes', 0)],
    ])
  );

  assert.deepEqual(
    results.map(result => result.pass),
    [true, true]
  );
});
