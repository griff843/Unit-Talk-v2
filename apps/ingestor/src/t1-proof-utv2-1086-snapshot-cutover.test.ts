/**
 * T1 Pre-Merge Proof: UTV2-1086 — Snapshot Cutover and Point-in-Time Reconstruction
 *
 * Proves queryAtTimestamp against the live Supabase DB:
 *   1. Inserts 50 snapshots at distinct timestamps across a time range
 *   2. For each timestamp, queries via queryAtTimestamp and verifies the correct snapshot is returned
 *   3. Verifies reconstruction returns null for a timestamp before the earliest snapshot
 *   4. Adversarial: verifies a later snapshot does NOT appear in an earlier timestamp query
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/ingestor/src/t1-proof-utv2-1086-snapshot-cutover.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseIngestorRepositoryBundle,
  type DatabaseConnectionConfig,
} from '@unit-talk/db';

function hasSupabaseEnvironment(): boolean {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

const PROOF_PROVIDER = 'odds-api';
const PROOF_LEAGUE = 'NBA';
const SNAPSHOT_COUNT = 50;

let connection: DatabaseConnectionConfig;

before(() => {
  if (skipReason) return;
  loadEnvironment();
  connection = createServiceRoleDatabaseConnectionConfig();
});

test(
  'queryAtTimestamp: 50-timestamp point-in-time reconstruction',
  { skip: skipReason },
  async () => {
    const repositories = createDatabaseIngestorRepositoryBundle(connection);
    const runId = randomUUID();
    const baseMs = Date.now() - SNAPSHOT_COUNT * 60_000;

    const inserted: { snapshotAt: string; id: string }[] = [];

    for (let i = 0; i < SNAPSHOT_COUNT; i++) {
      const snapshotAt = new Date(baseMs + i * 60_000).toISOString();
      const record = await repositories.oddsSnapshots.insert({
        providerKey: PROOF_PROVIDER,
        marketKey: 'h2h',
        league: PROOF_LEAGUE,
        runId,
        snapshotAt,
        priceBlob: { proofIndex: i, runId },
        ...(i > 0 ? { priorSnapshotId: inserted[i - 1]!.id } : {}),
      });
      inserted.push({ snapshotAt, id: record.id });
    }

    assert.equal(inserted.length, SNAPSHOT_COUNT, 'all 50 snapshots inserted');

    for (let i = 0; i < SNAPSHOT_COUNT; i++) {
      const { snapshotAt, id } = inserted[i]!;
      const reconstructed = await repositories.oddsSnapshots.queryAtTimestamp(
        snapshotAt,
        PROOF_PROVIDER,
        PROOF_LEAGUE,
      );
      assert.ok(reconstructed, `snapshot ${i} reconstructed at its own timestamp`);
      assert.equal(
        reconstructed.id,
        id,
        `snapshot ${i}: queryAtTimestamp returned correct record (id match)`,
      );
    }
  },
);

test(
  'queryAtTimestamp: returns null before earliest snapshot',
  { skip: skipReason },
  async () => {
    const repositories = createDatabaseIngestorRepositoryBundle(connection);
    const veryOldTimestamp = new Date(0).toISOString();
    const result = await repositories.oddsSnapshots.queryAtTimestamp(
      veryOldTimestamp,
      'proof-provider-no-history',
      'PROOF_LEAGUE_NO_HISTORY',
    );
    assert.equal(result, null, 'no snapshot before epoch returns null');
  },
);

test(
  'queryAtTimestamp: adversarial — later snapshot not visible at earlier timestamp',
  { skip: skipReason },
  async () => {
    const repositories = createDatabaseIngestorRepositoryBundle(connection);
    const runId = randomUUID();
    const providerKey = `proof-adversarial-${runId.slice(0, 8)}`;

    const t1 = new Date(Date.now() - 120_000).toISOString();
    const t2 = new Date(Date.now() - 60_000).toISOString();

    const earlyRecord = await repositories.oddsSnapshots.insert({
      providerKey,
      marketKey: 'h2h',
      league: PROOF_LEAGUE,
      runId,
      snapshotAt: t1,
      priceBlob: { label: 'early', runId },
    });

    await repositories.oddsSnapshots.insert({
      providerKey,
      marketKey: 'h2h',
      league: PROOF_LEAGUE,
      runId,
      snapshotAt: t2,
      priceBlob: { label: 'later', runId },
      priorSnapshotId: earlyRecord.id,
    });

    const atT1 = await repositories.oddsSnapshots.queryAtTimestamp(t1, providerKey, PROOF_LEAGUE);
    assert.ok(atT1, 'early snapshot visible at t1');
    assert.equal(atT1.id, earlyRecord.id, 'adversarial: only early snapshot visible at t1 — later snapshot does not appear');
  },
);
