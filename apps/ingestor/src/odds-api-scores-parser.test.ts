/**
 * WORK-2026111102 -- Odds API `/scores` parser and scores fetcher.
 *
 * Plan tests 1-13 (`.ops/work/WORK-2026111102.md` "Tests") plus fixture
 * acceptance criterion 9 (every fixture file carries its provenance label).
 *
 * Written ahead of the implementation. Each block loads its target at runtime
 * and skips with "not implemented yet" until the target exists, so this file
 * type-checks and runs green on a branch where the source is absent. The
 * fixture-label tests run unconditionally.
 *
 * Contract these tests pin (the implementation must satisfy it, or the test is
 * updated in the same commit with a stated reason):
 *
 *   parseOddsApiScores(raw: unknown, league: 'NFL'|'NBA'|'NHL'|'MLB', now: Date)
 *     -> ParsedScore[]                       // one entry per input event, in input order
 *   ParsedScore =
 *     | { status: 'final'; eventId; event; homeTeam; awayTeam; homeScore: number; awayScore: number;
 *         commenceTime; lastUpdate; sportKey }
 *     | { status: 'not_final'; eventId; event; reason: string | null }
 *     | { status: 'rejected'; eventId: string | null; event: object | null; reason: string }
 *   `event` is the input event object as received, so the resolver can upsert a
 *   not-final event (home/away names, commence_time) without re-reading the payload.
 *
 *   fetchOddsApiScores({ apiKey, league, daysFrom, fetchImpl })
 *     -> { events: OddsApiScoreEvent[]; eventsCount; rawBody: string; fetchedAt: string;
 *          quota: { remaining: number | null; used: number | null; last: number | null } }
 *
 * No network: every fetch is injected. No API key: the key is a literal dummy.
 */

import type { OddsApiScoreEvent } from './odds-api-fetcher.js';

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_DIR = new URL('./__fixtures__/odds-api-scores/', import.meta.url);
/** The instant every doc-derived fixture is evaluated at (also stored in each file). */
const NOW = new Date('2026-11-09T12:00:00Z');

type League = 'NFL' | 'NBA' | 'NHL' | 'MLB';

interface ScoreEntry {
  name: string;
  score: string;
}

interface ScoreEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: ScoreEntry[] | null;
  last_update: string | null;
}

interface FixtureEnvelope {
  provenance: 'doc-derived' | 'recorded';
  vendorBehaviour: string;
  league: League;
  expectedParse: string;
  evaluateAt: string;
  response: ScoreEvent[];
}

function loadFixture(name: string): FixtureEnvelope {
  const file = name.endsWith('.json') ? name : `${name}.doc-derived.json`;
  return JSON.parse(readFileSync(new URL(file, FIXTURE_DIR), 'utf8')) as FixtureEnvelope;
}

function firstEvent(name: string): ScoreEvent {
  const event = loadFixture(name).response[0];
  assert.ok(event, `fixture ${name} has no event`);
  return structuredClone(event);
}

// ---------------------------------------------------------------------------
// Runtime loading of not-yet-implemented targets
// ---------------------------------------------------------------------------

interface ParsedScore {
  status: 'final' | 'not_final' | 'rejected';
  eventId: string | null;
  reason?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  lastUpdate?: string;
}

interface ParserModule {
  parseOddsApiScores(raw: unknown, league: League, now: Date): ParsedScore[];
}

interface ScoresFetchResult {
  events: Array<Record<string, unknown>>;
  eventsCount: number;
  rawBody: string;
  fetchedAt: string;
  quota: { remaining: number | null; used: number | null; last: number | null };
}

interface FetcherModule {
  fetchOddsApiScores(options: {
    apiKey: string;
    league: string;
    daysFrom?: number;
    fetchImpl?: typeof fetch;
  }): Promise<ScoresFetchResult>;
}

async function importIfPresent<T>(specifier: string): Promise<T | null> {
  try {
    return (await import(specifier)) as T;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return null;
    throw error;
  }
}

// Specifiers are held in variables so tsc does not resolve modules that do not exist yet.
const PARSER_SPECIFIER = './odds-api-scores-parser.js';
const FETCHER_SPECIFIER = './odds-api-fetcher.js';

