import test from 'node:test';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import type { CanonicalPick } from '@unit-talk/contracts';
import { InMemoryOutboxRepository } from '@unit-talk/db';
import {
  AwaitingApprovalBrakeError,
  TrackOnlyDistributionError,
  DistributionTargetMismatchError,
  UnsupportedDeliveryTargetError,
  enqueueDistributionWork,
  evaluateDistributionTargetGate,
  getDistributionTargetValidationStats,
  isGovernanceBrakeSource,
  resetDistributionTargetValidationStats,
  resolveDeliveryTarget,
  type DistributionSkippedResult,
} from './distribution-service.js';
import { retryDeliveryController } from './controllers/retry-delivery-controller.js';
import { requeuePickController } from './controllers/requeue-controller.js';
import { createInMemoryRepositoryBundle } from './persistence.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePick(overrides: Partial<CanonicalPick> = {}): CanonicalPick {
  return {
    id: 'pick-001',
    submissionId: 'sub-001',
    source: 'api',
    market: 'NFL passing yards',
    selection: 'QB Over 287.5',
    line: 287.5,
    odds: -115,
    stakeUnits: 1.5,
    confidence: 0.75,
    lifecycleState: 'validated',
    approvalStatus: 'approved',
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    createdAt: new Date().toISOString(),
    metadata: {
      sport: 'NFL',
      promotionScores: { edge: 92, trust: 88, readiness: 85, uniqueness: 85, boardFit: 90 },
    },
    ...overrides,
  };
}

const TARGET_CANARY = 'discord:canary';

// ---------------------------------------------------------------------------
// enqueueDistributionWork idempotency
// ---------------------------------------------------------------------------

test('enqueueDistributionWork: first enqueue succeeds', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick();

  const result = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);

  assert.ok('outboxRecord' in result, 'expected enqueue result');
  assert.equal(result.pickId, pick.id);
  assert.equal(result.target, TARGET_CANARY);
});

// ---------------------------------------------------------------------------
// Phase 7A governance brake — UTV2-492
// ---------------------------------------------------------------------------

test('isGovernanceBrakeSource: brakes autonomous non-human sources', () => {
  assert.equal(isGovernanceBrakeSource('system-pick-scanner'), true);
  assert.equal(isGovernanceBrakeSource('alert-agent'), true);
  assert.equal(isGovernanceBrakeSource('model-driven'), true);
  // UTV2-1611: board-pick-writer is scheduled and autonomous. Scheduling flags
  // only start it; they never authorize a release. Source membership is the
  // marker-independent fallback brake behind the automated write boundary.
  assert.equal(isGovernanceBrakeSource('board-construction'), true);
});

test('isGovernanceBrakeSource: does NOT brake human-relayed sources', () => {
  assert.equal(isGovernanceBrakeSource('smart-form'), false);
  assert.equal(isGovernanceBrakeSource('api'), false);
  assert.equal(isGovernanceBrakeSource('discord-bot'), false);
  assert.equal(isGovernanceBrakeSource('feed'), false);
  assert.equal(isGovernanceBrakeSource('system'), false);
});

test('enqueueDistributionWork: refuses picks in awaiting_approval (defense-in-depth)', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick({ lifecycleState: 'awaiting_approval' });

  await assert.rejects(
    () => enqueueDistributionWork(pick, outbox, TARGET_CANARY),
    AwaitingApprovalBrakeError,
  );

  // Outbox must remain empty — no enqueue should have been attempted
  const outboxRows = await outbox.listByPickId(pick.id);
  assert.equal(outboxRows.length, 0);
});

test('enqueueDistributionWork: track-only metadata blocks direct enqueue', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick({ metadata: { distributionMode: 'track-only' } });
  await assert.rejects(() => enqueueDistributionWork(pick, outbox, TARGET_CANARY), TrackOnlyDistributionError);
  assert.equal((await outbox.listByPickId(pick.id)).length, 0);
});

test('requeuePickController: track-only pick cannot be requeued', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const pick = makePick({ id: 'pick-track-only-requeue', metadata: { distributionMode: 'track-only' } });
  await repositories.picks.savePick(pick);
  const result = await requeuePickController(pick.id, repositories);
  assert.equal(result.status, 409);
  assert.ok(!result.body.ok);
  if (!result.body.ok) assert.equal(result.body.error.code, 'TRACK_ONLY_DELIVERY_BLOCKED');
  assert.equal((await repositories.outbox.listByPickId(pick.id)).length, 0);
});

