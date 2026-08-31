import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CanonicalPick } from '@unit-talk/contracts';

import { enqueueDistributionWithRunTracking } from './run-audit-service.js';
import {
  AwaitingApprovalBrakeError,
  DistributionTargetMismatchError,
  TrackOnlyDistributionError,
} from './distribution-service.js';
import { createInMemoryRepositoryBundle } from './persistence.js';

// ---------------------------------------------------------------------------
// Phase 7A governance brake — UTV2-492 — defense-in-depth layer
// ---------------------------------------------------------------------------
//
// Controller-level enforcement (submit-pick-controller) prevents non-human
// sources from ever reaching enqueueDistributionWithRunTracking. These tests
// assert that even when the function is called directly with a pick parked in
// `awaiting_approval`, it refuses to run the distribution enqueue pipeline —
// it must throw AwaitingApprovalBrakeError and leave no outbox row.

function makeParkedPick(overrides: Partial<CanonicalPick> = {}): CanonicalPick {
  return {
    id: 'pick-ru-audit-brake-1',
    submissionId: 'sub-ru-audit-brake-1',
    market: 'NBA points',
    selection: 'Player Over 18.5',
    source: 'system-pick-scanner',
    approvalStatus: 'pending',
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    lifecycleState: 'awaiting_approval',
    metadata: {
      sport: 'NBA',
      promotionScores: { edge: 92, trust: 88, readiness: 85, uniqueness: 85, boardFit: 90 },
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('enqueueDistributionWithRunTracking: refuses picks in awaiting_approval (defense-in-depth)', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const pick = makeParkedPick();
  await repositories.picks.savePick(pick);

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        pick,
        'discord:canary',
        'test-actor',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    AwaitingApprovalBrakeError,
  );

  // No outbox row must exist for this pick
  const outboxRows = await repositories.outbox.listByPickId(pick.id);
  assert.equal(outboxRows.length, 0);

  // Pick must still be in awaiting_approval (no sneaky transition)
  const refreshed = await repositories.picks.findPickById(pick.id);
  assert.ok(refreshed);
  assert.equal(refreshed.status, 'awaiting_approval');

  // A blocked audit row must exist describing the brake
  const blockedAudits = await repositories.audit.listRecentByEntityType(
    'distribution_outbox',
    new Date(0).toISOString(),
    'distribution.enqueue.blocked',
  );
  const brakeAudit = blockedAudits.find(
    (row) => (row.payload as Record<string, unknown>)['pickId'] === pick.id,
  );
  assert.ok(brakeAudit, 'expected distribution.enqueue.blocked audit row');
});

test('enqueueDistributionWithRunTracking: re-fetches DB state and blocks even if caller passes stale validated state', async () => {
  // A caller might hold a stale CanonicalPick object where lifecycleState is
  // still 'validated', but the DB has already moved the pick to
  // 'awaiting_approval'. The function must trust the DB state, not the caller.
  const repositories = createInMemoryRepositoryBundle();
  const stalePickObject = makeParkedPick({
    id: 'pick-stale-state-1',
    lifecycleState: 'validated', // stale caller view
  });
  // Persist the pick in awaiting_approval (DB truth)
  await repositories.picks.savePick({
    ...stalePickObject,
    lifecycleState: 'awaiting_approval',
  });

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        stalePickObject,
        'discord:canary',
        'test-actor',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    AwaitingApprovalBrakeError,
  );

  const outboxRows = await repositories.outbox.listByPickId(stalePickObject.id);
  assert.equal(outboxRows.length, 0);
});

test('enqueueDistributionWithRunTracking: blocks target drift before atomic enqueue', async () => {
  const previousEnv = {
    UNIT_TALK_APP_ENV: process.env.UNIT_TALK_APP_ENV,
    UNIT_TALK_DISTRIBUTION_TARGETS: process.env.UNIT_TALK_DISTRIBUTION_TARGETS,
    UNIT_TALK_ENABLED_TARGETS: process.env.UNIT_TALK_ENABLED_TARGETS,
  };
  process.env.UNIT_TALK_APP_ENV = 'production';
  process.env.UNIT_TALK_DISTRIBUTION_TARGETS = 'discord:canary';
  process.env.UNIT_TALK_ENABLED_TARGETS = 'best-bets';

  try {
    const repositories = createInMemoryRepositoryBundle();
    const pick = makeParkedPick({
      id: 'pick-target-drift-1',
      source: 'api',
      approvalStatus: 'approved',
      lifecycleState: 'validated',
      promotionStatus: 'qualified',
      promotionTarget: 'best-bets',
    });
    await repositories.picks.savePick(pick);

    let atomicCalled = false;
    repositories.outbox.enqueueDistributionAtomic = async () => {
      atomicCalled = true;
      throw new Error('atomic enqueue should not run when target coverage fails');
    };

    await assert.rejects(
      () =>
        enqueueDistributionWithRunTracking(
          pick,
          'discord:best-bets',
          'test-actor',
          repositories.picks,
          repositories.outbox,
          repositories.runs,
          repositories.audit,
        ),
      DistributionTargetMismatchError,
    );

    assert.equal(atomicCalled, false, 'target drift gate must run before atomic enqueue');
    assert.equal((await repositories.outbox.listByPickId(pick.id)).length, 0);
    assert.equal((await repositories.picks.findPickById(pick.id))?.status, 'validated');
  } finally {
    restoreEnvValue('UNIT_TALK_APP_ENV', previousEnv.UNIT_TALK_APP_ENV);
    restoreEnvValue('UNIT_TALK_DISTRIBUTION_TARGETS', previousEnv.UNIT_TALK_DISTRIBUTION_TARGETS);
    restoreEnvValue('UNIT_TALK_ENABLED_TARGETS', previousEnv.UNIT_TALK_ENABLED_TARGETS);
  }
});

function restoreEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

// ---------------------------------------------------------------------------
// UTV2-1038: Atomic path failure injection — real DB errors must not silently
// fall back to sequential writes in enqueueDistributionWithRunTracking
// ---------------------------------------------------------------------------

function makeValidatedPick(overrides: Partial<CanonicalPick> = {}): CanonicalPick {
  return {
    id: 'pick-atomic-injection-1',
    submissionId: 'sub-atomic-injection-1',
    market: 'NBA points',
    selection: 'Player Over 18.5',
    source: 'api',
    approvalStatus: 'approved',
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    lifecycleState: 'validated',
    metadata: {
      sport: 'NBA',
      promotionScores: { edge: 92, trust: 88, readiness: 85, uniqueness: 85, boardFit: 90 },
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function installProductionAtomicMutationHarness(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
) {
  const enqueue = repositories.outbox.enqueue.bind(repositories.outbox);
  let atomicCallCount = 0;

  repositories.outbox.enqueueDistributionAtomic = async (input) => {
    atomicCallCount += 1;
    assert.equal(input.fromState, 'validated');
    assert.equal(input.toState, 'queued');
    assert.equal(input.writerRole, 'promoter');

    const persistedPick = await repositories.picks.updatePickLifecycleState(input.pickId, 'queued');
    const lifecycleEvent = await repositories.picks.saveLifecycleEvent({
      pickId: input.pickId,
      fromState: 'validated',
      toState: 'queued',
      writerRole: 'promoter',
      reason: input.reason,
      createdAt: input.lifecycleCreatedAt,
    });
    const outbox = await enqueue({
      pickId: input.pickId,
      target: input.outboxTarget,
      payload: input.outboxPayload,
      idempotencyKey: input.outboxIdempotencyKey,
    });

    return { pick: persistedPick, lifecycleEvent, outbox };
  };

  return () => atomicCallCount;
}

test('enqueueDistributionWithRunTracking: persisted Track Only metadata blocks the production atomic path', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const callerPick = makeValidatedPick({
    id: 'pick-track-only-atomic-guard',
    metadata: { sport: 'NBA' },
  });
  await repositories.picks.savePick({
    ...callerPick,
    metadata: { sport: 'NBA', distributionMode: 'track-only' },
  });
  const atomicCallCount = installProductionAtomicMutationHarness(repositories);

  await assert.rejects(
    () => enqueueDistributionWithRunTracking(
      callerPick,
      'discord:canary',
      'test-actor',
      repositories.picks,
      repositories.outbox,
      repositories.runs,
      repositories.audit,
    ),
    TrackOnlyDistributionError,
  );

  assert.equal(atomicCallCount(), 0, 'Track Only guard must run before production atomic enqueue');
  assert.equal((await repositories.picks.findPickById(callerPick.id))?.status, 'validated');
  assert.equal((await repositories.outbox.listByPickId(callerPick.id)).length, 0);
});

test('mutation control: removing the pre-atomic Track Only guard lets the atomic distribution path run for a Track Only pick', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const callerPick = makeValidatedPick({
    id: 'pick-track-only-atomic-mutant',
    metadata: { sport: 'NBA' },
  });
  await repositories.picks.savePick({
    ...callerPick,
    metadata: { sport: 'NBA', distributionMode: 'track-only' },
  });
  const atomicCallCount = installProductionAtomicMutationHarness(repositories);

  const sourcePath = fileURLToPath(new URL('./run-audit-service.ts', import.meta.url));
  const mutantPath = fileURLToPath(
    new URL(`./run-audit-service.__track_only_mutant_${process.pid}.ts`, import.meta.url),
  );
  const source = await readFile(sourcePath, 'utf8');
  const guardPattern = /[ ]{2}\/\/ UTV2-1672 TRACK_ONLY_ATOMIC_GUARD_START[\s\S]*?[ ]{2}\/\/ UTV2-1672 TRACK_ONLY_ATOMIC_GUARD_END\n/u;
  const mutantSource = source.replace(guardPattern, '');
  assert.notEqual(mutantSource, source, 'mutation control could not remove the Track Only guard');

  await writeFile(mutantPath, mutantSource, 'utf8');
  let mutantOutcome: unknown = null;
  try {
    const mutant = await import(`${pathToFileURL(mutantPath).href}?mutation=track-only`) as typeof import('./run-audit-service.js');
    await mutant.enqueueDistributionWithRunTracking(
      callerPick,
      'discord:canary',
      'test-actor',
      repositories.picks,
      repositories.outbox,
      repositories.runs,
      repositories.audit,
    ).catch((error: unknown) => {
      mutantOutcome = error;
    });
  } finally {
    await unlink(mutantPath).catch(() => undefined);
  }

  // The guard is load-bearing: with it, the call is refused before the atomic
  // enqueue is ever attempted (atomicCallCount() === 0 in the baseline test
  // above). Without it, the call reaches the production atomic path.
  assert.equal(atomicCallCount(), 1, 'mutant must reach production atomic enqueue');

  // It is not, however, the last line of defence. UTV2-1672 added a chokepoint
  // in the outbox repository itself, so the mutant is stopped there instead of
  // creating delivery work. Asserting an outbox row here would be asserting a
  // hole that no longer exists; what this control proves is that removing the
  // pre-atomic guard changes behaviour from "refused early, atomic never
  // attempted" to "atomic attempted, refused only by the repository chokepoint".
  assert.equal(
    (mutantOutcome as { name?: string } | null)?.name,
    'TrackOnlyDeliveryForbiddenError',
    'with the pre-atomic guard gone, only the repository chokepoint stops delivery',
  );
  // The lifecycle row does move to `queued` in this harness before the outbox
  // write is refused, because the in-memory harness performs sequentially what
  // `enqueue_distribution_atomic` performs in one Postgres transaction. That is
  // a property of the harness, not of production, and it is recorded here
  // rather than asserted away: the chokepoint is the last line of defence for
  // *delivery*, not a substitute for the pre-atomic guard's lifecycle safety.
  assert.equal((await repositories.picks.findPickById(callerPick.id))?.status, 'queued');
  const outboxRows = await repositories.outbox.listByPickId(callerPick.id);
  assert.equal(outboxRows.length, 0, 'the chokepoint must still prevent delivery work');
});

test('enqueueDistributionWithRunTracking: real DB errors (constraint violation) rethrow — no silent sequential fallback', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const pick = makeValidatedPick({ id: 'pick-db-error-1' });
  await repositories.picks.savePick(pick);

  const dbError = new Error('duplicate key value violates unique constraint "distribution_outbox_pkey"');
  repositories.outbox.enqueueDistributionAtomic = async () => {
    throw dbError;
  };

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        pick,
        'discord:canary',
        'test-actor',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, dbError.message);
      return true;
    },
  );

  // No outbox row must exist — sequential fallback must not have run
  const outboxRows = await repositories.outbox.listByPickId(pick.id);
  assert.equal(outboxRows.length, 0, 'sequential fallback must not have created an outbox row');
});

