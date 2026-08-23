import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createInMemoryRepositoryBundle, type SystemRunRecord } from '@unit-talk/db';
import {
  evaluateAgeFinding,
  evaluateAlertRunFinding,
  evaluateMonitoringSnapshot,
  notifyCriticalFindings,
  parseThreshold,
  resolveIngestorAlertThresholds,
  runScheduledAlertPass,
  unknownMonitorFinding,
  type AlertMonitoringSnapshot,
} from './ingestor-alert-check.js';

test('ingestor alert thresholds prefer canonical provider-offer staleness env', () => {
  const thresholds = resolveIngestorAlertThresholds({
    UNIT_TALK_APP_ENV: 'local',
    UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES: '45',
    INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES: '15',
    INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES: '90',
    INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES: '10',
    ALERT_SYSTEM_STALE_MINUTES: '20',
  });

  assert.deepEqual(thresholds, {
    offers: 45,
    results: 90,
    cycle: 10,
    alertSystem: 20,
  });
});

test('production cadence thresholds fail above the five minute provider-offer cadence', () => {
  const thresholds = resolveIngestorAlertThresholds({
    UNIT_TALK_APP_ENV: 'production',
    UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES: '30',
    INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES: undefined,
    INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES: undefined,
    INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES: '30',
    ALERT_SYSTEM_STALE_MINUTES: undefined,
  });

  assert.deepEqual(thresholds, {
    offers: 5,
    results: 60,
    cycle: 5,
    alertSystem: 15,
  });

  const now = new Date('2026-04-21T16:00:00.000Z');
  const finding = evaluateAgeFinding(
    'offers',
    '2026-04-21T15:54:00.000Z',
    thresholds.offers,
    null,
    now,
  );

  assert.equal(finding.level, 'CRITICAL');
  assert.equal(finding.ageMinutes, 6);
  assert.match(finding.message, /threshold: 5m/);
});

test('ingestor alert threshold parser rejects invalid values', () => {
  assert.equal(parseThreshold('0', 30), 30);
  assert.equal(parseThreshold('-5', 30), 30);
  assert.equal(parseThreshold('abc', 30), 30);
  assert.equal(parseThreshold('31', 30), 31);
});

test('ingestor alert finding trips when latest merged cycle timestamp exceeds threshold', () => {
  const now = new Date('2026-04-21T16:00:00.000Z');
  const finding = evaluateAgeFinding(
    'offers',
    '2026-04-21T15:20:00.000Z',
    30,
    null,
    now,
  );

  assert.equal(finding.level, 'CRITICAL');
  assert.equal(finding.ageMinutes, 40);
  assert.match(finding.message, /threshold: 30m/);
});

test('scheduled pass induces a line movement, persists it, notifies canary, and records both runs', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'utv2-1735-induced-event',
    sportId: 'NBA',
    eventName: 'UTV2-1735 Induced Movement',
    eventDate: '2026-08-23',
    status: 'scheduled',
    metadata: { proofIssue: 'UTV2-1735' },
  });
  await repositories.providerOffers.upsertBatch([
    makeOffer('4.5', '2026-08-23T10:00:00.000Z', 'baseline'),
    makeOffer('6.5', '2026-08-23T10:30:00.000Z', 'current'),
  ]);

  const restoreDiscord = installDiscordTestEnvironment();
  const requests: string[] = [];
  try {
    const result = await runScheduledAlertPass(repositories, {
      environment: {
        ALERT_AGENT_ENABLED: 'true',
        ALERT_DRY_RUN: 'false',
        ALERT_MIN_TIER: 'notable',
      },
      now: new Date('2026-08-23T10:35:00.000Z'),
      fetchImpl: async (input) => {
        requests.push(String(input));
        return new Response('{}', { status: 200 });
      },
      sleepImpl: async () => {},
    });

    assert.equal(result.detection.persisted, 1);
    assert.equal(result.notification.notified, 1);
    assert.equal(result.notification.failed, 0);
    assert.deepEqual(requests, ['https://discord.com/api/v10/channels/1296531122234327100/messages']);

    const detections = await repositories.alertDetections.listRecent();
    assert.equal(detections.length, 1);
    assert.equal(detections[0]?.notified, true);
    assert.deepEqual(detections[0]?.notified_channels, ['discord:canary']);

    const detectionRuns = await repositories.runs.listByType('alert.detection', 1);
    const notificationRuns = await repositories.runs.listByType('alert.notification', 1);
    assert.equal(detectionRuns[0]?.status, 'succeeded');
    assert.equal(notificationRuns[0]?.status, 'succeeded');
  } finally {
    restoreDiscord();
  }
});

