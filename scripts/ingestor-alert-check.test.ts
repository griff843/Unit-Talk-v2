import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createInMemoryRepositoryBundle,
  type AlertDetectionRecord,
  type SystemRunRecord,
} from '@unit-talk/db';
import { resolveDiscordChannelId } from '@unit-talk/alert-runtime';
import {
  evaluateAgeFinding,
  evaluateAlertRunFinding,
  evaluateMonitoringSnapshot,
  notifyCriticalFindings,
  parseThreshold,
  resolveIngestorAlertThresholds,
  runScheduledAlertPass,
  buildChannelGuardedFetch,
  mergeUndeliveredDetections,
  MEMBER_CHANNELS_ENABLED_ENV,
  applyMemberChannelPolicy,
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

test('production thresholds are clamped to the observed scheduler cadence, not the nominal one', () => {
  const thresholds = resolveIngestorAlertThresholds({
    UNIT_TALK_APP_ENV: 'production',
    UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES: '30',
    INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES: undefined,
    INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES: undefined,
    INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES: '30',
    ALERT_SYSTEM_STALE_MINUTES: undefined,
  });

  // The workflow is scheduled `*/5`, but eight consecutive production runs were
  // measured 18-49 minutes apart. Clamping to the nominal 5 would mark a healthy
  // system CRITICAL on nearly every pass; these floors are the observed cadence.
  assert.deepEqual(thresholds, {
    offers: 60,
    results: 60,
    cycle: 60,
    alertSystem: 60,
  });

  const now = new Date('2026-04-21T16:00:00.000Z');

  // A six-minute-old offer is a healthy system running on a throttled scheduler.
  // Under the previous nominal-5 clamp this was CRITICAL on almost every pass.
  const withinCadence = evaluateAgeFinding(
    'offers',
    '2026-04-21T15:54:00.000Z',
    thresholds.offers,
    null,
    now,
  );
  assert.equal(withinCadence.ageMinutes, 6);
  assert.notEqual(withinCadence.level, 'CRITICAL');

  // Genuine staleness past the observed cadence still trips.
  const genuinelyStale = evaluateAgeFinding(
    'offers',
    '2026-04-21T14:30:00.000Z',
    thresholds.offers,
    null,
    now,
  );
  assert.equal(genuinelyStale.level, 'CRITICAL');
  assert.equal(genuinelyStale.ageMinutes, 90);
  assert.match(genuinelyStale.message, /threshold: 60m/);
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

const TARGET_MAP = JSON.stringify({
  'discord:canary': '111',
  'discord:trader-insights': '999',
});
const okFetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
const post = async (impl: typeof fetch, channelId: string): Promise<'sent' | 'refused'> => {
  try {
    await impl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
    } as RequestInit);
    return 'sent';
  } catch {
    return 'refused';
  }
};

test('member-facing discord channels are refused unless explicitly activated', async () => {
  const guarded = buildChannelGuardedFetch(okFetch, {
    UNIT_TALK_DISCORD_TARGET_MAP: TARGET_MAP,
  } as NodeJS.ProcessEnv);

  // The canary channel is the authorized default and must still deliver.
  assert.equal(await post(guarded, '111'), 'sent');
  // trader-insights is member-facing: refused without an activation decision.
  assert.equal(await post(guarded, '999'), 'refused');

  const activated = buildChannelGuardedFetch(okFetch, {
    UNIT_TALK_DISCORD_TARGET_MAP: TARGET_MAP,
    [MEMBER_CHANNELS_ENABLED_ENV]: 'true',
  } as NodeJS.ProcessEnv);
  assert.equal(await post(activated, '999'), 'sent');
});

test('channel guard fails closed when the target map cannot be resolved', async () => {
  const guarded = buildChannelGuardedFetch(okFetch, {} as NodeJS.ProcessEnv);
  assert.equal(await post(guarded, '111'), 'refused');
});

test('channel guard leaves non-message requests untouched', async () => {
  const guarded = buildChannelGuardedFetch(okFetch, {
    UNIT_TALK_DISCORD_TARGET_MAP: TARGET_MAP,
  } as NodeJS.ProcessEnv);
  assert.equal(await post(guarded, '111'), 'sent');
  const other = await guarded('https://supabase.example/rest/v1/x', {} as RequestInit);
  assert.equal((other as unknown as { ok: boolean }).ok, true);
});

test('undelivered detections are retried without duplicating delivered ones', () => {
  const now = new Date('2026-08-23T15:00:00Z');
  // Built from a REAL alert_detections row, not a hand-written shape. An earlier
  // revision filtered on `detected_at`, a column that does not exist on this
  // table, so the retry silently matched nothing; a fabricated fixture hid it.
  const record = (id: string, notified: boolean, minutesAgo: number): AlertDetectionRecord => ({
    id,
    notified,
    created_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    baseline_snapshot_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    current_snapshot_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    bookmaker_key: 'draftkings',
    cooldown_expires_at: null,
    direction: 'up',
    event_id: 'evt',
    first_mover_book: null,
    idempotency_key: `key-${id}`,
    line_change: 2,
    line_change_abs: 2,
    market_key: 'spread',
    market_type: 'spread',
    metadata: null,
    new_line: 6.5,
    notified_at: null,
    notified_channels: null,
    old_line: 4.5,
    participant_id: null,
    steam_detected: false,
    tier: 'notable',
    time_elapsed_minutes: 30,
    velocity: null,
  });

  const merged = mergeUndeliveredDetections(
    [record('fresh', false, 1)],
    [
      record('fresh', false, 1), // already in this pass — must not be duplicated
      record('undelivered', false, 30), // persisted but never delivered — retry
      record('delivered', true, 30), // already delivered — must not resend
      record('expired', false, 999), // outside the retry window
    ],
    now,
    240,
  );

  assert.deepEqual(merged.map((entry) => entry.id), ['fresh', 'undelivered']);
});

test('production threshold floor raises low values without disabling the env knob', () => {
  const at = (offers: string, cycle: string) =>
    resolveIngestorAlertThresholds({
      UNIT_TALK_APP_ENV: 'production',
      UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES: offers,
      INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES: cycle,
    });

  // Below the observed-cadence floor: raised to the floor.
  assert.equal(at('1', '1').offers, 60);
  assert.equal(at('5', '5').cycle, 60);
  // Above it: the operator's value is honoured. A previous revision computed
  // Math.max(Math.min(x, 5), 60), which is always exactly 60 and silently made
  // both of these knobs dead.
  assert.equal(at('120', '90').offers, 120);
  assert.equal(at('120', '90').cycle, 90);
});

test('the scheduled workflow pins the self-monitor threshold to the observed cadence', () => {
  const workflow = readFileSync('.github/workflows/ingestor-staleness-alert.yml', 'utf8');
  // 15 would mark a healthy system stale: the runs this threshold watches are
  // produced by the same throttled scheduler (~28 min effective cadence).
  assert.match(workflow, /ALERT_SYSTEM_STALE_MINUTES: \$\{\{ vars\.ALERT_SYSTEM_STALE_MINUTES \|\| '60' \}\}/u);
  // Member-facing delivery must stay off by default.
  assert.match(workflow, /ALERT_MEMBER_CHANNELS_ENABLED: 'false'/u);
});

test('member targets are stripped from the resolvable map unless activated', () => {
  const env = {
    UNIT_TALK_DISCORD_TARGET_MAP: JSON.stringify({
      'discord:canary': '111',
      'discord:trader-insights': '999',
    }),
  } as NodeJS.ProcessEnv;

  const result = applyMemberChannelPolicy(env);
  assert.deepEqual(result.removedTargets, ['discord:trader-insights']);
  // The member target is now unresolvable, so the delivery loop skips it with no
  // attempt, no retry ladder, and no audit rows.
  assert.equal(resolveDiscordChannelId('discord:trader-insights', env), null);
  assert.equal(resolveDiscordChannelId('discord:canary', env), '111');

  const activated = {
    UNIT_TALK_DISCORD_TARGET_MAP: JSON.stringify({
      'discord:canary': '111',
      'discord:trader-insights': '999',
    }),
    [MEMBER_CHANNELS_ENABLED_ENV]: 'true',
  } as NodeJS.ProcessEnv;
  assert.deepEqual(applyMemberChannelPolicy(activated).removedTargets, []);
  assert.equal(resolveDiscordChannelId('discord:trader-insights', activated), '999');
});

test('an alert-worthy pass delivers to canary, refuses the member channel, and is not a failure', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'utv2-1735-induced-event',
    sportId: 'NBA',
    eventName: 'UTV2-1735 Member Guard',
    eventDate: '2026-08-23',
    status: 'scheduled',
    metadata: { proofIssue: 'UTV2-1735' },
  });
  // 4.5 -> 9.0 is a 4.5 spread move, above the 3.5 alert-worthy threshold, so
  // resolveChannels() routes it to canary AND the member-facing trader-insights.
  await repositories.providerOffers.upsertBatch([
    makeOffer('4.5', '2026-08-23T10:00:00.000Z', 'guard-baseline'),
    makeOffer('9.0', '2026-08-23T10:30:00.000Z', 'guard-current'),
  ]);

  const originalBotToken = process.env.DISCORD_BOT_TOKEN;
  const originalTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  const originalActivation = process.env[MEMBER_CHANNELS_ENABLED_ENV];
  process.env.DISCORD_BOT_TOKEN = 'utv2-1735-test-token';
  // Both targets are resolvable here, so the member channel is genuinely
  // reachable and only the guard prevents delivery.
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify({
    'discord:canary': '1296531122234327100',
    'discord:trader-insights': '1296531122234327999',
  });
  delete process.env[MEMBER_CHANNELS_ENABLED_ENV];

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

    // No request ever reached the member-facing channel.
    assert.ok(requests.length > 0);
    assert.ok(
      requests.every((url) => url.includes('1296531122234327100')),
      `member channel was contacted: ${requests.join(', ')}`,
    );

    // A refused member channel is a policy decision, not a delivery failure:
    // canary succeeded, so the detection is marked notified and never re-queued.
    assert.equal(result.notification.failed, 0);
    assert.equal(result.notification.notified, 1);

    const detections = await repositories.alertDetections.listRecent();
    assert.equal(detections[0]?.tier, 'alert-worthy');
    assert.equal(detections[0]?.notified, true);
    assert.deepEqual(detections[0]?.notified_channels, ['discord:canary']);

    const notificationRuns = await repositories.runs.listByType('alert.notification', 1);
    assert.equal(notificationRuns[0]?.status, 'succeeded');
    // The refusal leaves a durable trace, and it took the cheap path: the member
    // target was withheld from the resolvable map, so the delivery loop skipped
    // it outright instead of burning the retry ladder at the transport.
    const details = notificationRuns[0]?.details as {
      memberTargetsWithheld?: string[];
      blockedMemberChannels?: number;
    };
    assert.deepEqual(details?.memberTargetsWithheld, ['discord:trader-insights']);
    assert.equal(details?.blockedMemberChannels, 0);
  } finally {
    if (originalBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalBotToken;
    if (originalTargetMap === undefined) delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    else process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalTargetMap;
    if (originalActivation === undefined) delete process.env[MEMBER_CHANNELS_ENABLED_ENV];
    else process.env[MEMBER_CHANNELS_ENABLED_ENV] = originalActivation;
  }
});

