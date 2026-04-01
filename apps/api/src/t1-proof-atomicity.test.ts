/**
 * T1 Pre-Merge Proof: Atomicity RPCs (UTV2-217, 218, 219, 220, 221)
 *
 * Runs ONLY against live Supabase — uses direct REST/RPC calls via fetch.
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-atomicity.test.ts
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment, type AppEnv } from '@unit-talk/config';

let SUPABASE_URL: string;
let SUPABASE_KEY: string;

type RpcError = { message: string; code?: string };

interface SubmissionAtomicResponse {
  submission: { id: string };
  pick: { id: string; status: string };
  lifecycleEvent: { id: string };
}

interface EnqueueAtomicResponse {
  pick: { status: string };
  outbox: { status: string };
}

interface ConfirmDeliveryAtomicResponse {
  alreadyConfirmed: boolean;
  outbox: { status: string };
}

interface SettlePickAtomicResponse {
  duplicate: boolean;
  settlement: { id: string };
  lifecycleEvent: { id: string };
  pick: { status: string };
}

interface PickIdRow {
  id: string;
}

interface PickStatusRow {
  status: string;
}

interface PickPostedRow {
  status: string;
  posted_at: string | null;
}

interface PickSettledRow {
  status: string;
  settled_at: string | null;
}

interface OutboxRow {
  id: string;
  status: string;
}

function headers() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<{ data: T | null; error: RpcError | null }> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params),
  });
  const body = (await resp.json()) as unknown;
  if (!resp.ok) {
    return { data: null, error: body as RpcError };
  }
  return { data: body as T, error: null };
}

async function query<T>(table: string, filter: string): Promise<T[]> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: headers(),
  });
  return (await resp.json()) as T[];
}

async function insert(table: string, row: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(row),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`INSERT ${table} failed: ${JSON.stringify(body)}`);
  return Array.isArray(body) ? body[0] : body;
}

before(() => {
  const env = loadEnvironment();
  assert.ok(env.SUPABASE_URL, 'SUPABASE_URL required');
  assert.ok(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY required');
  SUPABASE_URL = env.SUPABASE_URL!;
  SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;
});

// ─── STEP 1: RPC EXISTENCE ─────────────────────────────────────────

describe('STEP 1 — RPC existence', () => {
  for (const name of [
    'process_submission_atomic',
    'enqueue_distribution_atomic',
    'claim_next_outbox',
    'confirm_delivery_atomic',
    'settle_pick_atomic',
  ]) {
    test(`${name} exists`, async () => {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: headers(),
        body: '{}',
      });
      const body = await resp.json() as { message?: string; code?: string };
      const notFound = body.message?.includes('does not exist') || body.code === '42883';
      assert.ok(!notFound, `RPC ${name} does not exist: ${body.message}`);
      console.log(`  ✓ ${name}`);
    });
  }
});

// ─── STEP 2: SUBMISSION ATOMICITY (UTV2-218) ───────────────────────

describe('STEP 2 — Submission atomicity (UTV2-218)', () => {
  const pickId = randomUUID();
  const submissionId = randomUUID();
  const idempotencyKey = `t1-sub-${randomUUID()}`;

  test('A. atomic submission creates all records', async () => {
    const now = new Date().toISOString();
    const { data, error } = await rpc<SubmissionAtomicResponse>('process_submission_atomic', {
      p_submission: {
        id: submissionId, source: 't1-proof', submitted_by: 'proof-runner',
        payload: { market: 'nba-spread', selection: 'LAL -3.5' },
        status: 'validated', received_at: now, created_at: now, updated_at: now,
      },
      p_event: {
        submission_id: submissionId, event_name: 'submission.accepted',
        payload: { source: 't1-proof' }, created_at: now,
      },
      p_pick: {
        id: pickId, submission_id: submissionId, market: 'nba-spread',
        selection: 'LAL -3.5', source: 't1-proof', approval_status: 'approved',
        promotion_status: 'not_eligible', status: 'validated',
        metadata: { proof: true }, created_at: now, updated_at: now,
      },
      p_idempotency_key: idempotencyKey,
      p_lifecycle_event: {
        pick_id: pickId, from_state: null, to_state: 'validated',
        writer_role: 'submitter', reason: 'submission accepted', created_at: now,
      },
    });

    assert.ok(!error, `RPC failed: ${error?.message}`);
    assert.ok(data, 'RPC returned null');
    assert.ok(data.submission, 'Missing submission');
    assert.ok(data.pick, 'Missing pick');
    assert.ok(data.lifecycleEvent, 'Missing lifecycleEvent');
    assert.equal(data.pick.id, pickId);
    assert.equal(data.pick.status, 'validated');
    console.log(`  ✓ Submission ${submissionId}, Pick ${pickId} created atomically`);
  });

  test('B. duplicate returns existing pick (idempotent)', async () => {
    const now = new Date().toISOString();
    const { data, error } = await rpc<SubmissionAtomicResponse>('process_submission_atomic', {
      p_submission: {
        id: randomUUID(), source: 't1-proof', submitted_by: 'proof-runner',
        payload: {}, status: 'validated', received_at: now, created_at: now, updated_at: now,
      },
      p_event: {
        submission_id: submissionId, event_name: 'submission.accepted',
        payload: {}, created_at: now,
      },
      p_pick: {
        id: randomUUID(), submission_id: submissionId, market: 'nba-spread',
        selection: 'LAL -3.5', source: 't1-proof', approval_status: 'approved',
        promotion_status: 'not_eligible', status: 'validated',
        metadata: {}, created_at: now, updated_at: now,
      },
      p_idempotency_key: idempotencyKey, // SAME KEY
      p_lifecycle_event: null,
    });

    assert.ok(!error, `Duplicate failed: ${error?.message}`);
    assert.ok(data, 'Duplicate returned null');
    assert.equal(data.pick.id, pickId, `Idempotency FAILED: expected ${pickId}, got ${data.pick.id}`);
    console.log(`  ✓ Duplicate returned original pick ${pickId}`);
  });

  test('C. exactly 1 pick for idempotency key', async () => {
    const picks = await query<PickIdRow>('picks', `idempotency_key=eq.${idempotencyKey}&select=id`);
    assert.equal(picks.length, 1, `Expected 1 pick, got ${picks.length}`);
    console.log(`  ✓ 1 pick record — no orphans`);
  });
});

// ─── STEP 3: ENQUEUE ATOMICITY (UTV2-219) ──────────────────────────

describe('STEP 3 — Enqueue atomicity (UTV2-219)', () => {
  let enqueuePickId: string;

  before(async () => {
    enqueuePickId = randomUUID();
    const subId = randomUUID();
    const now = new Date().toISOString();
    await insert('submissions', {
      id: subId, source: 't1-enq', payload: {}, status: 'validated', received_at: now,
    });
    await insert('picks', {
      id: enqueuePickId, submission_id: subId, market: 'nba-total',
      selection: 'Over 220.5', source: 't1-proof', status: 'validated',
      approval_status: 'approved', promotion_status: 'qualified',
      promotion_target: 'best-bets', metadata: {},
      created_at: now, updated_at: now,
    });
  });

  test('A. atomic enqueue transitions + creates outbox', async () => {
    const { data, error } = await rpc<EnqueueAtomicResponse>('enqueue_distribution_atomic', {
      p_pick_id: enqueuePickId, p_from_state: 'validated', p_to_state: 'queued',
      p_writer_role: 'promoter', p_reason: 'proof: ready',
      p_lifecycle_created_at: new Date().toISOString(),
      p_outbox_target: 'discord:canary',
      p_outbox_payload: { pickId: enqueuePickId },
      p_outbox_idempotency_key: `t1-enq-${enqueuePickId}`,
    });

    assert.ok(!error, `Enqueue failed: ${error?.message}`);
    assert.ok(data, 'Enqueue returned null');
    assert.equal(data.pick.status, 'queued');
    assert.equal(data.outbox.status, 'pending');
    console.log(`  ✓ Pick queued + outbox pending — atomic`);
  });

  test('B. no zombie pick (outbox exists for queued pick)', async () => {
    const picks = await query<PickStatusRow>('picks', `id=eq.${enqueuePickId}&select=status`);
    assert.equal(picks[0]?.status, 'queued');

    const outbox = await query<OutboxRow>('distribution_outbox', `pick_id=eq.${enqueuePickId}&select=id,status`);
    assert.ok(outbox.length >= 1, 'ZOMBIE: queued pick has no outbox row');
    console.log(`  ✓ Consistent: pick=queued, outbox rows=${outbox.length}`);
  });

  test('C. re-enqueue returns null (already queued)', async () => {
    const { data, error } = await rpc<null>('enqueue_distribution_atomic', {
      p_pick_id: enqueuePickId, p_from_state: 'validated', p_to_state: 'queued',
      p_writer_role: 'promoter', p_reason: 'retry',
      p_lifecycle_created_at: new Date().toISOString(),
      p_outbox_target: 'discord:canary', p_outbox_payload: {},
      p_outbox_idempotency_key: `t1-enq-retry-${enqueuePickId}`,
    });

    assert.ok(!error, `Re-enqueue error: ${error?.message}`);
    assert.equal(data, null, 'Expected null — pick not in validated state');
    console.log(`  ✓ Re-enqueue correctly returned null`);
  });
});

// ─── STEP 4: DELIVERY IDEMPOTENCY (UTV2-220) ───────────────────────

describe('STEP 4 — Delivery idempotency (UTV2-220)', () => {
  let dlvPickId: string;
  let dlvOutboxId: string;

  before(async () => {
    dlvPickId = randomUUID();
    dlvOutboxId = randomUUID();
    const subId = randomUUID();
    const now = new Date().toISOString();
    await insert('submissions', {
      id: subId, source: 't1-dlv', payload: {}, status: 'validated', received_at: now,
    });
    await insert('picks', {
      id: dlvPickId, submission_id: subId, market: 'nba-ml', selection: 'LAL',
      source: 't1-proof', status: 'queued', approval_status: 'approved',
      promotion_status: 'qualified', metadata: {},
      created_at: now, updated_at: now,
    });
    await insert('distribution_outbox', {
      id: dlvOutboxId, pick_id: dlvPickId, target: 'discord:canary',
      status: 'processing', claimed_at: now, claimed_by: 'proof-worker',
      payload: {}, idempotency_key: `t1-dlv-${dlvPickId}`,
    });
  });

  test('A. claim returns null for empty target', async () => {
    const { data, error } = await rpc<null>('claim_next_outbox', {
      p_target: `none-${randomUUID()}`, p_worker_id: 'proof',
    });
    assert.ok(!error, `Claim error: ${error?.message}`);
    assert.equal(data, null);
    console.log(`  ✓ claim_next_outbox returns null for empty target`);
  });

  test('B. confirm_delivery_atomic — marks sent + lifecycle + receipt', async () => {
    const { data, error } = await rpc<ConfirmDeliveryAtomicResponse>('confirm_delivery_atomic', {
      p_outbox_id: dlvOutboxId, p_pick_id: dlvPickId, p_worker_id: 'proof-worker',
      p_receipt_type: 'discord.message', p_receipt_status: 'sent',
      p_receipt_channel: 'discord:#canary', p_receipt_external_id: 'msg-proof-123',
      p_receipt_idempotency_key: `t1-rcpt-${dlvOutboxId}`,
      p_receipt_payload: { proof: true },
      p_lifecycle_from_state: 'queued', p_lifecycle_to_state: 'posted',
      p_lifecycle_writer_role: 'poster', p_lifecycle_reason: 'delivery confirmed',
      p_audit_action: 'distribution.sent', p_audit_payload: { proof: true },
    });

    assert.ok(!error, `Confirm failed: ${error?.message}`);
    assert.ok(data, 'Confirm returned null');
    assert.equal(data.alreadyConfirmed, false);
    assert.equal(data.outbox.status, 'sent');
    console.log(`  ✓ Outbox=sent, lifecycle=posted, receipt created, audit logged`);
  });

  test('C. re-confirm returns alreadyConfirmed=true (NO double post)', async () => {
    const { data, error } = await rpc<ConfirmDeliveryAtomicResponse>('confirm_delivery_atomic', {
      p_outbox_id: dlvOutboxId, p_pick_id: dlvPickId, p_worker_id: 'proof-worker',
      p_receipt_type: 'discord.message', p_receipt_status: 'sent',
      p_receipt_channel: 'discord:#canary', p_receipt_external_id: 'msg-proof-456',
      p_receipt_idempotency_key: `t1-rcpt-retry-${dlvOutboxId}`,
      p_receipt_payload: {},
      p_lifecycle_from_state: 'queued', p_lifecycle_to_state: 'posted',
      p_lifecycle_writer_role: 'poster', p_lifecycle_reason: 'retry',
      p_audit_action: 'distribution.sent', p_audit_payload: {},
    });

    assert.ok(!error, `Re-confirm error: ${error?.message}`);
    assert.ok(data, 'Re-confirm null');
    assert.equal(data.alreadyConfirmed, true, 'Expected alreadyConfirmed=true');
    console.log(`  ✓ Re-confirm idempotent — NO duplicate delivery`);
  });

  test('D. pick is posted (not stuck in queued)', async () => {
    const picks = await query<PickPostedRow>('picks', `id=eq.${dlvPickId}&select=status,posted_at`);
    assert.equal(picks[0]?.status, 'posted');
    assert.ok(picks[0]?.posted_at, 'posted_at missing');
    console.log(`  ✓ Pick status=posted, posted_at=${picks[0].posted_at}`);
  });
});

// ─── STEP 5: SETTLEMENT ATOMICITY (UTV2-221) ───────────────────────

describe('STEP 5 — Settlement atomicity (UTV2-221)', () => {
  let settlePickId: string;

  before(async () => {
    settlePickId = randomUUID();
    const subId = randomUUID();
    const now = new Date().toISOString();
    await insert('submissions', {
      id: subId, source: 't1-stl', payload: {}, status: 'validated', received_at: now,
    });
    await insert('picks', {
      id: settlePickId, submission_id: subId, market: 'nba-spread',
      selection: 'BOS -5', source: 't1-proof', status: 'posted',
      posted_at: now, approval_status: 'approved', promotion_status: 'qualified',
      metadata: {}, created_at: now, updated_at: now,
    });
  });

  test('A. atomic settlement creates record + transitions', async () => {
    const { data, error } = await rpc<SettlePickAtomicResponse>('settle_pick_atomic', {
      p_pick_id: settlePickId,
      p_settlement: {
        result: 'win', source: 'operator', confidence: 'confirmed',
        settled_by: 'proof-runner', evidence_ref: 'proof-test',
        payload: { proof: true }, settled_at: new Date().toISOString(),
      },
      p_lifecycle_from_state: 'posted', p_lifecycle_to_state: 'settled',
      p_lifecycle_writer_role: 'settler', p_lifecycle_reason: 'proof settlement',
      p_audit_action: 'settlement.recorded', p_audit_actor: 'proof-runner',
      p_audit_payload: { proof: true },
    });

    assert.ok(!error, `Settlement failed: ${error?.message}`);
    assert.ok(data, 'Settlement returned null');
    assert.equal(data.duplicate, false);
    assert.ok(data.settlement, 'Missing settlement');
    assert.ok(data.lifecycleEvent, 'Missing lifecycle event');
    assert.equal(data.pick.status, 'settled');
    console.log(`  ✓ Settlement + lifecycle + audit — atomic`);
  });

  test('B. duplicate returns existing (idempotent)', async () => {
    const { data, error } = await rpc<SettlePickAtomicResponse>('settle_pick_atomic', {
      p_pick_id: settlePickId,
      p_settlement: {
        result: 'win', source: 'operator', confidence: 'confirmed',
        settled_by: 'proof-runner', evidence_ref: 'dup-test',
        payload: {}, settled_at: new Date().toISOString(),
      },
      p_lifecycle_from_state: 'posted', p_lifecycle_to_state: 'settled',
      p_lifecycle_writer_role: 'settler', p_lifecycle_reason: 'dup test',
      p_audit_action: 'settlement.recorded', p_audit_actor: 'proof-runner',
      p_audit_payload: {},
    });

    assert.ok(!error, `Dup settlement error: ${error?.message}`);
    assert.ok(data, 'Dup settlement null');
    assert.equal(data.duplicate, true, 'Expected duplicate=true');
    console.log(`  ✓ Duplicate settlement idempotent`);
  });

  test('C. exactly 1 settlement record', async () => {
    const settlements = await query<PickIdRow>('settlement_records',
      `pick_id=eq.${settlePickId}&corrects_id=is.null&select=id`);
    assert.equal(settlements.length, 1, `Expected 1, got ${settlements.length}`);
    console.log(`  ✓ 1 settlement record — no duplicates`);
  });

  test('D. pick is settled with timestamp', async () => {
    const picks = await query<PickSettledRow>('picks', `id=eq.${settlePickId}&select=status,settled_at`);
    assert.equal(picks[0]?.status, 'settled');
    assert.ok(picks[0]?.settled_at);
    console.log(`  ✓ Pick settled, settled_at=${picks[0].settled_at}`);
  });
});

// ─── STEP 6: FAIL-CLOSED (UTV2-217) ────────────────────────────────

describe('STEP 6 — Fail-closed (UTV2-217)', () => {
  test('API refuses to start in fail_closed without DB', async () => {
    const { createApiRuntimeDependencies } = await import('./server.js');
    const failClosedEnvironment: AppEnv = {
      NODE_ENV: 'production',
      UNIT_TALK_APP_ENV: 'production',
      UNIT_TALK_API_RUNTIME_MODE: 'fail_closed',
      UNIT_TALK_ACTIVE_WORKSPACE: 'test',
      UNIT_TALK_LEGACY_WORKSPACE: 'test',
      LINEAR_TEAM_KEY: 'test',
      LINEAR_TEAM_NAME: 'test',
      NOTION_WORKSPACE_NAME: 'test',
      SLACK_WORKSPACE_NAME: 'test',
    };
    assert.throws(
      () => createApiRuntimeDependencies({
        environment: failClosedEnvironment,
      }),
      (err: Error) => {
        assert.ok(err.message.includes('fail_closed'));
        return true;
      },
    );
    console.log(`  ✓ fail_closed rejects startup without DB — no silent data loss`);
  });
});
