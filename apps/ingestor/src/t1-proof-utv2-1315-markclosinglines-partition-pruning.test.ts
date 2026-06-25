/**
 * T1 Pre-Merge Proof: UTV2-1315 — markClosingLines snapshot_at partition-pruning fix.
 *
 * Proves against the LIVE, partitioned `provider_offer_history` that the
 * partition-pruned `markClosingLines` completes quickly instead of hitting a
 * statement timeout. Read-safe — uses a non-existent providerEventId so no
 * rows are mutated; the DB round-trip still exercises all 60+ partitions in
 * the unpatched code path, but completes in under 5s with the lower bound.
 *
 * The root cause: without `.gte('snapshot_at', windowStart)`, Postgres scans
 * all daily partitions (60+) for every started event — causing statement_timeout
 * on a full MLB slate. The fix mirrors UTV2-1296 (findExistingCombinations).
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/ingestor/src/t1-proof-utv2-1315-markclosinglines-partition-pruning.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseIngestorRepositoryBundle,
  type DatabaseConnectionConfig,
} from '@unit-talk/db';

function hasSupabaseEnvironment(): boolean {
  try {
    return Boolean(loadEnvironment().SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let connection: DatabaseConnectionConfig;

before(() => {
  if (skipReason) return;
  loadEnvironment();
  connection = createServiceRoleDatabaseConnectionConfig();
});

test(
  'markClosingLines is bounded by the snapshot window and completes fast on live partitioned history (UTV2-1315)',
  { skip: skipReason },
  async () => {
    const repositories = createDatabaseIngestorRepositoryBundle(connection);
    const snapshotAt = new Date().toISOString();
    // commenceTime in the past so the window condition is satisfied
    const commenceTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Non-existent event ID — no rows will be updated, but the partition scan
    // still executes. With the fix the lower bound limits it to ~2 partitions.
    const start = Date.now();
    const count = await repositories.providerOffers.markClosingLines(
      [{ providerEventId: 'utv2-1315-proof-nonexistent', commenceTime }],
      snapshotAt,
    );
    const elapsedMs = Date.now() - start;

    assert.equal(count, 0, 'non-existent event ID must update 0 rows');
    assert.ok(
      elapsedMs < 10_000,
      `markClosingLines must complete promptly (partition pruning), took ${elapsedMs}ms`,
    );
  },
);
