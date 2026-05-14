import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InvalidLifecycleTransitionError,
  VALID_TRANSITIONS,
  assertValidTransition,
  isValidTransition,
} from './lifecycle-validator.js';

const validTransitions: ReadonlyArray<readonly [string, string]> = [
  ['pending', 'qualified'],
  ['pending', 'disqualified'],
  ['qualified', 'approved'],
  ['qualified', 'awaiting_approval'],
  ['awaiting_approval', 'approved'],
  ['awaiting_approval', 'rejected'],
  ['approved', 'sent'],
  ['approved', 'cancelled'],
  ['sent', 'won'],
  ['sent', 'lost'],
  ['sent', 'push'],
  ['sent', 'void'],
];

const terminalStates = [
  'disqualified',
  'rejected',
  'cancelled',
  'won',
  'lost',
  'push',
  'void',
] as const;

test('VALID_TRANSITIONS exposes every lifecycle status', () => {
  assert.deepEqual(Array.from(VALID_TRANSITIONS.keys()), [
    'pending',
    'qualified',
    'awaiting_approval',
    'approved',
    'sent',
    'disqualified',
    'rejected',
    'cancelled',
    'won',
    'lost',
    'push',
    'void',
  ]);
});

test('VALID_TRANSITIONS defines pending targets', () => {
  assert.deepEqual(Array.from(VALID_TRANSITIONS.get('pending') ?? []), [
    'qualified',
    'disqualified',
  ]);
});

test('VALID_TRANSITIONS defines qualified targets', () => {
  assert.deepEqual(Array.from(VALID_TRANSITIONS.get('qualified') ?? []), [
    'approved',
    'awaiting_approval',
  ]);
});

test('VALID_TRANSITIONS defines awaiting approval targets', () => {
  assert.deepEqual(Array.from(VALID_TRANSITIONS.get('awaiting_approval') ?? []), [
    'approved',
    'rejected',
  ]);
});

test('VALID_TRANSITIONS defines approved targets', () => {
  assert.deepEqual(Array.from(VALID_TRANSITIONS.get('approved') ?? []), [
    'sent',
    'cancelled',
  ]);
});

test('VALID_TRANSITIONS defines sent result targets', () => {
  assert.deepEqual(Array.from(VALID_TRANSITIONS.get('sent') ?? []), [
    'won',
    'lost',
    'push',
    'void',
  ]);
});

test('isValidTransition returns true for all valid transitions', () => {
  for (const [from, to] of validTransitions) {
    assert.equal(isValidTransition(from, to), true, `${from} -> ${to} should be valid`);
  }
});

test('assertValidTransition accepts all valid transitions', () => {
  for (const [from, to] of validTransitions) {
    assert.doesNotThrow(() => assertValidTransition(from, to), `${from} -> ${to}`);
  }
});

test('terminal states reject further transitions', () => {
  for (const from of terminalStates) {
    assert.equal(isValidTransition(from, 'pending'), false, `${from} should be terminal`);
    assert.throws(
      () => assertValidTransition(from, 'pending'),
      InvalidLifecycleTransitionError,
    );
  }
});

test('unknown source states reject', () => {
  assert.equal(isValidTransition('unknown', 'qualified'), false);
  assert.throws(
    () => assertValidTransition('unknown', 'qualified'),
    InvalidLifecycleTransitionError,
  );
});

test('unknown target states reject', () => {
  assert.equal(isValidTransition('pending', 'unknown'), false);
  assert.throws(
    () => assertValidTransition('pending', 'unknown'),
    InvalidLifecycleTransitionError,
  );
});

test('cross-terminal transitions reject', () => {
  assert.equal(isValidTransition('won', 'lost'), false);
  assert.equal(isValidTransition('cancelled', 'void'), false);
  assert.throws(() => assertValidTransition('won', 'lost'), InvalidLifecycleTransitionError);
});

test('invalid transition error exposes from and to properties', () => {
  assert.throws(
    () => assertValidTransition('sent', 'approved'),
    (error) => {
      assert.ok(error instanceof InvalidLifecycleTransitionError);
      assert.equal(error.from, 'sent');
      assert.equal(error.to, 'approved');
      assert.equal(error.name, 'InvalidLifecycleTransitionError');
      return true;
    },
  );
});
