import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pickLifecycleTransitions,
  isAllowedLifecycleTransition,
  isTerminalLifecycleState,
  getAllowedLifecycleTransitions,
  type PickLifecycleState,
} from '@unit-talk/contracts';
import { getAllowedTransitions, isTerminalState } from './lifecycle.js';

const allStates = Object.keys(pickLifecycleTransitions) as PickLifecycleState[];

test('contracts FSM covers all 7 canonical delivery lifecycle states', () => {
  assert.deepEqual(
    [...allStates].sort(),
    ['awaiting_approval', 'draft', 'posted', 'queued', 'settled', 'validated', 'voided'],
  );
});

test('db getAllowedTransitions matches contracts matrix for every state', () => {
  for (const state of allStates) {
    const contractsAllowed = getAllowedLifecycleTransitions(state);
    const dbAllowed = getAllowedTransitions(state);
    assert.deepEqual(
      [...dbAllowed].sort(),
      [...contractsAllowed].sort(),
      `mismatch for state: ${state}`,
    );
  }
});

test('db isTerminalState matches contracts isTerminalLifecycleState', () => {
  for (const state of allStates) {
    assert.equal(
      isTerminalState(state),
      isTerminalLifecycleState(state),
      `terminal check mismatch for state: ${state}`,
    );
  }
});

test('contracts terminal states are settled and voided only', () => {
  const terminal = allStates.filter((s) => isTerminalLifecycleState(s));
  assert.deepEqual([...terminal].sort(), ['settled', 'voided']);
});

test('contracts isAllowedLifecycleTransition is consistent with matrix', () => {
  for (const from of allStates) {
    const allowed = getAllowedLifecycleTransitions(from);
    for (const to of allStates) {
      const expected = (allowed as readonly string[]).includes(to);
      assert.equal(
        isAllowedLifecycleTransition(from, to),
        expected,
        `isAllowedLifecycleTransition(${from}, ${to}) mismatch`,
      );
    }
  }
});

test('no regression transitions exist in the matrix', () => {
  // States have a natural order; verify no backward edge exists
  const order: Record<PickLifecycleState, number> = {
    draft: 0,
    validated: 1,
    awaiting_approval: 2,
    queued: 3,
    posted: 4,
    settled: 5,
    voided: 5,
  };
  for (const from of allStates) {
    const allowed = getAllowedLifecycleTransitions(from);
    for (const to of allowed) {
      assert.ok(
        order[to] > order[from] || to === 'voided',
        `regression transition found: ${from} -> ${to}`,
      );
    }
  }
});
