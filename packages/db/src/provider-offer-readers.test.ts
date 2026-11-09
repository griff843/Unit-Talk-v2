/**
 * WORK-2026110705 — provider-offer reader correction.
 *
 * Fixtures are RECORDED provider data, read-only SELECTs against production
 * Supabase on 2026-11-08 (ref zfzdnfwdarxucxtaojxm), no secrets, no inference:
 *   - CURRENT_ROWS: 6 rows of provider_offer_current for SGO event
 *     peWDBWtFGYDbolu9pa4a (MLB, batting_basesOnBalls-all-game-ou), observed
 *     2026-06-30 12:25-12:41Z. The projection has not been written since
 *     2026-06-30 (SGO parked), which is itself the real stale-data case.
 *   - HISTORY_ROWS: 4 rows of provider_offer_history_compact for SGO event
 *     4Cl9fxEv9OrurKFGv3Wz (NBA), observed 2026-04-26 18:56:42Z.
 *
 * QUARANTINE_MARKER is NOT provider evidence. It is a clearly-marked negative
 * control standing in for a frozen row in the legacy quarantine view for the
 * same event; the tests prove it can never be returned.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DatabaseExecutionQualityRepository,
  DatabaseProviderOfferRepository,
  fetchCurrentEventOffers,
} from './runtime-repositories.js';
import type { UnitTalkSupabaseClient } from './client.js';

const EVENT = 'peWDBWtFGYDbolu9pa4a';

const CURRENT_ROWS = [
  row('sgo:peWDBWtFGYDbolu9pa4a:batting_basesOnBalls-all-game-ou:COLE_YOUNG_1_MLB:', null, 'COLE_YOUNG_1_MLB', 158, -245, '2026-06-30T12:41:02.424Z'),
  row('sgo:peWDBWtFGYDbolu9pa4a:batting_basesOnBalls-all-game-ou:COLE_YOUNG_1_MLB:bet365', 'bet365', 'COLE_YOUNG_1_MLB', 185, -250, '2026-06-30T12:25:12.551Z'),
  row('sgo:peWDBWtFGYDbolu9pa4a:batting_basesOnBalls-all-game-ou:COLE_YOUNG_1_MLB:draftkings', 'draftkings', 'COLE_YOUNG_1_MLB', 160, null, '2026-06-30T12:25:12.551Z'),
  row('sgo:peWDBWtFGYDbolu9pa4a:batting_basesOnBalls-all-game-ou:COLE_YOUNG_1_MLB:fanatics', 'fanatics', 'COLE_YOUNG_1_MLB', 175, -255, '2026-06-30T12:25:12.551Z'),
  row('sgo:peWDBWtFGYDbolu9pa4a:batting_basesOnBalls-all-game-ou:COLT_EMERSON_1_MLB:', null, 'COLT_EMERSON_1_MLB', 163, -240, '2026-06-30T12:41:02.424Z'),
  row('sgo:peWDBWtFGYDbolu9pa4a:batting_basesOnBalls-all-game-ou:COLT_EMERSON_1_MLB:bet365', 'bet365', 'COLT_EMERSON_1_MLB', 180, -244, '2026-06-30T12:25:12.551Z'),
];

function row(
  identity: string,
  bookmaker: string | null,
  participant: string,
  over: number,
  under: number | null,
  snapshotAt: string,
) {
  return {
    identity_key: identity,
    provider_event_id: EVENT,
    provider_key: 'sgo',
    sport_key: 'MLB',
    bookmaker_key: bookmaker,
    provider_market_key: 'batting_basesOnBalls-all-game-ou',
    provider_participant_id: participant,
    line: 0.5,
    over_odds: over,
    under_odds: under,
    is_opening: true,
    is_closing: false,
    snapshot_at: snapshotAt,
  };
}

/** NEGATIVE CONTROL (not provider evidence): a frozen quarantine-era row. */
const QUARANTINE_MARKER = {
  ...row('QUARANTINE-NEGATIVE-CONTROL', 'quarantine-book', 'QUARANTINE_PLAYER', 999, -999, '2026-04-29T13:04:29.674Z'),
  line: 99.5,
};

