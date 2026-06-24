import assert from 'node:assert/strict';
import test from 'node:test';
import type { IngestorRepositoryBundle } from '@unit-talk/db';
import { resolveSgoEntities } from './entity-resolver.js';
import type { SGOResolvedEvent } from './sgo-fetcher.js';

/*
 * UTV2-1298 — entity resolution is the dominant cost behind the 240s MLB odds-path
 * wall-clock (~1,700 sequential PostgREST upserts on a heavy slate). Player entity
 * resolution is now bounded-concurrency parallel. These tests prove: all expected
 * writes still happen (no missing/duplicate links), the concurrency cap is honored,
 * the sequential fallback is reversible, and errors fail closed deterministically.
 */

function makeEvent(id: string, playerIds: string[]): SGOResolvedEvent {
  return {
    providerEventId: id,
    leagueKey: 'MLB',
    sportKey: 'MLB',
    eventName: `Event ${id}`,
    startsAt: '2026-06-23T18:00:00.000Z',
    status: null,
    venue: null,
    broadcast: null,
    teams: { home: null, away: null },
    players: playerIds.map((playerId) => ({
      playerId,
      teamId: null,
      displayName: playerId.toUpperCase(),
      firstName: null,
      lastName: null,
    })),
    providerParticipantIds: [],
  };
}

interface Recorder {
  eventUpserts: string[];
  participantUpserts: string[];
  eventParticipantLinks: Array<{ eventId: string; participantId: string }>;
  maxInFlight: number;
}

function makeRepositories(
  recorder: Recorder,
  hooks: { failOnPlayer?: string } = {},
): Pick<IngestorRepositoryBundle, 'events' | 'eventParticipants' | 'participants'> {
  let inFlight = 0;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const repositories = {
    events: {
      async upsertByExternalId(input: { externalId: string }) {
        recorder.eventUpserts.push(input.externalId);
        return { id: `event-${input.externalId}` };
      },
    },
    participants: {
      async upsertByExternalId(input: { externalId: string }) {
        inFlight += 1;
        recorder.maxInFlight = Math.max(recorder.maxInFlight, inFlight);
        await tick();
        try {
          if (hooks.failOnPlayer && input.externalId === hooks.failOnPlayer) {
            throw new Error(`upsert failed for ${input.externalId}`);
          }
          recorder.participantUpserts.push(input.externalId);
          return { id: `participant-${input.externalId}` };
        } finally {
          inFlight -= 1;
        }
      },
      async listByType() {
        return [];
      },
    },
    eventParticipants: {
      async upsert(input: { eventId: string; participantId: string }) {
        recorder.eventParticipantLinks.push({
          eventId: input.eventId,
          participantId: input.participantId,
        });
        return { id: `${input.eventId}:${input.participantId}` };
      },
    },
  };
  return repositories as unknown as Pick<
    IngestorRepositoryBundle,
    'events' | 'eventParticipants' | 'participants'
  >;
}

function emptyRecorder(): Recorder {
  return {
    eventUpserts: [],
    participantUpserts: [],
    eventParticipantLinks: [],
    maxInFlight: 0,
  };
}

test('bounded concurrency preserves all entity + event-participant writes with no duplicates', async () => {
  const recorder = emptyRecorder();
  const events = [
    makeEvent('e1', ['p1', 'p2', 'p3']),
    makeEvent('e2', ['p4', 'p5']),
  ];
  const summary = await resolveSgoEntities(events, makeRepositories(recorder), {
    concurrency: 4,
  });

  assert.deepEqual(recorder.eventUpserts.sort(), ['e1', 'e2']);
  assert.deepEqual(recorder.participantUpserts.sort(), ['p1', 'p2', 'p3', 'p4', 'p5']);
  // Exactly one event-participant link per player, mapped to the correct event.
  assert.equal(recorder.eventParticipantLinks.length, 5);
  const links = recorder.eventParticipantLinks
    .map((l) => `${l.eventId}->${l.participantId}`)
    .sort();
  assert.deepEqual(links, [
    'event-e1->participant-p1',
    'event-e1->participant-p2',
    'event-e1->participant-p3',
    'event-e2->participant-p4',
    'event-e2->participant-p5',
  ]);
  // No duplicate links.
  assert.equal(new Set(links).size, links.length);
  assert.equal(summary.resolvedEventsCount, 2);
  assert.equal(summary.resolvedParticipantsCount, 5);
  assert.ok(summary.timings, 'timings must be present when resolution runs');
  assert.equal(summary.timings?.players, 5);
  assert.equal(summary.timings?.eventParticipants, 5);
  assert.equal(summary.timings?.errors, 0);
});

test('concurrency cap is honored', async () => {
  const recorder = emptyRecorder();
  const events = [makeEvent('e1', Array.from({ length: 20 }, (_u, i) => `p${i}`))];
  const summary = await resolveSgoEntities(events, makeRepositories(recorder), {
    concurrency: 3,
  });
  assert.ok(recorder.maxInFlight <= 3, `max in-flight ${recorder.maxInFlight} exceeded cap 3`);
  assert.ok(recorder.maxInFlight >= 2, 'should run players concurrently above 1');
  assert.equal(summary.timings?.concurrency, 3);
  assert.equal(recorder.participantUpserts.length, 20);
});

test('sequential fallback via env flag is reversible (overrides concurrency option)', async () => {
  const recorder = emptyRecorder();
  const events = [makeEvent('e1', Array.from({ length: 8 }, (_u, i) => `p${i}`))];
  const prev = process.env.UNIT_TALK_INGESTOR_ENTITY_RESOLUTION_SEQUENTIAL;
  process.env.UNIT_TALK_INGESTOR_ENTITY_RESOLUTION_SEQUENTIAL = 'true';
  try {
    const summary = await resolveSgoEntities(events, makeRepositories(recorder), {
      concurrency: 8,
    });
    assert.equal(recorder.maxInFlight, 1, 'sequential flag must force one-at-a-time');
    assert.equal(summary.timings?.concurrency, 1);
  } finally {
    if (prev === undefined) {
      delete process.env.UNIT_TALK_INGESTOR_ENTITY_RESOLUTION_SEQUENTIAL;
    } else {
      process.env.UNIT_TALK_INGESTOR_ENTITY_RESOLUTION_SEQUENTIAL = prev;
    }
  }
});

test('a failed entity write fails closed (rejects) and does not dispatch all players', async () => {
  const recorder = emptyRecorder();
  const events = [makeEvent('e1', Array.from({ length: 30 }, (_u, i) => `p${i}`))];
  await assert.rejects(
    resolveSgoEntities(events, makeRepositories(recorder, { failOnPlayer: 'p1' }), {
      concurrency: 2,
    }),
    /upsert failed for p1/,
  );
  // The successful participant writes must not include the full slate (early stop).
  assert.ok(
    recorder.participantUpserts.length < 30,
    `expected fail-closed early stop, wrote ${recorder.participantUpserts.length}/30`,
  );
});
