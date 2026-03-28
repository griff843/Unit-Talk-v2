import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { runAlertDetectionPassForTests, startAlertAgent } from './alert-agent.js';

test('runAlertDetectionPassForTests persists a detection row for a qualifying move', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-agent-1',
    sportId: 'NBA',
    eventName: 'Suns vs Nuggets',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      providerEventId: 'evt-agent-1',
      line: 4.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
    }),
    makeOffer({
      providerEventId: 'evt-agent-1',
      line: 6.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  const result = await runAlertDetectionPassForTests(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-03-28T10:30:00.000Z',
  });

  assert.equal(result.persisted, 1);
  assert.equal(result.persistedSignals[0]?.tier, 'notable');
});

test('runAlertDetectionPassForTests respects ALERT_MIN_TIER semantics', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-agent-2',
    sportId: 'NBA',
    eventName: 'Knicks vs Heat',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      providerEventId: 'evt-agent-2',
      line: 4.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
    }),
    makeOffer({
      providerEventId: 'evt-agent-2',
      line: 5.0,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  const result = await runAlertDetectionPassForTests(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'notable',
    now: '2026-03-28T10:30:00.000Z',
  });

  assert.equal(result.persisted, 0);
  assert.equal(result.belowMinTier, 1);
});

test('startAlertAgent registers a 60 second polling interval and cleanup clears it', () => {
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

function makeOffer(
  overrides: Partial<{
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
    line: number | null;
    snapshotAt: string;
  }> = {},
) {
  return {
    providerKey: overrides.providerKey ?? 'sgo',
    providerEventId: overrides.providerEventId ?? 'evt-agent-1',
    providerMarketKey: overrides.providerMarketKey ?? 'spread',
    providerParticipantId:
      overrides.providerParticipantId !== undefined ? overrides.providerParticipantId : 'player-1',
    sportKey: 'NBA',
    line: overrides.line ?? 4.5,
    overOdds: -110,
    underOdds: -110,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
    idempotencyKey: [
      overrides.providerEventId ?? 'evt-agent-1',
      overrides.providerMarketKey ?? 'spread',
      overrides.providerKey ?? 'sgo',
      overrides.providerParticipantId !== undefined
        ? overrides.providerParticipantId
        : 'player-1',
      String(overrides.line ?? 4.5),
      overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
    ].join(':'),
  };
}
