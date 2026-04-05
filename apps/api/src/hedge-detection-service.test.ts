import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { runHedgeDetectionPassForTests } from './hedge-detection-service.js';

test('runHedgeDetectionPassForTests persists and deduplicates hedge opportunities', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await repositories.events.upsertByExternalId({
    externalId: 'evt-hedge-1',
    sportId: 'NBA',
    eventName: 'Lakers vs Celtics',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.participants.upsertByExternalId({
    externalId: 'player-1',
    displayName: 'LeBron James',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });

  await repositories.providerOffers.upsertBatch([
    makeOffer({
      id: 'offer-a',
      providerKey: 'draftkings',
      providerEventId: 'evt-hedge-1',
      providerParticipantId: 'player-1',
      line: 4.5,
      snapshotAt: '2026-03-28T10:10:00.000Z',
    }),
    makeOffer({
      id: 'offer-b',
      providerKey: 'fanduel',
      providerEventId: 'evt-hedge-1',
      providerParticipantId: 'player-1',
      line: 7.5,
      snapshotAt: '2026-03-28T10:12:00.000Z',
    }),
  ]);

  const first = await runHedgeDetectionPassForTests(repositories, {
    enabled: true,
    lookbackMinutes: 15,
    dryRun: true,
    now: '2026-03-28T10:20:00.000Z',
  });

  assert.equal(first.evaluatedGroups, 1);
  assert.equal(first.persisted, 1);
  assert.equal(first.duplicateOpportunities, 0);
  assert.ok(first.persistedOpportunities[0]?.event_id !== null);
  assert.equal(first.persistedOpportunities[0]?.participant_id !== null, true);
  assert.equal(first.persistedOpportunities[0]?.type, 'hedge');

  const second = await runHedgeDetectionPassForTests(repositories, {
    enabled: true,
    lookbackMinutes: 15,
    dryRun: true,
    now: '2026-03-28T10:20:00.000Z',
  });

  assert.equal(second.persisted, 0);
  assert.equal(second.duplicateOpportunities, 1);
});

test('runHedgeDetectionPassForTests ignores offers outside the lookback window', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await repositories.events.upsertByExternalId({
    externalId: 'evt-hedge-2',
    sportId: 'NBA',
    eventName: 'Knicks vs Heat',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });

  await repositories.providerOffers.upsertBatch([
    makeOffer({
      id: 'stale-a',
      providerKey: 'draftkings',
      providerEventId: 'evt-hedge-2',
      line: 4.5,
      snapshotAt: '2026-03-28T09:30:00.000Z',
    }),
    makeOffer({
      id: 'fresh-b',
      providerKey: 'fanduel',
      providerEventId: 'evt-hedge-2',
      line: 7.5,
      snapshotAt: '2026-03-28T10:18:00.000Z',
    }),
  ]);

  const result = await runHedgeDetectionPassForTests(repositories, {
    enabled: true,
    lookbackMinutes: 15,
    dryRun: true,
    now: '2026-03-28T10:20:00.000Z',
  });

  assert.equal(result.persisted, 0);
  assert.equal(result.opportunities, 0);
});

function makeOffer(
  overrides: Partial<{
    id: string;
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    snapshotAt: string;
  }> = {},
) {
  return {
    id: overrides.id ?? randomUUID(),
    providerKey: overrides.providerKey ?? 'draftkings',
    providerEventId: overrides.providerEventId ?? 'evt-hedge-1',
    providerMarketKey: overrides.providerMarketKey ?? 'player_points',
    providerParticipantId:
      overrides.providerParticipantId !== undefined ? overrides.providerParticipantId : 'player-1',
    sportKey: 'NBA',
    line: overrides.line ?? 4.5,
    overOdds: overrides.overOdds ?? -110,
    underOdds: overrides.underOdds ?? -110,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: overrides.snapshotAt ?? '2026-03-28T10:10:00.000Z',
    idempotencyKey: [
      overrides.providerEventId ?? 'evt-hedge-1',
      overrides.providerMarketKey ?? 'player_points',
      overrides.providerKey ?? 'draftkings',
      overrides.providerParticipantId !== undefined ? overrides.providerParticipantId : 'player-1',
      String(overrides.line ?? 4.5),
      overrides.snapshotAt ?? '2026-03-28T10:10:00.000Z',
    ].join(':'),
    bookmakerKey: null,
  };
}
