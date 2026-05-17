/**
 * T1 Live-DB Proof: UTV2-938 Formal Invariant Verification
 *
 * Exercises the lifecycle FSM against the real Supabase database, verifying:
 *   1. Terminal states (settled, voided) reject all outbound transitions via DB RPC
 *   2. Invalid skip-transitions are rejected at the DB layer (not just TS layer)
 *   3. DB/TS matrix parity — allowed transitions succeed end-to-end
 *   4. Governance brake path (awaiting_approval) enforced at DB layer
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Fixtures prefixed utv2-938-* are
 * NOT deleted — never mutate live rows in T1 proofs.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-lifecycle-invariants.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  pickLifecycleTransitions,
  type PickLifecycleState,
  type CanonicalPick,
  type SubmissionPayload,
} from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  InvalidTransitionError,
  transitionPickLifecycle,
  type RepositoryBundle,
} from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Environment guard
// ---------------------------------------------------------------------------

function hasSupabaseEnv(): boolean {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnv()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let repositories: RepositoryBundle;
const RUN_ID = randomUUID().slice(0, 8);

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
});

// ---------------------------------------------------------------------------
// Helper — creates a pick directly in `draft` state, bypassing the
// submission pipeline so tests control the exact starting lifecycle state.
// Satisfies picks_submission_id_fkey by creating the submission row first.
// ---------------------------------------------------------------------------

async function createDraftPick(label: string): Promise<string> {
  const now = new Date().toISOString();
  const submissionId = randomUUID();

  const submissionPayload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection: `UTV2-938 INVARIANT ${label}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: { testRun: RUN_ID, label },
  };

  await repositories.submissions.saveSubmission({
    id: submissionId,
    payload: submissionPayload,
    receivedAt: now,
  });

  const pick: CanonicalPick = {
    id: randomUUID(),
    submissionId,
    market: 'nba-spread',
    selection: `UTV2-938 INVARIANT ${label}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'draft',
    metadata: { testRun: RUN_ID, label },
    createdAt: now,
  };
  const record = await repositories.picks.savePick(pick, `utv2-938-${label}`);
  return record.id;
}

const allStates = Object.keys(pickLifecycleTransitions) as PickLifecycleState[];

// ---------------------------------------------------------------------------
// Test 1: Terminal states reject all transitions via DB RPC
// ---------------------------------------------------------------------------

test('[live-db] settled rejects all outbound transitions', { skip: skipReason }, async () => {
  const pickId = await createDraftPick(`settled-${RUN_ID}`);

  // Advance via happy path: draft -> validated -> queued -> posted -> settled
  for (const to of ['validated', 'queued', 'posted', 'settled'] as PickLifecycleState[]) {
    await transitionPickLifecycle(repositories.picks, pickId, to, 'utv2-938');
  }

  for (const to of allStates) {
    await assert.rejects(
      () => transitionPickLifecycle(repositories.picks, pickId, to, 'utv2-938-invariant'),
      (err: unknown) => {
        assert.ok(
          err instanceof InvalidTransitionError,
          `settled -> ${to} must throw InvalidTransitionError`,
        );
        return true;
      },
    );
  }
});

test('[live-db] voided rejects all outbound transitions', { skip: skipReason }, async () => {
  const pickId = await createDraftPick(`voided-${RUN_ID}`);

  // draft -> voided is allowed
  await transitionPickLifecycle(repositories.picks, pickId, 'voided', 'utv2-938');

  for (const to of allStates) {
    await assert.rejects(
      () => transitionPickLifecycle(repositories.picks, pickId, to, 'utv2-938-invariant'),
      (err: unknown) => {
        assert.ok(
          err instanceof InvalidTransitionError,
          `voided -> ${to} must throw InvalidTransitionError`,
        );
        return true;
      },
    );
  }
});

// ---------------------------------------------------------------------------
// Test 2: Skip-transitions rejected at DB layer
// ---------------------------------------------------------------------------

test('[live-db] draft cannot skip to queued', { skip: skipReason }, async () => {
  const pickId = await createDraftPick(`draft-skip-${RUN_ID}`);
  await assert.rejects(
    () => transitionPickLifecycle(repositories.picks, pickId, 'queued', 'utv2-938'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.equal(err.fromState, 'draft');
      assert.equal(err.toState, 'queued');
      return true;
    },
  );
});

test('[live-db] validated cannot jump to posted (must queue first)', { skip: skipReason }, async () => {
  const pickId = await createDraftPick(`validated-skip-${RUN_ID}`);
  await transitionPickLifecycle(repositories.picks, pickId, 'validated', 'utv2-938');
  await assert.rejects(
    () => transitionPickLifecycle(repositories.picks, pickId, 'posted', 'utv2-938'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.equal(err.fromState, 'validated');
      assert.equal(err.toState, 'posted');
      return true;
    },
  );
});

test('[live-db] awaiting_approval cannot bypass queued', { skip: skipReason }, async () => {
  const pickId = await createDraftPick(`aa-skip-${RUN_ID}`);
  await transitionPickLifecycle(repositories.picks, pickId, 'validated', 'utv2-938');
  await transitionPickLifecycle(repositories.picks, pickId, 'awaiting_approval', 'utv2-938');
  await assert.rejects(
    () => transitionPickLifecycle(repositories.picks, pickId, 'posted', 'utv2-938'),
    (err: unknown) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.equal(err.fromState, 'awaiting_approval');
      assert.equal(err.toState, 'posted');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Test 3: DB/TS matrix parity — allowed transitions succeed end-to-end
// ---------------------------------------------------------------------------

test('[live-db] happy path draft->validated->queued->posted->settled', { skip: skipReason }, async () => {
  const pickId = await createDraftPick(`happy-${RUN_ID}`);
  for (const to of ['validated', 'queued', 'posted', 'settled'] as PickLifecycleState[]) {
    const result = await transitionPickLifecycle(repositories.picks, pickId, to, 'utv2-938');
    assert.equal(result.lifecycleState, to);
    assert.ok(result.lifecycleEvent.from_state, `from_state must be set for transition to ${to}`);
  }
});

test('[live-db] governance brake path validated->awaiting_approval->queued->posted', { skip: skipReason }, async () => {
  const pickId = await createDraftPick(`brake-${RUN_ID}`);
  const path: PickLifecycleState[] = ['validated', 'awaiting_approval', 'queued', 'posted'];
  for (const to of path) {
    const result = await transitionPickLifecycle(repositories.picks, pickId, to, 'utv2-938');
    assert.equal(result.lifecycleState, to);
  }
});

test('[live-db] any state can be voided', { skip: skipReason }, async () => {
  // Test void from queued state (mid-pipeline)
  const pickId = await createDraftPick(`void-from-queued-${RUN_ID}`);
  await transitionPickLifecycle(repositories.picks, pickId, 'validated', 'utv2-938');
  await transitionPickLifecycle(repositories.picks, pickId, 'queued', 'utv2-938');
  const result = await transitionPickLifecycle(repositories.picks, pickId, 'voided', 'utv2-938');
  assert.equal(result.lifecycleState, 'voided');
});
