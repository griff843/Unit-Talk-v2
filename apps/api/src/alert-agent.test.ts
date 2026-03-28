import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import {
  checkAndEmitLineMovementAlertsForTests,
  resetAlertAgentStateForTests,
  startAlertAgent,
} from './alert-agent.js';

test('checkAndEmitLineMovementAlerts emits only new signals', async () => {
  resetAlertAgentStateForTests();
  const repositories = createInMemoryRepositoryBundle();
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
  assert.equal(emitted.length, 1);
  assert.equal((emitted[0] as { service: string }).service, 'alert-agent');
});

test('checkAndEmitLineMovementAlerts invokes consumer callback with new signals', async () => {
  resetAlertAgentStateForTests();
  const repositories = createInMemoryRepositoryBundle();
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
  const line = overrides.line ?? 27.5;

  return {
    providerKey: overrides.providerKey ?? 'sgo',
    providerEventId: overrides.providerEventId ?? 'event-1',
    providerMarketKey: overrides.providerMarketKey ?? 'points-all-game-ou',
    providerParticipantId: overrides.providerParticipantId ?? 'player-1',
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
      overrides.providerParticipantId ?? 'player-1',
      line.toFixed(1),
      'false',
      'false',
    ].join(':'),
  };
}