test('resolveDeliveryTarget rewrites governed discord targets to canary in local env', () => {
  assert.equal(
    resolveDeliveryTarget('discord:best-bets', { UNIT_TALK_APP_ENV: 'local' }),
    'discord:canary',
  );
  assert.equal(
    resolveDeliveryTarget('discord:trader-insights', { UNIT_TALK_APP_ENV: 'local' }),
    'discord:canary',
  );
  assert.equal(
    resolveDeliveryTarget('discord:canary', { UNIT_TALK_APP_ENV: 'local' }),
    'discord:canary',
  );
  assert.equal(
    resolveDeliveryTarget('discord:best-bets', { UNIT_TALK_APP_ENV: 'production' }),
    'discord:best-bets',
  );
});

test('enqueueDistributionWork rewrites governed discord targets to canary in local env', async () => {
  const previousAppEnv = process.env.UNIT_TALK_APP_ENV;
  process.env.UNIT_TALK_APP_ENV = 'local';

  try {
    const outbox = new InMemoryOutboxRepository();
    const pick = makePick();
    const result = await enqueueDistributionWork(pick, outbox, 'discord:best-bets');

    assert.ok('outboxRecord' in result, 'expected enqueue result');
    assert.equal(result.target, TARGET_CANARY);
    assert.equal(result.outboxRecord.target, TARGET_CANARY);
  } finally {
    if (previousAppEnv === undefined) {
      delete process.env.UNIT_TALK_APP_ENV;
    } else {
      process.env.UNIT_TALK_APP_ENV = previousAppEnv;
    }
  }
});

test('evaluateDistributionTargetGate rejects enabled promotion targets without worker coverage', () => {
  resetDistributionTargetValidationStats();

  assert.throws(
    () =>
      evaluateDistributionTargetGate(
        'discord:best-bets',
        [
          { target: 'best-bets', enabled: true, rolloutPct: 100 },
          { target: 'trader-insights', enabled: false, rolloutPct: 100 },
          { target: 'exclusive-insights', enabled: false, rolloutPct: 100 },
        ],
        {
          UNIT_TALK_APP_ENV: 'production',
          UNIT_TALK_DISTRIBUTION_TARGETS: 'discord:canary',
        },
      ),
    DistributionTargetMismatchError,
  );

  assert.equal(getDistributionTargetValidationStats().rejectedTargetMismatchCount, 1);
});

test('evaluateDistributionTargetGate allows enabled promotion targets with worker coverage', () => {
  const gate = evaluateDistributionTargetGate(
    'discord:best-bets',
    [
      { target: 'best-bets', enabled: true, rolloutPct: 100 },
      { target: 'trader-insights', enabled: false, rolloutPct: 100 },
      { target: 'exclusive-insights', enabled: false, rolloutPct: 100 },
    ],
    {
      UNIT_TALK_APP_ENV: 'production',
      UNIT_TALK_DISTRIBUTION_TARGETS: 'discord:best-bets',
    },
  );

  assert.equal(gate.ok, true);
  assert.equal(gate.resolvedTarget, 'discord:best-bets');
});

test('enqueueDistributionWork rejects blocked promotion targets even with explicit registry', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick({
    promotionTarget: 'exclusive-insights',
    promotionStatus: 'qualified',
  });

  const result = await enqueueDistributionWork(
    pick,
    outbox,
    'discord:exclusive-insights',
    [
      { target: 'best-bets', enabled: true, rolloutPct: 100 },
      { target: 'trader-insights', enabled: true, rolloutPct: 100 },
      { target: 'exclusive-insights', enabled: true, rolloutPct: 100 },
    ],
  );

  assert.deepEqual(result, {
    enqueued: false,
    reason: 'target-disabled',
    target: 'discord:exclusive-insights',
  });
  assert.deepEqual(await outbox.listByPickId(pick.id), []);
});

test('enqueueDistributionWork: duplicate enqueue for same pick+target is rejected when pending row exists', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick();

  // First enqueue succeeds
  const first = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  assert.ok('outboxRecord' in first);

  // Second enqueue for the same pick+target should be deduplicated
  const second = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  assert.ok('enqueued' in second && second.enqueued === false, 'expected skip result');
  const skipped = second as DistributionSkippedResult;
  assert.equal(skipped.reason, 'duplicate-pending');
  assert.equal(skipped.existingOutboxId, first.outboxRecord.id);
});

