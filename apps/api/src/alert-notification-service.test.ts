import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryAlertDetectionRepository, InMemorySystemRunRepository } from '@unit-talk/db';
import {
  buildAlertEmbed,
  resolveDiscordChannelId,
  runAlertNotificationPass,
} from './alert-notification-service.js';
import type {
  AlertDetectionRecord,
  SystemRunStartInput,
  SystemRunCompleteInput,
} from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDetection(
  overrides: Partial<AlertDetectionRecord> = {},
): AlertDetectionRecord {
  return {
    id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
    event_id: 'evt-001',
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
    ...overrides,
  };
}

function makeTargetMap(): string {
  return JSON.stringify({
    'discord:canary': '1296531122234327100',
    'discord:trader-insights': '1356613995175481405',
    'discord:recaps': '1300411261854547968',
  });
}

// ---------------------------------------------------------------------------
// buildAlertEmbed
// ---------------------------------------------------------------------------

test('buildAlertEmbed — notable tier uses amber color 0xff9900', () => {
  const detection = makeDetection({ tier: 'notable' });
  const embed = buildAlertEmbed(detection, 'discord:canary');
  assert.equal(embed.color, 0xff9900);
});

test('buildAlertEmbed — alert-worthy tier uses orange color 0xff6600', () => {
  const detection = makeDetection({ tier: 'alert-worthy' });
  const embed = buildAlertEmbed(detection, 'discord:canary');
  assert.equal(embed.color, 0xff6600);
});

test('buildAlertEmbed — title contains LINE MOVEMENT', () => {
  const detection = makeDetection();
  const embed = buildAlertEmbed(detection, 'discord:canary');
  assert.ok(typeof embed.title === 'string');
  assert.ok((embed.title as string).includes('LINE MOVEMENT'));
});

test('buildAlertEmbed — description contains old and new line', () => {
  const detection = makeDetection({ old_line: 4.5, new_line: 7.0, line_change: 2.5 });
  const embed = buildAlertEmbed(detection, 'discord:canary');
  assert.ok(typeof embed.description === 'string');
  assert.ok((embed.description as string).includes('4.5'));
  assert.ok((embed.description as string).includes('7'));
});

test('buildAlertEmbed — footer contains channel name', () => {
  const detection = makeDetection();
  const embed = buildAlertEmbed(detection, 'discord:canary');
  const footer = embed.footer as { text: string };
  assert.ok(footer.text.includes('discord:canary'));
});

test('buildAlertEmbed — velocity elevated flag shown in field name', () => {
  const detection = makeDetection({
    velocity: 0.5,
    metadata: { velocityElevated: true },
  });
  const embed = buildAlertEmbed(detection, 'discord:canary');
  const fields = embed.fields as Array<{ name: string; value: string }>;
  const velocityField = fields.find((f) => f.name.includes('Velocity'));
  assert.ok(velocityField !== undefined);
  assert.ok(velocityField.name.includes('elevated'));
});

// ---------------------------------------------------------------------------
// resolveDiscordChannelId
// ---------------------------------------------------------------------------

test('resolveDiscordChannelId — resolves from target map env', () => {
  const env = { UNIT_TALK_DISCORD_TARGET_MAP: makeTargetMap() };
  const id = resolveDiscordChannelId('discord:canary', env);
  assert.equal(id, '1296531122234327100');
});

test('resolveDiscordChannelId — returns null when target not in map', () => {
  const env = { UNIT_TALK_DISCORD_TARGET_MAP: makeTargetMap() };
  const id = resolveDiscordChannelId('discord:unknown', env);
  assert.equal(id, null);
});

test('resolveDiscordChannelId — accepts raw numeric channel ID', () => {
  const id = resolveDiscordChannelId('1296531122234327100', {});
  assert.equal(id, '1296531122234327100');
});

// ---------------------------------------------------------------------------
// runAlertNotificationPass
// ---------------------------------------------------------------------------

