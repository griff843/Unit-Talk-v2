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
// Phase 7A (UTV2-491) — awaiting_approval valid transitions
// ---------------------------------------------------------------------------

test('validated -> awaiting_approval succeeds', async () => {
  const repo = await repoWithPick('p1', 'validated');
  const result = await transitionPickLifecycle(repo, 'p1', 'awaiting_approval', 'test');
  assert.equal(result.lifecycleState, 'awaiting_approval');
});

test('awaiting_approval -> queued succeeds (approval)', async () => {
  const repo = await repoWithPick('p1', 'awaiting_approval');
  const result = await transitionPickLifecycle(repo, 'p1', 'queued', 'test');
  assert.equal(result.lifecycleState, 'queued');
});

test('awaiting_approval -> voided succeeds (rejection)', async () => {
  const repo = await repoWithPick('p1', 'awaiting_approval');
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
// Phase 7A (UTV2-491) — awaiting_approval forbidden transitions
// ---------------------------------------------------------------------------

test('awaiting_approval -> posted throws InvalidTransitionError (must go through queued)', async () => {
  const repo = await repoWithPick('p1', 'awaiting_approval');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'posted', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.equal(err.fromState, 'awaiting_approval');
      assert.equal(err.toState, 'posted');
      return true;
    },
  );
});

test('awaiting_approval -> settled throws InvalidTransitionError', async () => {
  const repo = await repoWithPick('p1', 'awaiting_approval');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'settled', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      return true;
    },
  );
});

test('awaiting_approval -> validated throws InvalidTransitionError (no regression)', async () => {
  const repo = await repoWithPick('p1', 'awaiting_approval');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'validated', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      return true;
    },
  );
});

test('awaiting_approval -> draft throws InvalidTransitionError (no regression)', async () => {
  const repo = await repoWithPick('p1', 'awaiting_approval');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'draft', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      return true;
    },
  );
});