const parserModule = await importIfPresent<ParserModule>(PARSER_SPECIFIER);
const parser =
  parserModule && typeof parserModule.parseOddsApiScores === 'function' ? parserModule : null;
const PARSER_SKIP = parser ? false : 'not implemented yet: odds-api-scores-parser.ts (WORK-2026111102)';

function parse(events: unknown, league: League, now: Date = NOW): ParsedScore[] {
  assert.ok(parser);
  return parser.parseOddsApiScores(events, league, now);
}

function parseOne(event: ScoreEvent, league: League, now: Date = NOW): ParsedScore {
  const [only, ...rest] = parse([event], league, now);
  assert.ok(only, 'parser returned no outcome for the event');
  assert.equal(rest.length, 0, 'parser returned more than one outcome for one event');
  return only;
}

/**
 * The scores fetcher already exists with the old odds-shaped return. These tests
 * activate only once it returns the new shape (detected by `rawBody` on a 200).
 */
async function loadFixedFetcher(): Promise<FetcherModule | null> {
  const mod = await importIfPresent<FetcherModule>(FETCHER_SPECIFIER);
  if (!mod || typeof mod.fetchOddsApiScores !== 'function') return null;
  try {
    const probe = await mod.fetchOddsApiScores({
      apiKey: 'dummy-not-a-key',
      league: 'NBA',
      daysFrom: 1,
      fetchImpl: (async () => new Response('[]', { status: 200 })) as typeof fetch,
    });
    return typeof (probe as Partial<ScoresFetchResult>).rawBody === 'string' ? mod : null;
  } catch {
    return null;
  }
}

const fetcher = await loadFixedFetcher();
const FETCHER_SKIP = fetcher
  ? false
  : 'not implemented yet: fetchOddsApiScores new return shape (WORK-2026111102)';

interface RecordedCall {
  url: string;
}

function recordingFetch(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url });
    return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// Fixture provenance (acceptance criterion 9) -- runs now
// ---------------------------------------------------------------------------

test('WORK-2026111102 fixtures: provenance labels', async (t) => {
  const files = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'));

  await t.test('fixture directory is non-empty', () => {
    assert.ok(files.length >= 15, `expected at least 15 fixtures, found ${files.length}`);
  });

  await t.test('every fixture file name carries doc-derived or recorded, and the body agrees', () => {
    for (const file of files) {
      const match = /\.(doc-derived|recorded)\.json$/.exec(file);
      assert.ok(match, `unlabelled fixture file: ${file}`);
      const body = loadFixture(file);
      assert.equal(body.provenance, match[1], `${file}: provenance field disagrees with file name`);
      assert.ok(Array.isArray(body.response), `${file}: response must be an array`);
    }
  });

  await t.test('both NHL shootout fixtures are marked behaviour unconfirmed by vendor', () => {
    for (const name of ['nhl-shootout-winner-credited', 'nhl-shootout-equal-scores']) {
      assert.equal(loadFixture(name).vendorBehaviour, 'behaviour unconfirmed by vendor', name);
    }
  });

  await t.test('every doc-derived event matches the documented field set and has a 32-char id', () => {
    const documented = [
      'away_team',
      'commence_time',
      'completed',
      'home_team',
      'id',
      'last_update',
      'scores',
      'sport_key',
      'sport_title',
    ];
    for (const file of files) {
      for (const event of loadFixture(file).response) {
        assert.deepEqual(Object.keys(event).sort(), documented, `${file}: field set`);
        assert.equal(event.id.length, 32, `${file}: id length`);
        assert.ok(!('bookmakers' in event), `${file}: scores events carry no bookmakers`);
      }
    }
  });

  await t.test('every fixture states the evaluation instant the tests use', () => {
    for (const file of files) {
      assert.equal(loadFixture(file).evaluateAt, NOW.toISOString().replace('.000Z', 'Z'), file);
    }
  });
});

// ---------------------------------------------------------------------------
// Fetcher (plan tests 1-4)
// ---------------------------------------------------------------------------