test('enqueueDistributionWork: duplicate enqueue rejected when processing (claimed) row exists', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick();

  // Enqueue then claim
  await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  await outbox.claimNext(TARGET_CANARY, 'worker-1');

  // Attempt re-enqueue while processing -- should be rejected
  const result = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  assert.ok('enqueued' in result && result.enqueued === false);
  assert.equal((result as DistributionSkippedResult).reason, 'duplicate-pending');
});

test('enqueueDistributionWork: re-enqueue succeeds after terminal state (sent)', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick();

  // Enqueue, claim, mark sent
  const first = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  assert.ok('outboxRecord' in first);
  await outbox.claimNext(TARGET_CANARY, 'worker-1');
  await outbox.markSent(first.outboxRecord.id);

  // Now re-enqueue should succeed (no active row)
  const second = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  assert.ok('outboxRecord' in second, 'expected new enqueue after terminal state');
  assert.notEqual(second.outboxRecord.id, first.outboxRecord.id);
});

test('enqueueDistributionWork: re-enqueue succeeds after dead_letter', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick();

  // Enqueue, claim, mark dead_letter
  const first = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  assert.ok('outboxRecord' in first);
  await outbox.claimNext(TARGET_CANARY, 'worker-1');
  await outbox.markDeadLetter(first.outboxRecord.id, 'max retries exceeded');

  // Re-enqueue after dead_letter should succeed
  const second = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  assert.ok('outboxRecord' in second, 'expected new enqueue after dead_letter');
});

test('enqueueDistributionWork: different targets for same pick are allowed', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick();

  const first = await enqueueDistributionWork(pick, outbox, TARGET_CANARY);
  assert.ok('outboxRecord' in first);

  // Different target should work fine — numeric channel IDs are valid non-promotion targets
  const second = await enqueueDistributionWork(pick, outbox, 'discord:123456789123456789');
  assert.ok('outboxRecord' in second, 'expected enqueue to different target to succeed');
});

// ---------------------------------------------------------------------------
// InMemoryOutboxRepository.enqueue idempotency
// ---------------------------------------------------------------------------

test('InMemoryOutboxRepository.enqueue: throws on duplicate active row for same pick+target', async () => {
  const outbox = new InMemoryOutboxRepository();

  await outbox.enqueue({
    pickId: 'pick-dup',
    target: TARGET_CANARY,
    payload: {},
    idempotencyKey: 'key-1',
  });

  await assert.rejects(
    () =>
      outbox.enqueue({
        pickId: 'pick-dup',
        target: TARGET_CANARY,
        payload: {},
        idempotencyKey: 'key-2',
      }),
    (err: Error) => {
      assert.ok(err.message.includes('Duplicate outbox row'));
      return true;
    },
  );
});

test('InMemoryOutboxRepository.enqueue: allows insert after prior row reaches terminal state', async () => {
  const outbox = new InMemoryOutboxRepository();

  const first = await outbox.enqueue({
    pickId: 'pick-term',
    target: TARGET_CANARY,
    payload: {},
    idempotencyKey: 'key-1',
  });

  // Move to terminal state
  await outbox.claimNext(TARGET_CANARY, 'w1');
  await outbox.markSent(first.id);

  // Should succeed now
  const second = await outbox.enqueue({
    pickId: 'pick-term',
    target: TARGET_CANARY,
    payload: {},
    idempotencyKey: 'key-2',
  });
  assert.ok(second.id);
  assert.notEqual(second.id, first.id);
});

// ---------------------------------------------------------------------------
// retryDeliveryController idempotency
// ---------------------------------------------------------------------------

test('retryDeliveryController: rejects retry when an active pending row already exists for same target', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const pick = makePick({ id: 'pick-retry-guard' });
  await repositories.picks.savePick(pick);

  // Enqueue row 1 (canary), claim, dead-letter it
  const deadRow = await repositories.outbox.enqueue({
    pickId: pick.id,
    target: TARGET_CANARY,
    payload: {},
    idempotencyKey: 'key-dead',
  });
  await repositories.outbox.claimNext(TARGET_CANARY, 'w1');
  await repositories.outbox.markDeadLetter(deadRow.id, 'max retries');

  // Enqueue row 2 (same target), which is now pending -- simulates a concurrent re-enqueue
  await repositories.outbox.enqueue({
    pickId: pick.id,
    target: TARGET_CANARY,
    payload: {},
    idempotencyKey: 'key-active',
  });

  // Retry the dead_letter row -- should be blocked by the active pending row
  const result = await retryDeliveryController(
    pick.id,
    { reason: 'operator retry', actor: 'operator' },
    repositories,
  );
  assert.equal(result.status, 409);
  assert.ok(!result.body.ok);
  if (!result.body.ok) {
    assert.equal(result.body.error.code, 'ACTIVE_ROW_EXISTS');
  }
});

