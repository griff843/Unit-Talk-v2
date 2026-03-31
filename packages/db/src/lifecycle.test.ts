/**
 * Lifecycle FSM tests
 *
 * Coverage:
 *   - valid transitions succeed
 *   - invalid transitions throw InvalidTransitionError
 *   - unknown pick throws InvalidPickStateError
 *   - terminal states have no allowed transitions
 *   - getAllowedTransitions returns correct lists
 *   - isTerminalState returns correct values
 *   - timestamp invariant warnings (no hard block)
 *
 * Run with: tsx --test packages/db/src/lifecycle.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalPick } from '@unit-talk/contracts';
import { InMemoryPickRepository } from './runtime-repositories.js';
import {
  transitionPickLifecycle,
  ensurePickLifecycleState,
  atomicClaimForTransition,
  InvalidTransitionError,
  InvalidPickStateError,
  getAllowedTransitions,
  isTerminalState,
} from './lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePick(
  overrides: Partial<CanonicalPick> & { id: string },
): CanonicalPick {
  return {
    submissionId: 'sub-1',
    market: 'nba-spread',
    selection: 'Lakers -3.5',
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'draft',
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function repoWithPick(
  pickId: string,
  lifecycleState: CanonicalPick['lifecycleState'] = 'draft',
) {
  const repo = new InMemoryPickRepository();
  await repo.savePick(makePick({ id: pickId, lifecycleState }));
  return repo;
}

// ---------------------------------------------------------------------------
// transitionPickLifecycle — valid transitions
// ---------------------------------------------------------------------------

test('draft -> validated succeeds', async () => {
  const repo = await repoWithPick('p1', 'draft');
  const result = await transitionPickLifecycle(repo, 'p1', 'validated', 'test');
  assert.equal(result.lifecycleState, 'validated');
  assert.equal(result.pickId, 'p1');
});

test('draft -> voided succeeds', async () => {
  const repo = await repoWithPick('p1', 'draft');
  const result = await transitionPickLifecycle(repo, 'p1', 'voided', 'test');
  assert.equal(result.lifecycleState, 'voided');
});

test('validated -> queued succeeds', async () => {
  const repo = await repoWithPick('p1', 'validated');
  const result = await transitionPickLifecycle(repo, 'p1', 'queued', 'test');
  assert.equal(result.lifecycleState, 'queued');
});

test('queued -> posted succeeds', async () => {
  const repo = await repoWithPick('p1', 'queued');
  const result = await transitionPickLifecycle(repo, 'p1', 'posted', 'test');
  assert.equal(result.lifecycleState, 'posted');
});

test('posted -> settled succeeds', async () => {
  const repo = await repoWithPick('p1', 'posted');
  const result = await transitionPickLifecycle(repo, 'p1', 'settled', 'test');
  assert.equal(result.lifecycleState, 'settled');
});

test('posted -> voided succeeds', async () => {
  const repo = await repoWithPick('p1', 'posted');
  const result = await transitionPickLifecycle(repo, 'p1', 'voided', 'test');
  assert.equal(result.lifecycleState, 'voided');
});

// ---------------------------------------------------------------------------
// transitionPickLifecycle — invalid transitions throw InvalidTransitionError
// ---------------------------------------------------------------------------

test('settled -> validated throws InvalidTransitionError', async () => {
  const repo = await repoWithPick('p1', 'settled');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'validated', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.equal(err.fromState, 'settled');
      assert.equal(err.toState, 'validated');
      return true;
    },
  );
});

test('voided -> draft throws InvalidTransitionError', async () => {
  const repo = await repoWithPick('p1', 'voided');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'draft', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.equal(err.fromState, 'voided');
      assert.equal(err.toState, 'draft');
      return true;
    },
  );
});

test('posted -> validated throws InvalidTransitionError (no regression)', async () => {
  const repo = await repoWithPick('p1', 'posted');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'validated', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      return true;
    },
  );
});

test('posted -> queued throws InvalidTransitionError (no regression)', async () => {
  const repo = await repoWithPick('p1', 'posted');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'queued', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// transitionPickLifecycle — unknown pick throws InvalidPickStateError
// ---------------------------------------------------------------------------

test('unknown pick throws InvalidPickStateError', async () => {
  const repo = new InMemoryPickRepository();
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'no-such-pick', 'validated', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidPickStateError);
      assert.equal(err.pickId, 'no-such-pick');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// ensurePickLifecycleState — preserves existing behavior
// ---------------------------------------------------------------------------

test('ensurePickLifecycleState returns null when already in target state', async () => {
  const repo = await repoWithPick('p1', 'validated');
  const result = await ensurePickLifecycleState(repo, 'p1', 'validated', 'test');
  assert.equal(result, null);
});

test('ensurePickLifecycleState transitions when not in target state', async () => {
  const repo = await repoWithPick('p1', 'draft');
  const result = await ensurePickLifecycleState(repo, 'p1', 'validated', 'test');
  assert.ok(result != null);
  assert.equal(result.lifecycleState, 'validated');
});

test('ensurePickLifecycleState throws InvalidPickStateError for unknown pick', async () => {
  const repo = new InMemoryPickRepository();
  await assert.rejects(
    () => ensurePickLifecycleState(repo, 'missing', 'validated', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidPickStateError);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// getAllowedTransitions
// ---------------------------------------------------------------------------

test('getAllowedTransitions for draft returns [validated, voided]', () => {
  const result = getAllowedTransitions('draft');
  assert.deepEqual(result, ['validated', 'voided']);
});

test('getAllowedTransitions for validated returns [queued, voided]', () => {
  assert.deepEqual(getAllowedTransitions('validated'), ['queued', 'voided']);
});

test('getAllowedTransitions for queued returns [posted, voided]', () => {
  assert.deepEqual(getAllowedTransitions('queued'), ['posted', 'voided']);
});

test('getAllowedTransitions for posted returns [settled, voided]', () => {
  assert.deepEqual(getAllowedTransitions('posted'), ['settled', 'voided']);
});

test('getAllowedTransitions for settled returns []', () => {
  assert.deepEqual(getAllowedTransitions('settled'), []);
});

test('getAllowedTransitions for voided returns []', () => {
  assert.deepEqual(getAllowedTransitions('voided'), []);
});

// ---------------------------------------------------------------------------
// isTerminalState
// ---------------------------------------------------------------------------

test('isTerminalState returns true for settled', () => {
  assert.equal(isTerminalState('settled'), true);
});

test('isTerminalState returns true for voided', () => {
  assert.equal(isTerminalState('voided'), true);
});

test('isTerminalState returns false for draft', () => {
  assert.equal(isTerminalState('draft'), false);
});

test('isTerminalState returns false for validated', () => {
  assert.equal(isTerminalState('validated'), false);
});

test('isTerminalState returns false for queued', () => {
  assert.equal(isTerminalState('queued'), false);
});

test('isTerminalState returns false for posted', () => {
  assert.equal(isTerminalState('posted'), false);
});

// ---------------------------------------------------------------------------
// InvalidTransitionError shape
// ---------------------------------------------------------------------------

test('InvalidTransitionError has correct name and properties', () => {
  const err = new InvalidTransitionError('draft', 'settled');
  assert.equal(err.name, 'InvalidTransitionError');
  assert.equal(err.fromState, 'draft');
  assert.equal(err.toState, 'settled');
  assert.ok(err.message.includes('draft'));
  assert.ok(err.message.includes('settled'));
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// InvalidPickStateError shape
// ---------------------------------------------------------------------------

test('InvalidPickStateError has correct name and properties', () => {
  const err = new InvalidPickStateError('pick-123');
  assert.equal(err.name, 'InvalidPickStateError');
  assert.equal(err.pickId, 'pick-123');
  assert.ok(err.message.includes('pick-123'));
  assert.ok(err instanceof Error);
});

test('InvalidPickStateError with detail includes detail in message', () => {
  const err = new InvalidPickStateError('pick-123', 'unexpected state');
  assert.ok(err.message.includes('unexpected state'));
  assert.ok(err.message.includes('pick-123'));
});

// ---------------------------------------------------------------------------
// Atomic claim idempotency tests (UTV2-176)
// ---------------------------------------------------------------------------

test('atomicClaimForTransition claims pick on first call', async () => {
  const repo = await repoWithPick('claim-1', 'validated');
  const result = await atomicClaimForTransition(repo, 'claim-1', 'validated', 'queued');
  assert.equal(result.claimed, true);
  assert.equal(result.pickId, 'claim-1');
  const updated = await repo.findPickById('claim-1');
  assert.equal(updated?.status, 'queued');
});

test('atomicClaimForTransition returns false on second call (idempotent)', async () => {
  const repo = await repoWithPick('claim-2', 'validated');
  await atomicClaimForTransition(repo, 'claim-2', 'validated', 'queued');
  const second = await atomicClaimForTransition(repo, 'claim-2', 'validated', 'queued');
  assert.equal(second.claimed, false);
});

test('atomicClaimForTransition returns false if pick is in wrong state', async () => {
  const repo = await repoWithPick('claim-3', 'posted');
  const result = await atomicClaimForTransition(repo, 'claim-3', 'validated', 'queued');
  assert.equal(result.claimed, false);
});

test('atomicClaimForTransition returns false for invalid transition', async () => {
  const repo = await repoWithPick('claim-4', 'settled');
  const result = await atomicClaimForTransition(repo, 'claim-4', 'settled', 'posted');
  assert.equal(result.claimed, false);
});