test('WORK-2026111102 fetchOddsApiScores', { skip: FETCHER_SKIP }, async (t) => {
  await t.test('1. daysFrom 0, 4, 1.5 rejected before any request; 1, 2, 3 sent', async () => {
    assert.ok(fetcher);
    for (const daysFrom of [0, 4, 1.5]) {
      const { fetchImpl, calls } = recordingFetch('[]');
      await assert.rejects(
        fetcher.fetchOddsApiScores({ apiKey: 'dummy-not-a-key', league: 'NBA', daysFrom, fetchImpl }),
        Error,
        `daysFrom ${daysFrom} must be rejected`,
      );
      assert.equal(calls.length, 0, `daysFrom ${daysFrom} must not reach the network`);
    }
    for (const daysFrom of [1, 2, 3]) {
      const { fetchImpl, calls } = recordingFetch('[]');
      await fetcher.fetchOddsApiScores({ apiKey: 'dummy-not-a-key', league: 'NBA', daysFrom, fetchImpl });
      assert.equal(calls.length, 1);
      const url = new URL(calls[0]!.url);
      assert.equal(url.searchParams.get('daysFrom'), String(daysFrom));
      assert.match(url.pathname, /\/sports\/basketball_nba\/scores\/?$/);
    }
  });

  await t.test('2. non-200 (401, 429, 500) throws carrying status; no partial result', async () => {
    assert.ok(fetcher);
    for (const status of [401, 429, 500]) {
      const { fetchImpl } = recordingFetch(`{"message":"status ${status}"}`, status);
      await assert.rejects(
        fetcher.fetchOddsApiScores({ apiKey: 'dummy-not-a-key', league: 'NBA', daysFrom: 1, fetchImpl }),
        (error: unknown) => {
          const text = `${(error as Error).message} ${JSON.stringify(error)}`;
          assert.ok(text.includes(String(status)), `error must carry status ${status}: ${text}`);
          return true;
        },
      );
    }
  });

  await t.test('3. quota headers surface in telemetry; missing headers give null', async () => {
    assert.ok(fetcher);
    const body = JSON.stringify(loadFixture('nba-final').response);
    const withHeaders = recordingFetch(body, 200, {
      'x-requests-remaining': '480',
      'x-requests-used': '20',
      'x-requests-last': '2',
    });
    const full = await fetcher.fetchOddsApiScores({
      apiKey: 'dummy-not-a-key',
      league: 'NBA',
      daysFrom: 1,
      fetchImpl: withHeaders.fetchImpl,
    });
    assert.deepEqual(full.quota, { remaining: 480, used: 20, last: 2 });
    assert.equal(full.rawBody, body);
    assert.ok(!Number.isNaN(Date.parse(full.fetchedAt)), 'fetchedAt is an ISO timestamp');

    const without = recordingFetch(body, 200);
    const bare = await fetcher.fetchOddsApiScores({
      apiKey: 'dummy-not-a-key',
      league: 'NBA',
      daysFrom: 1,
      fetchImpl: without.fetchImpl,
    });
    assert.deepEqual(bare.quota, { remaining: null, used: null, last: null });
  });

  await t.test('4. scores events carry no bookmakers', async () => {
    assert.ok(fetcher);
    const { fetchImpl } = recordingFetch(JSON.stringify(loadFixture('nba-final').response));
    const result = await fetcher.fetchOddsApiScores({
      apiKey: 'dummy-not-a-key',
      league: 'NBA',
      daysFrom: 1,
      fetchImpl,
    });
    assert.equal(result.eventsCount, 1);
    for (const event of result.events) assert.ok(!('bookmakers' in event));
  });

  await t.test('4b. scores type has no bookmakers key', () => {
    const assertNoBookmakers: 'bookmakers' extends keyof OddsApiScoreEvent ? false : true = true;
    assert.equal(assertNoBookmakers, true);
  });
});

// ---------------------------------------------------------------------------
// Parser (plan tests 5-13)
// ---------------------------------------------------------------------------

