/**
 * T1 Pre-Merge Proof: UTV2-1084 raw_payloads append-only store
 *
 * Exercises DatabaseRawPayloadRepository and the raw_payloads immutability
 * trigger against the live Supabase DB:
 *   1. INSERT via repository succeeds and returns the row with correct hash
 *   2. Direct UPDATE is rejected by the DB-level immutability trigger
 *   3. Direct DELETE is rejected by the DB-level immutability trigger
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Proof rows are tagged with
 * 'utv2-1084-t1-proof' and are NOT deleted — immutability is the invariant
 * being proved; deleting proof rows would contradict it.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/ingestor/src/t1-proof-utv2-1084-raw-payload-archive.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
  createDatabaseIngestorRepositoryBundle,
  type DatabaseConnectionConfig,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';
import type { RawPayloadRepository } from '@unit-talk/db';

function hasSupabaseEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let rawPayloads: RawPayloadRepository;
let supabaseClient: UnitTalkSupabaseClient;
let connection: DatabaseConnectionConfig;

before(async () => {
  if (skipReason) return;
  const env = loadEnvironment();
  connection = createServiceRoleDatabaseConnectionConfig(env);
  const bundle = createDatabaseIngestorRepositoryBundle(connection);
  rawPayloads = bundle.rawPayloads;
  supabaseClient = createDatabaseClientFromConnection(connection);
});

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const FAKE_RAW_BODY = JSON.stringify({
  events: [{ id: 'utv2-1084-t1-proof', home: 'TeamA', away: 'TeamB', odds: -110 }],
});

test('T1 proof — INSERT raw_payloads row succeeds with correct hash', { skip: skipReason }, async () => {
  const runId = randomUUID();
  const expectedHash = sha256Hex(FAKE_RAW_BODY);

  const row = await rawPayloads.insert({
    providerKey: 'utv2-1084-t1-proof',
    league: 'NBA',
    runId,
    kind: 'odds',
    payloadHash: expectedHash,
    payload: JSON.parse(FAKE_RAW_BODY) as Record<string, unknown>,
    snapshotAt: new Date().toISOString(),
  });

  assert.ok(row.id, 'inserted row must have an id');
  assert.equal(row.provider_key, 'utv2-1084-t1-proof');
  assert.equal(row.payload_hash, expectedHash, 'stored hash must match SHA-256 of raw body');
  assert.equal(row.run_id, runId);
});

test('T1 proof — UPDATE blocked by immutability trigger', { skip: skipReason }, async () => {
  const { error } = await supabaseClient
    .from('raw_payloads')
    .update({ payload_hash: 'mutated-by-t1-proof' })
    .eq('provider_key', 'utv2-1084-t1-proof');

  assert.ok(error, 'UPDATE must be rejected — got null error (immutability trigger not firing)');
  assert.ok(
    error.message.includes('immutable') || error.message.includes('UTV2-1084'),
    `trigger error must reference immutability, got: ${error.message}`,
  );
});

test('T1 proof — DELETE blocked by immutability trigger', { skip: skipReason }, async () => {
  const { error } = await supabaseClient
    .from('raw_payloads')
    .delete()
    .eq('provider_key', 'utv2-1084-t1-proof');

  assert.ok(error, 'DELETE must be rejected — got null error (immutability trigger not firing)');
  assert.ok(
    error.message.includes('immutable') || error.message.includes('UTV2-1084'),
    `trigger error must reference immutability, got: ${error.message}`,
  );
});
