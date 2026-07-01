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
  assert.equal(summary.timings?.transientRetryCount, 0);
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

/*
 * UTV2-1373 — transient statement-timeout retry on participant upserts.
 * Tests use a call-count-per-player map so the mock can succeed on attempt N.
 */

interface RetryRecorder extends Recorder {
  callCountByPlayer: Map<string, number>;
}

function emptyRetryRecorder(): RetryRecorder {
  return { ...emptyRecorder(), callCountByPlayer: new Map() };
}

/**
 * Extended mock that supports per-player transient failure (fail first N attempts, then succeed)
 * and permanent failure by player ID.
 */
function makeRetryRepositories(
  recorder: RetryRecorder,
  hooks: {
    /** Player IDs that should timeout on first attempt but succeed from attempt 2 onward. */
    transientFailPlayers?: string[];
    /** Player ID that always throws a timeout — exhausts budget. */
    permanentTimeoutPlayer?: string;
    /** Player ID that throws a non-retryable (non-timeout) error. */
    nonRetryableFailPlayer?: string;
  } = {},
): Pick<IngestorRepositoryBundle, 'events' | 'eventParticipants' | 'participants'> {
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
        const count = (recorder.callCountByPlayer.get(input.externalId) ?? 0) + 1;
        recorder.callCountByPlayer.set(input.externalId, count);
        await tick();
        if (hooks.permanentTimeoutPlayer === input.externalId) {
          throw new Error('canceling statement due to statement timeout');
        }
        if (hooks.nonRetryableFailPlayer === input.externalId) {
          throw new Error('permission denied for table participants');
        }
        if (hooks.transientFailPlayers?.includes(input.externalId) && count === 1) {
          throw new Error('statement timeout');
        }
        recorder.participantUpserts.push(input.externalId);
        return { id: `participant-${input.externalId}` };
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

test('transient timeout is retried and cycle completes; transientRetryCount is incremented', async () => {
  const recorder = emptyRetryRecorder();
  const events = [makeEvent('e1', ['p1', 'p2', 'p3'])];
  const summary = await resolveSgoEntities(
    events,
    makeRetryRepositories(recorder, { transientFailPlayers: ['p1', 'p3'] }),
    { concurrency: 1, upsertAttempts: 3 },
  );
  // All three players resolved despite two transient failures.
  assert.deepEqual(recorder.participantUpserts.sort(), ['p1', 'p2', 'p3']);
  assert.equal(summary.timings?.players, 3);
  // p1 and p3 each needed 2 attempts → 2 retried calls.
  assert.equal(recorder.callCountByPlayer.get('p1'), 2, 'p1 should have been called twice');
  assert.equal(recorder.callCountByPlayer.get('p3'), 2, 'p3 should have been called twice');
  assert.equal(summary.timings?.transientRetryCount, 2, 'two successful retries recorded');
  assert.equal(summary.timings?.errors, 0, 'recovered retries must NOT count as errors');
});

test('budget exhausted on permanent timeout: cycle fails closed', async () => {
  const recorder = emptyRetryRecorder();
  const events = [makeEvent('e1', ['p1', 'p2'])];
  await assert.rejects(
    resolveSgoEntities(
      events,
      makeRetryRepositories(recorder, { permanentTimeoutPlayer: 'p1' }),
      { concurrency: 1, upsertAttempts: 3 },
    ),
    /statement timeout/,
  );
  // p1 must have been attempted 3 times (budget exhausted) before fail-closed rejection.
  assert.equal(recorder.callCountByPlayer.get('p1'), 3, 'all 3 attempts must have fired');
});

test('non-retryable error is not retried and propagates immediately', async () => {
  const recorder = emptyRetryRecorder();
  const events = [makeEvent('e1', ['p1'])];
  await assert.rejects(
    resolveSgoEntities(
      events,
      makeRetryRepositories(recorder, { nonRetryableFailPlayer: 'p1' }),
      { concurrency: 1, upsertAttempts: 3 },
    ),
    /permission denied/,
  );
  assert.equal(recorder.callCountByPlayer.get('p1'), 1, 'non-retryable must not use retry budget');
});

test('upsertAttempts=1 disables retry (matches today behavior)', async () => {
  const recorder = emptyRetryRecorder();
  const events = [makeEvent('e1', ['p1', 'p2'])];
  await assert.rejects(
    resolveSgoEntities(
      events,
      makeRetryRepositories(recorder, { transientFailPlayers: ['p1'] }),
      { concurrency: 1, upsertAttempts: 1 },
    ),
    /statement timeout/,
  );
  assert.equal(recorder.callCountByPlayer.get('p1'), 1, 'no retry when attempts=1');
});
