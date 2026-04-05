import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCatalog,
  getEventBrowse,
  getMatchups,
  searchBrowse,
  submitPick,
} from '../lib/api-client.ts';
import {
  buildParticipantSearchUrl,
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
    { participantId: 'team-1', displayName: 'Boston Celtics', participantType: 'team' },
    { participantId: 'team-2', displayName: 'New York Knicks', participantType: 'team' },
  ]);
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
