import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  createInMemoryRepositoryBundle,
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

// ---------------------------------------------------------------------------
// UTV2-1856 — event browse must resolve participant identity from `participants`
//
// `getEventBrowse` and the player half of `searchBrowse` resolved identity
// through `loadCanonicalTeamsByParticipantIds` (provider_entity_aliases where
// entity_kind='team', then `teams`) and `loadCurrentAssignments`
// (player_team_assignments). Measured read-only on production 2026-09-08:
// `teams` 0 rows, `player_team_assignments` 0 rows, and all 840
// `provider_entity_aliases` rows are entity_kind='player'. Both maps are empty
// unconditionally, so every player came back `teamId: null`, which
// apps/api/src/smart-form-validation.ts:448 rejected on every canonical-event
// player prop and which made BetForm's player picker empty once a team was
// selected.
//
// Every harness below therefore leaves the canonical tables EMPTY. That is not
// a convenience -- it is the production condition under containment, and a
// fixture that populated them would prove the fix on data the running system
// does not have.
// ---------------------------------------------------------------------------

type BrowseTables = Record<string, Array<Record<string, unknown>>>;

/**
 * Resolves every table to its fixture rows and supports `maybeSingle()`, which
 * `getEventBrowse` uses for the event row itself. Predicates are NOT emulated
 * here, unlike `recordingBuilder` above: each fixture below names exactly the
 * rows its query would return, so emulating `.in(...)` would only re-implement
 * the fixture. The one predicate that must be observable -- the proof-fixture
 * exclusion -- is asserted through the RESULT, not through the call log, because
 * in this path it is an in-process `continue` rather than a pushed-down filter.
 */
function browseHarness(tables: BrowseTables): DatabaseReferenceDataRepository {
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
      maybeSingle: () =>
        Promise.resolve({ data: rows[0] ?? null, error: null }),
    };
    for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'ilike']) {
      builder[method] = () => builder;
    }
    return builder;
  };
  return Object.create(DatabaseReferenceDataRepository.prototype, {
    client: { value: { from }, enumerable: true },
  }) as DatabaseReferenceDataRepository;
}

const HOME_TEAM = {
  id: 'participant-team-home',
  external_id: 'CLUB-HOME',
  participant_type: 'team',
  sport: 'NBA',
  display_name: 'Home Club',
  metadata: {},
};

/** `external_id: null` keeps `loadEventOffers` out of the picture entirely. */
const BROWSE_EVENT = {
  id: 'event-1',
  event_name: 'Away Club @ Home Club',
  event_date: '2026-09-08',
  status: 'scheduled',
  sport_id: 'NBA',
  external_id: null,
  metadata: {},
};

test('getEventBrowse resolves a player team through the participants edge while the canonical tables are empty', async () => {
  const repository = browseHarness({
    events: [BROWSE_EVENT],
    event_participants: [
      { event_id: 'event-1', participant_id: 'participant-team-home', role: 'home' },
      { event_id: 'event-1', participant_id: 'participant-player-1', role: 'competitor' },
    ],
    participants: [
      HOME_TEAM,
      {
        id: 'participant-player-1',
        external_id: 'PLAYER-1',
        participant_type: 'player',
        sport: 'NBA',
        display_name: 'Rostered Player',
        metadata: { team_external_id: 'CLUB-HOME' },
      },
    ],
    provider_entity_aliases: [],
    teams: [],
    player_team_assignments: [],
    leagues: [],
  });

  const result = await repository.getEventBrowse('event-1');
  const player = result?.participants.find(
    (participant) => participant.participantId === 'participant-player-1',
  );

  assert.ok(player, 'the player must be present in the browse result');
  assert.equal(
    player.teamId,
    'participant-team-home',
    'teamId must be the team PARTICIPANT id -- the id space searchTeams, searchPlayers and the whole handler layer already use',
  );
  assert.equal(player.teamName, 'Home Club');
});