const HISTORY_ROWS = [
  { provider_key: 'sgo', sport_key: 'NBA', provider_market_key: 'points-all-2h-ou', line: 103.5, is_opening: true, is_closing: false },
  { provider_key: 'sgo', sport_key: 'NBA', provider_market_key: 'points-all-2h-sp', line: null, is_opening: true, is_closing: true },
  { provider_key: 'sgo', sport_key: 'NBA', provider_market_key: 'points-all-3q-sp', line: null, is_opening: true, is_closing: true },
];

type Filter = { op: string; column: string; value?: unknown };

/** Records every table touched and serves table-specific data; awaitable like PostgREST. */
function fakeClient(tables: Record<string, unknown[]>, errorTable?: string) {
  const touched: string[] = [];
  const client = {
    from(table: string) {
      touched.push(table);
      const filters: Filter[] = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => (filters.push({ op: 'eq', column, value }), builder),
        is: (column: string, value: unknown) => (filters.push({ op: 'is', column, value }), builder),
        not: (column: string, op: string, value: unknown) => (filters.push({ op: `not.${op}`, column, value }), builder),
        gte: (column: string, value: unknown) => (filters.push({ op: 'gte', column, value }), builder),
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) => {
          if (table === errorTable) {
            return resolve({ data: null, error: { message: `boom reading ${table}` } });
          }
          const data = (tables[table] ?? []).filter((candidate) =>
            filters.every((filter) => {
              const record = candidate as Record<string, unknown>;
              if (filter.op === 'eq') return record[filter.column] === filter.value;
              if (filter.op === 'is') return record[filter.column] === filter.value;
              if (filter.op === 'not.is') return record[filter.column] !== filter.value;
              return true;
            }),
          );
          return resolve({ data, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as UnitTalkSupabaseClient, touched };
}

const FRESH_SINCE = '2026-06-30T00:00:00.000Z';

test('WORK-2026110705 proof 1: current-offer read returns the canonical current projection and never a quarantine row', async () => {
  const { client, touched } = fakeClient({
    provider_offer_current: CURRENT_ROWS,
    provider_offers: [QUARANTINE_MARKER],
    provider_offers_legacy_quarantine: [QUARANTINE_MARKER],
  });

  const result = await fetchCurrentEventOffers(client, EVENT, FRESH_SINCE);

  assert.equal(result.state.status, 'fresh');
  assert.equal(result.rows.length, CURRENT_ROWS.length);
  assert.equal(result.state.newestObservedAt, '2026-06-30T12:41:02.424Z');
  assert.ok(result.rows.every((r) => r.identity_key !== 'QUARANTINE-NEGATIVE-CONTROL'));
  assert.ok(touched.length > 0 && touched.every((t) => t === 'provider_offer_current'), `touched: ${touched.join(',')}`);
});

test('WORK-2026110705 proof 2: historical opening/closing reads keep history semantics (provider_offer_history_compact), not the quarantine view', async () => {
  const { client, touched } = fakeClient({
    provider_offer_history_compact: HISTORY_ROWS,
    provider_offers: [QUARANTINE_MARKER],
  });

  const reports = await new DatabaseExecutionQualityRepository(client).summarizeByProvider('NBA');

  assert.deepEqual(touched, ['provider_offer_history_compact']);
  const twoHalfSpread = reports.find((r) => r.marketFamily === 'points-all-2h-sp');
  assert.ok(twoHalfSpread, 'closing/opening history row is reported');
  assert.equal(twoHalfSpread.sampleSize, 1);
  assert.equal(reports.reduce((sum, r) => sum + r.sampleSize, 0), HISTORY_ROWS.length);

  const byFamily = await new DatabaseExecutionQualityRepository(client).summarizeByMarketFamily('sgo');
  assert.equal(byFamily.reduce((sum, r) => sum + r.sampleSize, 0), HISTORY_ROWS.length);
  assert.ok(!touched.includes('provider_offers'));
});

/**
 * PostgREST fake that, like the real server, silently clamps every response to
 * `maxRows` (supabase/config.toml max_rows = 1000) whatever the caller asked for.
 */
/** The repository constructor opens a privileged connection; inject the fake client instead. */
function offerRepoOver(client: UnitTalkSupabaseClient) {
  const repo = Object.create(DatabaseProviderOfferRepository.prototype) as DatabaseProviderOfferRepository;
  (repo as unknown as { client: UnitTalkSupabaseClient }).client = client;
  return repo;
}

function clampingHistoryClient(total: number, maxRows = 1000) {
  const touched: string[] = [];
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `row-${String(i).padStart(6, '0')}`,
    snapshot_at: new Date(Date.UTC(2026, 10, 8) - i * 1000).toISOString(),
  }));
  const client = {
    from(table: string) {
      touched.push(table);
      let from = 0;
      let to = Number.MAX_SAFE_INTEGER;
      const builder: Record<string, unknown> = {
        select: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: (n: number) => ((to = n - 1), builder),
        range: (f: number, t: number) => ((from = f), (to = t), builder),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            data: rows.slice(from, Math.min(to + 1, from + maxRows)),
            error: null,
          }),
      };
      return builder;
    },
  };
  return { client: client as unknown as UnitTalkSupabaseClient, touched };
}