test('retryDeliveryController: succeeds for failed row with no active conflict', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const pick = makePick({ id: 'pick-retry-ok' });
  await repositories.picks.savePick(pick);

  const row = await repositories.outbox.enqueue({
    pickId: pick.id,
    target: TARGET_CANARY,
    payload: {},
    idempotencyKey: 'key-1',
  });
  await repositories.outbox.claimNext(TARGET_CANARY, 'w1');
  await repositories.outbox.markDeadLetter(row.id, 'max retries');

  const result = await retryDeliveryController(
    pick.id,
    { reason: 'operator retry', actor: 'operator' },
    repositories,
  );
  assert.equal(result.status, 200);
  if (!result.body.ok) throw new Error('expected ok');
  assert.equal(result.body.data.previousStatus, 'dead_letter');
  assert.equal(result.body.data.newStatus, 'pending');
});

test('retryDeliveryController: track-only pick cannot revive a dead-letter delivery', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const pick = makePick({ id: 'pick-track-only-retry', metadata: {} });
  await repositories.picks.savePick(pick);
  const row = await repositories.outbox.enqueue({
    pickId: pick.id,
    target: TARGET_CANARY,
    payload: {},
    idempotencyKey: 'track-only-dead-letter',
  });
  await repositories.outbox.claimNext(TARGET_CANARY, 'worker');
  await repositories.outbox.markDeadLetter(row.id, 'synthetic failure');
  // The pick becomes Track Only only after the delivery row already exists.
  await repositories.picks.savePick(
    makePick({ id: 'pick-track-only-retry', metadata: { distributionMode: 'track-only' } }),
  );

  const result = await retryDeliveryController(pick.id, { reason: 'retry', actor: 'operator' }, repositories);
  assert.equal(result.status, 409);
  assert.ok(!result.body.ok);
  if (!result.body.ok) assert.equal(result.body.error.code, 'TRACK_ONLY_DELIVERY_BLOCKED');
});

// ---------------------------------------------------------------------------
// UTV2-982: fail-closed validation for unsupported non-promotion targets
// ---------------------------------------------------------------------------

test('evaluateDistributionTargetGate: discord:canary passes as supported non-promotion target', () => {
  const gate = evaluateDistributionTargetGate('discord:canary', [], {});
  assert.equal(gate.ok, true);
  assert.equal(gate.requestedPromotionTarget, null);
});

test('evaluateDistributionTargetGate: discord:<numericId> passes as supported direct channel target', () => {
  const gate = evaluateDistributionTargetGate('discord:1234567890', [], {});
  assert.equal(gate.ok, true);
  assert.equal(gate.requestedPromotionTarget, null);
});

test('evaluateDistributionTargetGate: discord:qa-pick-delivery throws UnsupportedDeliveryTargetError', () => {
  assert.throws(
    () => evaluateDistributionTargetGate('discord:qa-pick-delivery', [], {}),
    (err: unknown) => {
      assert.ok(err instanceof UnsupportedDeliveryTargetError, 'expected UnsupportedDeliveryTargetError');
      assert.equal(err.target, 'discord:qa-pick-delivery');
      return true;
    },
  );
});

test('evaluateDistributionTargetGate: discord:unknown-lane throws UnsupportedDeliveryTargetError', () => {
  assert.throws(
    () => evaluateDistributionTargetGate('discord:some-other-lane', [], {}),
    (err: unknown) => {
      assert.ok(err instanceof UnsupportedDeliveryTargetError, 'expected UnsupportedDeliveryTargetError');
      assert.equal(err.target, 'discord:some-other-lane');
      return true;
    },
  );
});

