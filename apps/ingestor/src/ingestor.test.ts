import assert from 'node:assert/strict';
import test from 'node:test';
import { V1_REFERENCE_DATA } from '@unit-talk/contracts';
import {
  createInMemoryIngestorRepositoryBundle,
  InMemoryReferenceDataRepository,
  InMemoryProviderOfferRepository,
} from '@unit-talk/db';
import { mapSGOStatus, resolveSgoEntities } from './entity-resolver.js';
import { ingestLeague } from './ingest-league.js';
import { runIngestorCycles } from './ingestor-runner.js';
import { fetchSGOResults, type SGOEventResult, type SGOResolvedEvent } from './sgo-fetcher.js';
import { normalizeSGOPairedProp } from './sgo-normalizer.js';
import { resolveAndInsertResults } from './results-resolver.js';

test('normalizeSGOPairedProp returns a PAIRED normalized offer with stripped market key and idempotency key', () => {
  const normalized = normalizeSGOPairedProp({
    providerEventId: 'evt-1',
    marketKey: 'points-player-123-game-ou',
    providerParticipantId: 'player-123',
    sportKey: 'NBA',
    line: '22.5',
    overOdds: -115,
    underOdds: -105,
    snapshotAt: '2026-03-25T12:00:00.000Z',
  });

  assert.ok(normalized);
  assert.equal(normalized.providerKey, 'sgo');
  assert.equal(normalized.providerMarketKey, 'points-all-game-ou');
  assert.equal(normalized.providerParticipantId, 'player-123');
  assert.equal(normalized.line, 22.5);
  assert.equal(normalized.devigMode, 'PAIRED');
  assert.equal(
    normalized.idempotencyKey,
    'sgo:evt-1:points-all-game-ou:player-123:22.5:false:false',
  );
});

test('normalizeSGOPairedProp returns FALLBACK_SINGLE_SIDED when only one side is present', () => {
  const normalized = normalizeSGOPairedProp({
    providerEventId: 'evt-2',
    marketKey: 'rebounds-player-9-game-ou',
    providerParticipantId: null,
    sportKey: 'NBA',
    line: 8.5,
    overOdds: -110,
    underOdds: null,
    snapshotAt: '2026-03-25T12:00:00.000Z',
  });

  assert.ok(normalized);
  assert.equal(normalized.providerParticipantId, 'player-9');
  assert.equal(normalized.devigMode, 'FALLBACK_SINGLE_SIDED');
  assert.equal(normalized.overOdds, -110);
  assert.equal(normalized.underOdds, null);
});

test('normalizeSGOPairedProp skips rows where both sides are null', () => {
  const normalized = normalizeSGOPairedProp({
    providerEventId: 'evt-3',
    marketKey: 'assists-player-7-game-ou',
    providerParticipantId: 'player-7',
    sportKey: 'NBA',
    line: 6.5,
    overOdds: null,
    underOdds: null,
    snapshotAt: '2026-03-25T12:00:00.000Z',
  });

  assert.equal(normalized, null);
});