test('runAlertNotificationPass — watch tier never notified', async () => {
  const repo = new InMemoryAlertDetectionRepository();
  const detection = makeDetection({ tier: 'watch' });
  const result = await runAlertNotificationPass([detection], repo, { dryRun: true });
  assert.equal(result.skippedWatch, 1);
  assert.equal(result.notified, 0);
});

test('runAlertNotificationPass — dry-run skips Discord post and writes no cooldown', async () => {
  const repo = new InMemoryAlertDetectionRepository();
  const detection = await repo.saveDetection({
    idempotencyKey: 'test-key-1',
    eventId: 'evt-001',
    marketKey: 'spread',
    bookmakerKey: 'draftkings',
    baselineSnapshotAt: '2026-03-28T10:00:00.000Z',
    currentSnapshotAt: '2026-03-28T10:30:00.000Z',
    oldLine: 4.5,
    newLine: 7.0,
    lineChange: 2.5,
    lineChangeAbs: 2.5,
    velocity: 0.083,
    timeElapsedMinutes: 30,
    direction: 'up',
    marketType: 'spread',
    tier: 'notable',
    metadata: {},
  });

  assert.ok(detection !== null);

  let discordCalled = false;
  const fakeFetch = async () => {
    discordCalled = true;
    return new Response('', { status: 200 });
  };

  const result = await runAlertNotificationPass([detection!], repo, {
    dryRun: true,
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert.equal(discordCalled, false, 'Discord should not be called in dry-run');
  assert.equal(result.notified, 1); // counted as would-notify

  const updated = (await repo.listRecent(10)).find((r) => r.id === detection!.id);
  assert.equal(updated?.notified, false, 'cooldown must not be written in dry-run');
});

test('runAlertNotificationPass — notable routes to canary only', async () => {
  const repo = new InMemoryAlertDetectionRepository();
  const calledChannels: string[] = [];

  const fakeFetch = async (url: string) => {
    calledChannels.push(url as string);
    return new Response('', { status: 200 });
  };

  const detection = makeDetection({ tier: 'notable', id: crypto.randomUUID() });

  // Store in repo so cooldown check has the record
  const saved = await repo.saveDetection({
    idempotencyKey: detection.idempotency_key,
    eventId: detection.event_id,
    marketKey: detection.market_key,
    bookmakerKey: detection.bookmaker_key,
    baselineSnapshotAt: detection.baseline_snapshot_at,
    currentSnapshotAt: detection.current_snapshot_at,
    oldLine: detection.old_line,
    newLine: detection.new_line,
    lineChange: detection.line_change,
    lineChangeAbs: detection.line_change_abs,
    velocity: detection.velocity,
    timeElapsedMinutes: detection.time_elapsed_minutes,
    direction: detection.direction as 'up' | 'down',
    marketType: detection.market_type as 'spread' | 'total' | 'moneyline' | 'player_prop',
    tier: 'notable',
    metadata: {},
  });

  assert.ok(saved !== null);

  const originalEnv = process.env.DISCORD_BOT_TOKEN;
  const originalMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = makeTargetMap();

  try {
    const result = await runAlertNotificationPass([saved!], repo, {
      dryRun: false,
      fetchImpl: fakeFetch as typeof fetch,
    });

    assert.equal(result.notified, 1);
    // notable should only post to canary (1 channel)
    assert.equal(calledChannels.length, 1);
    assert.ok(calledChannels[0]!.includes('1296531122234327100'), 'should post to canary ID');
  } finally {
    if (originalEnv === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalEnv;
    }
    if (originalMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalMap;
    }
  }
});

test('runAlertNotificationPass — alert-worthy routes to canary and trader-insights', async () => {
  const repo = new InMemoryAlertDetectionRepository();
  const calledChannels: string[] = [];

  const fakeFetch = async (url: string) => {
    calledChannels.push(url as string);
    return new Response('', { status: 200 });
  };

  const saved = await repo.saveDetection({
    idempotencyKey: 'aw-key-1',
    eventId: 'evt-002',
    marketKey: 'total',
    bookmakerKey: 'fanduel',
    baselineSnapshotAt: '2026-03-28T10:00:00.000Z',
    currentSnapshotAt: '2026-03-28T10:10:00.000Z',
    oldLine: 220.5,
    newLine: 224.0,
    lineChange: 3.5,
    lineChangeAbs: 3.5,
    velocity: 0.35,
    timeElapsedMinutes: 10,
    direction: 'up',
    marketType: 'total',
    tier: 'alert-worthy',
    metadata: { velocityElevated: true },
  });

  assert.ok(saved !== null);

  const originalEnv = process.env.DISCORD_BOT_TOKEN;
  const originalMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = makeTargetMap();

  try {
    const result = await runAlertNotificationPass([saved!], repo, {
      dryRun: false,
      fetchImpl: fakeFetch as typeof fetch,
    });

    assert.equal(result.notified, 1);
    assert.equal(calledChannels.length, 2, 'alert-worthy posts to 2 channels');
    assert.ok(calledChannels.some((u) => u.includes('1296531122234327100')), 'canary');
    assert.ok(calledChannels.some((u) => u.includes('1356613995175481405')), 'trader-insights');
  } finally {
    if (originalEnv === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalEnv;
    }
    if (originalMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalMap;
    }
  }
});

test('runAlertNotificationPass — cooldown suppresses re-notification', async () => {
  const repo = new InMemoryAlertDetectionRepository();
  const now = new Date('2026-03-28T11:00:00.000Z');
  const cooldownExpiry = new Date(now.getTime() + 20 * 60 * 1000).toISOString();

  // Save a detection that is already notified with active cooldown
  const saved = await repo.saveDetection({
    idempotencyKey: 'cooldown-key-1',
    eventId: 'evt-003',
    marketKey: 'h2h',
    bookmakerKey: 'betmgm',
    baselineSnapshotAt: '2026-03-28T10:30:00.000Z',
    currentSnapshotAt: '2026-03-28T10:45:00.000Z',
    oldLine: -110,
    newLine: -130,
    lineChange: -20,
    lineChangeAbs: 20,
    velocity: null,
    timeElapsedMinutes: 15,
    direction: 'down',
    marketType: 'moneyline',
    tier: 'notable',
    notified: true,
    notifiedAt: now.toISOString(),
    notifiedChannels: ['discord:canary'],
    cooldownExpiresAt: cooldownExpiry,
    metadata: {},
  });

  assert.ok(saved !== null);

  // Now try to notify a fresh detection on the same event/market/tier
  const freshDetection = await repo.saveDetection({
    idempotencyKey: 'cooldown-key-2',
    eventId: 'evt-003',
    marketKey: 'h2h',
    bookmakerKey: 'betmgm',
    baselineSnapshotAt: '2026-03-28T10:35:00.000Z',
    currentSnapshotAt: '2026-03-28T10:50:00.000Z',
    oldLine: -110,
    newLine: -135,
    lineChange: -25,
    lineChangeAbs: 25,
    velocity: null,
    timeElapsedMinutes: 15,
    direction: 'down',
    marketType: 'moneyline',
    tier: 'notable',
    metadata: {},
  });

  assert.ok(freshDetection !== null);

  let discordCalled = false;
  const fakeFetch = async () => {
    discordCalled = true;
    return new Response('', { status: 200 });
  };

  const originalEnv = process.env.DISCORD_BOT_TOKEN;
  const originalMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = makeTargetMap();

  try {
    const result = await runAlertNotificationPass([freshDetection!], repo, {
      dryRun: false,
      now,
      fetchImpl: fakeFetch as typeof fetch,
    });

    assert.equal(discordCalled, false, 'Discord should not be called — cooldown active');
    assert.equal(result.skippedCooldown, 1);
    assert.equal(result.notified, 0);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalEnv;
    }
    if (originalMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalMap;
    }
  }
});

test('runAlertNotificationPass — Discord failure leaves notified=false', async () => {
  const repo = new InMemoryAlertDetectionRepository();

  const saved = await repo.saveDetection({
    idempotencyKey: 'fail-key-1',
    eventId: 'evt-004',
    marketKey: 'spread',
    bookmakerKey: 'caesars',
    baselineSnapshotAt: '2026-03-28T10:00:00.000Z',
    currentSnapshotAt: '2026-03-28T10:20:00.000Z',
    oldLine: 3.0,
    newLine: 5.5,
    lineChange: 2.5,
    lineChangeAbs: 2.5,
    velocity: 0.125,
    timeElapsedMinutes: 20,
    direction: 'up',
    marketType: 'spread',
    tier: 'notable',
    metadata: {},
  });

  assert.ok(saved !== null);

  const fakeFetch = async () => new Response('', { status: 500 });

  const originalEnv = process.env.DISCORD_BOT_TOKEN;
  const originalMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = makeTargetMap();

  try {
    const result = await runAlertNotificationPass([saved!], repo, {
      dryRun: false,
      fetchImpl: fakeFetch as typeof fetch,
    });

    assert.equal(result.failed, 1);
    assert.equal(result.notified, 0);

    const updated = (await repo.listRecent(10)).find((r) => r.id === saved!.id);
    assert.equal(updated?.notified, false, 'notified must remain false on Discord failure');
    assert.equal(updated?.cooldown_expires_at, null);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalEnv;
    }
    if (originalMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalMap;
    }
  }
});

