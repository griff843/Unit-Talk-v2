import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTables } from './index.js';
import { canonicalSchema } from './schema.js';

test('canonical table registry includes canonical reference backbone tables', () => {
  for (const table of ['leagues', 'teams', 'players', 'player_team_assignments']) {
    assert.ok(canonicalTables.includes(table as (typeof canonicalTables)[number]));
  }
});

test('canonical schema metadata includes expected owners for backbone tables', () => {
  const leagues = canonicalSchema.find((row) => row.name === 'leagues');
  const teams = canonicalSchema.find((row) => row.name === 'teams');
  const players = canonicalSchema.find((row) => row.name === 'players');
  const assignments = canonicalSchema.find((row) => row.name === 'player_team_assignments');

  assert.ok(leagues);
  assert.equal(leagues.owner, 'platform');
  assert.ok(teams);
  assert.equal(teams.owner, 'platform');
  assert.ok(players);
  assert.equal(players.owner, 'platform');
  assert.ok(assignments);
  assert.equal(assignments.owner, 'api');
});

import { DatabaseReferenceDataRepository } from './runtime-repositories.js';

// ---------------------------------------------------------------------------
// UTV2-1854 — reference-data search must answer from `participants`
//
// `getCatalog`, `getEventBrowse` and every consumer in
// apps/api/src/handlers/reference-data.ts are written against `participants`
// ids. Before this lane `searchTeams` and `searchPlayers` were the only two
// methods answering with canonical `teams`/`players` ids, and both of those
// tables are empty under parked provider ingestion — so every query returned
// `[]`. That is a false refusal, not an honest absence, and it is what blocks
// the structured Smart Form path.
// ---------------------------------------------------------------------------

type SearchHarness = {
  client: { from(table: string): unknown };
  searchTeams(sportId: string, query: string, limit: number): Promise<unknown[]>;
  searchPlayers(sportId: string, query: string, limit: number): Promise<unknown[]>;
};

function harness(from: (table: string) => unknown): SearchHarness {
  return Object.create(DatabaseReferenceDataRepository.prototype, {
    client: { value: { from }, enumerable: true },
  }) as unknown as SearchHarness;
}

/**
 * Records every builder call so a test can assert the whole query, not just its
 * result. The builder is BOTH chainable and awaitable: the patched `searchTeams`
 * ends its query at `.eq(...)` with no `.limit(...)` (it reads the whole sport and
 * ranks in process), while `searchPlayers` still terminates at `.limit(...)`. A
 * builder that were only chainable would resolve to itself for the first of those,
 * and the test would assert against an object rather than a result set.
 */