test('enqueueDistributionWork: throws UnsupportedDeliveryTargetError for unsupported target', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick({ lifecycleState: 'queued', promotionStatus: 'not_eligible', promotionTarget: undefined });

  await assert.rejects(
    () => enqueueDistributionWork(pick, outbox, 'discord:qa-pick-delivery'),
    (err: unknown) => {
      assert.ok(err instanceof UnsupportedDeliveryTargetError);
      assert.equal((err as UnsupportedDeliveryTargetError).target, 'discord:qa-pick-delivery');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// UTV2-1672: mutation controls for the Track Only delivery guards.
//
// A guard that is merely present proves nothing. Each control below physically
// deletes one named guard from its own source file, imports the mutated module,
// and asserts the mutant reaches the delivery behaviour the guard exists to
// prevent. If a control ever passes without the deletion changing behaviour,
// the guard it names is not load-bearing and the control is worthless.
// ---------------------------------------------------------------------------

async function withGuardRemoved<T>(
  relativeModulePath: string,
  guardName: string,
  run: (mutant: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const sourcePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
  const suffix = `__mutant_${guardName}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const mutantPath = sourcePath.replace(/\.ts$/u, `${suffix}.ts`);
  const source = await readFile(sourcePath, 'utf8');
  const guardPattern = new RegExp(
    `[ ]*// UTV2-1672 ${guardName}_START[\\s\\S]*?// UTV2-1672 ${guardName}_END\\n`,
    // Global: a guard name can mark more than one block (the chokepoint marks
    // both the in-memory and the database outbox repository). Removing only the
    // first would leave the control covering half the feature.
    'gu',
  );
  const mutantSource = source.replace(guardPattern, '');
  assert.notEqual(mutantSource, source, `mutation control could not remove ${guardName}`);
  await writeFile(mutantPath, mutantSource, 'utf8');
  try {
    const mutant = (await import(
      `${pathToFileURL(mutantPath).href}?mutation=${guardName}`
    )) as Record<string, unknown>;
    return await run(mutant);
  } finally {
    await unlink(mutantPath).catch(() => undefined);
  }
}

test('mutation control: removing TRACK_ONLY_DIRECT_ENQUEUE_GUARD lets a track-only pick be enqueued for delivery', async () => {
  const outbox = new InMemoryOutboxRepository();
  const pick = makePick({ id: 'pick-mc-direct-enqueue', metadata: { distributionMode: 'track-only' } });

  // Baseline: the guard refuses.
  await assert.rejects(
    () => enqueueDistributionWork(pick, outbox, TARGET_CANARY),
    (err: unknown) => {
      assert.ok(err instanceof TrackOnlyDistributionError);
      return true;
    },
    'guarded build must refuse to enqueue a track-only pick',
  );
  assert.equal((await outbox.listByPickId(pick.id)).length, 0);

  // Mutant: the same call now creates real delivery work.
  await withGuardRemoved('./distribution-service.ts', 'TRACK_ONLY_DIRECT_ENQUEUE_GUARD', async (mutant) => {
    const mutantEnqueue = mutant.enqueueDistributionWork as typeof enqueueDistributionWork;
    const mutantOutbox = new InMemoryOutboxRepository();
    await mutantEnqueue(pick, mutantOutbox, TARGET_CANARY);
    const rows = await mutantOutbox.listByPickId(pick.id);
    assert.equal(rows.length, 1, 'mutant must create member-facing delivery work');
    assert.equal(rows[0]?.target, TARGET_CANARY);
  });
});

test('mutation control: removing TRACK_ONLY_RETRY_GUARD re-arms a dead-lettered track-only delivery', async () => {
  async function seedDeadLetter() {
    const repositories = createInMemoryRepositoryBundle();
    const pick = makePick({ id: 'pick-mc-retry', metadata: {} });
    await repositories.picks.savePick(pick);
    const row = await repositories.outbox.enqueue({
      pickId: pick.id,
      target: TARGET_CANARY,
      payload: {},
      idempotencyKey: `mc-retry-${Math.random().toString(36).slice(2, 10)}`,
    });
    await repositories.outbox.claimNext(TARGET_CANARY, 'worker');
    await repositories.outbox.markDeadLetter(row.id, 'synthetic failure');
    await repositories.picks.savePick(
      makePick({ id: 'pick-mc-retry', metadata: { distributionMode: 'track-only' } }),
    );
    return { repositories, pick, rowId: row.id };
  }

  // Baseline: the guard refuses and the row stays dead-lettered.
  const guarded = await seedDeadLetter();
  const guardedResult = await retryDeliveryController(
    guarded.pick.id,
    { reason: 'retry', actor: 'operator' },
    guarded.repositories,
  );
  assert.equal(guardedResult.status, 409);
  const guardedRows = await guarded.repositories.outbox.listByPickId(guarded.pick.id);
  assert.equal(guardedRows[0]?.status, 'dead_letter', 'guarded build must leave the row dead-lettered');

  // Mutant: the dead-lettered delivery is reset to pending — real member-facing
  // work is revived. Nothing downstream of this guard stops it.
  await withGuardRemoved(
    './controllers/retry-delivery-controller.ts',
    'TRACK_ONLY_RETRY_GUARD',
    async (mutant) => {
      const mutantRetry = mutant.retryDeliveryController as typeof retryDeliveryController;
      const seeded = await seedDeadLetter();
      const result = await mutantRetry(
        seeded.pick.id,
        { reason: 'retry', actor: 'operator' },
        seeded.repositories,
      );
      assert.equal(result.status, 200, 'mutant must accept the retry');
      const rows = await seeded.repositories.outbox.listByPickId(seeded.pick.id);
      assert.equal(rows[0]?.status, 'pending', 'mutant must re-arm the delivery');
      assert.equal(rows[0]?.attempt_count ?? -1, 0, 'mutant must reset the attempt count');
    },
  );
});

test('mutation control: removing TRACK_ONLY_REQUEUE_GUARD sends a track-only pick down the delivery path', async () => {
  async function seed() {
    const repositories = createInMemoryRepositoryBundle();
    const pick = makePick({
      id: `pick-mc-requeue-${Math.random().toString(36).slice(2, 8)}`,
      metadata: { distributionMode: 'track-only' },
    });
    await repositories.picks.savePick(pick);
    return { repositories, pick };
  }

  // Baseline: the guard refuses with its own named error, before any promotion
  // or delivery evaluation happens.
  const guarded = await seed();
  const guardedResult = await requeuePickController(guarded.pick.id, guarded.repositories);
  assert.equal(guardedResult.status, 409);
  assert.ok(!guardedResult.body.ok);
  if (!guardedResult.body.ok) {
    assert.equal(guardedResult.body.error.code, 'TRACK_ONLY_DELIVERY_BLOCKED');
  }
  assert.equal((await guarded.repositories.outbox.listByPickId(guarded.pick.id)).length, 0);

  // Mutant: the request is no longer refused at this guard. It proceeds into
  // the delivery path and is stopped only by the INDEPENDENT pre-atomic guard
  // in run-audit-service, which throws TrackOnlyDistributionError. That
  // defence-in-depth is real and deliberate, so this control asserts what it
  // can honestly assert: the requeue guard changes observable behaviour, and
  // the fallback that catches the mutant is a different, named guard.
  await withGuardRemoved(
    './controllers/requeue-controller.ts',
    'TRACK_ONLY_REQUEUE_GUARD',
    async (mutant) => {
      const mutantRequeue = mutant.requeuePickController as typeof requeuePickController;
      const seeded = await seed();
      let observed: string;
      try {
        const result = await mutantRequeue(seeded.pick.id, seeded.repositories);
        observed = result.body.ok ? 'ok' : result.body.error.code;
      } catch (err) {
        observed = err instanceof Error ? err.name : 'unknown';
      }
      assert.notEqual(
        observed,
        'TRACK_ONLY_DELIVERY_BLOCKED',
        'mutant must no longer refuse at the requeue guard',
      );
      assert.equal(
        observed,
        'TrackOnlyDistributionError',
        'mutant must be caught by the independent pre-atomic guard instead',
      );
      assert.equal(
        (await seeded.repositories.outbox.listByPickId(seeded.pick.id)).length,
        0,
        'the pre-atomic guard must still prevent any outbox row',
      );
    },
  );
});

// ---------------------------------------------------------------------------
// UTV2-1672: the outbox chokepoint.
//
// The per-route guards each protect one entry point. recap-service reaches the
// outbox without passing any of them, so the invariant "a Track Only pick never
// gets delivery work" cannot rest on them alone. The control below deletes the
// chokepoint from the repository layer and shows that a Track Only pick then
// receives a real outbox row.
// ---------------------------------------------------------------------------

test('mutation control: removing OUTBOX_TRACK_ONLY_CHOKEPOINT_GUARD lets any route create delivery work for a track-only pick', async () => {
  const trackOnly = async () => ({ distributionMode: 'track-only' });
  const enqueueInput = {
    pickId: 'pick-track-only-chokepoint',
    target: 'discord:best-bets',
    payload: { note: 'recap-shaped direct enqueue' },
    idempotencyKey: 'utv2-1672-chokepoint-control',
  };

  // Baseline: the shipped repository refuses.
  const { InMemoryOutboxRepository: RealOutbox, TrackOnlyDeliveryForbiddenError } =
    await import('@unit-talk/db');
  const real = new RealOutbox(trackOnly);
  await assert.rejects(
    () => real.enqueue(enqueueInput),
    (error: unknown) => error instanceof TrackOnlyDeliveryForbiddenError,
    'baseline: the chokepoint must refuse delivery work for a track-only pick',
  );

  // Mutant: with the marked block deleted, the same call succeeds.
  await withGuardRemoved(
    '../../../packages/db/src/runtime-repositories.ts',
    'OUTBOX_TRACK_ONLY_CHOKEPOINT_GUARD',
    async (mutant) => {
      const MutantOutbox = mutant['InMemoryOutboxRepository'] as new (
        resolve: () => Promise<Record<string, unknown>>,
      ) => { enqueue: (input: typeof enqueueInput) => Promise<{ pick_id: string; target: string }> };
      const mutated = new MutantOutbox(trackOnly);
      const row = await mutated.enqueue(enqueueInput);
      assert.equal(
        row.pick_id,
        enqueueInput.pickId,
        'mutant must create real delivery work for a track-only pick',
      );
      assert.equal(row.target, 'discord:best-bets');
    },
  );
});

test('the outbox chokepoint is wired into the repository bundle, not just available on the class', async () => {
  const { createInMemoryRepositoryBundle, TrackOnlyDeliveryForbiddenError } =
    await import('@unit-talk/db');
  const repositories = createInMemoryRepositoryBundle();
  const pick = makePick({
    id: 'pick-chokepoint-wiring',
    metadata: { distributionMode: 'track-only' },
  });
  await repositories.picks.savePick(pick);

  await assert.rejects(
    () =>
      repositories.outbox.enqueue({
        pickId: pick.id,
        target: 'discord:best-bets',
        payload: {},
        idempotencyKey: 'utv2-1672-chokepoint-wiring',
      }),
    (error: unknown) => error instanceof TrackOnlyDeliveryForbiddenError,
    'the bundle must wire the pick lookup, or the guard is inert in production shape',
  );
});

// ---------------------------------------------------------------------------
// UTV2-1672: the database-side half of the chokepoint.
//
// `DatabaseOutboxRepository` is the repository production actually runs. Its
// two guards, and the metadata read they depend on, were previously executed by
// no test at all -- the in-memory control above proved only the in-memory half.
// A stub client makes both reachable without a live connection.
// ---------------------------------------------------------------------------

interface StubPickRow {
  metadata: Record<string, unknown> | null;
}

function stubSupabaseClient(options: {
  pickRow?: StubPickRow | null;
  pickError?: { message: string } | null;
}) {
  const inserted: Array<Record<string, unknown>> = [];
  const rpcCalls: string[] = [];
  const client = {
    from(table: string) {
      if (table === 'picks') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.pickError ? null : (options.pickRow ?? null),
                error: options.pickError ?? null,
              }),
            }),
          }),
        };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: 'outbox-1', ...row }, error: null }),
            }),
          };
        },
      };
    },
    async rpc(name: string) {
      rpcCalls.push(name);
      return { data: null, error: null };
    },
  };
  return { client, inserted, rpcCalls };
}