test('enqueueDistributionWithRunTracking: network timeout rethrows — no silent sequential fallback', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const pick = makeValidatedPick({ id: 'pick-network-timeout-1' });
  await repositories.picks.savePick(pick);

  const networkError = new Error('fetch failed: connection timed out');
  repositories.outbox.enqueueDistributionAtomic = async () => {
    throw networkError;
  };

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        pick,
        'discord:canary',
        'test-actor',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, networkError.message);
      return true;
    },
  );

  const outboxRows = await repositories.outbox.listByPickId(pick.id);
  assert.equal(outboxRows.length, 0, 'sequential fallback must not have created an outbox row');
});

test('enqueueDistributionWithRunTracking: PGRST202 (RPC not found) rethrows — no silent sequential fallback', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const pick = makeValidatedPick({ id: 'pick-pgrst202-1' });
  await repositories.picks.savePick(pick);

  const pgrst202Error = new Error('Could not find the function public.enqueue_distribution_atomic');
  repositories.outbox.enqueueDistributionAtomic = async () => {
    throw pgrst202Error;
  };

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        pick,
        'discord:canary',
        'test-actor',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, pgrst202Error.message);
      return true;
    },
  );

  const outboxRows = await repositories.outbox.listByPickId(pick.id);
  assert.equal(outboxRows.length, 0, 'sequential fallback must not have created an outbox row');
});

test('enqueueDistributionWithRunTracking: InMemory sentinel allows sequential fallback (expected dev/test path)', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const pick = makeValidatedPick({ id: 'pick-inmemory-sentinel-1' });
  await repositories.picks.savePick(pick);

  // The InMemory repo already throws the sentinel message — this test
  // exercises the real InMemory path end-to-end, confirming sequential
  // fallback is permitted only for the sentinel error.
  const result = await enqueueDistributionWithRunTracking(
    pick,
    'discord:canary',
    'test-actor',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );

  assert.ok(result.run, 'should have a completed run record');
  assert.equal(result.pickId, pick.id);
});