function recordingBuilder(
  calls: Array<[string, unknown[]]>,
  rows: Array<Record<string, unknown>>,
): unknown {
  const result = { data: rows, error: null };
  const builder: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ['select', 'eq', 'ilike', 'order', 'in', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  return builder;
}

test('searchTeams reads participants scoped by sport and answers with participant ids', async () => {
  const calls: Array<[string, unknown[]]> = [];
  const tables: string[] = [];
  const repository = harness((table) => {
    tables.push(table);
    return recordingBuilder(calls, [
      { id: 'participant-knicks', display_name: 'New York Knicks' },
    ]);
  });

  const results = await repository.searchTeams('NBA', 'knick', 10);

  assert.deepEqual(tables, ['participants']);
  assert.deepEqual(results, [
    { participantId: 'participant-knicks', displayName: 'New York Knicks', sport: 'NBA' },
  ]);
  // The sport scope is a query predicate, so the read is bounded to one sport's
  // 30-32 team participants and nothing from another sport can reach the ranking.
  assert.ok(calls.some(([m, a]) => m === 'eq' && a[0] === 'sport' && a[1] === 'NBA'));
  assert.ok(calls.some(([m, a]) => m === 'eq' && a[0] === 'participant_type' && a[1] === 'team'));
  // The operator's text is deliberately NOT pushed into the query. It is matched
  // in process against nickname, city and abbreviation, so it never reaches
  // PostgREST's filter grammar and a `display_name`-only `ilike` cannot make
  // "milwaukee" or "mil" unfindable. Asserting the absence is the point: an
  // `ilike` reappearing here would silently reintroduce both problems.
  assert.ok(!calls.some(([m]) => m === 'ilike'), 'the query must not filter on the raw operator text');
  assert.ok(!calls.some(([m]) => m === 'limit'), 'the sport is bounded, so limit is applied after ranking');
});

test('searchTeams no longer reads the canonical teams or leagues tables', async () => {
  const forbidden: string[] = [];
  const repository = harness((table) => {
    if (table !== 'participants') { forbidden.push(table); }
    return recordingBuilder([], []);
  });

  await repository.searchTeams('NBA', 'knick', 10);

  // Reverting this lane reintroduces `listLeagues` + `fromUntyped('teams')`,
  // both of which are empty under parked ingestion, and turns this red.
  assert.deepEqual(forbidden, []);
});

test('searchPlayers scopes by sport in the query and never reads player_team_assignments', async () => {
  const calls: Array<[string, unknown[]]> = [];
  const tables: string[] = [];
  const repository = harness((table) => {
    tables.push(table);
    return recordingBuilder(calls, [
      { id: 'participant-brunson', display_name: 'Jalen Brunson', metadata: {} },
    ]);
  });

  await repository.searchPlayers('NBA', 'bruns', 10);

  assert.equal(tables.includes('player_team_assignments'), false);
  assert.equal(tables.includes('players'), false);
  assert.ok(calls.some(([m, a]) => m === 'eq' && a[0] === 'sport' && a[1] === 'NBA'));
  assert.ok(calls.some(([m, a]) => m === 'eq' && a[0] === 'participant_type' && a[1] === 'player'));
});

test('searchPlayers resolves teamId through participants.external_id and reports absence honestly', async () => {
  const teamLookupArgs: unknown[][] = [];
  const repository = harness((table) => {
    assert.equal(table, 'participants');
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'ilike', 'order']) {
      builder[method] = () => builder;
    }
    builder.limit = () =>
      Promise.resolve({
        data: [
          { id: 'p-brunson', display_name: 'Jalen Brunson', metadata: { team_external_id: 'NEW_YORK_KNICKS_NBA' } },
          { id: 'p-unknown', display_name: 'Unmapped Player', metadata: { team_external_id: 'NOT_IN_DB' } },
          { id: 'p-none', display_name: 'No Team Player', metadata: {} },
        ],
        error: null,
      });
    builder.in = (column: string, values: unknown[]) => {
      teamLookupArgs.push([column, values]);
      return Promise.resolve({
        data: [{ id: 'p-knicks', external_id: 'NEW_YORK_KNICKS_NBA' }],
        error: null,
      });
    };
    return builder;
  });

  const results = (await repository.searchPlayers('NBA', 'a', 25)) as Array<{
    participantId: string;
    teamId: string | null;
  }>;

  // One batched lookup for the whole page, not one per row.
  assert.equal(teamLookupArgs.length, 1);
  assert.equal(teamLookupArgs[0]?.[0], 'external_id');
  assert.deepEqual(results.map((row) => [row.participantId, row.teamId]), [
    ['p-brunson', 'p-knicks'],
    ['p-unknown', null],
    ['p-none', null],
  ]);
});

test('searchTeams treats an empty query as "what is available", not "nothing matches"', async () => {
  // `handleGetReferenceDataAvailability` calls `searchTeams(sport, '', 1)` to set
  // `teamsAvailable`. The `ilike '%%'` this replaced matched every row, so an empty
  // query must keep returning rows. A rewrite that short-circuits to [] reports
  // every sport as having no teams, and no test that passes a real query sees it.
  const repository = harness(() =>
    recordingBuilder([], [
      { id: 't-2', display_name: 'Bulls' },
      { id: 't-1', display_name: 'Bucks' },
    ]),
  );

  const results = (await repository.searchTeams('NBA', '', 1)) as Array<{ displayName: string }>;

  assert.equal(results.length, 1, 'an empty query must still report availability');
  assert.equal(results[0]!.displayName, 'Bucks', 'and must be ordered deterministically');
});

test('searchTeams finds a team by its city and its abbreviation, not only its nickname', async () => {
  // `participants(team).display_name` is the nickname alone ("Bucks"); the city
  // lives in `external_id` ("MILWAUKEE_BUCKS_NBA") and the short code in
  // `metadata.abbreviation` ("mil"). A display-name-only match finds nothing for
  // either of the two things an operator actually types.
  const rows = [
    {
      id: 't-bucks',
      display_name: 'Bucks',
      external_id: 'MILWAUKEE_BUCKS_NBA',
      metadata: { abbreviation: 'mil' },
    },
    {
      id: 't-bulls',
      display_name: 'Bulls',
      external_id: 'CHICAGO_BULLS_NBA',
      metadata: { abbreviation: 'chi' },
    },
  ];
  for (const [query, expected] of [
    ['milwaukee', ['t-bucks']],
    ['mil', ['t-bucks']],
    ['bucks', ['t-bucks']],
    ['chicago bulls', ['t-bulls']],
  ] as Array<[string, string[]]>) {
    const repository = harness(() => recordingBuilder([], rows));
    const results = (await repository.searchTeams('NBA', query, 25)) as Array<{
      participantId: string;
    }>;
    assert.deepEqual(results.map((row) => row.participantId), expected, `query "${query}"`);
  }
});
