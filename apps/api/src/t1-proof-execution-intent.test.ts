/**
 * T1 Pre-Merge Proof: ExecutionIntent Entity (UTV2-1132 — INIT-4.1.1)
 *
 * Verifies against live Supabase:
 *  1. Append-only INSERT works (initial intent)
 *  2. Immutability trigger fires on UPDATE (append-only enforcement)
 *  3. Immutability trigger fires on DELETE (append-only enforcement)
 *  4. Idempotency key UNIQUE partial index prevents duplicate confirmed receipt
 *  5. Predecessor chain persists and reconstructs correctly
 *  6. inputs_hash CHECK constraint rejects malformed hash
 *  7. status CHECK constraint rejects invalid status
 *
 * Run: pnpm test:db
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function insertIntent(fields: {
  id: string;
  predecessor_id: string | null;
  pick_id: string;
  decision_record_id: string;
  intent_type: string;
  status: string;
  idempotency_key: string | null;
  inputs_hash: string;
  provenance: object;
  payload: object;
  issued_at_ms: number;
}): Promise<{ status: number; body: string }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/execution_intents`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(fields),
  });
  return { status: res.status, body: await res.text() };
}

const VALID_HASH = 'a'.repeat(64);
const VALID_PROVENANCE = { authority: 'system', policy_version: '1.0.0', executor_version: '4.0.0' };
const TEST_PICK_ID = randomUUID();
const TEST_DR_ID = `dr-${randomUUID()}`;

test('UTV2-1132: execution_intents table exists and INSERT works', async () => {
  const id = randomUUID();
  const result = await insertIntent({
    id,
    predecessor_id: null,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 'initial',
    status: 'pending',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_000,
  });
  assert.equal(result.status, 201, `INSERT failed: ${result.body}`);
  const rows = JSON.parse(result.body) as Array<{ id: string; status: string }>;
  assert.equal(rows[0]?.id, id);
  assert.equal(rows[0]?.status, 'pending');
});

test('UTV2-1132: immutability trigger rejects UPDATE', async () => {
  const id = randomUUID();
  await insertIntent({
    id,
    predecessor_id: null,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 'initial',
    status: 'pending',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_001,
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/execution_intents?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.ok(res.status >= 400, `UPDATE should have been rejected but got status ${res.status}`);
});

test('UTV2-1132: immutability trigger rejects DELETE', async () => {
  const id = randomUUID();
  await insertIntent({
    id,
    predecessor_id: null,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 'initial',
    status: 'pending',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_002,
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/execution_intents?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  assert.ok(res.status >= 400, `DELETE should have been rejected but got status ${res.status}`);
});

test('UTV2-1132: idempotency_key unique index prevents duplicate re-confirm', async () => {
  const ikey = `ikey-${randomUUID()}`;
  const id1 = randomUUID();
  const id2 = randomUUID();
  const r1 = await insertIntent({
    id: id1,
    predecessor_id: null,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 're_confirm',
    status: 'pending',
    idempotency_key: ikey,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_003,
  });
  assert.equal(r1.status, 201, `First insert failed: ${r1.body}`);
  const r2 = await insertIntent({
    id: id2,
    predecessor_id: null,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 're_confirm',
    status: 'pending',
    idempotency_key: ikey,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_004,
  });
  assert.ok(r2.status >= 400, `Duplicate idempotency_key should be rejected but got ${r2.status}`);
});

test('UTV2-1132: predecessor_id chain persists correctly', async () => {
  const rootId = randomUUID();
  const followId = randomUUID();
  await insertIntent({
    id: rootId,
    predecessor_id: null,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 'initial',
    status: 'pending',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_005,
  });
  const r = await insertIntent({
    id: followId,
    predecessor_id: rootId,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 'recovery',
    status: 'pending',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_006,
  });
  assert.equal(r.status, 201, `Chain follow-on insert failed: ${r.body}`);
  const rows = JSON.parse(r.body) as Array<{ id: string; predecessor_id: string }>;
  assert.equal(rows[0]?.predecessor_id, rootId);
});

test('UTV2-1132: inputs_hash CHECK rejects non-hex hash', async () => {
  const r = await insertIntent({
    id: randomUUID(),
    predecessor_id: null,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 'initial',
    status: 'pending',
    idempotency_key: null,
    inputs_hash: 'not-a-valid-hash',
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_007,
  });
  assert.ok(r.status >= 400, `Invalid inputs_hash should be rejected but got ${r.status}`);
});

test('UTV2-1132: status CHECK rejects invalid status value', async () => {
  const r = await insertIntent({
    id: randomUUID(),
    predecessor_id: null,
    pick_id: TEST_PICK_ID,
    decision_record_id: TEST_DR_ID,
    intent_type: 'initial',
    status: 'invalid_status',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_008,
  });
  assert.ok(r.status >= 400, `Invalid status should be rejected but got ${r.status}`);
});