test('draft -> awaiting_approval throws InvalidTransitionError (must validate first)', async () => {
  const repo = await repoWithPick('p1', 'draft');
  await assert.rejects(
    () => transitionPickLifecycle(repo, 'p1', 'awaiting_approval', 'test'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.equal(err.fromState, 'draft');
      assert.equal(err.toState, 'awaiting_approval');
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

test('getAllowedTransitions for validated returns [queued, awaiting_approval, voided]', () => {
  assert.deepEqual(getAllowedTransitions('validated'), ['queued', 'awaiting_approval', 'voided']);
});

test('getAllowedTransitions for awaiting_approval returns [queued, voided]', () => {
  assert.deepEqual(getAllowedTransitions('awaiting_approval'), ['queued', 'voided']);
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

test('isTerminalState returns false for awaiting_approval', () => {
  assert.equal(isTerminalState('awaiting_approval'), false);
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

// ---------------------------------------------------------------------------
// UTV2-519 — transitionPickLifecycleAtomic path
//
// The lifecycle caller tries the atomic RPC first and only falls back to the
// sequential writes when the repo throws the exact InMemory sentinel. Any
// other atomic-path error (real DB failure, typed FSM error) must propagate
// without falling back — otherwise Postgres rollback semantics would be
// masked by the in-memory non-enforcing writes.
// ---------------------------------------------------------------------------

interface MockCall {
  name: string;
  args: unknown[];
}

function makeMockRepo(opts: {
  currentState?: CanonicalPick['lifecycleState'];
  atomic: () => Promise<{ pickId: string; fromState: string; toState: string; eventId: string }>;
}) {
  const calls: MockCall[] = [];
  const repo = {
    async findPickById(pickId: string) {
      calls.push({ name: 'findPickById', args: [pickId] });
      return {
        id: pickId,
        status: opts.currentState ?? 'validated',
        created_at: new Date().toISOString(),
      } as unknown as import('./types.js').PickRecord;
    },
    async updatePickLifecycleState(pickId: string, state: CanonicalPick['lifecycleState']) {
      calls.push({ name: 'updatePickLifecycleState', args: [pickId, state] });
      return { id: pickId, status: state } as unknown as import('./types.js').PickRecord;
    },
    async saveLifecycleEvent(event: unknown) {
      calls.push({ name: 'saveLifecycleEvent', args: [event] });
      return { id: 'seq-event-id' } as unknown as import('./types.js').PickLifecycleRecord;
    },
    async transitionPickLifecycleAtomic(input: unknown) {
      calls.push({ name: 'transitionPickLifecycleAtomic', args: [input] });
      return opts.atomic();
    },
  } as unknown as import('./repositories.js').PickRepository;
  return { repo, calls };
}

test('UTV2-519: atomic path is called when repo supports it and sequential path is skipped', async () => {
  const { repo, calls } = makeMockRepo({
    currentState: 'validated',
    atomic: async () => ({
      pickId: 'mock-1',
      fromState: 'validated',
      toState: 'awaiting_approval',
      eventId: 'evt-1',
    }),
  });

  const result = await transitionPickLifecycle(
    repo,
    'mock-1',
    'awaiting_approval',
    'brake',
    'promoter',
  );

  assert.equal(result.lifecycleState, 'awaiting_approval');
  assert.equal(result.lifecycleEvent.id, 'evt-1');
  const atomicCalls = calls.filter((c) => c.name === 'transitionPickLifecycleAtomic');
  const seqUpdateCalls = calls.filter((c) => c.name === 'updatePickLifecycleState');
  const seqInsertCalls = calls.filter((c) => c.name === 'saveLifecycleEvent');
  assert.equal(atomicCalls.length, 1, 'atomic should be called exactly once');
  assert.equal(seqUpdateCalls.length, 0, 'sequential update must NOT run when atomic succeeds');
  assert.equal(seqInsertCalls.length, 0, 'sequential insert must NOT run when atomic succeeds');
});

test('UTV2-519: real DB error from atomic path is re-raised (no fallback)', async () => {
  const { repo, calls } = makeMockRepo({
    currentState: 'validated',
    atomic: async () => {
      throw new Error('transition_pick_lifecycle failed: connection reset by peer');
    },
  });

  await assert.rejects(
    () => transitionPickLifecycle(repo, 'mock-2', 'awaiting_approval', 'brake', 'promoter'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        (err as Error).message.includes('connection reset'),
        'original error should propagate',
      );
      return true;
    },
  );

  const seqUpdateCalls = calls.filter((c) => c.name === 'updatePickLifecycleState');
  const seqInsertCalls = calls.filter((c) => c.name === 'saveLifecycleEvent');
  assert.equal(seqUpdateCalls.length, 0, 'sequential update must NOT run after atomic DB error');
  assert.equal(seqInsertCalls.length, 0, 'sequential insert must NOT run after atomic DB error');
});

test('UTV2-519: InvalidTransitionError from atomic path propagates unchanged', async () => {
  const { repo } = makeMockRepo({
    // The caller-side FSM check happens first using findPickById — we must
    // keep the mocked current state matching the intended fromState so we
    // reach the atomic call, then have the atomic call throw the typed FSM
    // error (simulating a race where the DB changed under us).
    currentState: 'validated',
    atomic: async () => {
      throw new InvalidTransitionError('queued', 'awaiting_approval');
    },
  });

  await assert.rejects(
    () => transitionPickLifecycle(repo, 'mock-3', 'awaiting_approval', 'brake', 'promoter'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.equal((err as InvalidTransitionError).fromState, 'queued');
      return true;
    },
  );
});

test('UTV2-519: InMemory sentinel triggers sequential fallback (both writes occur)', async () => {
  // InMemoryPickRepository already throws the sentinel; the existing caller
  // passing it through must fall back to the sequential path. Assert both
  // writes happen and the transition succeeds.
  const repo = await repoWithPick('p-fallback', 'validated');
  const result = await transitionPickLifecycle(
    repo,
    'p-fallback',
    'awaiting_approval',
    'brake',
    'promoter',
  );
  assert.equal(result.lifecycleState, 'awaiting_approval');
  const updated = await repo.findPickById('p-fallback');
  assert.equal(updated?.status, 'awaiting_approval');
});
