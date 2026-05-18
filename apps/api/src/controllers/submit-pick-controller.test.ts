import test from 'node:test';
import assert from 'node:assert/strict';
import type { SubmissionPayload, PickSource } from '@unit-talk/contracts';

import { submitPickController } from './submit-pick-controller.js';
import { createInMemoryRepositoryBundle } from '../persistence.js';

// ---------------------------------------------------------------------------
// Phase 7A governance brake — UTV2-492
// ---------------------------------------------------------------------------
//
// These tests assert that non-human pick sources land in `awaiting_approval`
// at submission time and do NOT auto-enqueue for distribution. Human sources
// retain the existing validated → queued behavior.
//
// The brake is enforced at the controller level (primary) before any call
// to enqueueDistributionWithRunTracking is made, so no outbox rows or
// distribution runs should appear for braked sources.

function makePayload(source: PickSource, overrides: Partial<SubmissionPayload> = {}): SubmissionPayload {
  return {
    source,
    market: 'NBA points',
    selection: 'Player Over 18.5',
    line: 18.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.7,
    ...overrides,
  };
}

test('submit-pick-controller: system-pick-scanner lands in awaiting_approval (governance brake)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const result = await submitPickController(
    makePayload('system-pick-scanner'),
    repositories,
  );

  assert.equal(result.status, 201);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  assert.equal(result.body.data.lifecycleState, 'awaiting_approval');
  assert.equal(result.body.data.outboxEnqueued, false);
  assert.equal(result.body.data.governanceBrake, true);

  // Persisted pick must be parked in awaiting_approval
  const pickId = result.body.data.pickId;
  const pick = await repositories.picks.findPickById(pickId);
  assert.ok(pick);
  assert.equal(pick.status, 'awaiting_approval');

  // No outbox row should exist for this pick
  const outboxRows = await repositories.outbox.listByPickId(pickId);
  assert.equal(outboxRows.length, 0, 'braked pick must not have an outbox row');

  // Audit row for the governance brake must exist
  const auditRows = await repositories.audit.listRecentByEntityType(
    'picks',
    new Date(0).toISOString(),
    'pick.governance_brake.applied',
  );
  const brakeAudit = auditRows.find(
    (row) => (row.payload as Record<string, unknown>)['pickId'] === pickId,
  );
  assert.ok(brakeAudit, 'expected governance_brake audit row for this pick');
});

test('submit-pick-controller: alert-agent lands in awaiting_approval (governance brake)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const result = await submitPickController(
    makePayload('alert-agent'),
    repositories,
  );

  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  assert.equal(result.body.data.lifecycleState, 'awaiting_approval');
  assert.equal(result.body.data.governanceBrake, true);
  assert.equal(result.body.data.outboxEnqueued, false);
});

test('submit-pick-controller: board-construction is NOT braked (operator-triggered governed path)', async () => {
  // Phase 7A repo-truth correction (PM, 2026-04-10): board-construction is
  // operator-triggered, not autonomous. It must retain existing queueing
  // behavior and NOT be lumped into the non-human brake bucket.
  const repositories = createInMemoryRepositoryBundle();

  const result = await submitPickController(
    makePayload('board-construction'),
    repositories,
  );

  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  assert.notEqual(result.body.data.lifecycleState, 'awaiting_approval');
  assert.equal(result.body.data.governanceBrake, undefined);
});

test('submit-pick-controller: smart-form path is NOT braked (regression guard)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const result = await submitPickController(
    makePayload('smart-form'),
    repositories,
  );

  assert.equal(result.status, 201);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  assert.notEqual(result.body.data.lifecycleState, 'awaiting_approval');
  assert.equal(result.body.data.governanceBrake, undefined);

  const pick = await repositories.picks.findPickById(result.body.data.pickId);
  assert.ok(pick);
  assert.notEqual(pick.status, 'awaiting_approval');
});

test('submit-pick-controller: api source is NOT braked (human path preserved)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const result = await submitPickController(
    makePayload('api'),
    repositories,
  );

  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  assert.notEqual(result.body.data.lifecycleState, 'awaiting_approval');
  assert.equal(result.body.data.governanceBrake, undefined);
});

test('submit-pick-controller: discord-bot source is NOT braked (human-relayed path)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const result = await submitPickController(
    makePayload('discord-bot'),
    repositories,
  );

  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  assert.notEqual(result.body.data.lifecycleState, 'awaiting_approval');
  assert.equal(result.body.data.governanceBrake, undefined);
});

test('submit-pick-controller: enqueue failure writes operator-visible zombie pick alert run', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const originalUpdateLifecycle = repositories.picks.updatePickLifecycleState.bind(repositories.picks);
  repositories.picks.updatePickLifecycleState = async (pickId, lifecycleState) => {
    if (lifecycleState === 'queued') {
      throw new Error('synthetic lifecycle write failure');
    }

    return originalUpdateLifecycle(pickId, lifecycleState);
  };

  const result = await submitPickController(
    makePayload('api', {
      metadata: {
        sport: 'NBA',
        eventName: 'Suns vs Nuggets',
        promotionScores: {
          edge: 82,
          trust: 83,
          readiness: 88,
          uniqueness: 80,
          boardFit: 86,
        },
      },
    }),
    repositories,
  );

  assert.equal(result.status, 201);
  assert.ok(result.body.ok);
  if (!result.body.ok) return;

  assert.equal(result.body.data.promotionStatus, 'qualified');
  assert.equal(result.body.data.outboxEnqueued, false);
  assert.match(
    String((result.body.data as { warning?: string }).warning),
    /distribution enqueue failed/i,
  );

  const pick = await repositories.picks.findPickById(result.body.data.pickId);
  assert.equal(pick?.status, 'validated');
  const outboxRows = await repositories.outbox.listByPickId(result.body.data.pickId);
  assert.equal(outboxRows.length, 0);

  const alertRuns = await repositories.runs.listByType('distribution.enqueue.zombie_pick');
  assert.equal(alertRuns.length, 1);
  assert.equal(alertRuns[0]?.status, 'failed');
  assert.equal(alertRuns[0]?.actor, 'submission');
  const alertDetails = alertRuns[0]?.details;
  assert.ok(alertDetails && typeof alertDetails === 'object' && !Array.isArray(alertDetails));
  assert.equal(alertDetails.pickId, result.body.data.pickId);
  assert.equal(alertDetails.recoveryAction, 'POST /api/picks/:id/requeue');
});