test('WORK-2026110705 proof 2b: listRecentOffers reads provider_offer_history and returns up to the caller cap despite the 1000-row server clamp', async () => {
  const { client, touched } = clampingHistoryClient(2600);
  const repo = offerRepoOver(client);

  // A single clamped request would silently return 1000 rows for a 2500 ask.
  const rows = await repo.listRecentOffers('2026-11-01T00:00:00.000Z', 2500);
  assert.equal(rows.length, 2500);
  assert.equal(new Set(rows.map((r) => (r as { id: string }).id)).size, 2500, 'no repeated rows across pages');
  assert.ok(touched.length > 1 && touched.every((t) => t === 'provider_offer_history'), `touched: ${touched.join(',')}`);

  // Fewer rows than the cap: returned in full, not reported as capped.
  const small = await offerRepoOver(clampingHistoryClient(1200).client).listRecentOffers(
    '2026-11-01T00:00:00.000Z',
    10_000,
  );
  assert.equal(small.length, 1200);
});

test('WORK-2026110705 proof 5: a current-offer read that fills a PostgREST page is flagged truncated, not presented as complete', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({
    ...CURRENT_ROWS[0]!,
    identity_key: `bulk-${i}`,
    provider_participant_id: `P_${i}`,
    snapshot_at: '2026-06-30T12:00:00.000Z',
  }));
  const truncated = await fetchCurrentEventOffers(
    fakeClient({ provider_offer_current: many }).client,
    EVENT,
    FRESH_SINCE,
  );
  assert.equal(truncated.state.truncated, true);

  const whole = await fetchCurrentEventOffers(
    fakeClient({ provider_offer_current: CURRENT_ROWS }).client,
    EVENT,
    FRESH_SINCE,
  );
  assert.equal(whole.state.truncated, false);
});

test('WORK-2026110705 proof 3: stale canonical data returns an explicit stale state, no offers, and no quarantine fallback', async () => {
  const { client, touched } = fakeClient({
    provider_offer_current: CURRENT_ROWS,
    provider_offers: [QUARANTINE_MARKER],
  });

  // "Now" for the check is 2026-11-08; the newest canonical observation is 2026-06-30.
  const stale = await fetchCurrentEventOffers(client, EVENT, '2026-11-08T14:00:00.000Z');
  assert.equal(stale.state.status, 'stale');
  assert.deepEqual(stale.rows, []);
  assert.equal(stale.state.newestObservedAt, '2026-06-30T12:41:02.424Z');
  assert.equal(stale.state.freshSince, '2026-11-08T14:00:00.000Z');
  assert.ok(touched.every((t) => t === 'provider_offer_current'), 'no quarantine fallback');

  const empty = await fetchCurrentEventOffers(
    fakeClient({ provider_offer_current: [], provider_offers: [QUARANTINE_MARKER] }).client,
    EVENT,
    FRESH_SINCE,
  );
  assert.equal(empty.state.status, 'empty');
  assert.deepEqual(empty.rows, []);
});

test('WORK-2026110705 proof 4: a repository read error is surfaced, never a silent empty list', async () => {
  const failing = fakeClient({ provider_offer_current: CURRENT_ROWS }, 'provider_offer_current');
  await assert.rejects(
    fetchCurrentEventOffers(failing.client, EVENT, FRESH_SINCE),
    /Failed to load (game-level|player-prop) offers: boom reading provider_offer_current/,
  );

  const failingHistory = fakeClient({}, 'provider_offer_history_compact');
  await assert.rejects(
    new DatabaseExecutionQualityRepository(failingHistory.client).summarizeByProvider(),
    /Failed to summarize execution quality by provider: boom reading provider_offer_history_compact/,
  );
});