test('InMemoryProviderOfferRepository.upsertBatch is idempotent on idempotency_key', async () => {
  const repository = new InMemoryProviderOfferRepository();
  const offer = normalizeSGOPairedProp({
    providerEventId: 'evt-4',
    marketKey: 'points-player-42-game-ou',
    providerParticipantId: 'player-42',
    sportKey: 'NBA',
    line: 27.5,
    overOdds: -120,
    underOdds: 100,
    snapshotAt: '2026-03-25T12:00:00.000Z',
  });

  assert.ok(offer);
  const first = await repository.upsertBatch([offer]);
  const second = await repository.upsertBatch([{ ...offer, snapshotAt: '2026-03-25T12:05:00.000Z' }]);
  const rows = await repository.listByProvider('sgo');

  assert.deepEqual(first, { insertedCount: 1, updatedCount: 0, totalProcessed: 1 });
  assert.deepEqual(second, { insertedCount: 0, updatedCount: 1, totalProcessed: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.snapshot_at, '2026-03-25T12:05:00.000Z');
});

test('ingestLeague returns gracefully with empty API response', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const summary = await ingestLeague('NBA', 'test-key', repositories, {
    snapshotAt: '2026-03-25T12:00:00.000Z',
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.eventsCount, 0);
  assert.equal(summary.insertedCount, 0);
  assert.equal(summary.updatedCount, 0);
  assert.equal(summary.skippedCount, 0);
  assert.equal(summary.insertedResultsCount, 0);
});

test('runIngestorCycles polls across cycles and leagues', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const sleeps: number[] = [];
  const cycles = await runIngestorCycles({
    repositories,
    leagues: ['NBA'],
    maxCycles: 2,
    pollIntervalMs: 1234,
    logger: { warn() {}, info() {} },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(cycles.length, 2);
  assert.equal(cycles[0]?.results[0]?.status, 'skipped');
  assert.equal(cycles[1]?.results[0]?.status, 'skipped');
  assert.deepEqual(sleeps, [1234]);
});

test('mapSGOStatus marks completed and in-progress events from SGO booleans', () => {
  assert.equal(
    mapSGOStatus({
      started: true,
      completed: true,
      cancelled: false,
      ended: true,
      live: false,
      delayed: false,
      finalized: true,
      oddsAvailable: false,
    }),
    'completed',
  );

  assert.equal(
    mapSGOStatus({
      started: true,
      completed: false,
      cancelled: false,
      ended: false,
      live: true,
      delayed: false,
      finalized: false,
      oddsAvailable: false,
    }),
    'in_progress',
  );
});

test('resolveSgoEntities upserts events and players idempotently', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const events = [createResolvedEvent()];

  const first = await resolveSgoEntities(events, repositories);
  const second = await resolveSgoEntities(events, repositories);
  const resolvedEvents = await repositories.events.listUpcoming('NBA', 30);
  const resolvedPlayers = await repositories.participants.listByType('player', 'NBA');

  assert.equal(first.resolvedEventsCount, 1);
  assert.equal(first.resolvedParticipantsCount, 4);
  assert.equal(second.resolvedEventsCount, 1);
  assert.equal(second.resolvedParticipantsCount, 4);
  assert.equal(resolvedEvents.length, 1);
  assert.equal(resolvedPlayers.length, 2);
});

test('resolveSgoEntities creates fallback player participants from provider offer ids', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const event = createResolvedEvent({
    players: [],
    providerParticipantIds: ['JALEN_BRUNSON_1_NBA'],
  });

  const summary = await resolveSgoEntities([event], repositories);
  const resolvedPlayers = await repositories.participants.listByType('player', 'NBA');

  assert.equal(summary.resolvedParticipantsCount, 3);
  assert.equal(resolvedPlayers.length, 1);
  assert.equal(resolvedPlayers[0]?.display_name, 'Jalen Brunson');
});

test('resolveSgoEntities ignores reserved home away fallback participant ids', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const event = createResolvedEvent({
    players: [],
    providerParticipantIds: ['home', 'away', 'JALEN_BRUNSON_1_NBA'],
  });

  const summary = await resolveSgoEntities([event], repositories);
  const resolvedPlayers = await repositories.participants.listByType('player', 'NBA');

  assert.equal(summary.resolvedParticipantsCount, 3);
  assert.equal(resolvedPlayers.length, 1);
  assert.equal(resolvedPlayers[0]?.external_id, 'JALEN_BRUNSON_1_NBA');
});

test('resolveSgoEntities links home away and competitor participants to events', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const event = createResolvedEvent();

  await resolveSgoEntities([event], repositories);
  const resolvedEvent = await repositories.events.findByExternalId(event.providerEventId);
  assert.ok(resolvedEvent);

  const rows = await repositories.eventParticipants.listByEvent(resolvedEvent.id);
  assert.equal(rows.length, 4);
  assert.equal(rows.some((row) => row.role === 'home'), true);
  assert.equal(rows.some((row) => row.role === 'away'), true);
  assert.equal(rows.filter((row) => row.role === 'competitor').length, 2);
});

test('resolveSgoEntities stores starts_at in event metadata', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const event = createResolvedEvent();

  await resolveSgoEntities([event], repositories);
  const resolvedEvent = await repositories.events.findByExternalId(event.providerEventId);

  assert.equal(
    (resolvedEvent?.metadata as Record<string, unknown>).starts_at,
    '2026-03-26T23:30:00.000Z',
  );
});