const dbConnection = {
  url: 'https://stub.invalid',
  serviceRoleKey: 'stub',
} as never;

const atomicInput = {
  pickId: 'pick-db-chokepoint',
  fromState: 'qualified',
  toState: 'distributing',
  writerRole: 'api',
  reason: 'test',
  lifecycleCreatedAt: '2026-08-30T00:00:00.000Z',
  outboxTarget: 'discord:best-bets',
  outboxPayload: {},
  outboxIdempotencyKey: 'utv2-1672-db-atomic',
} as never;

test('DatabaseOutboxRepository.enqueue refuses delivery work for a persisted track-only pick', async () => {
  const { DatabaseOutboxRepository, TrackOnlyDeliveryForbiddenError } = await import('@unit-talk/db');
  const stub = stubSupabaseClient({ pickRow: { metadata: { distributionMode: 'track-only' } } });
  const repository = new DatabaseOutboxRepository(dbConnection, stub.client as never);

  await assert.rejects(
    () =>
      repository.enqueue({
        pickId: 'pick-db-chokepoint',
        target: 'discord:best-bets',
        payload: {},
        idempotencyKey: 'utv2-1672-db-enqueue',
      }),
    (error: unknown) => error instanceof TrackOnlyDeliveryForbiddenError,
  );
  assert.equal(stub.inserted.length, 0, 'no row may be inserted for a track-only pick');
});