test('getEventBrowse reports an honest null for a player with no team key, and does not fabricate one', async () => {
  const repository = browseHarness({
    events: [BROWSE_EVENT],
    event_participants: [
      { event_id: 'event-1', participant_id: 'participant-team-home', role: 'home' },
      { event_id: 'event-1', participant_id: 'participant-player-2', role: 'competitor' },
    ],
    participants: [
      HOME_TEAM,
      {
        id: 'participant-player-2',
        external_id: 'PLAYER-2',
        participant_type: 'player',
        sport: 'NBA',
        display_name: 'Team-less Player',
        metadata: {},
      },
    ],
    provider_entity_aliases: [],
    teams: [],
    player_team_assignments: [],
    leagues: [],
  });

  const result = await repository.getEventBrowse('event-1');
  const player = result?.participants.find(
    (participant) => participant.participantId === 'participant-player-2',
  );

  assert.ok(player, 'a team-less player is still a legitimate participant and must be retained');
  assert.equal(player.teamId, null, 'no team key means no team -- never the only team in the event');
  assert.equal(player.teamName, null);
});

test('getEventBrowse leaves a player whose team key names a team outside this event unrelated', async () => {
  const repository = browseHarness({
    events: [BROWSE_EVENT],
    event_participants: [
      { event_id: 'event-1', participant_id: 'participant-team-home', role: 'home' },
      { event_id: 'event-1', participant_id: 'participant-player-3', role: 'competitor' },
    ],
    participants: [
      HOME_TEAM,
      {
        id: 'participant-player-3',
        external_id: 'PLAYER-3',
        participant_type: 'player',
        sport: 'NBA',
        display_name: 'Elsewhere Player',
        metadata: { team_external_id: 'CLUB-SOMEWHERE-ELSE' },
      },
    ],
    provider_entity_aliases: [],
    teams: [],
    player_team_assignments: [],
    leagues: [],
  });

  const result = await repository.getEventBrowse('event-1');
  const player = result?.participants.find(
    (participant) => participant.participantId === 'participant-player-3',
  );

  assert.ok(player);
  assert.equal(
    player.teamId,
    null,
    'a key that matches no team IN THIS EVENT must not fall through to whichever team is present',
  );
});

test('getEventBrowse excludes a confirmed proof fixture attached to an event while retaining the legitimate player beside it', async () => {
  const repository = browseHarness({
    events: [BROWSE_EVENT],
    event_participants: [
      { event_id: 'event-1', participant_id: 'participant-team-home', role: 'home' },
      { event_id: 'event-1', participant_id: 'participant-player-1', role: 'competitor' },
      { event_id: 'event-1', participant_id: 'participant-fixture', role: 'competitor' },
    ],
    participants: [
      HOME_TEAM,
      {
        id: 'participant-player-1',
        external_id: 'PLAYER-1',
        participant_type: 'player',
        sport: 'NBA',
        display_name: 'Rostered Player',
        metadata: { team_external_id: 'CLUB-HOME' },
      },
      {
        // Deliberately given a REAL team key, so it would resolve and be pickable
        // if the exclusion were absent. A fixture with no key would be excluded by
        // accident -- it would simply carry teamId: null -- and the test would
        // pass without the control existing. This is the constructed case: on
        // production, 0 of the 26 confirmed fixtures sit in any event_participants
        // row, so no production row exercises this path.
        id: 'participant-fixture',
        external_id: 'FIXTURE-1',
        participant_type: 'player',
        sport: 'NBA',
        display_name: 'Proof Fixture Player',
        metadata: { team_external_id: 'CLUB-HOME', proofIssue: 'UTV2-1672' },
      },
    ],
    provider_entity_aliases: [],
    teams: [],
    player_team_assignments: [],
    leagues: [],
  });

  const result = await repository.getEventBrowse('event-1');
  const ids = (result?.participants ?? []).map(
    (participant) => participant.participantId,
  );

  assert.ok(
    !ids.includes('participant-fixture'),
    'a confirmed proof fixture must not be selectable in the picker this result feeds',
  );
  assert.ok(
    ids.includes('participant-player-1'),
    'the legitimate player on the same event must be retained -- exclusion must not be a blunt drop',
  );
  assert.ok(
    ids.includes('participant-team-home'),
    'and the ordinary team participant must be retained',
  );
});

