import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalPick } from '@unit-talk/contracts';

import { enqueueDistributionWithRunTracking } from './run-audit-service.js';
import { AwaitingApprovalBrakeError } from './distribution-service.js';
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
