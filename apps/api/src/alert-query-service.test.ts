import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAlertDetectionRepository } from '@unit-talk/db';
import type { AlertDetectionRepository } from '@unit-talk/db';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { getAlertStatus, getRecentAlerts } from './alert-query-service.js';

test('getRecentAlerts returns empty state when no detections exist', async () => {
  const repository = new InMemoryAlertDetectionRepository();

  const result = await getRecentAlerts(repository);

  assert.deepEqual(result, {
    detections: [],
    total: 0,
  });
});

test('getRecentAlerts returns recent notable and alert-worthy detections ordered by snapshot time', async () => {
  const repository = new InMemoryAlertDetectionRepository();
  await seedDetection(repository, {
    idempotencyKey: 'old-watch',
    tier: 'watch',
    currentSnapshotAt: '2026-03-28T12:00:00.000Z',
  });
  const notable = await seedDetection(repository, {
    idempotencyKey: 'notable',
    tier: 'notable',
    currentSnapshotAt: '2026-03-28T12:05:00.000Z',
  });
  const alertWorthy = await seedDetection(repository, {
    idempotencyKey: 'alert-worthy',
    tier: 'alert-worthy',
    currentSnapshotAt: '2026-03-28T12:10:00.000Z',
    notified: true,
  });

  const result = await getRecentAlerts(repository, { limit: 5, minTier: 'notable' });

  assert.equal(result.total, 2);
  assert.deepEqual(
    result.detections.map((detection) => detection.id),
    [alertWorthy.id, notable.id],
  );
  assert.equal(result.detections[0]?.notified, true);
});

test('getRecentAlerts clamps the requested limit to 10', async () => {
  const repository = new InMemoryAlertDetectionRepository();

  for (let index = 0; index < 12; index += 1) {
    await seedDetection(repository, {
      idempotencyKey: `signal-${index}`,
      tier: 'notable',
      currentSnapshotAt: `2026-03-28T12:${String(index).padStart(2, '0')}:00.000Z`,
    });
  }

  const result = await getRecentAlerts(repository, { limit: 50, minTier: 'notable' });

  assert.equal(result.total, 10);
});

test('getAlertStatus reads env-driven flags and recent counts correctly', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await seedDetection(repositories.alertDetections, {
    idempotencyKey: 'recent-notable',
    tier: 'notable',
    currentSnapshotAt: '2026-03-28T11:40:00.000Z',
  });
  const failed = await seedDetection(repositories.alertDetections, {
    idempotencyKey: 'recent-alert-worthy',
    tier: 'alert-worthy',
    currentSnapshotAt: '2026-03-28T11:50:00.000Z',
    steamDetected: true,
  });
  await repositories.audit.record({
    entityType: 'alert_notification',
    entityId: failed.id,
    entityRef: failed.id,
    action: 'notify_attempt',
    actor: 'system:test',
    payload: {
      attempt: 3,
      statusCode: 500,
      error: 'discord returned 500',
    },
  });
  await seedDetection(repositories.alertDetections, {
    idempotencyKey: 'older-alert-worthy',
    tier: 'alert-worthy',
    currentSnapshotAt: '2026-03-28T09:00:00.000Z',
    notified: true,
  });

  const status = await getAlertStatus(
    repositories.alertDetections,
    repositories.audit,
    {
      ALERT_AGENT_ENABLED: 'false',
      ALERT_DRY_RUN: 'false',
      ALERT_MIN_TIER: 'alert-worthy',
      ALERT_LOOKBACK_MINUTES: '90',
      SYSTEM_PICKS_ENABLED: 'true',
    },
    new Date('2026-03-28T12:00:00.000Z'),
  );

  assert.deepEqual(status, {
    enabled: false,
    dryRun: false,
    systemPicksEnabled: true,
    effectiveMode: 'disabled',
    minTier: 'alert-worthy',
    lookbackMinutes: 90,
    activeSports: ['NBA', 'NHL', 'MLB'],
    systemPickEligibleMarketTypes: ['moneyline', 'spread', 'total'],
    systemPickBlockedMarketTypes: ['player_prop'],
    last1h: {
      notable: 1,
      alertWorthy: 1,
      notified: 0,
      failedDeliveries: 1,
      steamEvents: 1,
    },
    lastDetectedAt: '2026-03-28T11:50:00.000Z',
  });
});

async function seedDetection(
  repository: Pick<AlertDetectionRepository, 'saveDetection'>,
  overrides: {
    idempotencyKey: string;
    tier: 'watch' | 'notable' | 'alert-worthy';
    currentSnapshotAt: string;
    notified?: boolean;
    steamDetected?: boolean;
  },
) {
  const created = await repository.saveDetection({
    idempotencyKey: overrides.idempotencyKey,
    eventId: 'event-1',
    participantId: null,
    marketKey: 'spreads/nfl',
    bookmakerKey: 'fanduel',
    baselineSnapshotAt: '2026-03-28T11:00:00.000Z',
    currentSnapshotAt: overrides.currentSnapshotAt,
    oldLine: -3,
    newLine: -5.5,
    lineChange: -2.5,
    lineChangeAbs: 2.5,
    velocity: 0.25,
    timeElapsedMinutes: 10,
    direction: 'down',
    marketType: 'spread',
    tier: overrides.tier,
    steamDetected: overrides.steamDetected,
    notified: overrides.notified,
    metadata: {},
  });

  assert.ok(created);
  return created;
}
