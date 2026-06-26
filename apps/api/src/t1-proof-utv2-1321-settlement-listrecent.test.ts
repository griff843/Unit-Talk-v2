/**
 * T1 Pre-Merge Proof: UTV2-1321 — settlement.listRecent created_at lower-bound fix.
 *
 * Proves against the LIVE settlement_records table that listRecent(500, since)
 * completes promptly when a created_at lower-bound is passed. Without the fix,
 * this call scans all partitions and hits statement_timeout under load. With the
 * fix, the partition scan is limited to rows within the since window (~1 partition).
 *
 * Read-only — no rows are written or mutated. The DB round-trip exercises the
 * partition-pruned query path against real settlement_records data.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1321-settlement-listrecent.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseRepositoryBundle,
} from '@unit-talk/db';

test(
  'UTV2-1321: settlement.listRecent with created_at lower-bound completes promptly on live partitioned table',
  async (t) => {
    let connection;
    try {
      connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
    } catch (error) {
      t.skip(`Supabase service-role environment unavailable: ${(error as Error).message}`);
      return;
    }

    const repositories = createDatabaseRepositoryBundle(connection);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffIso = cutoff.toISOString();

    const start = Date.now();
    const results = await repositories.settlements.listRecent(500, cutoffIso);
    const elapsedMs = Date.now() - start;

    assert.ok(Array.isArray(results), 'listRecent must return an array');
    assert.ok(
      elapsedMs < 10_000,
      `listRecent with lower-bound must complete promptly (partition pruning), took ${elapsedMs}ms`,
    );

    for (const row of results) {
      assert.ok(
        row.created_at >= cutoffIso,
        `all rows must be within the since window (created_at=${row.created_at} >= ${cutoffIso})`,
      );
    }
  },
);
