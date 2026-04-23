import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryProviderOfferRepository, InMemoryEventRepository } from '@unit-talk/db';
import { runClosingLineRecovery } from './closing-line-recovery-service.js';

function makeOffer(overrides: {
  providerEventId: string;
  providerMarketKey: string;
  snapshotAt: string;
  isClosing?: boolean;
  providerParticipantId?: string | null;
  bookmakerKey?: string | null;
}) {
  return {
    providerKey: 'sgo',
    providerEventId: overrides.providerEventId,
    providerMarketKey: overrides.providerMarketKey,
    providerParticipantId: overrides.providerParticipantId ?? null,
    sportKey: 'NBA',
    line: 10.5,
    overOdds: -115,
    underOdds: -105,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: overrides.isClosing ?? false,
    snapshotAt: overrides.snapshotAt,
    idempotencyKey: `sgo:${overrides.providerEventId}:${overrides.providerMarketKey}:${overrides.snapshotAt}`,
    bookmakerKey: overrides.bookmakerKey ?? null,
  };
}

function makeEvent(overrides: {
  id: string;
  externalId: string;
  eventDate: string;
  startsAt: string;
}) {
  return {
    id: overrides.id,
    sport_id: 'NBA',
    event_name: `Event ${overrides.id}`,
    event_date: overrides.eventDate,
    external_id: overrides.externalId,
    status: 'completed' as const,
    metadata: { starts_at: overrides.startsAt },
    created_at: '2026-04-20T00:00:00.000Z',
    updated_at: '2026-04-20T00:00:00.000Z',
  };
}

test('runClosingLineRecovery: marks pre-commence offer as is_closing for started event', async () => {
  const eventId = 'evt-001';
  const commenceTime = '2026-04-22T00:00:00.000Z';
  const beforeStart = '2026-04-21T23:00:00.000Z';
  const afterStart = '2026-04-22T01:00:00.000Z'; // after game start — should NOT be marked

  const providerOffers = new InMemoryProviderOfferRepository();
  await providerOffers.upsertBatch([
    makeOffer({ providerEventId: eventId, providerMarketKey: 'points-ou', snapshotAt: beforeStart }),
    makeOffer({ providerEventId: eventId, providerMarketKey: 'points-ou', snapshotAt: afterStart }),
  ]);

  const events = new InMemoryEventRepository([
    makeEvent({ id: 'e1', externalId: eventId, eventDate: '2026-04-22', startsAt: commenceTime }),
  ]);

  const result = await runClosingLineRecovery({ events, providerOffers }, {});

  assert.equal(result.eventsEligible, 1);
  assert.equal(result.rowsMarked >= 1, true, 'expected at least 1 row marked');

  const allOffers = await providerOffers.listAll();
  const closingOffer = allOffers.find(
    (o) => o.provider_event_id === eventId && o.snapshot_at === beforeStart,
  );
  assert.ok(closingOffer, 'pre-commence offer should exist');
  assert.equal(closingOffer.is_closing, true, 'pre-commence offer should be marked is_closing');

  const afterOffer = allOffers.find(
    (o) => o.provider_event_id === eventId && o.snapshot_at === afterStart,
  );
  assert.ok(afterOffer, 'post-commence offer should exist');
  assert.equal(afterOffer.is_closing, false, 'post-commence offer must NOT be marked is_closing');
});

test('runClosingLineRecovery: skips events without external_id', async () => {
  const providerOffers = new InMemoryProviderOfferRepository();
  const events = new InMemoryEventRepository([
    {
      id: 'e-no-ext',
      sport_id: 'NBA',
      event_name: 'No External ID',
      event_date: '2026-04-21',
      external_id: null,
      status: 'completed' as const,
      metadata: { starts_at: '2026-04-21T00:00:00.000Z' },
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:00:00.000Z',
    },
  ]);

  const result = await runClosingLineRecovery({ events, providerOffers }, {});
  assert.equal(result.eventsEligible, 0);
  assert.equal(result.rowsMarked, 0);
});

test('runClosingLineRecovery: skips future events (commenceTime > now)', async () => {
  const futureStart = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h from now
  const eventDate = futureStart.slice(0, 10);

  const providerOffers = new InMemoryProviderOfferRepository();
  await providerOffers.upsertBatch([
    makeOffer({ providerEventId: 'evt-future', providerMarketKey: 'points-ou', snapshotAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }),
  ]);

  const events = new InMemoryEventRepository([
    makeEvent({ id: 'e-future', externalId: 'evt-future', eventDate, startsAt: futureStart }),
  ]);

  const result = await runClosingLineRecovery({ events, providerOffers }, {});
  assert.equal(result.eventsEligible, 0);
  assert.equal(result.rowsMarked, 0);
});

test('runClosingLineRecovery: idempotent — does not double-mark already-marked rows', async () => {
  const eventId = 'evt-idem';
  const commenceTime = '2026-04-21T20:00:00.000Z';
  const snapshotAt = '2026-04-21T19:30:00.000Z';

  const providerOffers = new InMemoryProviderOfferRepository();
  await providerOffers.upsertBatch([
    makeOffer({ providerEventId: eventId, providerMarketKey: 'points-ou', snapshotAt, isClosing: true }),
  ]);

  const events = new InMemoryEventRepository([
    makeEvent({ id: 'e-idem', externalId: eventId, eventDate: '2026-04-21', startsAt: commenceTime }),
  ]);

  const result = await runClosingLineRecovery({ events, providerOffers }, {});
  assert.equal(result.rowsMarked, 0, 'already-marked rows should not be re-marked');
});

test('runClosingLineRecovery: handles events with no matching provider_offers gracefully', async () => {
  const commenceTime = '2026-04-21T20:00:00.000Z';
  const providerOffers = new InMemoryProviderOfferRepository();
  const events = new InMemoryEventRepository([
    makeEvent({ id: 'e-nooffers', externalId: 'evt-nooffers', eventDate: '2026-04-21', startsAt: commenceTime }),
  ]);

  const result = await runClosingLineRecovery({ events, providerOffers }, {});
  assert.equal(result.eventsEligible, 1);
  assert.equal(result.rowsMarked, 0);
});