test('ingestLeague includes resolved entity counts in cycle summary', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const summary = await ingestLeague('NBA', 'test-key', repositories, {
    snapshotAt: '2026-03-25T12:00:00.000Z',
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [createSgoApiEvent()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.resolvedEventsCount, 1);
  assert.equal(summary.resolvedParticipantsCount, 4);
  assert.equal(summary.insertedCount, 1);
});

test('fetchSGOResults returns player stat rows for completed events only', async () => {
  const { results, resolvedEvents } = await fetchSGOResults({
    apiKey: 'test-key',
    league: 'NBA',
    snapshotAt: '2026-03-25T12:00:00.000Z',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: [
            createCompletedSgoResultsEvent(),
            createSgoApiEvent(),
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.providerEventId, 'evt-entity-1');
  assert.equal(results[0]?.playerStats.length, 2);
  assert.equal(results[0]?.playerStats[0]?.providerParticipantId, 'JALEN_BRUNSON_1_NBA');
  assert.equal(results[0]?.playerStats[0]?.stats.points, 31);
  // Both events are returned as resolvedEvents for entity resolution;
  // only the completed+finalized one appears in results
  assert.equal(resolvedEvents.length, 2);
  assert.equal(results.length, 1);
});

test('resolveAndInsertResults inserts game results and remains idempotent', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const event = createResolvedEvent({
    status: {
      started: true,
      completed: true,
      cancelled: false,
      ended: true,
      live: false,
      delayed: false,
      finalized: true,
      oddsAvailable: false,
    },
  });
  await resolveSgoEntities([event], repositories);

  const first = await resolveAndInsertResults([createCompletedEventResult()], repositories);
  const resolvedEvent = await repositories.events.findByExternalId(event.providerEventId);
  assert.ok(resolvedEvent);

  const afterFirst = await repositories.gradeResults.listByEvent(resolvedEvent.id);
  const second = await resolveAndInsertResults([createCompletedEventResult()], repositories);
  const afterSecond = await repositories.gradeResults.listByEvent(resolvedEvent.id);

  assert.equal(first.completedEvents, 1);
  assert.equal(first.insertedResults, 7);
  assert.equal(afterFirst.length, 7);
  assert.equal(second.insertedResults, 7);
  assert.equal(afterSecond.length, 7);
});

test('resolveAndInsertResults produces correct summed actual_value for combo market keys (AC-4)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const event = createResolvedEvent({
    status: {
      started: true,
      completed: true,
      cancelled: false,
      ended: true,
      live: false,
      delayed: false,
      finalized: true,
      oddsAvailable: false,
    },
  });
  await resolveSgoEntities([event], repositories);

  await resolveAndInsertResults(
    [
      {
        providerEventId: 'evt-entity-1',
        status: {
          started: true,
          completed: true,
          cancelled: false,
          ended: true,
          live: false,
          delayed: false,
          finalized: true,
          oddsAvailable: false,
        },
        playerStats: [
          {
            providerParticipantId: 'JALEN_BRUNSON_1_NBA',
            stats: { points: 31, rebounds: 4, assists: 7 },
          },
        ],
      },
    ],
    repositories,
  );

  const resolvedEvent = await repositories.events.findByExternalId('evt-entity-1');
  assert.ok(resolvedEvent);
  const results = await repositories.gradeResults.listByEvent(resolvedEvent.id);

  const pra = results.find((r) => r.market_key === 'pra-all-game-ou');
  assert.ok(pra, 'pra-all-game-ou result should be inserted');
  assert.equal(pra.actual_value, 42); // 31 + 4 + 7

  const ptsRebs = results.find((r) => r.market_key === 'pts-rebs-all-game-ou');
  assert.ok(ptsRebs, 'pts-rebs-all-game-ou result should be inserted');
  assert.equal(ptsRebs.actual_value, 35); // 31 + 4

  const ptsAsts = results.find((r) => r.market_key === 'pts-asts-all-game-ou');
  assert.ok(ptsAsts, 'pts-asts-all-game-ou result should be inserted');
  assert.equal(ptsAsts.actual_value, 38); // 31 + 7
});

