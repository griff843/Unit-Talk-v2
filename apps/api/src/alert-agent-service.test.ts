import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalPick } from '@unit-talk/contracts';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { listLineMovementAlerts } from './alert-agent-service.js';

test('listLineMovementAlerts returns empty when no tracked pick matches moved offers', async () => {
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

  const alerts = await listLineMovementAlerts(repositories);

  assert.deepEqual(alerts, []);
});

test('listLineMovementAlerts emits an alert when a tracked submitted pick matches moved offers', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'player-1',
    displayName: 'Player One',
    participantType: 'player',
    sport: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'event-1',
    sportId: 'NBA',
    eventName: 'Suns vs Nuggets',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'away',
  });
  await repositories.picks.savePick(
    makePick({
      metadata: {
        submittedBy: 'griff843',
        eventName: 'Suns vs Nuggets',
        player: 'Player One',
        sport: 'NBA',
      },
    }),
  );
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
  assert.equal(alerts[0]?.pickId, 'pick-1');
  assert.equal(alerts[0]?.submittedBy, 'griff843');
  assert.equal(alerts[0]?.currentLine, 29);
  assert.equal(alerts[0]?.previousLine, 27.5);
  assert.equal(alerts[0]?.lineDelta, 1.5);
  assert.equal(alerts[0]?.direction, 'up');
  assert.equal(alerts[0]?.threshold, 0.5);
  assert.ok(alerts[0]?.movementScore);
});

test('listLineMovementAlerts skips settled picks even when matching market movement exists', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'player-1',
    displayName: 'Player One',
    participantType: 'player',
    sport: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'event-1',
    sportId: 'NBA',
    eventName: 'Suns vs Nuggets',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'away',
  });
  await repositories.picks.savePick(
    makePick({
      id: 'pick-settled',
      lifecycleState: 'settled',
      metadata: {
        submittedBy: 'griff843',
        eventName: 'Suns vs Nuggets',
        player: 'Player One',
        sport: 'NBA',
      },
    }),
  );
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

  assert.deepEqual(alerts, []);
});

test('listLineMovementAlerts includes system picks without submittedBy metadata', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: 'event-total',
    sportId: 'NBA',
    eventName: 'Lakers vs Warriors',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.picks.savePick(
    makePick({
      id: 'pick-system',
      source: 'system',
      market: 'total-all-game-ou',
      selection: 'Over 228.5',
      line: 228.5,
      metadata: {
        eventName: 'Lakers vs Warriors',
        sport: 'NBA',
      },
    }),
  );
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      providerEventId: event.external_id ?? 'event-total',
      providerMarketKey: 'total-all-game-ou',
      providerParticipantId: null,
      line: 228.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
    }),
    makeOffer({
      providerEventId: event.external_id ?? 'event-total',
      providerMarketKey: 'total-all-game-ou',
      providerParticipantId: null,
      line: 230.0,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  const alerts = await listLineMovementAlerts(repositories, { threshold: 0.5 });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.pickId, 'pick-system');
  assert.equal(alerts[0]?.submittedBy, null);
  assert.equal(alerts[0]?.providerParticipantId, null);
});

function makePick(
  overrides: Partial<CanonicalPick> & {
    metadata?: Record<string, unknown>;
  } = {},
): CanonicalPick {
  return {
    id: overrides.id ?? 'pick-1',
    submissionId: overrides.submissionId ?? 'submission-1',
    market: overrides.market ?? 'points-all-game-ou',
    selection: overrides.selection ?? 'Over 27.5',
    line: overrides.line ?? 27.5,
    odds: overrides.odds ?? -110,
    stakeUnits: overrides.stakeUnits ?? 1,
    confidence: overrides.confidence ?? 0.7,
    source: overrides.source ?? 'discord',
    approvalStatus: overrides.approvalStatus ?? 'approved',
    promotionStatus: overrides.promotionStatus ?? 'qualified',
    promotionTarget: overrides.promotionTarget ?? 'trader-insights',
    promotionScore: overrides.promotionScore ?? 92,
    promotionReason: overrides.promotionReason ?? 'fixture',
    promotionVersion: overrides.promotionVersion ?? 'test-v1',
    promotionDecidedAt: overrides.promotionDecidedAt ?? '2026-03-28T10:00:00.000Z',
    promotionDecidedBy: overrides.promotionDecidedBy ?? 'system',
    lifecycleState: overrides.lifecycleState ?? 'posted',
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? '2026-03-28T09:30:00.000Z',
  };
}

function makeOffer(
  overrides: Partial<{
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
    sportKey: string | null;
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    snapshotAt: string;
  }> = {},
) {
  return {
    providerKey: overrides.providerKey ?? 'sgo',
    providerEventId: overrides.providerEventId ?? 'event-1',
    providerMarketKey: overrides.providerMarketKey ?? 'points-all-game-ou',
    providerParticipantId:
      overrides.providerParticipantId !== undefined
        ? overrides.providerParticipantId
        : 'player-1',
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
      overrides.providerParticipantId !== undefined
        ? overrides.providerParticipantId
        : 'player-1',
      String(overrides.line ?? 27.5),
      'false',
      'false',
    ].join(':'),
  };
}
