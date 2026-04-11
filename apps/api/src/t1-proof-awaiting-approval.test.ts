/**
 * T1 Pre-Merge Proof: UTV2-519 awaiting_approval governance brake
 *
 * Exercises the Phase 7A brake path against the live Supabase database via
 * the in-process submit-pick controller, covering the three brake sources
 * (system-pick-scanner, alert-agent, model-driven) plus an atomic-rollback
 * regression that confirms the new `transition_pick_lifecycle` RPC rolls
 * both writes back on a mismatched fromState.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Fixtures are tagged with a
 * deterministic prefix (`utv2-519-brake-*`) so they can be found after the
 * run; they are NOT deleted — we do not mutate live rows in T1 proofs.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-awaiting-approval.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { PickSource, SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  InvalidTransitionError,
  transitionPickLifecycle,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from './controllers/submit-pick-controller.js';

function hasSupabaseSmokeEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseSmokeEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let repositories: RepositoryBundle;
let supabaseUrl: string;
let serviceRoleKey: string;
const createdPickIds: string[] = [];

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  supabaseUrl = env.SUPABASE_URL!;
  serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
});

function authHeaders() {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

async function restQuery<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: authHeaders(),
  });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  }
  return body as T[];
}

interface PickRow {
  id: string;
  status: string;
  source: string;
}

interface LifecycleRow {
  id: string;
  pick_id: string;
  from_state: string | null;
  to_state: string;
  writer_role: string;
  reason: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  entity_type: string;
  entity_id: string;
}

interface OutboxRow {
  id: string;
  pick_id: string;
  status: string;
}

async function runBrakeCase(source: PickSource) {
  const runId = randomUUID();
  const fixtureId = `utv2-519-brake-${source}-${runId}`;
  const payload: SubmissionPayload = {
    source,
    market: 'nba-spread',
    selection: `UTV2-519 BRAKE ${source}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: {
      proof_fixture_id: fixtureId,
      proof_issue: 'UTV2-519',
    },
  };

  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `brake ${source}: expected 201, got ${response.status}`);
  assert.ok(response.body.ok, `brake ${source}: response not ok`);
  const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string; governanceBrake?: boolean; outboxEnqueued: boolean } }).data;
  assert.equal(data.lifecycleState, 'awaiting_approval', `brake ${source}: lifecycleState`);
  assert.equal(data.governanceBrake, true, `brake ${source}: governanceBrake flag`);
  assert.equal(data.outboxEnqueued, false, `brake ${source}: outboxEnqueued`);

  const pickId = data.pickId;
  createdPickIds.push(pickId);

  // 1. picks row status
  const pickRows = await restQuery<PickRow>(
    `picks?id=eq.${pickId}&select=id,status,source`,
  );
  assert.equal(pickRows.length, 1, `brake ${source}: pick row not found`);
  assert.equal(pickRows[0]!.status, 'awaiting_approval', `brake ${source}: picks.status`);

  // 2. exactly one pick_lifecycle row with validated->awaiting_approval
  const lifecycleRows = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason&order=created_at.asc`,
  );
  const brakeEvents = lifecycleRows.filter(
    (row) => row.from_state === 'validated' && row.to_state === 'awaiting_approval',
  );
  assert.equal(
    brakeEvents.length,
    1,
    `brake ${source}: expected 1 validated->awaiting_approval event, got ${brakeEvents.length}`,
  );
  const brakeEvent = brakeEvents[0]!;
  assert.ok(brakeEvent.writer_role, `brake ${source}: writer_role must be non-empty`);
  assert.ok(brakeEvent.reason && brakeEvent.reason.length > 0, `brake ${source}: reason must be non-empty`);

  // 3. audit_log has pick.governance_brake.applied with payload.pickId
  const auditRows = await restQuery<AuditRow>(
    `audit_log?action=eq.pick.governance_brake.applied&select=id,action,payload,entity_type,entity_id&order=created_at.desc&limit=200`,
  );
  const matchingAudit = auditRows.find(
    (row) => (row.payload as { pickId?: string } | null)?.pickId === pickId,
  );
  assert.ok(
    matchingAudit,
    `brake ${source}: no pick.governance_brake.applied audit row with payload.pickId=${pickId}`,
  );

  // 4. distribution_outbox has zero rows for this pick
  const outboxRows = await restQuery<OutboxRow>(
    `distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id,status`,
  );
  assert.equal(
    outboxRows.length,
    0,
    `brake ${source}: expected 0 outbox rows, got ${outboxRows.length}`,
  );

  return pickId;
}

// ─── STEP 1: brake-path integrity for each non-human source ──────────

test('UTV2-519 brake path: system-pick-scanner', { skip: skipReason }, async () => {
  const id = await runBrakeCase('system-pick-scanner');
  console.log(`  system-pick-scanner brake OK — pickId=${id}`);
});

test('UTV2-519 brake path: alert-agent', { skip: skipReason }, async () => {
  const id = await runBrakeCase('alert-agent');
  console.log(`  alert-agent brake OK — pickId=${id}`);
});

test('UTV2-519 brake path: model-driven', { skip: skipReason }, async () => {
  const id = await runBrakeCase('model-driven');
  console.log(`  model-driven brake OK — pickId=${id}`);
});

// ─── STEP 2: atomic-rollback regression ──────────────────────────────
//
// Submit a fresh brake-path pick (which lands it in awaiting_approval), then
// deliberately call transitionPickLifecycle with a MISMATCHED fromState
// ('queued' instead of the real 'awaiting_approval'). The atomic RPC must
// raise INVALID_LIFECYCLE_TRANSITION (P0001), the TypeScript caller must
// surface this as InvalidTransitionError, picks.status must not change, and
// no new pick_lifecycle row must be written.

test('UTV2-519 atomic rollback: mismatched fromState leaves picks.status and pick_lifecycle untouched', { skip: skipReason }, async () => {
  // Create a fresh fixture pick via the brake path so we are guaranteed to
  // own the row without touching any pre-existing stranded data.
  const runId = randomUUID();
  const fixtureId = `utv2-519-rollback-${runId}`;
  const payload: SubmissionPayload = {
    source: 'system-pick-scanner',
    market: 'nba-total',
    selection: `UTV2-519 ROLLBACK ${runId}`,
    line: 220.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: { proof_fixture_id: fixtureId, proof_issue: 'UTV2-519' },
  };
  const resp = await submitPickController(payload, repositories);
  assert.equal(resp.status, 201);
  const pickId = (resp.body as { ok: true; data: { pickId: string } }).data.pickId;
  createdPickIds.push(pickId);

  // Snapshot pick_lifecycle count before the mismatched attempt.
  const beforeEvents = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason`,
  );
  const beforeCount = beforeEvents.length;

  // FSM guard check in lifecycle.ts evaluates allowedTransitions before it
  // calls the atomic RPC. So to force the atomic path to raise the
  // INVALID_LIFECYCLE_TRANSITION, we need a target that is allowed by the
  // TypeScript FSM from our claimed fromState. awaiting_approval -> queued
  // is allowed by the FSM. The pick is actually in awaiting_approval, so
  // the ClaimPickTransition pre-check in transitionPickLifecycle will pass
  // (from = awaiting_approval, to = queued are FSM-valid), then we pass the
  // REAL fromState to the atomic RPC which will match. That is NOT a
  // mismatch test.
  //
  // Better: call the repository's transitionPickLifecycleAtomic directly
  // with a fabricated fromState mismatch. This bypasses the FSM pre-check
  // and lets us observe the Postgres-level exception rollback.
  // The method is optional on the interface (see UTV2-520 for tightening).
  // DatabasePickRepository implements it; assert it exists before invoking.
  const atomicTransition = repositories.picks.transitionPickLifecycleAtomic;
  assert.ok(
    typeof atomicTransition === 'function',
    'DatabasePickRepository.transitionPickLifecycleAtomic must be implemented for this proof',
  );
  await assert.rejects(
    () =>
      atomicTransition.call(repositories.picks, {
        pickId,
        fromState: 'queued', // wrong — real state is awaiting_approval
        toState: 'posted',
        writerRole: 'proof-runner',
        reason: 'UTV2-519 atomic rollback regression',
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err instanceof InvalidTransitionError ||
          (err as Error).message.includes('INVALID_LIFECYCLE_TRANSITION'),
        `expected InvalidTransitionError or INVALID_LIFECYCLE_TRANSITION, got: ${(err as Error).message}`,
      );
      return true;
    },
  );

  // Assert picks.status did not change.
  const afterPick = await restQuery<PickRow>(
    `picks?id=eq.${pickId}&select=id,status,source`,
  );
  assert.equal(afterPick.length, 1);
  assert.equal(
    afterPick[0]!.status,
    'awaiting_approval',
    'picks.status must be unchanged after rollback',
  );

  // Assert no new pick_lifecycle row was inserted.
  const afterEvents = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason`,
  );
  assert.equal(
    afterEvents.length,
    beforeCount,
    `pick_lifecycle row count must not change after rollback (before=${beforeCount}, after=${afterEvents.length})`,
  );

  // Sanity: the real transition still works (proves the atomic path is
  // live and the rollback did not leave a persistent lock).
  const realTransition = await transitionPickLifecycle(
    repositories.picks,
    pickId,
    'voided',
    'UTV2-519 cleanup to voided (allowed)',
    'promoter',
  );
  assert.equal(realTransition.lifecycleState, 'voided');

  console.log(`  atomic rollback OK — pickId=${pickId} (cleaned up to voided)`);
});

// ─── STEP 3: diagnostics ─────────────────────────────────────────────

test('UTV2-519 created pick ids (diagnostics)', { skip: skipReason }, () => {
  console.log(`  UTV2-519 test run created pick ids: ${JSON.stringify(createdPickIds)}`);
});
