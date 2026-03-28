import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { listLineMovementAlerts } from './alert-agent-service.js';

test('listLineMovementAlerts returns empty when no prior offer exists', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      line: 27.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  const alerts = await listLineMovementAlerts(repositories);

  assert.deepEqual(alerts, []);
});

test('listLineMovementAlerts emits an alert when movement threshold is exceeded', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      line: 27.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
    }),
    makeOffer({
      line: 29.0,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  const alerts = await listLineMovementAlerts(repositories, { threshold: 0.5 });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, 'line_movement');
  assert.equal(alerts[0]?.currentLine, 29);
  assert.equal(alerts[0]?.previousLine, 27.5);
  assert.equal(alerts[0]?.lineDelta, 1.5);
  assert.equal(alerts[0]?.direction, 'up');
  assert.equal(alerts[0]?.threshold, 0.5);
  assert.ok(alerts[0]?.movementScore);
});

test('listLineMovementAlerts skips movement below threshold', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      line: 27.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
    }),
    makeOffer({
      line: 27.9,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  const alerts = await listLineMovementAlerts(repositories, { threshold: 0.5 });

  assert.deepEqual(alerts, []);
});

test('listLineMovementAlerts sorts by largest movement and respects limit', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      providerEventId: 'event-a',
      providerParticipantId: 'player-a',
      line: 18.5,
      snapshotAt: '2026-03-28T08:00:00.000Z',
    }),
    makeOffer({
      providerEventId: 'event-a',
      providerParticipantId: 'player-a',
      line: 20.0,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
    makeOffer({
      providerEventId: 'event-b',
      providerParticipantId: 'player-b',
      line: 8.5,
      snapshotAt: '2026-03-28T08:00:00.000Z',
    }),
    makeOffer({
      providerEventId: 'event-b',
      providerParticipantId: 'player-b',
      line: 10.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  const alerts = await listLineMovementAlerts(repositories, {
    threshold: 0.5,
    limit: 1,
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.providerEventId, 'event-b');
  assert.equal(alerts[0]?.absoluteLineDelta, 2);
});

function makeOffer(overrides: Partial<{
  providerKey: string;
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  sportKey: string | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  snapshotAt: string;
}> = {}) {
  return {
    providerKey: overrides.providerKey ?? 'sgo',
    providerEventId: overrides.providerEventId ?? 'event-1',
    providerMarketKey: overrides.providerMarketKey ?? 'points-all-game-ou',
    providerParticipantId: overrides.providerParticipantId ?? 'player-1',
    sportKey: overrides.sportKey ?? 'NBA',
    line: overrides.line ?? 27.5,
    overOdds: overrides.overOdds ?? -110,
    underOdds: overrides.underOdds ?? -110,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
    idempotencyKey: [
      overrides.providerKey ?? 'sgo',
      overrides.providerEventId ?? 'event-1',
      overrides.providerMarketKey ?? 'points-all-game-ou',
      overrides.providerParticipantId ?? 'player-1',
      String(overrides.line ?? 27.5),
      'false',
      'false',
    ].join(':'),
  };
}