test('getEventBrowse keeps a row whose proofIssue is null: that names no issue and is not a confirmed fixture', async () => {
  const repository = browseHarness({
    events: [BROWSE_EVENT],
    event_participants: [
      { event_id: 'event-1', participant_id: 'participant-team-home', role: 'home' },
      { event_id: 'event-1', participant_id: 'participant-player-4', role: 'competitor' },
    ],
    participants: [
      HOME_TEAM,
      {
        id: 'participant-player-4',
        external_id: 'PLAYER-4',
        participant_type: 'player',
        sport: 'NBA',
        display_name: 'Null Marker Player',
        metadata: { team_external_id: 'CLUB-HOME', proofIssue: null },
      },
    ],
    provider_entity_aliases: [],
    teams: [],
    player_team_assignments: [],
    leagues: [],
  });

  const result = await repository.getEventBrowse('event-1');
  const player = result?.participants.find(
    (participant) => participant.participantId === 'participant-player-4',
  );

  assert.ok(
    player,
    'the browse predicate must agree with isConfirmedProofFixture, which treats a null marker as naming no issue',
  );
  assert.equal(player.teamId, 'participant-team-home');
});

// ---------------------------------------------------------------------------
// UTV2-1856 — the in-memory and database reference-data repositories are two
// implementations of one interface, and they had diverged in three places.
//
// Server-side evidence could not see it: every server test asserted the
// database path, every in-memory test asserted the in-memory path, and nothing
// compared them. The operator-visible consequence was that a canonical player
// prop submitted through the fail-open harness returned 422 from
// `validateSearchBackedPlayer`, because the player's resolved `teamId` was
// hardcoded `null` and the team's `participantId` was a synthetic string that
// could never equal a participant id anyway.
//
// This is the same defect class as UTV2-1688 and UTV2-1859: one rule stored
// twice, one copy changed, all tests green because each copy is tested against
// itself. The tests below compare the copies.
// ---------------------------------------------------------------------------

test('the in-memory repository resolves a player team through the participants edge, as the database path does', async () => {
  const row = (
    id: string,
    displayName: string,
    participantType: 'team' | 'player',
    externalId: string | null,
    metadata: Record<string, unknown>,
    sport = 'NBA',
  ) => ({
    id,
    display_name: displayName,
    external_id: externalId,
    league: sport,
    sport,
    participant_type: participantType,
    metadata,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  });

  const repository = new InMemoryReferenceDataRepository(V1_REFERENCE_DATA, {
    participants: [
      row('team-lakers', 'Lakers', 'team', 'nba:lakers', {}),
      row('team-other-sport', 'Lakers', 'team', 'nba:lakers', {}, 'NFL'),
      row('p-linked', 'Linked Player', 'player', 'p1', { team_external_id: 'nba:lakers' }),
      row('p-unlinked', 'Unlinked Player', 'player', 'p2', {}),
      row('p-dangling', 'Dangling Player', 'player', 'p3', { team_external_id: 'nba:no-such-team' }),
      row('p-cross-sport', 'Cross Sport Player', 'player', 'p4', { team_external_id: 'nfl:lakers' }),
    ] as never,
  });

  const players = await repository.searchPlayers('NBA', 'Player', 25);
  const byName = new Map(players.map((p) => [p.displayName, p.teamId]));

  assert.equal(
    byName.get('Linked Player'),
    'team-lakers',
    'a player whose team key names a seeded team in the same sport resolves to that team participant id',
  );
  assert.equal(
    byName.get('Unlinked Player'),
    null,
    'a player carrying no team key gets an honest null, never a guessed team',
  );
  assert.equal(
    byName.get('Dangling Player'),
    null,
    'a team key naming no seeded team gets an honest null',
  );
  assert.equal(
    byName.get('Cross Sport Player'),
    null,
    'a team key is resolved within the queried sport only; a same-named team in another sport is not a match',
  );
});