test('the scheduled pass restores the global target map it mutated', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'utv2-1735-induced-event',
    sportId: 'NBA',
    eventName: 'UTV2-1735 Env Restore',
    eventDate: '2026-08-23',
    status: 'scheduled',
    metadata: { proofIssue: 'UTV2-1735' },
  });
  await repositories.providerOffers.upsertBatch([
    makeOffer('4.5', '2026-08-23T10:00:00.000Z', 'restore-baseline'),
    makeOffer('9.0', '2026-08-23T10:30:00.000Z', 'restore-current'),
  ]);

  const originalBotToken = process.env.DISCORD_BOT_TOKEN;
  const originalTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  // apps/api and apps/worker read this variable directly from process.env, so a
  // canary-only map left behind would silently stop their Discord delivery.
  const supplied = JSON.stringify({
    'discord:canary': '1296531122234327100',
    'discord:trader-insights': '1296531122234327999',
    'discord:best-bets': '1296531122234327888',
  });
  process.env.DISCORD_BOT_TOKEN = 'utv2-1735-test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = supplied;

  try {
    await runScheduledAlertPass(repositories, {
      environment: {
        ALERT_AGENT_ENABLED: 'true',
        ALERT_DRY_RUN: 'false',
        ALERT_MIN_TIER: 'notable',
      },
      now: new Date('2026-08-23T10:35:00.000Z'),
      fetchImpl: async () => new Response('{}', { status: 200 }),
      sleepImpl: async () => {},
    });
    assert.equal(process.env.UNIT_TALK_DISCORD_TARGET_MAP, supplied);
  } finally {
    if (originalBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalBotToken;
    if (originalTargetMap === undefined) delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    else process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalTargetMap;
  }
});

