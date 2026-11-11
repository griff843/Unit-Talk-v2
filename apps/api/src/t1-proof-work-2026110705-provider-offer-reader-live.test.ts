/**
 * WORK-2026110705 — staging-only live-DB proof of the corrected provider-offer
 * read path. Runs through CI only (CI_FIXTURE_RUN_ID); never against production.
 *
 * It drives the REAL canonical readers against the REAL staging schema:
 *   - DatabaseProviderOfferRepository.listRecentOffers  (provider_offer_history,
 *     a RANGE-partitioned table): proves the `.range()` + `id` tie-break paging
 *     returns a population larger than the PostgREST 1000-row cap, honours the
 *     caller's `limit`, keeps rows that share a snapshot_at, and — as a
 *     non-vacuity control — that the pre-fix single `.limit(10000)` query is in
 *     fact clipped by this server.
 *   - fetchCurrentEventOffers (provider_offer_current): proves the explicit
 *     fresh / stale / empty / truncated states, and maps each through the
 *     smart-form `describeOffersState` that renders the user-visible label.
 *
 * All rows are run-owned fixtures (event ids prefixed with this run's
 * namespace), inserted with the staging service role and deleted in `finally`;
 * the test asserts nothing of the namespace remains. No existing row is read for
 * its value, updated or deleted.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  fetchCurrentEventOffers,
} from '@unit-talk/db';

const require = createRequire(import.meta.url);
const { describeOffersState } = require('../../smart-form/lib/form-utils.ts') as {
  describeOffersState: (
    state: unknown,
  ) => { tone: string; label: string; lastObservedAt: string | null } | null;
};

const fixtureRun = process.env['CI_FIXTURE_RUN_ID'];
const skip = !fixtureRun
  ? 'requires staging-ci CI_SUPABASE_* credentials and CI_FIXTURE_RUN_ID; writable proof deferred locally'
  : false;

const HISTORY_ROWS = 1250; // > 1000 PostgREST max_rows
const TRUNCATED_CURRENT_ROWS = 1050; // > 1000 so the clip is real, not coincidental
const INSERT_CHUNK = 250;

test(
  'WORK0705 staging: provider-offer readers page past the row cap and report explicit freshness state',
  { skip, timeout: 600_000 },
  async (t) => {
    const environment = loadEnvironment();
    const url = environment.SUPABASE_URL ?? '';
    assert.equal(process.env['CI'], 'true', 'writable proof runs through CI only');
    assert.equal(new URL(url).protocol, 'https:');
    assert.equal(new URL(url).hostname, 'xskgrzbteyqdufktjrjx.supabase.co');

    const connection = createServiceRoleDatabaseConnectionConfig(environment);
    const client = createDatabaseClientFromConnection(connection);
    const repositories = createDatabaseRepositoryBundle(connection);
    const namespace = `work0705-${fixtureRun}-${randomUUID().slice(0, 8)}`;

    const historyEvent = `${namespace}-hist`;
    const currentEvents = {
      truncated: `${namespace}-cur-trunc`,
      fresh: `${namespace}-cur-fresh`,
      stale: `${namespace}-cur-stale`,
      empty: `${namespace}-cur-empty`,
    };

    // History window: tomorrow (UTC). Staging partitions exist ahead of today and
    // no real ingest writes into the future, so `since` isolates this fixture.
    const now = new Date();
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const since = dayStart.toISOString();
    const snapshotSlots = [0, 1, 2].map((minute) =>
      new Date(dayStart.getTime() + 12 * 3_600_000 + minute * 60_000).toISOString(),
    );

    try {
      // ---- Population guard: the isolated window must be empty before we write.
      const before = await client
        .from('provider_offer_history')
        .select('id', { count: 'exact', head: true })
        .gte('snapshot_at', since);
      assert.equal(before.error, null);
      assert.equal(before.count, 0, 'external rows in the isolated future window; rerun proof');

      // ---- A. provider_offer_history via listRecentOffers ------------------
      const fixtures = Array.from({ length: HISTORY_ROWS }, (_, index) => ({
        id: randomUUID(),
        snapshot_at: snapshotSlots[index % snapshotSlots.length]!,
        idempotency_key: `${namespace}:hist:${index}`,
        provider_key: 'sgo',
        provider_event_id: historyEvent,
        provider_market_key: 'work0705-proof-market',
        provider_participant_id: null,
        bookmaker_key: null,
        devig_mode: 'PAIRED',
        line: 1.5,
        over_odds: -110,
        under_odds: -110,
        is_opening: false,
        is_closing: false,
      }));
      for (let offset = 0; offset < fixtures.length; offset += INSERT_CHUNK) {
        const inserted = await client
          .from('provider_offer_history')
          .insert(fixtures.slice(offset, offset + INSERT_CHUNK));
        assert.equal(inserted.error, null, `history insert failed: ${inserted.error?.message}`);
      }

      // Independent oracle: the ordering the reader must produce.
      const oracle = [...fixtures].sort((a, b) => {
        const byTime = Date.parse(b.snapshot_at) - Date.parse(a.snapshot_at);
        return byTime !== 0 ? byTime : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      });
      assert.equal(new Set(fixtures.map((row) => row.snapshot_at)).size, 3);
      assert.ok(HISTORY_ROWS > 1000);

      // Non-vacuity control: the pre-fix shape (one `.limit(10000)` query) is
      // clipped by this server's max_rows, so the paging below is load-bearing.
      const legacy = await client
        .from('provider_offer_history')
        .select('*')
        .gte('snapshot_at', since)
        .order('snapshot_at', { ascending: false })
        .limit(10_000);
      assert.equal(legacy.error, null);
      const legacyRows = legacy.data?.length ?? 0;
      assert.ok(
        legacyRows < HISTORY_ROWS,
        `server did not clip the legacy single query (${legacyRows} rows); proof would be vacuous`,
      );

      const full = await repositories.providerOffers.listRecentOffers(since);
      assert.equal(full.length, HISTORY_ROWS, 'reader must return the whole population past the row cap');
      assert.equal(new Set(full.map((row) => row.id)).size, full.length, 'duplicate rows across pages');
      assert.deepEqual(
        full.map((row) => row.id),
        oracle.map((row) => row.id),
        'reader order must be snapshot_at desc, id desc (ties across page boundaries kept)',
      );

      for (const limit of [1000, 1001, 1100]) {
        const capped = await repositories.providerOffers.listRecentOffers(since, limit);
        assert.equal(capped.length, limit, `limit ${limit} must be honoured, not clipped by the server`);
        assert.deepEqual(
          capped.map((row) => row.id),
          oracle.slice(0, limit).map((row) => row.id),
          `limit ${limit} must return the first ${limit} rows of the canonical order`,
        );
      }
      const none = await repositories.providerOffers.listRecentOffers(
        new Date(dayStart.getTime() + 36 * 3_600_000).toISOString(),
      );
      assert.equal(none.length, 0);

      // ---- B. provider_offer_current via fetchCurrentEventOffers ------------
      const observedFresh = new Date(now.getTime() - 60_000).toISOString();
      const observedStale = new Date(now.getTime() - 3 * 86_400_000).toISOString();
      const recentSince = new Date(now.getTime() - 3_600_000).toISOString();

      const currentRow = (eventId: string, key: string, snapshotAt: string, market: string) => ({
        id: randomUUID(),
        identity_key: `${namespace}:${key}`,
        idempotency_key: `${namespace}:cur:${key}`,
        provider_key: 'sgo',
        provider_event_id: eventId,
        provider_market_key: market,
        provider_participant_id: null,
        bookmaker_key: null,
        devig_mode: 'PAIRED',
        line: 2.5,
        over_odds: -105,
        under_odds: -115,
        is_opening: false,
        is_closing: false,
        snapshot_at: snapshotAt,
        created_at: snapshotAt,
      });
      const currentFixtures = [
        ...Array.from({ length: TRUNCATED_CURRENT_ROWS }, (_, i) =>
          currentRow(currentEvents.truncated, `trunc:${i}`, observedFresh, `work0705-market-${i}`)),
        ...Array.from({ length: 3 }, (_, i) =>
          currentRow(currentEvents.fresh, `fresh:${i}`, observedFresh, `work0705-market-${i}`)),
        ...Array.from({ length: 3 }, (_, i) =>
          currentRow(currentEvents.stale, `stale:${i}`, observedStale, `work0705-market-${i}`)),
      ];
      for (let offset = 0; offset < currentFixtures.length; offset += INSERT_CHUNK) {
        const inserted = await client
          .from('provider_offer_current')
          .insert(currentFixtures.slice(offset, offset + INSERT_CHUNK));
        assert.equal(inserted.error, null, `current insert failed: ${inserted.error?.message}`);
      }

      const truncated = await fetchCurrentEventOffers(client, currentEvents.truncated, recentSince);
      assert.equal(truncated.state.status, 'fresh');
      assert.equal(truncated.state.truncated, true);
      assert.ok(truncated.rows.length < TRUNCATED_CURRENT_ROWS, 'the read really was clipped by the row cap');
      assert.match(describeOffersState(truncated.state)?.label ?? '', /^Partial offers/);

      const fresh = await fetchCurrentEventOffers(client, currentEvents.fresh, recentSince);
      assert.equal(fresh.state.status, 'fresh');
      assert.equal(fresh.state.truncated, false);
      assert.equal(fresh.rows.length, 3);
      assert.equal(describeOffersState(fresh.state), null);

      const stale = await fetchCurrentEventOffers(client, currentEvents.stale, recentSince);
      assert.equal(stale.state.status, 'stale');
      assert.equal(stale.rows.length, 0, 'stale rows must never be returned as current offers');
      assert.equal(Date.parse(stale.state.newestObservedAt ?? ''), Date.parse(observedStale));
      assert.match(describeOffersState(stale.state)?.label ?? '', /^Stale offers — last observed /);

      const empty = await fetchCurrentEventOffers(client, currentEvents.empty, recentSince);
      assert.equal(empty.state.status, 'empty');
      assert.equal(empty.state.newestObservedAt, null);
      assert.equal(empty.rows.length, 0);
      assert.equal(describeOffersState(empty.state)?.label, 'No offers recorded for this event');

      t.diagnostic(
        JSON.stringify({
          namespace,
          history: {
            fixtureRows: HISTORY_ROWS,
            distinctSnapshotAt: 3,
            legacySingleQueryRows: legacyRows,
            readerRows: full.length,
            cappedReads: [1000, 1001, 1100],
          },
          current: {
            truncated: { fixtureRows: TRUNCATED_CURRENT_ROWS, returned: truncated.rows.length, state: truncated.state.status, flag: true },
            fresh: { returned: fresh.rows.length, state: fresh.state.status },
            stale: { returned: stale.rows.length, state: stale.state.status },
            empty: { returned: empty.rows.length, state: empty.state.status },
          },
        }),
      );
    } finally {
      const removedHistory = await client
        .from('provider_offer_history')
        .delete()
        .eq('provider_event_id', historyEvent);
      const removedCurrent = await client
        .from('provider_offer_current')
        .delete()
        .in('provider_event_id', Object.values(currentEvents));
      assert.equal(removedHistory.error, null, `history cleanup failed: ${removedHistory.error?.message}`);
      assert.equal(removedCurrent.error, null, `current cleanup failed: ${removedCurrent.error?.message}`);
      const leftHistory = await client
        .from('provider_offer_history')
        .select('id', { count: 'exact', head: true })
        .eq('provider_event_id', historyEvent);
      const leftCurrent = await client
        .from('provider_offer_current')
        .select('identity_key', { count: 'exact', head: true })
        .in('provider_event_id', Object.values(currentEvents));
      assert.equal(leftHistory.count, 0, 'fixture history rows must be removed');
      assert.equal(leftCurrent.count, 0, 'fixture current rows must be removed');
    }
  },
);
