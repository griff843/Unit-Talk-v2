/**
 * T1 Pre-Merge Proof: UTV2-1085 odds_snapshots append-only store
 *
 * Exercises DatabaseOddsSnapshotRepository and the odds_snapshots
 * immutability trigger against the live Supabase DB:
 *   1. INSERT via repository succeeds and returns the row
 *   2. Correction appends a new row referencing prior_snapshot_id (lineage intact)
 *   3. Direct UPDATE is rejected by the DB-level immutability trigger
 *   4. Direct DELETE is rejected by the DB-level immutability trigger
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Proof rows are NOT deleted —
 * immutability is the invariant; deleting them would contradict it.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/ingestor/src/t1-proof-utv2-1085-odds-snapshot.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
  createDatabaseIngestorRepositoryBundle,
  type DatabaseConnectionConfig,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

function hasSupabaseEnvironment(): boolean {
  try {
    loadEnvironment();
    return Boolean(process.env['SUPABASE_SERVICE_ROLE_KEY']);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let connection: DatabaseConnectionConfig;
let serviceClient: UnitTalkSupabaseClient;

before(() => {
  if (skipReason) return;
  loadEnvironment();
  connection = createServiceRoleDatabaseConnectionConfig();
  serviceClient = createDatabaseClientFromConnection(connection);
});

test('odds_snapshots: INSERT succeeds via repository', { skip: skipReason }, async () => {
  const repositories = createDatabaseIngestorRepositoryBundle(connection);
  const runId = randomUUID();
  const snapshotAt = new Date().toISOString();

  const record = await repositories.oddsSnapshots.insert({
    providerKey: 'odds-api',
    marketKey: 'h2h',
    league: 'NBA',
    runId,
    snapshotAt,
    priceBlob: { events: [{ id: 'utv2-1085-proof', homeOdds: -110, awayOdds: -110 }] },
  });

  assert.ok(record.id, 'row has id');
  assert.equal(record.provider_key, 'odds-api');
  assert.equal(record.league, 'NBA');
  assert.equal(record.run_id, runId);
  assert.equal(record.prior_snapshot_id, null, 'initial snapshot has no prior');
});

test('odds_snapshots: correction appends new row with prior_snapshot_id lineage', { skip: skipReason }, async () => {
  const repositories = createDatabaseIngestorRepositoryBundle(connection);
  const runId = randomUUID();
  const snapshotAt = new Date().toISOString();

  const original = await repositories.oddsSnapshots.insert({
    providerKey: 'odds-api',
    marketKey: 'h2h',
    league: 'NBA',
    runId,
    snapshotAt,
    priceBlob: { events: [{ id: 'utv2-1085-correction-proof', homeOdds: -120 }] },
  });

  const corrected = await repositories.oddsSnapshots.insert({
    providerKey: 'odds-api',
    marketKey: 'h2h',
    league: 'NBA',
    runId,
    snapshotAt: new Date().toISOString(),
    priceBlob: { events: [{ id: 'utv2-1085-correction-proof', homeOdds: -115 }] },
    priorSnapshotId: original.id,
  });

  assert.ok(corrected.id, 'correction row has id');
  assert.notEqual(corrected.id, original.id, 'correction is a new row');
  assert.equal(corrected.prior_snapshot_id, original.id, 'correction references original via prior_snapshot_id');

  // Verify original is unmodified (immutable)
  const { data: reread } = await serviceClient
    .from('odds_snapshots')
    .select('*')
    .eq('id', original.id)
    .single();
  assert.ok(reread, 'original row still exists after correction');
  assert.equal((reread as Record<string, unknown>)['id'], original.id, 'original row id unchanged');
});

test('odds_snapshots: UPDATE blocked by immutability trigger', { skip: skipReason }, async () => {
  const repositories = createDatabaseIngestorRepositoryBundle(connection);
  const runId = randomUUID();

  const record = await repositories.oddsSnapshots.insert({
    providerKey: 'odds-api',
    marketKey: 'h2h',
    league: 'NBA',
    runId,
    snapshotAt: new Date().toISOString(),
    priceBlob: { events: [{ id: 'utv2-1085-update-proof' }] },
  });

  const { error } = await serviceClient
    .from('odds_snapshots')
    .update({ market_key: 'mutated' })
    .eq('id', record.id);

  assert.ok(error, 'UPDATE must be rejected by trigger');
  assert.ok(
    error.message.includes('immutable') || error.message.includes('UTV2-1085'),
    `trigger message must mention immutable or UTV2-1085, got: ${error.message}`,
  );
});

test('odds_snapshots: DELETE blocked by immutability trigger', { skip: skipReason }, async () => {
  const repositories = createDatabaseIngestorRepositoryBundle(connection);
  const runId = randomUUID();

  const record = await repositories.oddsSnapshots.insert({
    providerKey: 'odds-api',
    marketKey: 'h2h',
    league: 'NBA',
    runId,
    snapshotAt: new Date().toISOString(),
    priceBlob: { events: [{ id: 'utv2-1085-delete-proof' }] },
  });

  const { error } = await serviceClient
    .from('odds_snapshots')
    .delete()
    .eq('id', record.id);

  assert.ok(error, 'DELETE must be rejected by trigger');
  assert.ok(
    error.message.includes('immutable') || error.message.includes('UTV2-1085'),
    `trigger message must mention immutable or UTV2-1085, got: ${error.message}`,
  );
});