test('the target map is restored even when startRun throws before delivery', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'utv2-1735-induced-event',
    sportId: 'NBA',
    eventName: 'UTV2-1735 Restore On Throw',
    eventDate: '2026-08-23',
    status: 'scheduled',
    metadata: { proofIssue: 'UTV2-1735' },
  });
  await repositories.providerOffers.upsertBatch([
    makeOffer('4.5', '2026-08-23T10:00:00.000Z', 'throw-baseline'),
    makeOffer('9.0', '2026-08-23T10:30:00.000Z', 'throw-current'),
  ]);

  // startRun is an await between the env mutation and the restore. A Supabase
  // blip on the system_runs insert must not leave a canary-only map behind.
  const realStartRun = repositories.runs.startRun.bind(repositories.runs);
  repositories.runs.startRun = (async (input: { runType: string }) => {
    if (input.runType === 'alert.notification') throw new Error('simulated system_runs failure');
    return realStartRun(input as never);
  }) as typeof repositories.runs.startRun;

  const originalBotToken = process.env.DISCORD_BOT_TOKEN;
  const originalTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  const supplied = JSON.stringify({
    'discord:canary': '1296531122234327100',
    'discord:trader-insights': '1296531122234327999',
  });
  process.env.DISCORD_BOT_TOKEN = 'utv2-1735-test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = supplied;

  try {
    await assert.rejects(
      runScheduledAlertPass(repositories, {
        environment: {
          ALERT_AGENT_ENABLED: 'true',
          ALERT_DRY_RUN: 'false',
          ALERT_MIN_TIER: 'notable',
        },
        now: new Date('2026-08-23T10:35:00.000Z'),
        fetchImpl: async () => new Response('{}', { status: 200 }),
        sleepImpl: async () => {},
      }),
      /simulated system_runs failure/u,
    );
    assert.equal(process.env.UNIT_TALK_DISCORD_TARGET_MAP, supplied);
  } finally {
    if (originalBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalBotToken;
    if (originalTargetMap === undefined) delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    else process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalTargetMap;
  }
});

