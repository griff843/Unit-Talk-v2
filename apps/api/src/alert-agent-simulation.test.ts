import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { runAlertDetectionPass } from './alert-agent-service.js';
import { runAlertNotificationPass } from './alert-notification-service.js';
import { createAlertSubmissionPublisher } from './alert-submission.js';
import type { AlertDetectionRecord } from '@unit-talk/db';

interface ScenarioFixture {
  name: string;
  sportId: string;
  providerMarketKey: string;
  marketType: AlertDetectionRecord['market_type'];
  oldLine: number | null;
  newLine: number | null;
  oldOdds?: { over: number; under: number };
  newOdds?: { over: number; under: number };
  participantType?: 'team' | 'player';
  baselineSnapshotAt?: string;
  currentSnapshotAt?: string;
  passNow?: string;
  expectedTier?: AlertDetectionRecord['tier'];
  expectedPersisted: number;
  expectedNotified: number;
  expectedSystemPickSubmissions: number;
  expectedChannels?: string[] | null;
}

const SCENARIOS: ScenarioFixture[] = [
  {
    name: 'NBA moneyline alert-worthy submits a system pick after notification',
    sportId: 'NBA',
    providerMarketKey: 'moneyline',
    marketType: 'moneyline',
    oldLine: null,
    newLine: null,
    oldOdds: { over: -110, under: -110 },
    newOdds: { over: -130, under: -105 },
    participantType: 'team',
    baselineSnapshotAt: '2026-04-03T10:00:00.000Z',
    currentSnapshotAt: '2026-04-03T10:10:00.000Z',
    passNow: '2026-04-03T10:15:00.000Z',
    expectedTier: 'alert-worthy',
    expectedPersisted: 1,
    expectedNotified: 1,
    expectedSystemPickSubmissions: 1,
    expectedChannels: ['discord:canary', 'discord:trader-insights'],
  },
  {
    name: 'NHL spread notable routes to canary only and does not submit a system pick',
    sportId: 'NHL',
    providerMarketKey: 'puck_line',
    marketType: 'spread',
    oldLine: 1.5,
    newLine: 3.5,
    participantType: 'team',
    baselineSnapshotAt: '2026-04-03T10:00:00.000Z',
    currentSnapshotAt: '2026-04-03T10:30:00.000Z',
    passNow: '2026-04-03T10:35:00.000Z',
    expectedTier: 'notable',
    expectedPersisted: 1,
    expectedNotified: 1,
    expectedSystemPickSubmissions: 0,
    expectedChannels: ['discord:canary'],
  },
  {
    name: 'MLB totals watch persists as intelligence without notifications',
    sportId: 'MLB',
    providerMarketKey: 'total',
    marketType: 'total',
    oldLine: 8.0,
    newLine: 8.5,
    participantType: 'team',
    baselineSnapshotAt: '2026-04-03T10:00:00.000Z',
    currentSnapshotAt: '2026-04-03T10:10:00.000Z',
    passNow: '2026-04-03T10:15:00.000Z',
    expectedTier: 'watch',
    expectedPersisted: 1,
    expectedNotified: 0,
    expectedSystemPickSubmissions: 0,
    expectedChannels: null,
  },
  {
    name: 'NBA player props notify but never become autonomous system picks',
    sportId: 'NBA',
    providerMarketKey: 'player_points',
    marketType: 'player_prop',
    oldLine: 24.5,
    newLine: 26.0,
    participantType: 'player',
    baselineSnapshotAt: '2026-04-03T10:00:00.000Z',
    currentSnapshotAt: '2026-04-03T10:10:00.000Z',
    passNow: '2026-04-03T10:15:00.000Z',
    expectedTier: 'alert-worthy',
    expectedPersisted: 1,
    expectedNotified: 1,
    expectedSystemPickSubmissions: 0,
    expectedChannels: ['discord:canary', 'discord:trader-insights'],
  },
  {
    name: 'NFL alerts are gated off before persistence',
    sportId: 'NFL',
    providerMarketKey: 'spread',
    marketType: 'spread',
    oldLine: 2.5,
    newLine: 6.0,
    participantType: 'team',
    baselineSnapshotAt: '2026-04-03T10:00:00.000Z',
    currentSnapshotAt: '2026-04-03T10:10:00.000Z',
    passNow: '2026-04-03T10:15:00.000Z',
    expectedPersisted: 0,
    expectedNotified: 0,
    expectedSystemPickSubmissions: 0,
    expectedChannels: null,
  },
  {
    name: 'Velocity elevated NBA spread becomes alert-worthy and submits a system pick',
    sportId: 'NBA',
    providerMarketKey: 'spread',
    marketType: 'spread',
    oldLine: 4.5,
    newLine: 6.5,
    participantType: 'team',
    baselineSnapshotAt: '2026-04-03T10:00:00.000Z',
    currentSnapshotAt: '2026-04-03T10:10:00.000Z',
    passNow: '2026-04-03T10:15:00.000Z',
    expectedTier: 'alert-worthy',
    expectedPersisted: 1,
    expectedNotified: 1,
    expectedSystemPickSubmissions: 1,
    expectedChannels: ['discord:canary', 'discord:trader-insights'],
  },
  {
    name: 'Cooldown suppresses duplicate notable notifications and system-pick retries',
    sportId: 'MLB',
    providerMarketKey: 'spread',
    marketType: 'spread',
    oldLine: 1.5,
    newLine: 3.5,
    participantType: 'team',
    baselineSnapshotAt: '2026-04-03T10:00:00.000Z',
    currentSnapshotAt: '2026-04-03T10:30:00.000Z',
    passNow: '2026-04-03T10:35:00.000Z',
    expectedTier: 'notable',
    expectedPersisted: 1,
    expectedNotified: 1,
    expectedSystemPickSubmissions: 0,
    expectedChannels: ['discord:canary'],
  },
];