test('runAlertNotificationPass — cooldown written after successful notify', async () => {
  const repo = new InMemoryAlertDetectionRepository();

  const saved = await repo.saveDetection({
    idempotencyKey: 'cooldown-write-key-1',
    eventId: 'evt-005',
    marketKey: 'player_points',
    bookmakerKey: 'draftkings',
    baselineSnapshotAt: '2026-03-28T10:00:00.000Z',
    currentSnapshotAt: '2026-03-28T10:10:00.000Z',
    oldLine: 24.5,
    newLine: 25.5,
    lineChange: 1.0,
    lineChangeAbs: 1.0,
    velocity: 0.1,
    timeElapsedMinutes: 10,
    direction: 'up',
    marketType: 'player_prop',
    tier: 'alert-worthy',
    metadata: {},
  });

  assert.ok(saved !== null);

  const fakeFetch = async () => new Response('', { status: 200 });
  const now = new Date('2026-03-28T11:00:00.000Z');

  const originalEnv = process.env.DISCORD_BOT_TOKEN;
  const originalMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = makeTargetMap();

  try {
    await runAlertNotificationPass([saved!], repo, {
      dryRun: false,
      now,
      fetchImpl: fakeFetch as typeof fetch,
    });

    const updated = (await repo.listRecent(10)).find((r) => r.id === saved!.id);
    assert.equal(updated?.notified, true);
    assert.ok(updated?.notified_at !== null);
    assert.ok(updated?.cooldown_expires_at !== null);

    // alert-worthy cooldown = 15 min from now
    const expectedExpiry = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    assert.equal(updated?.cooldown_expires_at, expectedExpiry);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalEnv;
    }
    if (originalMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = originalMap;
    }
  }
});

// ---------------------------------------------------------------------------
// system_runs instrumentation
// ---------------------------------------------------------------------------

test('runAlertNotificationPass calls startRun and completeRun with succeeded status', async () => {
  const repo = new InMemoryAlertDetectionRepository();
  const runsRepo = new InMemorySystemRunRepository();
  const runCalls: Array<{ method: string; runType?: string; status?: string }> = [];

  const spyRuns = {
    async startRun(input: SystemRunStartInput) {
      runCalls.push({ method: 'startRun', runType: input.runType });
      return runsRepo.startRun(input);
    },
    async completeRun(input: SystemRunCompleteInput) {
      runCalls.push({ method: 'completeRun', status: input.status });
      return runsRepo.completeRun(input);
    },
  };

  const detection = makeDetection({ tier: 'notable' });
  await runAlertNotificationPass([detection], repo, { dryRun: true, runs: spyRuns });

  assert.ok(runCalls.some((c) => c.method === 'startRun' && c.runType === 'alert.notification'));
  assert.ok(runCalls.some((c) => c.method === 'completeRun' && c.status === 'succeeded'));
});