/**
 * Counts every write the scheduled pass could make, so "disabled" can be proven
 * to mean zero writes rather than merely "returned early".
 */
function countingRepositories() {
  const repositories = createInMemoryRepositoryBundle();
  const writes = { detections: 0, runsStarted: 0, runsCompleted: 0, notified: 0 };
  const detections = repositories.alertDetections;
  const runs = repositories.runs;

  const realSave = detections.saveDetection.bind(detections);
  detections.saveDetection = ((input: never) => {
    writes.detections += 1;
    return realSave(input);
  }) as typeof detections.saveDetection;

  const realUpdateNotified = detections.updateNotified.bind(detections);
  detections.updateNotified = ((input: never) => {
    writes.notified += 1;
    return realUpdateNotified(input);
  }) as typeof detections.updateNotified;

  const realStart = runs.startRun.bind(runs);
  runs.startRun = ((input: never) => {
    writes.runsStarted += 1;
    return realStart(input);
  }) as typeof runs.startRun;

  const realComplete = runs.completeRun.bind(runs);
  runs.completeRun = ((input: never) => {
    writes.runsCompleted += 1;
    return realComplete(input);
  }) as typeof runs.completeRun;

  return { repositories, writes };
}

async function seedMovement(repositories: ReturnType<typeof createInMemoryRepositoryBundle>, suffix: string) {
  await repositories.events.upsertByExternalId({
    externalId: 'utv2-1740-induced-event',
    sportId: 'NBA',
    eventName: 'UTV2-1740 Disabled Path',
    eventDate: '2026-08-23',
    status: 'scheduled',
    metadata: { proofIssue: 'UTV2-1740' },
  });
  await repositories.providerOffers.upsertBatch([
    makeOffer('4.5', '2026-08-23T10:00:00.000Z', `${suffix}-baseline`),
    makeOffer('9.0', '2026-08-23T10:30:00.000Z', `${suffix}-current`),
  ]);
}