test('the in-memory repository answers searchTeams with real participant ids when teams are seeded', async () => {
  const seeded = new InMemoryReferenceDataRepository(V1_REFERENCE_DATA, {
    participants: [
      {
        id: 'team-lakers',
        display_name: 'Lakers',
        external_id: 'nba:lakers',
        league: 'NBA',
        sport: 'NBA',
        participant_type: 'team',
        metadata: {},
        created_at: '2026-09-08T00:00:00Z',
        updated_at: '2026-09-08T00:00:00Z',
      },
    ] as never,
  });

  const seededResults = await seeded.searchTeams('NBA', 'Lakers', 5);
  assert.deepEqual(
    seededResults.map((team) => team.participantId),
    ['team-lakers'],
    'a seeded team answers with its own row id, which is what a resolved player teamId can equal',
  );

  // Behaviour preservation: with no seeded team participants there is no real
  // id to return, so the catalog-derived form is kept rather than dropping the
  // team from the result entirely.
  const unseeded = new InMemoryReferenceDataRepository(V1_REFERENCE_DATA);
  const unseededResults = await unseeded.searchTeams('NBA', 'Lakers', 5);
  assert.deepEqual(
    unseededResults.map((team) => team.participantId),
    ['team:NBA:Lakers'],
  );
});

test('the in-memory bundle seeds one participant set both repositories agree on', async () => {
  // The seeding is opt-in under the repository's existing QA-seed flag, which
  // is what the contained Playwright harness sets. The default-off case is
  // asserted by its own test below.
  const previous = process.env['UNIT_TALK_QA_SEED_ENABLED'];
  process.env['UNIT_TALK_QA_SEED_ENABLED'] = 'true';
  const bundle = (() => {
    try {
      return createInMemoryRepositoryBundle();
    } finally {
      if (previous === undefined) delete process.env['UNIT_TALK_QA_SEED_ENABLED'];
      else process.env['UNIT_TALK_QA_SEED_ENABLED'] = previous;
    }
  })();

  const teams = await bundle.referenceData.searchTeams('NBA', 'Lakers', 5);
  const team = teams.find((row) => row.displayName === 'Lakers');
  assert.ok(team, 'the seeded catalog answers a team search');

  const participantRow = await bundle.participants.findById(team.participantId);
  assert.ok(
    participantRow,
    'searchTeams returns an id the participant repository can actually resolve — a synthetic id could not',
  );

  const players = await bundle.referenceData.searchPlayers('NBA', 'Lakers', 25);
  assert.ok(players.length > 0, 'the seeded bundle answers a player search');
  assert.ok(
    players.some((player) => player.teamId === team.participantId),
    'at least one seeded player resolves to exactly the team id searchTeams returned — the equality validateSearchBackedPlayer requires',
  );

  const unaffiliated = await bundle.referenceData.searchPlayers('NBA', 'Unaffiliated', 5);
  assert.ok(unaffiliated.length > 0, 'the honest-null case exists in the seeded data, not only in fixtures');
  assert.equal(
    unaffiliated[0]!.teamId,
    null,
    'a seeded player with no team key still reports null rather than a guessed team',
  );
});

test('the in-memory bundle carries no QA player fixtures unless the QA seed flag is set', async () => {
  // Fixture data appearing unasked is the failure direction that matters: every
  // API unit test builds this bundle expecting a blank runtime, and a seeded
  // player would silently change what `/api/reference-data/availability`
  // reports about a sport. The safe default is the empty one.
  const previous = process.env['UNIT_TALK_QA_SEED_ENABLED'];
  delete process.env['UNIT_TALK_QA_SEED_ENABLED'];
  try {
    const bundle = createInMemoryRepositoryBundle();
    const players = await bundle.referenceData.searchPlayers('NBA', 'Starter', 25);
    assert.deepEqual(players, [], 'no QA player fixture exists without the flag');

    // Teams are a different case and deliberately so: the bundle has always
    // seeded team participants into the participant repository, so a real id
    // exists for them with or without the flag. What the flag gates is the
    // player fixture, which never existed before this lane.
    const teams = await bundle.referenceData.searchTeams('NBA', 'Lakers', 5);
    const team = teams.find((row) => row.displayName === 'Lakers');
    assert.ok(team, 'the catalog still answers a team search with the flag off');
    assert.ok(
      await bundle.participants.findById(team.participantId),
      'and it answers with an id the participant repository resolves, not a synthetic string',
    );
  } finally {
    if (previous !== undefined) process.env['UNIT_TALK_QA_SEED_ENABLED'] = previous;
  }
});

