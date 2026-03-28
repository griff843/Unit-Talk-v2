import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InMemoryHedgeOpportunityRepository } from '@unit-talk/db';
import {
  buildHedgeEmbed,
  runHedgeNotificationPass,
} from './hedge-notification-service.js';

test('buildHedgeEmbed uses contract colors and title conventions', async () => {
  const repo = new InMemoryHedgeOpportunityRepository();
  const opportunity = await saveOpportunity(repo, {
    type: 'arbitrage',
    priority: 'critical',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 4.5,
    lineB: 6.5,
    overOddsA: 200,
    underOddsB: 200,
  });

  const embed = buildHedgeEmbed(opportunity, 'discord:canary');
  assert.equal(embed.color, 0x00cc44);
  assert.ok((embed.title as string).includes('ARBITRAGE'));
  const fields = embed.fields as Array<{ name: string; value: string }>;
  assert.ok(fields.some((field) => field.name === 'Guaranteed Profit'));
});

test('runHedgeNotificationPass dry-run skips Discord and leaves rows untouched', async () => {
  const repo = new InMemoryHedgeOpportunityRepository();
  const opportunity = await saveOpportunity(repo, {
    type: 'hedge',
    priority: 'medium',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 4.5,
    lineB: 7.5,
  });

  let discordCalled = false;
  const fakeFetch = async () => {
    discordCalled = true;
    return new Response('', { status: 200 });
  };

  const result = await runHedgeNotificationPass([opportunity], repo, {
    dryRun: true,
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert.equal(discordCalled, false);
  assert.equal(result.notified, 1);
  const updated = (await repo.listRecent(10)).find((row) => row.id === opportunity.id);
  assert.equal(updated?.notified, false);
});

test('runHedgeNotificationPass critical routes to canary and trader-insights', async () => {
  const repo = new InMemoryHedgeOpportunityRepository();
  const opportunity = await saveOpportunity(repo, {
    type: 'arbitrage',
    priority: 'critical',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 4.5,
    lineB: 6.5,
    overOddsA: 200,
    underOddsB: 200,
  });

  const calledChannels: string[] = [];
  const fakeFetch = async (url: string) => {
    calledChannels.push(url);
    return new Response('', { status: 200 });
  };

  const originalToken = process.env.DISCORD_BOT_TOKEN;
  const originalMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = makeTargetMap();

  try {
    const result = await runHedgeNotificationPass([opportunity], repo, {
      dryRun: false,
      fetchImpl: fakeFetch as typeof fetch,
    });

    assert.equal(result.notified, 1);
    assert.equal(calledChannels.length, 2);
    assert.ok(calledChannels.some((url) => url.includes('1296531122234327100')));
    assert.ok(calledChannels.some((url) => url.includes('1356613995175481405')));
  } finally {
    restoreEnv('DISCORD_BOT_TOKEN', originalToken);
    restoreEnv('UNIT_TALK_DISCORD_TARGET_MAP', originalMap);
  }
});

test('runHedgeNotificationPass cooldown suppresses duplicate hedge alerts', async () => {
  const repo = new InMemoryHedgeOpportunityRepository();
  const now = new Date('2026-03-28T11:00:00.000Z');
  const cooldownExpiry = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

  const notified = await saveOpportunity(repo, {
    type: 'hedge',
    priority: 'medium',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 4.5,
    lineB: 7.5,
    notified: true,
    notifiedAt: now.toISOString(),
    notifiedChannels: ['discord:canary'],
    cooldownExpiresAt: cooldownExpiry,
  });

  const fresh = await saveOpportunity(repo, {
    type: 'hedge',
    priority: 'medium',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 4.5,
    lineB: 7.5,
    detectedAt: '2026-03-28T11:05:00.000Z',
  });

  assert.ok(notified.id !== fresh.id);

  let discordCalled = false;
  const fakeFetch = async () => {
    discordCalled = true;
    return new Response('', { status: 200 });
  };

  const originalToken = process.env.DISCORD_BOT_TOKEN;
  const originalMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = makeTargetMap();

  try {
    const result = await runHedgeNotificationPass([fresh], repo, {
      dryRun: false,
      now,
      fetchImpl: fakeFetch as typeof fetch,
    });

    assert.equal(discordCalled, false);
    assert.equal(result.skippedCooldown, 1);
    assert.equal(result.notified, 0);
  } finally {
    restoreEnv('DISCORD_BOT_TOKEN', originalToken);
    restoreEnv('UNIT_TALK_DISCORD_TARGET_MAP', originalMap);
  }
});

test('runHedgeNotificationPass low priority opportunities are never notified', async () => {
  const repo = new InMemoryHedgeOpportunityRepository();
  const opportunity = await saveOpportunity(repo, {
    type: 'hedge',
    priority: 'low',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 4.5,
    lineB: 7.0,
  });

  let discordCalled = false;
  const fakeFetch = async () => {
    discordCalled = true;
    return new Response('', { status: 200 });
  };

  const result = await runHedgeNotificationPass([opportunity], repo, {
    dryRun: false,
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert.equal(discordCalled, false);
  assert.equal(result.skippedLow, 1);
  assert.equal(result.notified, 0);
});

function makeTargetMap(): string {
  return JSON.stringify({
    'discord:canary': '1296531122234327100',
    'discord:trader-insights': '1356613995175481405',
  });
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

async function saveOpportunity(
  repo: InMemoryHedgeOpportunityRepository,
  overrides: Partial<{
    type: 'arbitrage' | 'middle' | 'hedge';
    priority: 'low' | 'medium' | 'high' | 'critical';
    bookmakerA: string;
    bookmakerB: string;
    lineA: number;
    lineB: number;
    overOddsA: number;
    underOddsB: number;
    detectedAt: string;
    notified: boolean;
    notifiedAt: string | null;
    notifiedChannels: string[] | null;
    cooldownExpiresAt: string | null;
  }> = {},
) {
  const record = await repo.saveOpportunity({
    idempotencyKey: randomUUID(),
    eventId: 'evt-hedge-notify-1',
    participantId: 'participant-1',
    marketKey: 'player_points',
    type: overrides.type ?? 'hedge',
    priority: overrides.priority ?? 'medium',
    bookmakerA: overrides.bookmakerA ?? 'draftkings',
    bookmakerB: overrides.bookmakerB ?? 'fanduel',
    lineA: overrides.lineA ?? 4.5,
    lineB: overrides.lineB ?? 7.5,
    overOddsA: overrides.overOddsA ?? -110,
    underOddsB: overrides.underOddsB ?? -110,
    lineDiscrepancy: Math.abs((overrides.lineA ?? 4.5) - (overrides.lineB ?? 7.5)),
    impliedProbA: 0.5238,
    impliedProbB: 0.5238,
    totalImpliedProb: 1.0476,
    arbitragePercentage: -4.76,
    profitPotential: -4.76,
    guaranteedProfit: overrides.type === 'arbitrage' ? 4.76 : null,
    middleGap: overrides.type === 'middle' ? Math.abs((overrides.lineA ?? 4.5) - (overrides.lineB ?? 7.5)) : null,
    winProbability: overrides.type === 'middle' ? 0.42 : null,
    notified: overrides.notified ?? false,
    notifiedAt: overrides.notifiedAt ?? null,
    notifiedChannels: overrides.notifiedChannels ?? null,
    cooldownExpiresAt: overrides.cooldownExpiresAt ?? null,
    metadata: {},
    detectedAt: overrides.detectedAt ?? '2026-03-28T10:20:00.000Z',
  });

  if (!record) {
    throw new Error('expected opportunity to be inserted');
  }

  return record;
}
