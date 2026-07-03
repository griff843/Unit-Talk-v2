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
 * Data-freshness note (UTV2-1459): the window-content assertion below only
 * proves anything when provider data is actively flowing. If the most recent
 * row is already older than the lookback window (provider outage, ingestor
 * incident — see e.g. UTV2-1458), that assertion is skipped rather than
 * failed: a stale-data condition is not a partition-pruning regression, and
 * this test running inside the general `pnpm verify` gate must not block
 * unrelated PRs on a live-data staleness signal it isn't designed to carry.
 * The performance assertion (timeout/statement-timeout regression) still
 * runs unconditionally — that one is independent of data freshness.
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

/**
 * True if `snapshotAt` falls within `lookbackHours` of `now`. Extracted as a
 * pure function so the stale-vs-fresh branching (UTV2-1459) is unit-testable
 * without live Supabase — see the tests below.
 */
export function isSnapshotWithinLookback(
  snapshotAt: string | null,
  lookbackHours: number,
  now: number = Date.now(),
): boolean {
  const snapshotMs = snapshotAt ? Date.parse(snapshotAt) : NaN;
  return Number.isFinite(snapshotMs) && now - snapshotMs <= lookbackHours * 3_600_000;
}

let connection: DatabaseConnectionConfig;

before(() => {
  if (skipReason) return;
  loadEnvironment();
  connection = createServiceRoleDatabaseConnectionConfig();
});

test(
  'findExistingCombinations is bounded by the snapshot window and completes fast on live partitioned history (UTV2-1282)',
  { skip: skipReason },
  async (t) => {
    const client = createDatabaseClientFromConnection(connection);

    // Pick a real, recent provider_event_id (read-only). Prefer MLB; fall back to any.
    const recent = await client
      .from('provider_offer_history')
      .select('provider_event_id, snapshot_at, sport_key')
      .order('snapshot_at', { ascending: false })
      .limit(1);
    const eventId = recent.data?.[0]?.provider_event_id ?? null;
    const recentSnapshotAt = recent.data?.[0]?.snapshot_at ?? null;
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

    // Independent of data freshness — a real partition-pruning regression must
    // still fail closed even when provider data is stale.
    assert.ok(
      elapsedMs < 20_000,
      `bounded dedup lookup must complete promptly (partition pruning), took ${elapsedMs}ms`,
    );

    // The window-content assertion below only proves anything if the most
    // recent row is itself within the lookback window. If provider ingestion
    // has stalled (outage, ingestor incident), the most recent row can be
    // older than the window through no fault of findExistingCombinations —
    // skip rather than fail so an unrelated data-freshness gap doesn't read
    // as a partition-pruning regression (see UTV2-1459).
    if (!isSnapshotWithinLookback(recentSnapshotAt, DEDUP_LOOKBACK_HOURS)) {
      t.skip(
        `most recent provider_offer_history row (${recentSnapshotAt}) is older than the ${DEDUP_LOOKBACK_HOURS}h lookback window — provider data is stale (outage or ingestor incident), not a code regression; skipping window-content assertion`,
      );
      return;
    }

    // The most-recent event has fresh offers within the window, so its combinations
    // are found — proving the lower bound does not drop the recent history dedup needs.
    assert.ok(
      bounded.size >= 1,
      'recent event must have at least one existing combination inside the 72h window',
    );
  },
);

test('UTV2-1459: isSnapshotWithinLookback is true when the snapshot is inside the window', () => {
  const now = Date.parse('2026-07-03T12:00:00.000Z');
  const oneHourAgo = new Date(now - 3_600_000).toISOString();
  assert.equal(isSnapshotWithinLookback(oneHourAgo, 72, now), true);
});

test('UTV2-1459: isSnapshotWithinLookback is false when the snapshot is older than the window (stale-data condition)', () => {
  const now = Date.parse('2026-07-03T12:00:00.000Z');
  const eightyTwoHoursAgo = new Date(now - 82 * 3_600_000).toISOString();
  assert.equal(isSnapshotWithinLookback(eightyTwoHoursAgo, 72, now), false);
});

test('UTV2-1459: isSnapshotWithinLookback is false for null or unparseable input', () => {
  const now = Date.parse('2026-07-03T12:00:00.000Z');
  assert.equal(isSnapshotWithinLookback(null, 72, now), false);
  assert.equal(isSnapshotWithinLookback('not-a-date', 72, now), false);
});
