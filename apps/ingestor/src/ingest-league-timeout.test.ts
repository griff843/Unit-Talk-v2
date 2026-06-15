import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';
import {
  ingestLeagueWithTimeout,
  LeagueIngestTimeoutError,
  runIngestorCycles,
} from './ingestor-runner.js';
import {
  SGO_PLAYER_PROP_ODD_ID_PATTERNS,
  buildSgoOddsRequestUrl,
} from './sgo-request-contract.js';

/*
 * UTV2-1280 — bounded per-league ingest.
 *
 * Root cause: the SGO league cycle had no hard per-league timeout, so a single
 * high-volume league (MLB full slate, amplified by the UTV2-1275 league-wide
 * player-prop fetch) could hang the entire cycle indefinitely — the ingestor ran
 * `status=running` for hours and never reached the next league, so MLB
 * provider_offer_history went stale.
 *
 * These tests prove (a) a hung league fetch is aborted and fails closed within
 * the bound instead of hanging, (b) the cycle proceeds to the next league, and
 * (c) the player-prop fetch window is narrowed to bound high-volume pagination.
 */

const SNAPSHOT_AT = '2026-06-14T12:00:00.000Z';
const API_KEY = 'test-sgo-key';

/** A fetch that never resolves on its own but rejects when its signal aborts. */
function makeHangingFetch(): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      if (signal) {
        if (signal.aborted) {
          reject(signal.reason ?? new Error('aborted'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(signal.reason ?? new Error('aborted')),
          { once: true },
        );
      }
      // Otherwise: hang forever (simulates a stuck provider/DB call).
    })) as typeof fetch;
}

function emptyOddsResponse(): Response {
  return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('ingestLeagueWithTimeout: a hung league fetch fails closed within the bound, not indefinitely', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const timeoutMs = 100;
  const startedAt = Date.now();

  await assert.rejects(
    ingestLeagueWithTimeout(
      'MLB',
      API_KEY,
      repositories,
      {
        snapshotAt: SNAPSHOT_AT,
        fetchImpl: makeHangingFetch(),
        skipResults: true,
        playerPropOddIdPatterns: [...SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB],
      },
      timeoutMs,
    ),
    (error: unknown) => {
      assert.ok(
        error instanceof LeagueIngestTimeoutError,
        `expected LeagueIngestTimeoutError, got ${String(error)}`,
      );
      assert.equal(error.league, 'MLB');
      assert.equal(error.timeoutMs, timeoutMs);
      return true;
    },
  );

  const elapsed = Date.now() - startedAt;
  // The bound must dominate: comfortably under the per-page 30s HTTP timeout and
  // the 5-min pagination budget that previously let MLB run for hours.
  assert.ok(
    elapsed < 5_000,
    `expected bounded failure (<5s), took ${elapsed}ms`,
  );
});

test('ingestLeagueWithTimeout: timeoutMs <= 0 disables the bound (explicit opt-out)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  // With the bound disabled and an empty (immediately-resolving) response, the
  // call completes normally rather than throwing a timeout.
  const summary = await ingestLeagueWithTimeout(
    'NBA',
    API_KEY,
    repositories,
    {
      snapshotAt: SNAPSHOT_AT,
      fetchImpl: (() => Promise.resolve(emptyOddsResponse())) as typeof fetch,
      skipResults: true,
    },
    0,
  );
  assert.equal(summary.league, 'NBA');
});

test('runIngestorCycles: a hung MLB league does not block NBA — cycle fails closed and proceeds', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();

  // MLB hangs (until aborted); NBA returns an empty slate immediately.
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('leagueID=MLB')) {
      return makeHangingFetch()(href, init);
    }
    return Promise.resolve(emptyOddsResponse());
  }) as typeof fetch;

  const warnings: string[] = [];
  const startedAt = Date.now();

  const summaries = await runIngestorCycles({
    repositories,
    leagues: ['MLB', 'NBA'],
    apiKey: API_KEY,
    maxCycles: 1,
    skipResults: true,
    leagueTimeoutMs: 100,
    fetchImpl,
    logger: {
      warn: (message?: unknown) => warnings.push(String(message)),
      info: () => {},
    },
  });

  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 8_000, `expected bounded cycle (<8s), took ${elapsed}ms`);

  assert.equal(summaries.length, 1);
  const leagues = summaries[0]!.results.map((r) => r.league);
  // NBA must have run despite MLB hanging — the whole point of the fix.
  assert.ok(leagues.includes('NBA'), `expected NBA to run, got [${leagues.join(', ')}]`);
  // MLB timed out → fail-closed, not pushed as a successful result.
  assert.ok(!leagues.includes('MLB'), `MLB must not appear as succeeded, got [${leagues.join(', ')}]`);
  // Clear telemetry: a TIMEOUT warning was emitted for MLB.
  assert.ok(
    warnings.some((w) => w.includes('league=MLB') && w.includes('TIMEOUT')),
    `expected an MLB TIMEOUT warning, got: ${warnings.join(' | ')}`,
  );
});

test('buildSgoOddsRequestUrl: player-prop fetch narrows startsBefore to the imminent slate', () => {
  const gameLine = buildSgoOddsRequestUrl({
    apiKey: API_KEY,
    league: 'MLB',
    snapshotAt: SNAPSHOT_AT,
  });
  const playerProp = buildSgoOddsRequestUrl({
    apiKey: API_KEY,
    league: 'MLB',
    snapshotAt: SNAPSHOT_AT,
    playerPropOddIdPatterns: [...SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB],
  });

  const gameLineBefore = Date.parse(gameLine.searchParams.get('startsBefore')!);
  const playerPropBefore = Date.parse(
    playerProp.searchParams.get('startsBefore')!,
  );
  const snapshotMs = Date.parse(SNAPSHOT_AT);

  // Game-line keeps the full 7-day forward window.
  assert.equal(gameLineBefore - snapshotMs, 7 * 24 * 60 * 60 * 1000);
  // Player-prop is bounded to a much tighter window so PLAYER_ID-wildcard
  // pagination stays in budget on a full slate.
  assert.equal(playerPropBefore - snapshotMs, 36 * 60 * 60 * 1000);
  assert.ok(
    playerPropBefore < gameLineBefore,
    'player-prop window must be narrower than the game-line window',
  );
});

test('buildSgoOddsRequestUrl: explicit startsBefore overrides the player-prop narrowing', () => {
  const explicit = '2026-06-30T00:00:00.000Z';
  const url = buildSgoOddsRequestUrl({
    apiKey: API_KEY,
    league: 'MLB',
    snapshotAt: SNAPSHOT_AT,
    startsBefore: explicit,
    playerPropOddIdPatterns: [...SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB],
  });
  assert.equal(url.searchParams.get('startsBefore'), explicit);
});
