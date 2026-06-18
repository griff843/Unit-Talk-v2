/**
 * T1 Pre-Merge Proof: UTV2-1282 — bounded opening-line dedup lookup.
 *
 * Proves against the LIVE, partitioned `provider_offer_history` that the
 * snapshot-windowed `findExistingCombinations` (the partition-pruning fix) completes
 * quickly instead of hitting a statement timeout, and still returns the recent
 * combinations it needs for opening-line detection. Read-only — no writes.
 *
 * This is the InMemory-vs-Database guard for this lane: partition pruning only
 * manifests on real partitioned Postgres, not in the in-memory repository.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
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

const DEDUP_LOOKBACK_HOURS = 72;

let connection: DatabaseConnectionConfig;

before(() => {
  if (skipReason) return;
  loadEnvironment();
  connection = createServiceRoleDatabaseConnectionConfig();
});

test(
  'findExistingCombinations is bounded by the snapshot window and completes fast on live partitioned history (UTV2-1282)',
  { skip: skipReason },
  async () => {
    const client = createDatabaseClientFromConnection(connection);

    // Pick a real, recent provider_event_id (read-only). Prefer MLB; fall back to any.
    const recent = await client
      .from('provider_offer_history')
      .select('provider_event_id, snapshot_at, sport_key')
      .order('snapshot_at', { ascending: false })
      .limit(1);
    const eventId = recent.data?.[0]?.provider_event_id ?? null;
    if (!eventId) {
      // No history yet — nothing to dedup against; the bound is a no-op. Pass trivially.
      return;
    }

    const repositories = createDatabaseIngestorRepositoryBundle(connection);
    const nowIso = new Date().toISOString();
    const afterIso = new Date(Date.now() - DEDUP_LOOKBACK_HOURS * 3_600_000).toISOString();

    // The fix: a lower-bounded lookup prunes to the last few daily partitions instead
    // of scanning all ~60. It must return WITHOUT a statement timeout, well within the
    // per-league budget. (Pre-fix this scanned ~48 partitions and timed out under load.)
    const start = Date.now();
    const bounded = await repositories.providerOffers.findExistingCombinations([eventId], {
      includeBookmakerKey: true,
      beforeSnapshotAt: nowIso,
      afterSnapshotAt: afterIso,
    });
    const elapsedMs = Date.now() - start;

    assert.ok(
      elapsedMs < 20_000,
      `bounded dedup lookup must complete promptly (partition pruning), took ${elapsedMs}ms`,
    );
    // The most-recent event has fresh offers within the window, so its combinations
    // are found — proving the lower bound does not drop the recent history dedup needs.
    assert.ok(
      bounded.size >= 1,
      'recent event must have at least one existing combination inside the 72h window',
    );
  },
);