test('alert agent simulation harness proves the configured alert matrix', async () => {
  for (const scenario of SCENARIOS) {
    await runScenarioFixture(scenario);
  }
});

async function runScenarioFixture(scenario: ScenarioFixture) {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: `${scenario.sportId.toLowerCase()}-${slug(scenario.name)}-evt`,
    sportId: scenario.sportId,
    eventName: `${scenario.sportId} ${scenario.name}`,
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  const participant = scenario.participantType
    ? await repositories.participants.upsertByExternalId({
        externalId: `${slug(scenario.name)}-${scenario.participantType}`,
        displayName:
          scenario.participantType === 'player'
            ? 'Fixture Player'
            : `${scenario.sportId} Fixture Team`,
        participantType: scenario.participantType,
        sport: scenario.sportId,
        metadata: {},
      })
    : null;

  await repositories.providerOffers.upsertBatch([
    makeOfferInsert({
      providerEventId: event.external_id ?? event.id,
      providerMarketKey: scenario.providerMarketKey,
      providerParticipantId: participant?.id ?? null,
      sportKey: scenario.sportId,
      line: scenario.oldLine,
      overOdds: scenario.oldOdds?.over ?? -110,
      underOdds: scenario.oldOdds?.under ?? -110,
      snapshotAt: scenario.baselineSnapshotAt ?? '2026-04-03T10:00:00.000Z',
      idempotencyKey: `${slug(scenario.name)}:old`,
    }),
    makeOfferInsert({
      providerEventId: event.external_id ?? event.id,
      providerMarketKey: scenario.providerMarketKey,
      providerParticipantId: participant?.id ?? null,
      sportKey: scenario.sportId,
      line: scenario.newLine,
      overOdds: scenario.newOdds?.over ?? -110,
      underOdds: scenario.newOdds?.under ?? -110,
      snapshotAt: scenario.currentSnapshotAt ?? '2026-04-03T10:10:00.000Z',
      idempotencyKey: `${slug(scenario.name)}:new`,
    }),
  ]);

  const detection = await runAlertDetectionPass(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: scenario.passNow ?? '2026-04-03T10:15:00.000Z',
  });

  assert.equal(
    detection.persisted,
    scenario.expectedPersisted,
    `${scenario.name}: persisted count`,
  );

  if (scenario.expectedPersisted === 0) {
    assert.equal(
      (await repositories.alertDetections.listRecent()).length,
      0,
      `${scenario.name}: no alert rows should persist`,
    );
    return;
  }

  const persisted = detection.persistedSignals[0];
  assert.ok(persisted, `${scenario.name}: expected a persisted signal`);
  assert.equal(persisted.market_type, scenario.marketType, `${scenario.name}: market type`);
  assert.equal(persisted.tier, scenario.expectedTier, `${scenario.name}: tier`);

  const notificationRequests: string[] = [];
  const submissionRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const publishSystemPick = createAlertSubmissionPublisher({
    enabled: true,
    apiUrl: 'http://127.0.0.1:4000',
    events: repositories.events,
    participants: repositories.participants,
    fetchImpl: async (url, init) => {
      submissionRequests.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    },
    logger: { error() {}, info() {} },
  });

  const restoreEnv = installDiscordTestEnv();
  try {
    const notificationResult = await runAlertNotificationPass(
      [persisted],
      repositories.alertDetections,
      {
        dryRun: false,
        now: new Date('2026-04-03T10:15:00.000Z'),
        fetchImpl: async (url) => {
          notificationRequests.push(String(url));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
        runs: repositories.runs,
        onNotified: publishSystemPick,
      },
    );

    assert.equal(
      notificationResult.notified,
      scenario.expectedNotified,
      `${scenario.name}: notified count`,
    );
  } finally {
    restoreEnv();
  }

  assert.equal(
    submissionRequests.length,
    scenario.expectedSystemPickSubmissions,
    `${scenario.name}: system-pick submission count`,
  );

  if (scenario.expectedChannels) {
    const rows = await repositories.alertDetections.listRecent();
    assert.deepEqual(
      rows[0]?.notified_channels ?? null,
      scenario.expectedChannels,
      `${scenario.name}: notified channels`,
    );
  } else {
    const rows = await repositories.alertDetections.listRecent();
    assert.equal(rows[0]?.notified_channels ?? null, null, `${scenario.name}: no notified channels`);
  }

  if (scenario.name.startsWith('Cooldown suppresses')) {
    const restoreCooldownEnv = installDiscordTestEnv();
    try {
      const secondPass = await runAlertNotificationPass(
        [persisted],
        repositories.alertDetections,
        {
          dryRun: false,
          now: new Date('2026-04-03T10:20:00.000Z'),
          fetchImpl: async (url) => {
            notificationRequests.push(String(url));
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          },
          runs: repositories.runs,
          onNotified: publishSystemPick,
        },
      );
      assert.equal(secondPass.notified, 0, `${scenario.name}: duplicate notification suppressed`);
      assert.equal(secondPass.skippedCooldown, 1, `${scenario.name}: cooldown skip recorded`);
      assert.equal(submissionRequests.length, 0, `${scenario.name}: no system-pick retry`);
    } finally {
      restoreCooldownEnv();
    }
  }

  if (submissionRequests.length > 0) {
    assert.equal(
      submissionRequests[0]?.url,
      'http://127.0.0.1:4000/api/submissions',
      `${scenario.name}: submission target`,
    );
  }

  const runProbeBefore = await repositories.runs.startRun({ runType: '__probe-before', details: {} });
  const runProbeAfter = await repositories.runs.startRun({ runType: '__probe-after', details: {} });
  const beforeId = parseInt(runProbeBefore.id.replace('run_', ''), 10);
  const afterId = parseInt(runProbeAfter.id.replace('run_', ''), 10);
  assert.ok(afterId > beforeId, `${scenario.name}: system runs repository advanced`);
}

function installDiscordTestEnv() {
  const originalBotToken = process.env.DISCORD_BOT_TOKEN;
  const originalTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify({
    'discord:canary': '1296531122234327100',
    'discord:trader-insights': '1356613995175481405',
  });

  return () => {
    if (originalBotToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalBotToken;
    }

    if (originalTargetMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalTargetMap;
    }
  };
}

function makeOfferInsert(input: {
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  sportKey: string;
  line: number | null;
  overOdds: number;
  underOdds: number;
  snapshotAt: string;
  idempotencyKey: string;
}) {
  return {
    providerKey: 'draftkings',
    providerEventId: input.providerEventId,
    providerMarketKey: input.providerMarketKey,
    providerParticipantId: input.providerParticipantId,
    sportKey: input.sportKey,
    line: input.line,
    overOdds: input.overOdds,
    underOdds: input.underOdds,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: input.snapshotAt,
    idempotencyKey: input.idempotencyKey,
  };
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