test('resolveAndInsertResults skips rows when participant or stat mapping is missing', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  await resolveSgoEntities(
    [
      createResolvedEvent({
        status: {
          started: true,
          completed: true,
          cancelled: false,
          ended: true,
          live: false,
          delayed: false,
          finalized: true,
          oddsAvailable: false,
        },
      }),
    ],
    repositories,
  );

  const summary = await resolveAndInsertResults(
    [
      {
        providerEventId: 'evt-entity-1',
        status: {
          started: true,
          completed: true,
          cancelled: false,
          ended: true,
          live: false,
          delayed: false,
          finalized: true,
          oddsAvailable: false,
        },
        playerStats: [
          {
            providerParticipantId: 'UNKNOWN_PLAYER',
            stats: { points: 9 },
          },
          {
            providerParticipantId: 'JALEN_BRUNSON_1_NBA',
            stats: { points: 9 },
          },
        ],
      },
    ],
    repositories,
  );

  assert.equal(summary.completedEvents, 1);
  assert.equal(summary.insertedResults, 1);
  assert.ok(summary.skippedResults > 0);
});

test('ingestLeague can skip results phase without breaking offer/entity ingest', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const summary = await ingestLeague('NBA', 'test-key', repositories, {
    snapshotAt: '2026-03-25T12:00:00.000Z',
    skipResults: true,
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [createCompletedSgoResultsEvent()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.insertedCount, 1);
  assert.equal(summary.resolvedEventsCount, 1);
  assert.equal(summary.insertedResultsCount, 0);
  assert.equal(summary.resultsEventsCount, 0);
});

test('ingestLeague does not create player participants for home away market keys', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  await ingestLeague('NBA', 'test-key', repositories, {
    snapshotAt: '2026-03-25T12:00:00.000Z',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              ...createSgoApiEvent(),
              players: {},
              odds: {
                market: {
                  'points-player-home-game-ou-over': {
                    line: 27.5,
                    odds: -115,
                  },
                  'points-player-home-game-ou-under': {
                    line: 27.5,
                    odds: -105,
                  },
                  'points-player-away-game-ou-over': {
                    line: 26.5,
                    odds: -110,
                  },
                  'points-player-away-game-ou-under': {
                    line: 26.5,
                    odds: -110,
                  },
                  'points-player-JALEN_BRUNSON_1_NBA-game-ou-over': {
                    line: 25.5,
                    odds: -110,
                  },
                  'points-player-JALEN_BRUNSON_1_NBA-game-ou-under': {
                    line: 25.5,
                    odds: -110,
                  },
                },
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
  });

  const resolvedPlayers = await repositories.participants.listByType('player', 'NBA');

  assert.equal(resolvedPlayers.length, 1);
  assert.equal(resolvedPlayers[0]?.display_name, 'Jalen Brunson');
});

test('InMemoryReferenceDataRepository.searchPlayers returns resolved player rows', async () => {
  const repository = new InMemoryReferenceDataRepository(V1_REFERENCE_DATA, {
    participants: [
      {
        id: 'participant-player-1',
        display_name: 'Jalen Brunson',
        external_id: 'JALEN_BRUNSON_1_NBA',
        league: 'NBA',
        metadata: {},
        participant_type: 'player',
        sport: 'NBA',
        created_at: '2026-03-26T12:00:00.000Z',
        updated_at: '2026-03-26T12:00:00.000Z',
      },
    ],
  });

  const players = await repository.searchPlayers('NBA', 'brunson');
  assert.equal(players.length, 1);
  assert.equal(players[0]?.displayName, 'Jalen Brunson');
});

test('InMemoryReferenceDataRepository.listEvents returns resolved event rows', async () => {
  const repository = new InMemoryReferenceDataRepository(V1_REFERENCE_DATA, {
    events: [
      {
        id: 'event-1',
        sport_id: 'NBA',
        event_name: 'New York Knicks vs. Boston Celtics',
        event_date: '2026-03-26',
        status: 'scheduled',
        external_id: 'evt-entity-1',
        metadata: {},
        created_at: '2026-03-26T12:00:00.000Z',
        updated_at: '2026-03-26T12:00:00.000Z',
      },
    ],
  });

  const events = await repository.listEvents('NBA', '2026-03-26');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventName, 'New York Knicks vs. Boston Celtics');
});

