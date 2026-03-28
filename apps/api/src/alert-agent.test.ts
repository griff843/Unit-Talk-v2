import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalPick } from '@unit-talk/contracts';
import { createInMemoryRepositoryBundle } from './persistence.js';
import {
  checkAndEmitLineMovementAlertsForTests,
  resetAlertAgentStateForTests,
  startAlertAgent,
} from './alert-agent.js';

test('checkAndEmitLineMovementAlerts emits only new signals for tracked picks', async () => {
  resetAlertAgentStateForTests();
  const repositories = await createTrackedPickRepositories();
  const emitted: unknown[] = [];

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

  const logger = {
    error() {},
    info(message: string) {
      emitted.push(JSON.parse(message));
    },
  };

  const first = await checkAndEmitLineMovementAlertsForTests(repositories, logger, {
    listOptions: { threshold: 0.5 },
  });
  const second = await checkAndEmitLineMovementAlertsForTests(repositories, logger, {
    listOptions: { threshold: 0.5 },
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(first[0]?.pickId, 'pick-alert-1');
  assert.equal(emitted.length, 1);
  assert.equal((emitted[0] as { service: string }).service, 'alert-agent');
});

test('checkAndEmitLineMovementAlerts invokes consumer callback with new tracked-pick signals', async () => {
  resetAlertAgentStateForTests();
  const repositories = await createTrackedPickRepositories({
    pickId: 'pick-alert-2',
    participantExternalId: 'player-2',
    playerName: 'Player Two',
    eventExternalId: 'event-2',
    eventName: 'Knicks vs Heat',
  });
  const delivered: string[] = [];

  await repositories.providerOffers.upsertBatch([
    makeOffer({
      line: 18.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
      providerEventId: 'event-2',
      providerParticipantId: 'player-2',
    }),
    makeOffer({
      line: 20.0,
      snapshotAt: '2026-03-28T10:00:00.000Z',
      providerEventId: 'event-2',
      providerParticipantId: 'player-2',
    }),
  ]);

  await checkAndEmitLineMovementAlertsForTests(
    repositories,
    { error() {}, info() {} },
    {
      listOptions: { threshold: 0.5 },
      onSignals: async (signals) => {
        delivered.push(...signals.map((signal) => signal.signalId));
      },
    },
  );

  assert.equal(delivered.length, 1);
});

test('checkAndEmitLineMovementAlerts ignores market movement with no tracked pick', async () => {
  resetAlertAgentStateForTests();
  const repositories = createInMemoryRepositoryBundle();
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      line: 18.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
      providerEventId: 'orphan-event',
      providerParticipantId: 'orphan-player',
    }),
    makeOffer({
      line: 20.0,
      snapshotAt: '2026-03-28T10:00:00.000Z',
      providerEventId: 'orphan-event',
      providerParticipantId: 'orphan-player',
    }),
  ]);

  const emitted = await checkAndEmitLineMovementAlertsForTests(
    repositories,
    { error() {}, info() {} },
    {
      listOptions: { threshold: 0.5 },
    },
  );

  assert.deepEqual(emitted, []);
});

test('startAlertAgent registers a 60 second polling interval and cleanup clears it', () => {
  resetAlertAgentStateForTests();
  const repositories = createInMemoryRepositoryBundle();
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let capturedDelay = 0;
  let clearedHandle: ReturnType<typeof setInterval> | null = null;
  const fakeHandle = { id: 'alert-agent-interval' } as unknown as ReturnType<typeof setInterval>;

  globalThis.setInterval = ((callback: () => void, delay?: number) => {
    void callback;
    capturedDelay = delay ?? 0;
    return fakeHandle;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle?: ReturnType<typeof setInterval>) => {
    clearedHandle = handle ?? null;
  }) as typeof clearInterval;

  try {
    const cleanup = startAlertAgent(repositories, { error() {}, info() {} });
    cleanup();

    assert.equal(capturedDelay, 60_000);
    assert.equal(clearedHandle, fakeHandle);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

async function createTrackedPickRepositories(
  overrides: Partial<{
    pickId: string;
    playerName: string;
    participantExternalId: string;
    eventExternalId: string;
    eventName: string;
  }> = {},
) {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: overrides.participantExternalId ?? 'player-1',
    displayName: overrides.playerName ?? 'Player One',
    participantType: 'player',
    sport: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: overrides.eventExternalId ?? 'event-1',
    sportId: 'NBA',
    eventName: overrides.eventName ?? 'Suns vs Nuggets',
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
      id: overrides.pickId ?? 'pick-alert-1',
      metadata: {
        submittedBy: 'griff843',
        eventName: overrides.eventName ?? 'Suns vs Nuggets',
        player: overrides.playerName ?? 'Player One',
        sport: 'NBA',
      },
    }),
  );

  return repositories;
}

function makePick(
  overrides: Partial<CanonicalPick> & {
    metadata?: Record<string, unknown>;
  } = {},
): CanonicalPick {
  return {
    id: overrides.id ?? 'pick-alert-1',
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
  const line = overrides.line ?? 27.5;

  return {
    providerKey: overrides.providerKey ?? 'sgo',
    providerEventId: overrides.providerEventId ?? 'event-1',
    providerMarketKey: overrides.providerMarketKey ?? 'points-all-game-ou',
    providerParticipantId:
      overrides.providerParticipantId !== undefined
        ? overrides.providerParticipantId
        : 'player-1',
    sportKey: overrides.sportKey ?? 'NBA',
    line,
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
      line.toFixed(1),
      'false',
      'false',
    ].join(':'),
  };
}
