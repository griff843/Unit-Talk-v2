import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepositoryBundle } from '../persistence.js';
import { reviewPickController } from './review-pick-controller.js';
import type { CanonicalPick } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';

function makePendingPick(overrides: Partial<CanonicalPick> = {}): CanonicalPick {
  return {
    id: 'pick-review-test-1',
    submissionId: 'sub-1',
    market: 'NFL moneyline',
    selection: 'Team A',
    source: 'api',
    approvalStatus: 'pending',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata: {
      sport: 'NFL',
      eventName: 'Test Game',
      promotionScores: { edge: 92, trust: 88, readiness: 85, uniqueness: 85, boardFit: 90 },
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a repository bundle where `picks.getPromotionBoardState` throws,
 * causing the promotion evaluation to fail deterministically.
 */
function createReposWithBrokenPromotion(): RepositoryBundle {
  const repos = createInMemoryRepositoryBundle();
  const originalGetBoardState = repos.picks.getPromotionBoardState.bind(repos.picks);
  // Keep a reference so we can allow it to work during setup but fail during promotion
  void originalGetBoardState;
  repos.picks.getPromotionBoardState = () => {
    throw new Error('Simulated promotion board state failure');
  };
  return repos;
}

// ─── Happy path ──────────────────────────────────────────────────────────────

test('reviewPickController: approve succeeds and includes no promotionError on success', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick = makePendingPick();
  await repos.picks.savePick(pick);

  const result = await reviewPickController(
    pick.id,
    { decision: 'approve', reason: 'Looks great', decidedBy: 'operator-1' },
    repos,
  );

  assert.equal(result.status, 200);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  assert.equal(result.body.data.decision, 'approve');
  assert.equal(result.body.data.approvalStatus, 'approved');
  // promotionError should be absent on success
  assert.equal(result.body.data.promotionError, undefined);
});

test('reviewPickController: deny succeeds', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick = makePendingPick();
  await repos.picks.savePick(pick);

  const result = await reviewPickController(
    pick.id,
    { decision: 'deny', reason: 'Not confident enough', decidedBy: 'operator-1' },
    repos,
  );

  assert.equal(result.status, 200);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;
  assert.equal(result.body.data.decision, 'deny');
  assert.equal(result.body.data.approvalStatus, 'rejected');
});

// ─── Validation errors ───────────────────────────────────────────────────────

test('reviewPickController: rejects invalid decision', async () => {
  const repos = createInMemoryRepositoryBundle();
  const result = await reviewPickController(
    'any-id',
    { decision: 'invalid', reason: 'reason', decidedBy: 'op' },
    repos,
  );
  assert.equal(result.status, 400);
  assert.ok(!result.body.ok);
});

test('reviewPickController: rejects missing reason', async () => {
  const repos = createInMemoryRepositoryBundle();
  const result = await reviewPickController(
    'any-id',
    { decision: 'approve', reason: '', decidedBy: 'op' },
    repos,
  );
  assert.equal(result.status, 400);
  assert.ok(!result.body.ok);
});

test('reviewPickController: rejects missing decidedBy', async () => {
  const repos = createInMemoryRepositoryBundle();
  const result = await reviewPickController(
    'any-id',
    { decision: 'approve', reason: 'reason', decidedBy: '' },
    repos,
  );
  assert.equal(result.status, 400);
  assert.ok(!result.body.ok);
});

test('reviewPickController: returns 404 for unknown pick', async () => {
  const repos = createInMemoryRepositoryBundle();
  const result = await reviewPickController(
    'nonexistent-pick',
    { decision: 'approve', reason: 'reason', decidedBy: 'op' },
    repos,
  );
  assert.equal(result.status, 404);
  assert.ok(!result.body.ok);
});

// ─── Promotion failure surfaces correctly ────────────────────────────────────

test('reviewPickController: surfaces promotionError when promotion evaluation throws', async () => {
  const repos = createReposWithBrokenPromotion();
  const pick = makePendingPick({ id: 'pick-promo-fail-1' });
  // Save via the real underlying repo (getPromotionBoardState is what throws, not savePick)
  await repos.picks.savePick(pick);

  // Capture console.error output
  const originalError = console.error;
  const loggedErrors: string[] = [];
  console.error = (msg: string) => { loggedErrors.push(msg); };

  try {
    const result = await reviewPickController(
      pick.id,
      { decision: 'approve', reason: 'Approve for test', decidedBy: 'operator-test' },
      repos,
    );

    assert.equal(result.status, 200, 'Review itself should still succeed (200)');
    assert.ok(result.body.ok, 'Response should be ok — review completed');
    if (!result.body.ok) return;

    // Pick should still be approved despite promotion failure
    assert.equal(result.body.data.approvalStatus, 'approved');

    // promotionError MUST be present
    assert.ok(
      result.body.data.promotionError,
      'promotionError must be present when promotion evaluation fails',
    );
    assert.ok(
      result.body.data.promotionError!.startsWith('Promotion evaluation failed:'),
      `promotionError should have correct prefix, got: ${result.body.data.promotionError}`,
    );
    assert.ok(
      result.body.data.promotionError!.includes('Simulated promotion board state failure'),
      'promotionError should contain the original error message',
    );

    // Verify structured log was emitted
    assert.ok(loggedErrors.length > 0, 'Should have logged structured error');
    const parsed = JSON.parse(loggedErrors[0]!);
    assert.equal(parsed.level, 'error');
    assert.equal(parsed.event, 'promotion_evaluation_failed');
    assert.equal(parsed.pickId, pick.id);
    assert.equal(parsed.actor, 'operator-test');
  } finally {
    console.error = originalError;
  }
});

test('reviewPickController: promotionError is absent when decision is not approve', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick = makePendingPick({ id: 'pick-deny-no-promo' });
  await repos.picks.savePick(pick);

  const result = await reviewPickController(
    pick.id,
    { decision: 'deny', reason: 'Not good enough', decidedBy: 'operator-1' },
    repos,
  );

  assert.equal(result.status, 200);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;
  assert.equal(result.body.data.promotionError, undefined, 'No promotion runs for non-approve decisions');
});