function createResolvedEvent(
  overrides: Partial<SGOResolvedEvent> = {},
): SGOResolvedEvent {
  return {
    providerEventId: 'evt-entity-1',
    leagueKey: 'NBA',
    sportKey: 'NBA',
    eventName: 'New York Knicks vs. Boston Celtics',
    startsAt: '2026-03-26T23:30:00.000Z',
    status: {
      started: false,
      completed: false,
      cancelled: false,
      ended: false,
      live: false,
      delayed: false,
      finalized: false,
      oddsAvailable: true,
    },
    venue: 'TD Garden',
    broadcast: null,
    teams: {
      home: {
        teamId: 'BOSTON_CELTICS_NBA',
        displayName: 'Boston Celtics',
        abbreviation: 'BOS',
        city: 'Boston',
      },
      away: {
        teamId: 'NEW_YORK_KNICKS_NBA',
        displayName: 'New York Knicks',
        abbreviation: 'NYK',
        city: 'New York',
      },
    },
    players: [
      {
        playerId: 'JALEN_BRUNSON_1_NBA',
        teamId: 'NEW_YORK_KNICKS_NBA',
        displayName: 'Jalen Brunson',
        firstName: 'Jalen',
        lastName: 'Brunson',
      },
      {
        playerId: 'JAYSON_TATUM_0_NBA',
        teamId: 'BOSTON_CELTICS_NBA',
        displayName: 'Jayson Tatum',
        firstName: 'Jayson',
        lastName: 'Tatum',
      },
    ],
    providerParticipantIds: ['JALEN_BRUNSON_1_NBA', 'JAYSON_TATUM_0_NBA'],
    ...overrides,
  };
}

function createSgoApiEvent() {
  return {
    eventID: 'evt-entity-1',
    leagueID: 'NBA',
    sportID: 'NBA',
    teams: {
      home: {
        teamID: 'BOSTON_CELTICS_NBA',
        names: {
          long: 'Boston Celtics',
          short: 'BOS',
          location: 'Boston',
        },
      },
      away: {
        teamID: 'NEW_YORK_KNICKS_NBA',
        names: {
          long: 'New York Knicks',
          short: 'NYK',
          location: 'New York',
        },
      },
    },
    status: {
      startsAt: '2026-03-26T23:30:00.000Z',
      started: false,
      completed: false,
      cancelled: false,
      ended: false,
      live: false,
      delayed: false,
      finalized: false,
      oddsAvailable: true,
    },
    info: {
      venue: {
        name: 'TD Garden',
      },
    },
    players: {
      JALEN_BRUNSON_1_NBA: {
        playerID: 'JALEN_BRUNSON_1_NBA',
        teamID: 'NEW_YORK_KNICKS_NBA',
        firstName: 'Jalen',
        lastName: 'Brunson',
        name: 'Jalen Brunson',
      },
      JAYSON_TATUM_0_NBA: {
        playerID: 'JAYSON_TATUM_0_NBA',
        teamID: 'BOSTON_CELTICS_NBA',
        firstName: 'Jayson',
        lastName: 'Tatum',
        name: 'Jayson Tatum',
      },
    },
    odds: {
      market: {
        'points-player-JALEN_BRUNSON_1_NBA-game-ou-over': {
          playerID: 'JALEN_BRUNSON_1_NBA',
          line: 27.5,
          odds: -115,
        },
        'points-player-JALEN_BRUNSON_1_NBA-game-ou-under': {
          playerID: 'JALEN_BRUNSON_1_NBA',
          line: 27.5,
          odds: -105,
        },
      },
    },
  };
}

function createCompletedSgoResultsEvent() {
  return {
    ...createSgoApiEvent(),
    status: {
      startsAt: '2026-03-24T23:30:00.000Z',
      started: true,
      completed: true,
      cancelled: false,
      ended: true,
      live: false,
      delayed: false,
      finalized: true,
      oddsAvailable: false,
    },
    results: {
      game: {
        JALEN_BRUNSON_1_NBA: {
          points: 31,
          rebounds: 4,
          assists: 7,
        },
        JAYSON_TATUM_0_NBA: {
          points: 28,
          rebounds: 9,
          assists: 5,
        },
      },
    },
  };
}

function createCompletedEventResult(): SGOEventResult {
  return {
    providerEventId: 'evt-entity-1',
    status: {
      started: true,
      completed: true,
      cancelled: false,
      ended: true,
      live: false,
      delayed: false,
      finalized: true,
      oddsAvailable: false,
    },
    playerStats: [
      {
        providerParticipantId: 'JALEN_BRUNSON_1_NBA',
        stats: {
          points: 31,
          rebounds: 4,
          assists: 7,
        },
      },
    ],
  };
}