test('stale ingestion is induced and observed by the operations alert sink', async () => {
  const now = new Date('2026-08-23T12:00:00.000Z');
  const snapshot = healthySnapshot(now);
  snapshot.cycleStartedAt = '2026-08-23T10:00:00.000Z';
  snapshot.mergedCycleUpdatedAt = '2026-08-23T10:00:00.000Z';
  const findings = evaluateMonitoringSnapshot(snapshot, defaultThresholds(), now);
  const delivered: string[] = [];

  const count = await notifyCriticalFindings(findings, async (message) => {
    delivered.push(message);
  });

  assert.equal(count, 2);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0] ?? '', /Ingestor cycle freshness is 120m old/);
  assert.match(delivered[0] ?? '', /Ingestor offers freshness is 120m old/);
});

test('alerting silence is induced and observed by the operations alert sink', async () => {
  const now = new Date('2026-08-23T12:00:00.000Z');
  const snapshot = healthySnapshot(now);
  snapshot.alertDetectionRun = makeRun('alert.detection', '2026-08-23T10:00:00.000Z');
  snapshot.alertNotificationRun = null;
  const findings = evaluateMonitoringSnapshot(snapshot, defaultThresholds(), now);
  const delivered: string[] = [];

  const count = await notifyCriticalFindings(findings, async (message) => {
    delivered.push(message);
  });

  assert.equal(count, 2);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0] ?? '', /alert\.detection last succeeded 120m ago/);
  assert.match(delivered[0] ?? '', /No alert\.notification run found/);
});

test('notification run with failed deliveries is critical even when it is fresh', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');
  const run = makeRun('alert.notification', '2026-08-23T11:59:00.000Z', { failed: 1 });
  const finding = evaluateAlertRunFinding('alert.notification', run, 15, now);

  assert.equal(finding.level, 'CRITICAL');
  assert.match(finding.message, /1 failed notification attempt/);
});

test('an unreachable monitor is critical and pages instead of reporting healthy', async () => {
  const finding = unknownMonitorFinding(new Error('database unavailable'));
  const delivered: string[] = [];
  const count = await notifyCriticalFindings([finding], async (message) => {
    delivered.push(message);
  });

  assert.equal(finding.level, 'CRITICAL');
  assert.equal(count, 1);
  assert.match(delivered[0] ?? '', /UNKNOWN: database unavailable/);
});

test('workflow schedules alerting and always runs its independent self-monitor', () => {
  const workflow = readFileSync('.github/workflows/ingestor-staleness-alert.yml', 'utf8');
  const source = readFileSync('scripts/ingestor-alert-check.ts', 'utf8');

  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(workflow, /--run-alerting-pass/);
  assert.match(workflow, /needs: alerting-pass[\s\S]*if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /ALERT_DRY_RUN: 'false'/);
  assert.match(workflow, /SYSTEM_PICKS_ENABLED: 'false'/);
  assert.doesNotMatch(source, /provider_offers[\s\S]{0,120}updated_at/);
  assert.match(source, /provider_cycle_status[\s\S]{0,160}updated_at/);
});

function makeOffer(line: string, snapshotAt: string, suffix: string) {
  return {
    providerKey: 'draftkings',
    providerEventId: 'utv2-1735-induced-event',
    providerMarketKey: 'spread',
    providerParticipantId: null,
    sportKey: 'NBA',
    line: Number(line),
    overOdds: -110,
    underOdds: -110,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt,
    idempotencyKey: `utv2-1735:${suffix}`,
    bookmakerKey: null,
  };
}

function installDiscordTestEnvironment() {
  const originalBotToken = process.env.DISCORD_BOT_TOKEN;
  const originalTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'utv2-1735-test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify({
    'discord:canary': '1296531122234327100',
  });

  return () => {
    if (originalBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalBotToken;
    if (originalTargetMap === undefined) delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    else process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalTargetMap;
  };
}

function defaultThresholds() {
  return { offers: 5, results: 60, cycle: 5, alertSystem: 15 };
}

function healthySnapshot(now: Date): AlertMonitoringSnapshot {
  const recent = new Date(now.getTime() - 60_000).toISOString();
  return {
    cycleStartedAt: recent,
    cycleStatus: 'succeeded',
    mergedCycleUpdatedAt: recent,
    resultCreatedAt: recent,
    latestCycleFailure: null,
    alertDetectionRun: makeRun('alert.detection', recent),
    alertNotificationRun: makeRun('alert.notification', recent),
  };
}

function makeRun(
  runType: 'alert.detection' | 'alert.notification',
  startedAt: string,
  details: Record<string, unknown> = {},
): SystemRunRecord {
  return {
    id: `${runType}-${startedAt}`,
    run_type: runType,
    status: 'succeeded',
    started_at: startedAt,
    finished_at: startedAt,
    actor: 'system:utv2-1735-test',
    details,
    created_at: startedAt,
    idempotency_key: null,
  };
}
