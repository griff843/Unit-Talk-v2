/**
 * T1 Pre-Merge Proof: UTV2-539 / DEBT-002 backfill RPC.
 *
 * Exercises `public.backfill_pick_awaiting_approval(uuid, text)` (shipped in
 * `supabase/migrations/202604110001_utv2_539_backfill_pick_awaiting_approval_rpc.sql`)
 * against live Supabase. Covers the three RPC code paths:
 *
 *   1. INVALID_BACKFILL_STATE / P0001 — pick not found (drift guard, "not found" case)
 *   2. ALREADY_BACKFILLED    / P0001 — idempotency guard: the pick already has an
 *                                      `awaiting_approval` lifecycle row
 *   3. happy path             — synthetic stranded pick (brake-path submission with
 *                                its `validated→awaiting_approval` lifecycle row
 *                                manually removed to simulate the pre-UTV2-519 strand),
 *                                RPC call restores the missing lifecycle event + audit row
 *                                in one transaction
 *
 * The happy path mutates only a fresh synthetic fixture created inside the test.
 * It NEVER touches the 24 pre-existing stranded rows that UTV2-539 will eventually
 * clean up — those are production data and are owned by the PM-witnessed execute
 * session, not this proof. Fixtures are tagged with a `utv2-539-backfill-*` prefix
 * so they can be found after the run; they are NOT deleted (same convention as
 * `t1-proof-awaiting-approval.test.ts`).
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. When the migration has not yet been applied
 * to the target database, the RPC calls will fail with a 404/PGRST202 "function not
 * found" response — that is the signal to apply the migration first. The test fails
 * closed rather than silently passing.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-539-backfill.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from './controllers/submit-pick-controller.js';

function hasSupabaseSmokeEnvironment(): boolean {
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

function authHeaders(): Record<string, string> {
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

async function restDelete(path: string): Promise<void> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), Prefer: 'return=representation' },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`DELETE ${path} failed: ${resp.status} ${body}`);
  }
}

interface RpcResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: { message?: string; code?: string; details?: string; hint?: string };
}

async function callBackfillRpc(pickId: string, linearIssue: string): Promise<RpcResult> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/backfill_pick_awaiting_approval`, {
    method: 'POST',
    headers: { ...authHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ p_pick_id: pickId, p_linear_issue: linearIssue }),
  });
  const text = await resp.text();
  let data: unknown = undefined;
  let error: RpcResult['error'];
  if (text.length > 0) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!resp.ok) {
        error = parsed as RpcResult['error'];
      } else {
        data = parsed;
      }
    } catch {
      if (!resp.ok) {
        error = { message: text };
      } else {
        data = text;
      }
    }
  }
  const result: RpcResult = { ok: resp.ok, status: resp.status, data };
  if (error !== undefined) {
    result.error = error;
  }
  return result;
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
  entity_type: string;
  entity_id: string;
  entity_ref: string | null;
  actor: string | null;
  payload: Record<string, unknown> | null;
}

async function submitBrakeFixture(fixtureTag: string): Promise<string> {
  const payload: SubmissionPayload = {
    source: 'system-pick-scanner',
    market: 'nba-spread',
    selection: `UTV2-539 BACKFILL PROOF ${fixtureTag}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: {
      proof_fixture_id: fixtureTag,
      proof_issue: 'UTV2-539',
    },
  };
  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `fixture ${fixtureTag}: expected 201`);
  assert.ok(response.body.ok, `fixture ${fixtureTag}: response not ok`);
  const data = (
    response.body as { ok: true; data: { pickId: string; lifecycleState: string } }
  ).data;
  assert.equal(
    data.lifecycleState,
    'awaiting_approval',
    `fixture ${fixtureTag}: lifecycleState`,
  );
  createdPickIds.push(data.pickId);
  return data.pickId;
}

// ─── TEST 1 — drift guard / not-found path ──────────────────────────────────

test(
  'UTV2-539 backfill RPC: INVALID_BACKFILL_STATE on unknown pick id',
  { skip: skipReason },
  async () => {
    const bogusPickId = randomUUID();
    const result = await callBackfillRpc(bogusPickId, 'UTV2-539-t1-proof');

    assert.equal(result.ok, false, 'RPC must fail on unknown pick id');
    const message = result.error?.message ?? '';
    const code = result.error?.code ?? '';
    assert.ok(
      message.includes('INVALID_BACKFILL_STATE') ||
        message.includes('pick') ||
        code === 'P0001',
      `expected INVALID_BACKFILL_STATE / P0001, got code=${code} message=${message}`,
    );
    console.log(`  INVALID_BACKFILL_STATE OK — rejected unknown pick id ${bogusPickId}`);
  },
);

// ─── TEST 2 — idempotency guard / already-backfilled path ───────────────────
//
// Submit a fresh brake-path pick. Post-UTV2-519 that lands with an
// `awaiting_approval` lifecycle row already present. Calling the backfill RPC
// on a pick that already has the target lifecycle row must raise
// ALREADY_BACKFILLED without inserting anything.

test(
  'UTV2-539 backfill RPC: ALREADY_BACKFILLED when awaiting_approval lifecycle row already exists',
  { skip: skipReason },
  async () => {
    const fixtureTag = `utv2-539-backfill-idempotent-${randomUUID()}`;
    const pickId = await submitBrakeFixture(fixtureTag);

    // Confirm the brake submission left the pick with a matching awaiting_approval
    // lifecycle row — that's the precondition for the idempotency guard to fire.
    const lifecycleRows = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&to_state=eq.awaiting_approval&select=id,pick_id,from_state,to_state,writer_role,reason`,
    );
    assert.equal(
      lifecycleRows.length,
      1,
      `precondition: expected exactly one awaiting_approval lifecycle row for ${pickId}, got ${lifecycleRows.length}`,
    );

    const result = await callBackfillRpc(pickId, 'UTV2-539-t1-proof');
    assert.equal(result.ok, false, 'RPC must fail on already-backfilled pick');
    const message = result.error?.message ?? '';
    const code = result.error?.code ?? '';
    assert.ok(
      message.includes('ALREADY_BACKFILLED') || code === 'P0001',
      `expected ALREADY_BACKFILLED / P0001, got code=${code} message=${message}`,
    );

    // Verify nothing was inserted — count must be unchanged.
    const afterRows = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&to_state=eq.awaiting_approval&select=id`,
    );
    assert.equal(
      afterRows.length,
      1,
      `ALREADY_BACKFILLED must be a pure guard — no new lifecycle row allowed, got ${afterRows.length}`,
    );

    console.log(`  ALREADY_BACKFILLED OK — rejected duplicate backfill on ${pickId}`);
  },
);

// ─── TEST 3 — happy path ────────────────────────────────────────────────────
//
// Simulate a stranded row by:
//   1. Submitting a fresh brake-path pick (lands with both the null->validated
//      AND the validated->awaiting_approval lifecycle rows, plus a
//      pick.governance_brake.applied audit row).
//   2. Deleting the awaiting_approval lifecycle row and the governance_brake.applied
//      audit row, so the pick matches the pre-UTV2-519 stranded shape (status =
//      awaiting_approval, only null->validated lifecycle row, no brake audit).
//   3. Calling the backfill RPC. This must atomically insert a new
//      validated->awaiting_approval lifecycle row and a pick.governance_brake.backfilled
//      audit row, then return {pickId, lifecycleEventId, backfilledAt}.
//
// The test only mutates the fresh synthetic fixture it just created. It never
// touches any pre-existing stranded row.

test(
  'UTV2-539 backfill RPC: happy path inserts lifecycle + audit row atomically',
  { skip: skipReason },
  async () => {
    const fixtureTag = `utv2-539-backfill-happy-${randomUUID()}`;
    const pickId = await submitBrakeFixture(fixtureTag);

    // Step A: simulate stranded shape — delete the existing awaiting_approval
    // lifecycle row for this synthetic pick.
    const existingLifecycle = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&to_state=eq.awaiting_approval&select=id,pick_id,from_state,to_state,writer_role,reason`,
    );
    assert.equal(
      existingLifecycle.length,
      1,
      `synthetic setup: expected 1 awaiting_approval lifecycle row before strand, got ${existingLifecycle.length}`,
    );
    await restDelete(`pick_lifecycle?id=eq.${existingLifecycle[0]!.id}`);

    // Also delete the existing pick.governance_brake.applied audit row for this
    // pick so the "audit row count before backfill = 0" invariant holds.
    const existingBrakeAudit = await restQuery<AuditRow>(
      `audit_log?action=eq.pick.governance_brake.applied&entity_ref=eq.${pickId}&select=id,action,entity_type,entity_id,entity_ref,actor,payload`,
    );
    for (const row of existingBrakeAudit) {
      await restDelete(`audit_log?id=eq.${row.id}`);
    }

    // Confirm the stranded shape: status=awaiting_approval but no matching
    // lifecycle row, no governance_brake.applied audit.
    const strandedPicks = await restQuery<PickRow>(
      `picks?id=eq.${pickId}&select=id,status,source`,
    );
    assert.equal(strandedPicks.length, 1);
    assert.equal(strandedPicks[0]!.status, 'awaiting_approval');

    const strandedLifecycle = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&to_state=eq.awaiting_approval&select=id`,
    );
    assert.equal(
      strandedLifecycle.length,
      0,
      'synthetic strand: awaiting_approval lifecycle row must be absent before backfill',
    );

    // Step B: call the backfill RPC.
    const result = await callBackfillRpc(pickId, 'UTV2-539-t1-proof');
    assert.equal(
      result.ok,
      true,
      `happy path RPC must succeed, got ${result.status} ${JSON.stringify(result.error)}`,
    );
    const payload = result.data as {
      pickId?: string;
      lifecycleEventId?: string;
      backfilledAt?: string;
    } | null;
    assert.ok(payload && typeof payload === 'object', 'RPC must return a jsonb object');
    assert.equal(payload.pickId, pickId, 'RPC result.pickId');
    assert.ok(payload.lifecycleEventId, 'RPC result.lifecycleEventId must be present');
    assert.ok(payload.backfilledAt, 'RPC result.backfilledAt must be present');

    // Step C: verify the lifecycle row was inserted atomically.
    const afterLifecycle = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&to_state=eq.awaiting_approval&select=id,pick_id,from_state,to_state,writer_role,reason`,
    );
    assert.equal(
      afterLifecycle.length,
      1,
      `happy path: expected exactly one awaiting_approval lifecycle row after backfill, got ${afterLifecycle.length}`,
    );
    const newLifecycle = afterLifecycle[0]!;
    assert.equal(newLifecycle.from_state, 'validated', 'lifecycle.from_state');
    assert.equal(newLifecycle.to_state, 'awaiting_approval', 'lifecycle.to_state');
    assert.equal(
      newLifecycle.writer_role,
      'operator_override',
      'lifecycle.writer_role must be operator_override',
    );
    assert.equal(
      newLifecycle.reason,
      'backfill_utv2_519_remediation',
      'lifecycle.reason must be backfill_utv2_519_remediation',
    );
    assert.equal(
      newLifecycle.id,
      payload.lifecycleEventId,
      'returned lifecycleEventId must match inserted row id',
    );

    // Step D: verify the audit row was inserted atomically.
    const auditRows = await restQuery<AuditRow>(
      `audit_log?action=eq.pick.governance_brake.backfilled&entity_ref=eq.${pickId}&select=id,action,entity_type,entity_id,entity_ref,actor,payload`,
    );
    assert.equal(
      auditRows.length,
      1,
      `happy path: expected exactly one pick.governance_brake.backfilled audit row, got ${auditRows.length}`,
    );
    const auditRow = auditRows[0]!;
    assert.equal(auditRow.action, 'pick.governance_brake.backfilled');
    assert.equal(
      auditRow.entity_id,
      newLifecycle.id,
      'audit.entity_id must be the new lifecycle event id',
    );
    assert.equal(auditRow.entity_ref, pickId, 'audit.entity_ref must be pickId::text');
    const auditPayload = auditRow.payload ?? {};
    assert.equal(
      (auditPayload as { linear_issue?: string }).linear_issue,
      'UTV2-539-t1-proof',
      'audit.payload.linear_issue',
    );
    assert.equal(
      (auditPayload as { corrective_of?: string }).corrective_of,
      'UTV2-519',
      'audit.payload.corrective_of',
    );
    assert.ok(
      (auditPayload as { backfill_ran_at?: string }).backfill_ran_at,
      'audit.payload.backfill_ran_at',
    );
    assert.equal(
      (auditPayload as { original_pick_lifecycle_strand?: boolean })
        .original_pick_lifecycle_strand,
      true,
      'audit.payload.original_pick_lifecycle_strand',
    );

    // Step E: calling the RPC again on the same pick must now raise
    // ALREADY_BACKFILLED (idempotency is enforced across calls, not just
    // across unrelated picks).
    const secondResult = await callBackfillRpc(pickId, 'UTV2-539-t1-proof');
    assert.equal(
      secondResult.ok,
      false,
      'second backfill on the same pick must raise ALREADY_BACKFILLED',
    );
    const secondMessage = secondResult.error?.message ?? '';
    const secondCode = secondResult.error?.code ?? '';
    assert.ok(
      secondMessage.includes('ALREADY_BACKFILLED') || secondCode === 'P0001',
      `expected ALREADY_BACKFILLED / P0001 on second call, got code=${secondCode} message=${secondMessage}`,
    );

    console.log(
      `  happy path OK — pickId=${pickId} lifecycleEventId=${payload.lifecycleEventId}`,
    );
  },
);

// ─── STEP 4: diagnostics ────────────────────────────────────────────────────

test('UTV2-539 backfill proof created pick ids (diagnostics)', { skip: skipReason }, () => {
  console.log(
    `  UTV2-539 backfill proof run created pick ids: ${JSON.stringify(createdPickIds)}`,
  );
});
