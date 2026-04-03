import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalPick } from '@unit-talk/contracts';
import { InMemoryOutboxRepository } from '@unit-talk/db';
import { enqueueDistributionWork, type DistributionSkippedResult } from './distribution-service.js';
import { retryDeliveryController } from './controllers/retry-delivery-controller.js';
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

  // Different target should work fine
  const second = await enqueueDistributionWork(pick, outbox, 'discord:recaps');
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