test('DatabaseOutboxRepository.enqueue still inserts for a delivery-eligible pick', async () => {
  const { DatabaseOutboxRepository } = await import('@unit-talk/db');
  const stub = stubSupabaseClient({ pickRow: { metadata: { distributionMode: 'delivery-eligible' } } });
  const repository = new DatabaseOutboxRepository(dbConnection, stub.client as never);

  await repository.enqueue({
    pickId: 'pick-db-eligible',
    target: 'discord:best-bets',
    payload: {},
    idempotencyKey: 'utv2-1672-db-eligible',
  });
  assert.equal(stub.inserted.length, 1, 'the chokepoint must not block ordinary delivery work');
});

test('DatabaseOutboxRepository refuses when the pick row is unreadable rather than assuming it is safe', async () => {
  const { DatabaseOutboxRepository } = await import('@unit-talk/db');

  // Row absent or invisible: maybeSingle reports data:null/error:null.
  const missing = stubSupabaseClient({ pickRow: null });
  const withMissingRow = new DatabaseOutboxRepository(dbConnection, missing.client as never);
  await assert.rejects(
    () =>
      withMissingRow.enqueue({
        pickId: 'pick-absent',
        target: 'discord:best-bets',
        payload: {},
        idempotencyKey: 'utv2-1672-db-absent',
      }),
    /Track Only status cannot be established/u,
  );
  assert.equal(missing.inserted.length, 0);

  // Query error: already fail-closed, asserted here so both branches are covered.
  const failed = stubSupabaseClient({ pickError: { message: 'permission denied' } });
  const withError = new DatabaseOutboxRepository(dbConnection, failed.client as never);
  await assert.rejects(
    () =>
      withError.enqueue({
        pickId: 'pick-error',
        target: 'discord:best-bets',
        payload: {},
        idempotencyKey: 'utv2-1672-db-error',
      }),
    /delivery safety check/u,
  );
  assert.equal(failed.inserted.length, 0);
});