type NcaafRosterRow = {
  id: string;
  externalId: string;
  displayName: string;
  ncaaOrgId: number;
  subdivision: 'FBS' | 'FCS';
  abbreviation: string;
  institutionConference: string;
};

type NcaafRoster = {
  capturedAt: string;
  season: number;
  academicYear: number;
  sources: Array<{ url: string; sha256: string; count: number }>;
  reconciliation: {
    standingsMatched: number;
    membershipOnly: number[];
    excludedStandingsOnly: string[];
  };
  participants: NcaafRosterRow[];
};

const ncaafRoster = JSON.parse(
  readFileSync(
    new URL('./ncaaf-participant-roster.json', import.meta.url),
    'utf8',
  ),
) as NcaafRoster;

function governedNcaafParticipantId(ncaaOrgId: number): string {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const bytes = createHash('sha1')
    .update(namespace)
    .update(`unit-talk:participant:ncaaf:ncaa:${ncaaOrgId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

test('the frozen 2026 Division I football roster carries reviewed membership evidence', () => {
  assert.equal(ncaafRoster.season, 2026);
  assert.equal(ncaafRoster.academicYear, 2027);
  assert.equal(ncaafRoster.participants.length, 266);
  assert.equal(
    ncaafRoster.participants.filter((row) => row.subdivision === 'FBS').length,
    138,
  );
  assert.equal(
    ncaafRoster.participants.filter((row) => row.subdivision === 'FCS').length,
    128,
  );
  assert.deepEqual(
    ncaafRoster.sources.map(({ count }) => count),
    [138, 128],
  );
  assert.ok(
    ncaafRoster.sources.every(({ url }) =>
      url.startsWith('https://web3.ncaa.org/directory/api/'),
    ),
  );
  assert.ok(
    ncaafRoster.sources.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)),
  );
  assert.equal(ncaafRoster.reconciliation.standingsMatched, 264);
  assert.deepEqual(ncaafRoster.reconciliation.membershipOnly, [470, 11740]);
  assert.deepEqual(ncaafRoster.reconciliation.excludedStandingsOnly, [
    'Saint Francis',
  ]);
});

test('NCAAF participant identities are unique, deterministic, and school-qualified', () => {
  const ids = new Set<string>();
  const externalIds = new Set<string>();
  const displayNames = new Set<string>();
  const mascotOnlyNames = new Set([
    'bears',
    'bulldogs',
    'eagles',
    'panthers',
    'tigers',
    'wildcats',
  ]);

  for (const row of ncaafRoster.participants) {
    assert.equal(row.id, governedNcaafParticipantId(row.ncaaOrgId));
    assert.equal(row.externalId, `unit-talk:ncaaf:ncaa:${row.ncaaOrgId}`);
    assert.ok(!ids.has(row.id), `duplicate governed UUID: ${row.id}`);
    assert.ok(
      !externalIds.has(row.externalId),
      `duplicate external id: ${row.externalId}`,
    );
    assert.ok(
      !displayNames.has(row.displayName.toLowerCase()),
      `duplicate school name: ${row.displayName}`,
    );
    assert.ok(
      !mascotOnlyNames.has(row.displayName.toLowerCase()),
      `mascot-only display name is not canonical: ${row.displayName}`,
    );
    assert.ok(row.abbreviation.trim().length > 0);
    assert.ok(row.institutionConference.trim().length > 0);
    ids.add(row.id);
    externalIds.add(row.externalId);
    displayNames.add(row.displayName.toLowerCase());
  }
});

test('the NCAAF catalog migration is participants-only, additive, and conflict-refusing', () => {
  const migration = readFileSync(
    new URL(
      '../../../supabase/migrations/20261010170000_ncaaf_participant_catalog.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const rollback = readFileSync(
    new URL(
      '../../../db/migrations-rollback/20261010170000_ncaaf_participant_catalog.down.sql',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(migration, /INSERT INTO public\.participants/);
  assert.doesNotMatch(
    migration,
    /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*public\.teams/i,
  );
  assert.doesNotMatch(migration, /ON\s+CONFLICT/i);
  assert.match(migration, /canonical external identity conflict/);
  assert.match(migration, /governed UUID conflict/);
  assert.match(migration, /WHERE NOT EXISTS/);
  assert.match(migration, /'seedIssue', 'UTV2-1971'/);
  assert.match(rollback, /DELETE FROM public\.participants/);
  assert.match(rollback, /metadata->>'seedIssue' = 'UTV2-1971'/);
  assert.match(rollback, /rollback refused: seeded participant is referenced/);
  assert.doesNotMatch(rollback, /\b(?:CREATE|ALTER)\s+TABLE\b/i);
});


const participantCatalogTestAdmin = process.env['PARTICIPANT_CATALOG_TEST_ADMIN_URL'];

test('NCAAF rollback serializes concurrent references and refuses committed downstream use', {
  skip: !participantCatalogTestAdmin,
}, async () => {
  assert.ok(participantCatalogTestAdmin);
  const admin = new URL(participantCatalogTestAdmin);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(admin.hostname));
  assert.equal(admin.pathname, '/postgres');
  assert.equal(admin.search, '');
  const database = `participant_catalog_drill_ncaaf_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const scratch = new URL(admin);
  scratch.pathname = `/${database}`;
  const query = (dsn: string, sql: string) => execFileSync('psql', [
    dsn, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', sql,
  ], { encoding: 'utf8', timeout: 10_000 }).trim();
  const execute = (sql: string) => {
    const child = spawn('psql', [scratch.href, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']);
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const completed = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
    });
    child.stdin.end(sql);
    return completed;
  };
  const waitForPause = async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (query(scratch.href, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep');") === 't') return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail('controlled transaction did not reach its test-only pause');
  };
  const migration = readFileSync(new URL('../../../supabase/migrations/20261010170000_ncaaf_participant_catalog.sql', import.meta.url), 'utf8');
  const rollback = readFileSync(new URL('../../../db/migrations-rollback/20261010170000_ncaaf_participant_catalog.down.sql', import.meta.url), 'utf8');
  const participantId = ncaafRoster.participants[0]?.id;
  assert.ok(participantId);
  query(admin.href, `CREATE DATABASE ${database}`);
  try {
    query(scratch.href, "CREATE TABLE public.participants(id uuid PRIMARY KEY, external_id text UNIQUE, participant_type text NOT NULL, sport text, league text, display_name text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());");
    query(scratch.href, migration);
    query(scratch.href, 'CREATE TABLE public.concurrent_reference(id uuid REFERENCES public.participants(id) ON DELETE CASCADE);');
    // A test-only pause exposes the gap between the actual reference scan and DELETE.
    const firstRollback = execute(rollback.replace('DELETE FROM public.participants', 'SELECT pg_sleep(2);\nDELETE FROM public.participants'));
    await waitForPause();
    const insert = await execute(`SET lock_timeout='200ms'; INSERT INTO public.concurrent_reference VALUES ('${participantId}');`);
    assert.notEqual(insert.code, 0, 'concurrent reference slipped past the rollback scan');
    assert.match(insert.stderr, /55P03/);
    assert.equal((await firstRollback).code, 0);
    assert.equal(query(scratch.href, 'SELECT count(*) FROM public.concurrent_reference;'), '0');

    query(scratch.href, migration);
    const snapshot = () => query(scratch.href, 'SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.participants p;');
    const before = snapshot();
    const writer = execute(`BEGIN; INSERT INTO public.concurrent_reference VALUES ('${participantId}'); SELECT pg_sleep(2); COMMIT;`);
    await waitForPause();
    const secondRollback = execute(rollback);
    assert.equal((await writer).code, 0);
    const refused = await secondRollback;
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /P0001/);
    assert.match(refused.stderr, /seeded participant is referenced/);
    assert.equal(snapshot(), before, 'rollback changed participant data despite a committed reference');
    assert.equal(query(scratch.href, 'SELECT count(*) FROM public.concurrent_reference;'), '1');
  } finally {
    query(admin.href, `DROP DATABASE ${database} WITH (FORCE)`);
  }
});