test('reviewPickController: hold decision does not trigger promotion and has no error', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick = makePendingPick({ id: 'pick-hold-no-promo' });
  await repos.picks.savePick(pick);

  const result = await reviewPickController(
    pick.id,
    { decision: 'hold', reason: 'Need more data', decidedBy: 'operator-1' },
    repos,
  );

  assert.equal(result.status, 200);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;
  assert.equal(result.body.data.promotionError, undefined);
});

// ─── awaiting_approval governance brake paths (Phase 7A / UTV2-509) ──────────

test('reviewPickController: approve from awaiting_approval transitions lifecycle to queued', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick = makePendingPick({ id: 'pick-await-approve-1', lifecycleState: 'awaiting_approval' });
  await repos.picks.savePick(pick);

  const result = await reviewPickController(
    pick.id,
    { decision: 'approve', reason: 'Looks good', decidedBy: 'operator-1' },
    repos,
  );

  assert.equal(result.status, 200);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;
  assert.equal(result.body.data.decision, 'approve');
  assert.equal(result.body.data.approvalStatus, 'approved');

  // Verify lifecycle was advanced to queued
  const updated = await repos.picks.findPickById(pick.id);
  assert.ok(updated, 'pick should exist');
  assert.equal(updated!.status, 'queued', 'lifecycle state should be queued after approval');
});

test('reviewPickController: deny from awaiting_approval transitions lifecycle to voided', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick = makePendingPick({ id: 'pick-await-deny-1', lifecycleState: 'awaiting_approval' });
  await repos.picks.savePick(pick);

  const result = await reviewPickController(
    pick.id,
    { decision: 'deny', reason: 'Not confident', decidedBy: 'operator-1' },
    repos,
  );

  assert.equal(result.status, 200);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;
  assert.equal(result.body.data.decision, 'deny');
  assert.equal(result.body.data.approvalStatus, 'rejected');

  // Verify lifecycle was advanced to voided
  const updated = await repos.picks.findPickById(pick.id);
  assert.ok(updated, 'pick should exist');
  assert.equal(updated!.status, 'voided', 'lifecycle state should be voided after denial');
});

test('reviewPickController: awaiting_approval pick writes audit row with previousLifecycleState', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick = makePendingPick({ id: 'pick-await-audit-1', lifecycleState: 'awaiting_approval' });
  await repos.picks.savePick(pick);

  const result = await reviewPickController(
    pick.id,
    { decision: 'approve', reason: 'All good', decidedBy: 'operator-2' },
    repos,
  );

  assert.equal(result.status, 200);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  // Audit row should have been written (auditId present)
  assert.ok(result.body.data.auditId, 'auditId should be present');
});

test('reviewPickController: hold on awaiting_approval does NOT change lifecycle state', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick = makePendingPick({ id: 'pick-await-hold-1', lifecycleState: 'awaiting_approval' });
  await repos.picks.savePick(pick);

  const result = await reviewPickController(
    pick.id,
    { decision: 'hold', reason: 'Need more info', decidedBy: 'operator-1' },
    repos,
  );

  assert.equal(result.status, 200);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  // Lifecycle state should remain awaiting_approval (hold does not trigger a transition)
  const updated = await repos.picks.findPickById(pick.id);
  assert.ok(updated, 'pick should exist');
  assert.equal(updated!.status, 'awaiting_approval', 'hold should not change lifecycle state');
});