test('WORK-2026111102 parseOddsApiScores', { skip: PARSER_SKIP }, async (t) => {
  await t.test('5. documented completed example parses to final with integer scores', () => {
    const event = firstEvent('nba-final');
    const out = parseOne(event, 'NBA');
    assert.equal(out.status, 'final');
    assert.equal(out.eventId, event.id);
    assert.equal(out.homeTeam, 'Sacramento Kings');
    assert.equal(out.awayTeam, 'Oklahoma City Thunder');
    assert.equal(out.homeScore, 113);
    assert.equal(out.awayScore, 103);
    assert.ok(Number.isInteger(out.homeScore) && Number.isInteger(out.awayScore));
    assert.equal(out.lastUpdate !== undefined && Date.parse(out.lastUpdate), Date.parse(event.last_update!));
  });

  await t.test('5b. one outcome per event, in input order, for a multi-event payload', () => {
    const events = ['nba-final', 'nba-live', 'nba-upcoming'].map(firstEvent);
    const out = parse(events, 'NBA');
    assert.deepEqual(
      out.map((o) => o.eventId),
      events.map((e) => e.id),
    );
    assert.deepEqual(
      out.map((o) => o.status),
      ['final', 'not_final', 'not_final'],
    );
  });

  await t.test('6. live and upcoming are not_final', () => {
    assert.equal(parseOne(firstEvent('nba-live'), 'NBA').status, 'not_final');
    assert.equal(parseOne(firstEvent('nba-upcoming'), 'NBA').status, 'not_final');
  });

  await t.test('7. completed with null, one, three, non-numeric, negative, decimal scores: rejected', () => {
    const base = firstEvent('nba-final');
    const [home, away] = [base.home_team, base.away_team];
    const variants: Array<[string, ScoreEntry[] | null]> = [
      ['null scores', null],
      ['one score', [{ name: home, score: '113' }]],
      [
        'three scores',
        [
          { name: home, score: '113' },
          { name: away, score: '103' },
          { name: away, score: '1' },
        ],
      ],
      ['non-numeric', [{ name: home, score: '113' }, { name: away, score: 'N/A' }]],
      ['negative', [{ name: home, score: '113' }, { name: away, score: '-3' }]],
      ['decimal', [{ name: home, score: '113.5' }, { name: away, score: '103' }]],
    ];
    for (const [label, scores] of variants) {
      const out = parseOne({ ...base, scores }, 'NBA');
      assert.equal(out.status, 'rejected', label);
      assert.ok(out.reason, `${label}: rejection carries a named reason`);
    }
    // The fixture forms of the same cases.
    assert.equal(parseOne(firstEvent('nba-completed-scores-null'), 'NBA').status, 'rejected');
    assert.equal(parseOne(firstEvent('nba-non-numeric-score'), 'NBA').status, 'rejected');
  });

  await t.test('8. score names not equal to home/away: rejected; swapped order assigns by name', () => {
    const mismatch = parseOne(firstEvent('nba-score-name-mismatch'), 'NBA');
    assert.equal(mismatch.status, 'rejected');
    assert.ok(mismatch.reason);

    const base = firstEvent('nba-final');
    const duplicateName = parseOne(
      {
        ...base,
        scores: [
          { name: base.home_team, score: '113' },
          { name: base.home_team, score: '103' },
        ],
      },
      'NBA',
    );
    assert.equal(duplicateName.status, 'rejected', 'both entries naming the home team');

    const swapped = parseOne(firstEvent('nba-swapped-order'), 'NBA');
    assert.equal(swapped.status, 'final');
    assert.equal(swapped.homeTeam, 'Dallas Mavericks');
    assert.equal(swapped.homeScore, 98);
    assert.equal(swapped.awayTeam, 'Houston Rockets');
    assert.equal(swapped.awayScore, 120);
  });

  await t.test('9. last_update null, before commence, in the future, or inside the settle delay: not final', () => {
    assert.notEqual(parseOne(firstEvent('nba-completed-last-update-null'), 'NBA').status, 'final');

    const base = firstEvent('nba-final');
    assert.notEqual(
      parseOne({ ...base, last_update: '2026-11-07T23:00:00Z' }, 'NBA').status,
      'final',
      'last_update before commence_time',
    );
    assert.notEqual(
      parseOne({ ...base, last_update: '2026-11-10T00:00:00Z' }, 'NBA').status,
      'final',
      'last_update in the future',
    );
    assert.notEqual(
      parseOne({ ...base, last_update: 'not-a-timestamp' }, 'NBA').status,
      'final',
      'last_update not a timestamp',
    );

    const lastUpdate = Date.parse(base.last_update!);
    const inside = parseOne(base, 'NBA', new Date(lastUpdate + 5 * 60_000));
    assert.equal(inside.status, 'not_final', 'inside the 15 minute settle delay');
    const atBoundary = parseOne(base, 'NBA', new Date(lastUpdate + 15 * 60_000));
    assert.equal(atBoundary.status, 'final', 'exactly 15 minutes is settled');
  });

  await t.test('9b. id not 32 characters or sport_key for another league: rejected', () => {
    const base = firstEvent('nba-final');
    assert.equal(parseOne({ ...base, id: 'short-id' }, 'NBA').status, 'rejected');
    assert.equal(parseOne(firstEvent('nba-wrong-sport-key'), 'NBA').status, 'rejected');
    assert.equal(parseOne(base, 'NHL').status, 'rejected', 'NBA event under an NHL request');
  });

  await t.test('10. NFL tie accepted; NBA and MLB tie rejected tie_not_possible', () => {
    const nfl = parseOne(firstEvent('nfl-tie'), 'NFL');
    assert.equal(nfl.status, 'final');
    assert.equal(nfl.homeScore, 20);
    assert.equal(nfl.awayScore, 20);

    const nbaBase = firstEvent('nba-final');
    const nbaTie = parseOne(
      {
        ...nbaBase,
        scores: [
          { name: nbaBase.home_team, score: '100' },
          { name: nbaBase.away_team, score: '100' },
        ],
      },
      'NBA',
    );
    assert.equal(nbaTie.status, 'rejected');
    assert.equal(nbaTie.reason, 'tie_not_possible');

    const mlbTie = parseOne(
      {
        ...nbaBase,
        sport_key: 'baseball_mlb',
        sport_title: 'MLB',
        home_team: 'New York Yankees',
        away_team: 'Boston Red Sox',
        scores: [
          { name: 'New York Yankees', score: '4' },
          { name: 'Boston Red Sox', score: '4' },
        ],
      },
      'MLB',
    );
    assert.equal(mlbTie.status, 'rejected');
    assert.equal(mlbTie.reason, 'tie_not_possible');
  });

  await t.test('11. NHL shootout, winner credited: 3-2 parses to final (total 5, margin +1/-1)', () => {
    const out = parseOne(firstEvent('nhl-shootout-winner-credited'), 'NHL');
    assert.equal(out.status, 'final');
    assert.equal(out.homeScore, 3);
    assert.equal(out.awayScore, 2);
    assert.equal(out.homeScore! + out.awayScore!, 5);
    assert.equal(out.homeScore! - out.awayScore!, 1);
    assert.equal(out.awayScore! - out.homeScore!, -1);
  });

  await t.test('12. NHL shootout, equal scores with completed true: rejected tie_not_possible', () => {
    const out = parseOne(firstEvent('nhl-shootout-equal-scores'), 'NHL');
    assert.equal(out.status, 'rejected');
    assert.equal(out.reason, 'tie_not_possible');
    // "nothing written" is asserted against repositories in odds-api-scores-resolver.test.ts.
  });

  await t.test('13. NHL overtime one-goal final parses as an ordinary final', () => {
    const out = parseOne(firstEvent('nhl-overtime-final'), 'NHL');
    assert.equal(out.status, 'final');
    assert.equal(out.homeScore, 3);
    assert.equal(out.awayScore, 2);
    assert.equal(parseOne(firstEvent('nhl-regulation-final'), 'NHL').status, 'final');
  });

  await t.test('13b. every fixture parses to the outcome its envelope declares', () => {
    for (const file of readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'))) {
      const fixture = loadFixture(file);
      const at = new Date(fixture.evaluateAt);
      const [out] = parse(fixture.response, fixture.league, at);
      assert.ok(out, file);
      const [status, reason] = fixture.expectedParse.split(':');
      if (status === 'not_final_or_rejected') {
        assert.notEqual(out.status, 'final', file);
      } else {
        assert.equal(out.status, status, file);
        if (reason) assert.equal(out.reason, reason, file);
      }
    }
  });

  await t.test('13c. a non-array payload is refused rather than read as zero events', () => {
    assert.throws(() => parse({ message: 'quota exceeded' }, 'NBA'));
  });
});
