import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { runAlertDetectionPassForTests, startAlertAgent } from './alert-agent.js';
import { runAlertNotificationPass } from './alert-notification-service.js';
import type { AlertDetectionRecord } from '@unit-talk/db';

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

// ---------------------------------------------------------------------------
// system_runs observability tests (UTV2-143)
// ---------------------------------------------------------------------------

test('runAlertDetectionPassForTests writes a system_runs row with runType alert.detection', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-obs-1',
    sportId: 'NBA',
    eventName: 'Nets vs Raptors',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      providerEventId: 'evt-obs-1',
      line: 4.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
    }),
    makeOffer({
      providerEventId: 'evt-obs-1',
      line: 8.0,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  // Capture runs before
  const runsBefore = await repositories.runs.startRun({ runType: '__probe', details: {} });

  await runAlertDetectionPassForTests(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-03-28T10:30:00.000Z',
  });

  // The detection pass should have written a run with runType 'alert.detection'
  // We check by starting a fresh "probe" run after — the ID sequence should advance
  const runsAfter = await repositories.runs.startRun({ runType: '__probe2', details: {} });
  // IDs are sequential in InMemorySystemRunRepository (run_1, run_2, ...)
  const beforeNum = parseInt(runsBefore.id.replace('run_', ''), 10);
  const afterNum = parseInt(runsAfter.id.replace('run_', ''), 10);
  // There should be at least one run created between the two probes (the detection run)
  assert.ok(afterNum >= beforeNum + 2, `Expected at least one run created between probes (before=${beforeNum}, after=${afterNum})`);
});

test('runAlertDetectionPassForTests details include signalsFound, alertWorthy, notable, watch', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-obs-2',
    sportId: 'NBA',
    eventName: 'Pacers vs Pistons',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  // A notable spread move (1.5 pts)
  await repositories.providerOffers.upsertBatch([
    makeOffer({
      providerEventId: 'evt-obs-2',
      line: 4.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
    }),
    makeOffer({
      providerEventId: 'evt-obs-2',
      line: 6.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  ]);

  // Inspect the run repository by spying on startRun/completeRun
  type RunDetails = Record<string, unknown>;
  let capturedDetails: RunDetails | undefined;
  const originalComplete = repositories.runs.completeRun.bind(repositories.runs);
  repositories.runs.completeRun = async (input) => {
    capturedDetails = input.details as RunDetails | undefined;
    return originalComplete(input);
  };

  await runAlertDetectionPassForTests(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-03-28T10:30:00.000Z',
  });

  assert.ok(capturedDetails, 'completeRun should have been called with details');
  assert.equal(capturedDetails['signalsFound'], 1, 'signalsFound should be 1');
  assert.equal(typeof capturedDetails['alertWorthy'], 'number', 'alertWorthy should be a number');
  assert.equal(typeof capturedDetails['notable'], 'number', 'notable should be a number');
  assert.equal(typeof capturedDetails['watch'], 'number', 'watch should be a number');
});

test('runAlertNotificationPass writes a system_runs row when runs repo provided', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const signal: AlertDetectionRecord = {
    id: 'det-obs-1',
    idempotency_key: 'idem-obs-1',
    event_id: 'evt-obs-3',
    participant_id: null,
    market_key: 'spread',
    bookmaker_key: 'draftkings',
    baseline_snapshot_at: '2026-03-28T10:00:00.000Z',
    current_snapshot_at: '2026-03-28T10:30:00.000Z',
    old_line: 4.5,
    new_line: 7.0,
    line_change: 2.5,
    line_change_abs: 2.5,
    velocity: 0.083,
    time_elapsed_minutes: 30,
    direction: 'up',
    market_type: 'spread',
    tier: 'notable',
    notified: false,
    notified_at: null,
    notified_channels: null,
    cooldown_expires_at: null,
    metadata: {},
    created_at: '2026-03-28T10:30:00.000Z',
  };

  let capturedDetails: Record<string, unknown> | undefined;
  const originalComplete = repositories.runs.completeRun.bind(repositories.runs);
  repositories.runs.completeRun = async (input) => {
    capturedDetails = input.details as Record<string, unknown> | undefined;
    return originalComplete(input);
  };

  await runAlertNotificationPass(
    [signal],
    repositories.alertDetections,
    { dryRun: true, runs: repositories.runs },
  );

  assert.ok(capturedDetails, 'completeRun should have been called');
  assert.equal(typeof capturedDetails['notified'], 'number', 'notified should be a number');
  assert.equal(typeof capturedDetails['suppressed'], 'number', 'suppressed should be a number');
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