test('a disabled agent performs zero writes and zero delivery attempts', async () => {
  const { repositories, writes } = countingRepositories();
  await seedMovement(repositories, 'disabled');

  let fetchCalls = 0;
  await assert.rejects(
    runScheduledAlertPass(repositories, {
      // Disabled through the loaded configuration, exactly as an operator would
      // set it in local.env or .env.
      environment: { ALERT_AGENT_ENABLED: 'false', ALERT_DRY_RUN: 'false' } as NodeJS.ProcessEnv,
      now: new Date('2026-08-23T10:35:00.000Z'),
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
      sleepImpl: async () => {},
    }),
    /ALERT_AGENT_ENABLED=false/u,
  );

  // Disabled must mean nothing happened at all, not merely "returned early".
  assert.deepEqual(writes, { detections: 0, runsStarted: 0, runsCompleted: 0, notified: 0 });
  assert.equal(fetchCalls, 0);
  assert.equal((await repositories.alertDetections.listRecent()).length, 0);
  assert.equal((await repositories.runs.listByType('alert.detection', 5)).length, 0);
  assert.equal((await repositories.runs.listByType('alert.notification', 5)).length, 0);
});

test('the loaded configuration wins over process.env when the two disagree', async () => {
  const { repositories, writes } = countingRepositories();
  await seedMovement(repositories, 'precedence');

  const originalEnabled = process.env.ALERT_AGENT_ENABLED;
  // The ambient process says enabled -- as the scheduled workflow sets it --
  // while the loaded configuration says disabled. Before the fix, main() omitted
  // the loaded environment and the pass read process.env, so the operator's
  // file-configured disable was ignored and detection still wrote to the
  // database. The loaded configuration must win.
  process.env.ALERT_AGENT_ENABLED = 'true';
  try {
    await assert.rejects(
      runScheduledAlertPass(repositories, {
        environment: { ALERT_AGENT_ENABLED: 'false', ALERT_DRY_RUN: 'false' } as NodeJS.ProcessEnv,
        now: new Date('2026-08-23T10:35:00.000Z'),
        fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
        sleepImpl: async () => {},
      }),
      /ALERT_AGENT_ENABLED=false/u,
    );
    assert.deepEqual(writes, { detections: 0, runsStarted: 0, runsCompleted: 0, notified: 0 });
  } finally {
    if (originalEnabled === undefined) delete process.env.ALERT_AGENT_ENABLED;
    else process.env.ALERT_AGENT_ENABLED = originalEnabled;
  }
});

test('main() wires the loaded configuration into the scheduled pass', () => {
  // A wiring guard, deliberately textual: the defect that shipped was not inside
  // runScheduledAlertPass -- which honours whatever environment it is given --
  // but at the single call site in main(), which passed none. Behavioural tests
  // inject an environment directly and so cannot observe that omission. This
  // asserts the call site itself, which is the thing that regressed.
  const source = readFileSync('scripts/ingestor-alert-check.ts', 'utf8');
  assert.match(
    source,
    /runScheduledAlertPass\(\s*repositories,\s*\{[^}]*environment:/u,
    'main() must pass the loaded environment into runScheduledAlertPass',
  );
  assert.doesNotMatch(
    source,
    /runScheduledAlertPass\(\s*repositories\s*\)/u,
    'runScheduledAlertPass must never be called without an explicit environment',
  );
});
