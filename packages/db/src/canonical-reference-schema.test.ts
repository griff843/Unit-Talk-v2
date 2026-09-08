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

import {
  DatabaseReferenceDataRepository,
  InMemoryReferenceDataRepository,
} from './runtime-repositories.js';
import { V1_REFERENCE_DATA } from '@unit-talk/contracts';

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
  // PostgREST semantics are emulated for exactly one predicate: the
  // `metadata->>proofIssue IS NULL` proof-fixture exclusion. Recording the call
  // proves the predicate is *sent*; applying it proves the rows it excludes are
  // the ones intended. Without this the exclusion tests would assert against
  // rows the real database would never have returned.
  let current = rows;
  const result = () => ({ data: current, error: null });
  const builder: Record<string, unknown> = {
    then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
      Promise.resolve(result()).then(resolve),
  };
  for (const method of ['select', 'eq', 'ilike', 'order', 'in', 'is', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      if (method === 'is' && args[0] === 'metadata->>proofIssue' && args[1] === null) {
        current = current.filter((row) => {
          const metadata = row.metadata;
          if (typeof metadata !== 'object' || metadata === null) return true;
          const marker = (metadata as Record<string, unknown>)['proofIssue'];
          return marker === undefined || marker === null;
        });
      }
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
    for (const method of ['select', 'eq', 'is', 'ilike', 'order']) {
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

// ---------------------------------------------------------------------------
// UTV2-1854 PROOF_FIXTURE_EXCLUSION
//
// 26 player participants in production carry `metadata.proofIssue` (13 from
// UTV2-614, 13 from UTV2-618, created 2026-05-28/29 before staging isolation
// moved proof runs off production). They are real rows in the observation layer
// but they are not athletes, so they must not be selectable and must not set
// `playersAvailable`. Nothing is deleted; the rows are preserved and excluded.
//
// The measurement that shapes these tests: those 26 fixtures are EXACTLY the 26
// players with no `team_external_id`, and production contains zero legitimate
// team-less players. The two predicates are indistinguishable in current data,
// so the preservation case below is built from a constructed row -- a test that
// used production's shape could not tell a correct implementation from one that
// drops every team-less player.
// ---------------------------------------------------------------------------

test('searchPlayers excludes confirmed proof fixtures as a query predicate, before the limit', async () => {
  const calls: Array<[string, unknown[]]> = [];
  const repository = harness(() => recordingBuilder(calls, []));

  await repository.searchPlayers('NBA', 'a', 10);

  const isCall = calls.find(([m, a]) => m === 'is' && a[0] === 'metadata->>proofIssue');
  assert.ok(isCall, 'the fixture exclusion must be pushed into the query');
  assert.equal(isCall![1][1], null);

  // Order is the load-bearing part, not merely presence. `searchPlayers` applies
  // `limit` in the query, so an exclusion applied after the rows come back would
  // let fixtures consume the page and displace real players -- a false negative
  // of the same class the UTV2-1672 sport-scope guard exists to prevent.
  const isIndex = calls.findIndex(([m, a]) => m === 'is' && a[0] === 'metadata->>proofIssue');
  const limitIndex = calls.findIndex(([m]) => m === 'limit');
  assert.ok(limitIndex >= 0, 'searchPlayers still bounds its read');
  assert.ok(isIndex < limitIndex, 'the exclusion must be applied before the limit');
});

test('searchTeams excludes confirmed proof fixtures without dropping ordinary teams', async () => {
  // No team participant carries the marker in production today (0 of 124), so
  // this guard is a no-op on current data. It is asserted anyway: a fixture team
  // would otherwise become selectable and set `teamsAvailable`, which is the same
  // defect the 26 player fixtures produce on the sibling path.
  const repository = harness(() =>
    recordingBuilder([], [
      { id: 't-real', display_name: 'Knicks', external_id: 'NEW_YORK_KNICKS_NBA', metadata: {} },
      {
        id: 't-fixture',
        display_name: 'Knicks Proof',
        external_id: 'PROOF_TEAM_NBA',
        metadata: { proofIssue: 'UTV2-614' },
      },
    ]),
  );

  const results = (await repository.searchTeams('NBA', 'knick', 25)) as Array<{
    participantId: string;
  }>;

  assert.deepEqual(results.map((row) => row.participantId), ['t-real']);
});

test('searchPlayers preserves a legitimate team-less player while excluding a fixture', async () => {
  // The distinguishing case production cannot supply. Both rows lack
  // `team_external_id`; only one is marked. A "drop players with no team"
  // implementation returns [] here and still agrees with every production
  // observation, which is precisely why this row is constructed.
  const rows = [
    { id: 'p-legit', display_name: 'Rookie Callup', metadata: {} },
    { id: 'p-fixture', display_name: 'Rookie Proof', metadata: { proofIssue: 'UTV2-618' } },
  ];
  const repository = harness((table) =>
    // The batched team lookup finds nothing, because neither row names a team.
    recordingBuilder([], table === 'participants' ? rows : []),
  );

  const results = (await repository.searchPlayers('NBA', 'rookie', 10)) as Array<{
    participantId: string;
    teamId: string | null;
  }>;

  assert.deepEqual(
    results.map((row) => row.participantId),
    ['p-legit'],
    'the marked row is excluded and the unmarked one is kept',
  );
  assert.equal(results[0]!.teamId, null, 'missing team coverage stays honest, not fabricated');
});

test('a proofIssue that names no issue is not a confirmed fixture', async () => {
  // JSON `null` carries no issue identity, so it does not confirm anything. The
  // pushed-down predicate (`metadata->>proofIssue IS NULL`) and the in-process
  // one must agree on this, or the database and in-memory paths would disagree
  // about the same row.
  const repository = harness((table) =>
    recordingBuilder(
      [],
      table === 'participants'
        ? [{ id: 'p-null-marker', display_name: 'Ambiguous Row', metadata: { proofIssue: null } }]
        : [],
    ),
  );

  const results = (await repository.searchPlayers('NBA', 'ambiguous', 10)) as Array<{
    participantId: string;
  }>;

  assert.deepEqual(results.map((row) => row.participantId), ['p-null-marker']);
});

test('the in-memory repository applies the same proof-fixture exclusion, before its limit', async () => {
  // The in-memory repository is what the contained Playwright harness and every
  // fail-open runtime answer from, so an exclusion that existed only on the
  // database path would let a fixture reappear wherever the credential is
  // absent -- exactly the environments an operator uses to check the form.
  const participant = (
    id: string,
    displayName: string,
    metadata: Record<string, string>,
  ) => ({
    id,
    display_name: displayName,
    external_id: id,
    league: null,
    sport: 'NBA',
    participant_type: 'player',
    metadata,
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
  });

  const repository = new InMemoryReferenceDataRepository(V1_REFERENCE_DATA, {
    participants: [
      // Sorts first, so with a limit of 1 a post-filter implementation would
      // return nothing at all and the real player would be unreachable.
      participant('p-fixture', 'Aaa Fixture Player', { proofIssue: 'UTV2-618' }),
      participant('p-legit', 'Zzz Real Player', {}),
    ],
  });

  const unlimited = await repository.searchPlayers('NBA', 'player', 25);
  assert.deepEqual(
    unlimited.map((row) => row.participantId),
    ['p-legit'],
    'the marked row is excluded and the unmarked one kept',
  );
  assert.equal(unlimited[0]!.teamId, null, 'a missing team is reported honestly');

  const limited = await repository.searchPlayers('NBA', 'player', 1);
  assert.deepEqual(
    limited.map((row) => row.participantId),
    ['p-legit'],
    'a fixture must not consume the limit and displace a real player',
  );
});
