import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getCatalog,
  getEventBrowse,
  getMatchups,
  getReferenceDataAvailability,
  searchBrowse,
  resolveSubmitAuthorization,
  submitPick,
} from '../lib/api-client.ts';
import {
  buildManualEnteredParticipants,
  evaluateSubmissionGuards,
  participantAliasKey,
  CLIENT_TEAM_SPORT_IDS,
} from '../lib/form-utils.ts';
import {
  buildParticipantSearchUrl,
  buildParticipantSearchEmptyMessage,
  normalizeParticipantSearchResults,
} from '../lib/participant-search.ts';

type FetchFn = typeof globalThis.fetch;

function installFetchMock(
  implementation: (url: string, options?: RequestInit) => Promise<Response>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation as FetchFn;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('buildParticipantSearchUrl targets canonical player search endpoint', () => {
  const url = buildParticipantSearchUrl('  Jalen Brunson  ', 'player', 'NBA');
  assert.equal(
    url,
    'http://127.0.0.1:4000/api/reference-data/search/players?q=Jalen+Brunson&sport=NBA',
  );
});

test('buildParticipantSearchUrl targets canonical team search endpoint without sport when blank', () => {
  const url = buildParticipantSearchUrl('Knicks', 'team', '');
  assert.equal(
    url,
    'http://127.0.0.1:4000/api/reference-data/search/teams?q=Knicks',
  );
});

test('buildParticipantSearchUrl keeps event-aware search on canonical endpoints', () => {
  const playerUrl = buildParticipantSearchUrl('Shai', 'player', {
    sport: 'NBA',
    eventId: 'evt-thunder',
  });
  const teamUrl = buildParticipantSearchUrl('Thunder', 'team', {
    sport: 'NBA',
    eventId: 'evt-thunder',
  });

  assert.equal(
    playerUrl,
    'http://127.0.0.1:4000/api/reference-data/search/players?q=Shai&sport=NBA&eventId=evt-thunder',
  );
  assert.equal(
    teamUrl,
    'http://127.0.0.1:4000/api/reference-data/search/teams?q=Thunder&sport=NBA&eventId=evt-thunder',
  );
});

test('buildParticipantSearchUrl constrains player search to the selected team', () => {
  const url = buildParticipantSearchUrl('LeBron', 'player', {
    sport: 'NBA',
    teamId: 'team-lakers',
  });
  assert.equal(
    url,
    'http://127.0.0.1:4000/api/reference-data/search/players?q=LeBron&sport=NBA&teamId=team-lakers',
  );
});

test('participant empty states distinguish an empty dataset from a query miss', () => {
  assert.equal(
    buildParticipantSearchEmptyMessage('team', 'NBA', 'Lakers', false),
    'Canonical NBA team data is not available in this environment yet.',
  );
  assert.equal(
    buildParticipantSearchEmptyMessage('player', 'NBA', 'LeBron', true),
    'No canonical player found for “LeBron”.',
  );
});

test('normalizeParticipantSearchResults preserves participant ids, de-dupes, and sorts', () => {
  const results = normalizeParticipantSearchResults(
    {
      data: [
        { participantId: 'team-2', displayName: 'New York Knicks' },
        { participantId: 'team-1', displayName: 'Boston Celtics' },
        { participantId: 'team-3', displayName: ' new york knicks ' },
        { participantId: 'team-4', displayName: '' },
      ],
    },
    'team',
  );

  assert.deepEqual(results, [
    { participantId: 'team-1', displayName: 'Boston Celtics', participantType: 'team', teamId: null },
    { participantId: 'team-2', displayName: 'New York Knicks', participantType: 'team', teamId: null },
  ]);
});

test('getReferenceDataAvailability reports whether canonical sport datasets are populated', async () => {
  let capturedUrl = '';
  const restoreFetch = installFetchMock(async (url) => {
    capturedUrl = url;
    return new Response(
      JSON.stringify({
        data: { sportId: 'NBA', teamsAvailable: false, playersAvailable: false },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  const availability = await getReferenceDataAvailability('NBA');
  assert.equal(availability.teamsAvailable, false);
  assert.equal(
    capturedUrl,
    'http://127.0.0.1:4000/api/reference-data/availability?sport=NBA',
  );
  restoreFetch();
});

test('normalizeParticipantSearchResults returns an empty array for invalid payloads', () => {
  assert.deepEqual(normalizeParticipantSearchResults(null, 'player'), []);
  assert.deepEqual(normalizeParticipantSearchResults('bad', 'player'), []);
  assert.deepEqual(normalizeParticipantSearchResults({ data: 'not-array' }, 'player'), []);
});

test('getCatalog returns catalog data on a successful response', async () => {
  const restoreFetch = installFetchMock(async () =>
    new Response(
      JSON.stringify({
        data: {
          sports: [{
            id: 'NBA',
            name: 'NBA',
            marketTypes: ['player-prop'],
            statTypes: ['Points', 'Points + Rebounds + Assists'],
            teams: [],
          }],
          sportsbooks: [{ id: 'fanatics', name: 'Fanatics' }],
          ticketTypes: [],
          cappers: [{ id: 'griff843', displayName: 'griff843' }],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  await assert.doesNotReject(async () => {
    const catalog = await getCatalog();
    assert.equal(catalog.sports[0]?.id, 'NBA');
    assert.equal(catalog.sportsbooks[0]?.name, 'Fanatics');
    assert.equal(catalog.cappers[0]?.id, 'griff843');
    assert.ok(catalog.sports[0]?.statTypes.includes('Points + Rebounds + Assists'));
  });

  restoreFetch();
});

test('getCatalog filters provider-only books and backfills Fanatics for operator entry', async () => {
  const restoreFetch = installFetchMock(async () =>
    new Response(
      JSON.stringify({
        data: {
          sports: [],
          sportsbooks: [
            { id: 'draftkings', name: 'DraftKings' },
            { id: 'williamhill', name: 'William Hill' },
            { id: 'sgo', name: 'SGO' },
          ],
          ticketTypes: [],
          cappers: [],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  const catalog = await getCatalog();
  assert.deepEqual(catalog.sportsbooks, [
    { id: 'draftkings', name: 'DraftKings' },
    { id: 'fanatics', name: 'Fanatics' },
  ]);

  restoreFetch();
});

test('getCatalog normalizes legacy string capper entries', async () => {
  const restoreFetch = installFetchMock(async () =>
    new Response(
      JSON.stringify({
        data: {
          sports: [],
          sportsbooks: [],
          ticketTypes: [],
          cappers: ['griff843'],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  const catalog = await getCatalog();
  assert.deepEqual(catalog.cappers, [{ id: 'griff843', displayName: 'griff843' }]);

  restoreFetch();
});

test('getMatchups calls the canonical matchup browse endpoint', async () => {
  let capturedUrl = '';
  const restoreFetch = installFetchMock(async (url) => {
    capturedUrl = url;
    return new Response(
      JSON.stringify({
        data: [
          {
            eventId: 'evt-1',
            externalId: 'nba-1',
            eventName: 'Nuggets vs Jazz',
            eventDate: '2026-04-02T19:00:00.000Z',
            status: 'scheduled',
            sportId: 'NBA',
            leagueId: 'nba',
            teams: [],
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  const results = await getMatchups('NBA', '2026-04-02');
  assert.equal(results[0]?.eventId, 'evt-1');
  assert.equal(
    capturedUrl,
    'http://127.0.0.1:4000/api/reference-data/matchups?sport=NBA&date=2026-04-02',
  );

  restoreFetch();
});

test('getEventBrowse calls the canonical event browse endpoint', async () => {
  let capturedUrl = '';
  const restoreFetch = installFetchMock(async (url) => {
    capturedUrl = url;
    return new Response(
      JSON.stringify({
        data: {
          eventId: 'evt-1',
          externalId: 'nba-1',
          eventName: 'Nuggets vs Jazz',
          eventDate: '2026-04-02T19:00:00.000Z',
          status: 'scheduled',
          sportId: 'NBA',
          leagueId: 'nba',
          participants: [],
          offers: [],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  const result = await getEventBrowse('evt-1');
  assert.equal(result.eventName, 'Nuggets vs Jazz');
  assert.equal(
    capturedUrl,
    'http://127.0.0.1:4000/api/reference-data/events/evt-1/browse',
  );

  restoreFetch();
});

test('searchBrowse calls the canonical browse search endpoint', async () => {
  let capturedUrl = '';
  const restoreFetch = installFetchMock(async (url) => {
    capturedUrl = url;
    return new Response(
      JSON.stringify({
        data: [
          {
            resultType: 'player',
            participantId: 'player-jamal',
            displayName: 'Jamal Murray',
            contextLabel: 'Nuggets · Jazz @ Nuggets · Apr 2, 11:00 PM',
            teamId: 'team-nuggets',
            teamName: 'Nuggets',
            matchup: {
              eventId: 'evt-1',
              externalId: 'nba-evt-1',
              eventName: 'Nuggets vs Jazz',
              eventDate: '2026-04-02T23:00:00.000Z',
              status: 'scheduled',
              sportId: 'NBA',
              leagueId: 'nba',
              teams: [],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  const result = await searchBrowse('NBA', '2026-04-02', 'Jam');
  assert.equal(result[0]?.displayName, 'Jamal Murray');
  assert.equal(
    capturedUrl,
    'http://127.0.0.1:4000/api/reference-data/search?sport=NBA&date=2026-04-02&q=Jam',
  );

  restoreFetch();
});

test('submitPick posts to the submissions endpoint and returns the result payload', async () => {
  let capturedUrl = '';
  let capturedMethod = '';
  let capturedBody: Record<string, unknown> | null = null;
  const restoreFetch = installFetchMock(async (url, options) => {
    capturedUrl = url;
    capturedMethod = options?.method ?? 'GET';
    capturedBody = JSON.parse(String(options?.body)) as Record<string, unknown>;

    return new Response(
      JSON.stringify({
        data: {
          submissionId: 'sub-123',
          pickId: 'pick-456',
          lifecycleState: 'validated',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  const result = await submitPick({
    source: 'smart-form',
    market: 'nba.points',
    selection: 'Cody Williams Points O 14',
  });

  assert.equal(capturedUrl, 'http://127.0.0.1:4000/api/submissions');
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedBody?.source, 'smart-form');
  assert.equal(result.pickId, 'pick-456');

  restoreFetch();
});

test('api-client surfaces error messages from failed responses', async () => {
  const restoreFetch = installFetchMock(async () =>
    new Response(
      JSON.stringify({ error: { message: 'Reference data unavailable' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  await assert.rejects(() => getCatalog(), /Reference data unavailable/);
  restoreFetch();
});

// UTV2-1786 — regression coverage for the five review findings on PR #1469.
//
// Each block asserts the corrected behaviour and then inverts it: the second
// assertion is the case that must still be allowed, so a guard that simply
// refuses everything fails here rather than passing.

test('manual team-sport submission is refused until both sides are entered', () => {
  const oneSide = evaluateSubmissionGuards({
    sportId: 'NBA',
    identityMode: 'manual',
    awayParticipantName: 'Sioux Falls Skyforce',
    homeParticipantName: '',
    team: 'Sioux Falls Skyforce',
  });
  assert.equal(oneSide?.code, 'manual-team-sport-requires-both-sides');

  // Inversion: both distinct sides present is accepted.
  assert.equal(
    evaluateSubmissionGuards({
      sportId: 'NBA',
      identityMode: 'manual',
      awayParticipantName: 'Sioux Falls Skyforce',
      homeParticipantName: 'Osceola Magic',
      team: 'Osceola Magic',
    }),
    null,
  );

  // Inversion: an individual sport legitimately has one-participant markets.
  assert.equal(
    evaluateSubmissionGuards({
      sportId: 'GOLF',
      identityMode: 'manual',
      playerName: 'Unlisted Qualifier',
    }),
    null,
  );
});

test('manual team-sport submission is refused when both sides name the same participant', () => {
  // Two entered names that collapse to one alias key are one participant, not
  // two — the server counts them the same way and would reject the duplicate.
  const duplicateSides = evaluateSubmissionGuards({
    sportId: 'NBA',
    identityMode: 'manual',
    awayParticipantName: 'Osceola Magic',
    homeParticipantName: 'osceola  magic',
  });
  assert.equal(duplicateSides?.code, 'manual-team-sport-requires-both-sides');
});

test('manual provenance never repeats the selected side under a second role', () => {
  const participants = buildManualEnteredParticipants({
    awayParticipantName: 'Sioux Falls Skyforce',
    homeParticipantName: 'Osceola Magic',
    team: 'Osceola Magic',
  });

  assert.deepEqual(
    participants.map((participant) => [participant.role, participant.displayName]),
    [
      ['away', 'Sioux Falls Skyforce'],
      ['home', 'Osceola Magic'],
    ],
  );
  assert.equal(
    new Set(participants.map((participant) => participantAliasKey(participant.displayName))).size,
    participants.length,
  );
  for (const participant of participants) {
    assert.equal(participant.canonicalParticipantId, null);
  }

  // Inversion: a team that is genuinely not one of the two sides is kept, and
  // so is a player, so real four-participant provenance still round-trips.
  assert.deepEqual(
    buildManualEnteredParticipants({
      awayParticipantName: 'Sioux Falls Skyforce',
      homeParticipantName: 'Osceola Magic',
      team: 'Rip City Remix',
      playerName: 'Unlisted Prospect',
    }).map((participant) => participant.role),
    ['away', 'home', 'team', 'player'],
  );
});

test('manual provenance treats punctuation and case differences as the same participant', () => {
  assert.deepEqual(
    buildManualEnteredParticipants({
      awayParticipantName: 'St. John’s Red Storm',
      homeParticipantName: 'st johns red storm',
    }).map((participant) => participant.role),
    ['away'],
  );
});

test('a canonical player prop is refused without a canonical event', () => {
  const noEvent = evaluateSubmissionGuards({
    sportId: 'NBA',
    identityMode: 'structured-fallback',
    canonicalEventId: null,
    selectedPlayerId: 'player-123',
  });
  assert.equal(noEvent?.code, 'canonical-player-requires-event');

  // Inversion: the same player prop with its matchup selected is accepted.
  assert.equal(
    evaluateSubmissionGuards({
      sportId: 'NBA',
      identityMode: 'canonical',
      canonicalEventId: 'evt-abc',
      selectedPlayerId: 'player-123',
    }),
    null,
  );

  // Inversion: a team-sport market with no player still uses the structured
  // fallback and does not need an event.
  assert.equal(
    evaluateSubmissionGuards({
      sportId: 'NBA',
      identityMode: 'structured-fallback',
      canonicalEventId: null,
      team: 'Osceola Magic',
    }),
    null,
  );
});

test('a canonical submission outside team sports is refused without an event', () => {
  const guard = evaluateSubmissionGuards({
    sportId: 'GOLF',
    identityMode: 'structured-fallback',
    canonicalEventId: null,
  });
  assert.equal(guard?.code, 'canonical-without-event-requires-team-sport');
});

test('the client team-sport list matches the API contract it mirrors', async () => {
  // A file read, not an import: apps never import from apps. If the server list
  // changes, this pin fails here instead of the two silently diverging.
  const source = await readFile(
    new URL('../../api/src/smart-form-validation.ts', import.meta.url),
    'utf8',
  );
  const declaration = /const TEAM_SPORTS = new Set\(\[([^\]]*)\]\)/u.exec(source);
  assert.ok(declaration, 'TEAM_SPORTS declaration not found in smart-form-validation.ts');
  const serverSports = [...declaration[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  assert.ok(serverSports.length > 0, 'TEAM_SPORTS parsed as empty');
  assert.deepEqual([...CLIENT_TEAM_SPORT_IDS].sort(), [...serverSports].sort());
});

test('submitPick prefers the authoritative session bearer over a stored recovery token', () => {
  assert.equal(
    resolveSubmitAuthorization({
      sessionToken: 'session-jwt',
      storedRecoveryToken: 'stale-recovery-jwt',
    }),
    'Bearer session-jwt',
  );

  // Inversion: with no session, the operator-recovery path still works.
  assert.equal(
    resolveSubmitAuthorization({
      sessionToken: null,
      storedRecoveryToken: 'recovery-jwt',
    }),
    'Bearer recovery-jwt',
  );

  // A blank or whitespace-only session token is not a session.
  assert.equal(
    resolveSubmitAuthorization({ sessionToken: '   ', storedRecoveryToken: 'recovery-jwt' }),
    'Bearer recovery-jwt',
  );

  // Neither present: no header at all, rather than a `Bearer ` with nothing.
  assert.equal(
    resolveSubmitAuthorization({ sessionToken: null, storedRecoveryToken: null }),
    null,
  );
});

test('the QA auth bypass is documented under the name the browser bundle can see', async () => {
  const template = await readFile(
    new URL('../.env.example', import.meta.url),
    'utf8',
  );
  // The gate runs in a client component, so only the NEXT_PUBLIC_ name reaches
  // it. Documenting the unprefixed name alone left the bypass silently off.
  assert.match(template, /^NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=/mu);

  const appManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  assert.match(
    appManifest.scripts['test:e2e:fixture'] ?? '',
    /NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=/u,
  );
});