test('mutation control: removing ATOMIC_TRACK_ONLY_CHOKEPOINT_GUARD lets the atomic RPC run for a track-only pick', async () => {
  const { DatabaseOutboxRepository, TrackOnlyDeliveryForbiddenError } = await import('@unit-talk/db');
  const pickRow = { metadata: { distributionMode: 'track-only' } };

  // Baseline: the shipped repository refuses before the RPC is reached.
  const baseline = stubSupabaseClient({ pickRow });
  const shipped = new DatabaseOutboxRepository(dbConnection, baseline.client as never);
  await assert.rejects(
    () => shipped.enqueueDistributionAtomic(atomicInput),
    (error: unknown) => error instanceof TrackOnlyDeliveryForbiddenError,
  );
  assert.deepEqual(baseline.rpcCalls, [], 'the atomic RPC must not be reached');

  // Mutant: with the marked block deleted, the RPC runs.
  await withGuardRemoved(
    '../../../packages/db/src/runtime-repositories.ts',
    'ATOMIC_TRACK_ONLY_CHOKEPOINT_GUARD',
    async (mutant) => {
      const MutantRepository = mutant['DatabaseOutboxRepository'] as new (
        connection: never,
        client: never,
      ) => { enqueueDistributionAtomic: (input: never) => Promise<unknown> };
      const mutated = stubSupabaseClient({ pickRow });
      const repository = new MutantRepository(dbConnection, mutated.client as never);
      await repository.enqueueDistributionAtomic(atomicInput);
      assert.deepEqual(
        mutated.rpcCalls,
        ['enqueue_distribution_atomic'],
        'mutant must reach the server-side enqueue for a track-only pick',
      );
    },
  );
});
