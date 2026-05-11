import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInjuryEmbed,
  resolveInjuryChannelId,
} from './injury-notification-service.js';
import type { InjuryChange } from './injury-notification-service.js';

function makeChange(overrides: Partial<InjuryChange> = {}): InjuryChange {
  return {
    participantId: 'p1',
    playerName: 'Test Player',
    sport: 'nba',
    previousStatus: 'questionable',
    currentStatus: 'out',
    sourceTier: 'official',
    reportedAt: '2026-05-11T12:00:00.000Z',
    fetchedAt: '2026-05-11T12:00:00.000Z',
    affectedPickIds: [],
    ...overrides,
  };
}

test("buildInjuryEmbed for 'out' status uses red color and 🔴 emoji", () => {
  const embed = buildInjuryEmbed(makeChange(), 'Downgrade exposure') as {
    title: string;
    color: number;
    fields: Array<{ name: string; value: string }>;
  };

  assert.equal(embed.color, 0xff0000);
  assert.match(embed.title, /Test Player/);
  assert.match(
    embed.fields.find((f) => f.name === 'Status')?.value ?? '',
    /🔴/,
  );
});

test('buildInjuryEmbed includes thumbnail when provided', () => {
  const thumbnailUrl = 'https://example.com/thumb.png';
  const embed = buildInjuryEmbed(makeChange(), 'Monitor status', thumbnailUrl) as {
    thumbnail?: { url: string };
  };

  assert.equal(embed.thumbnail?.url, thumbnailUrl);
});

test('buildInjuryEmbed omits thumbnail when not provided', () => {
  const embed = buildInjuryEmbed(makeChange(), 'Monitor status') as {
    thumbnail?: { url: string };
  };

  assert.equal(embed.thumbnail, undefined);
});

test('buildInjuryEmbed truncates long injury notes to 200 chars', () => {
  const embed = buildInjuryEmbed(
    makeChange({ injuryNote: 'x'.repeat(250) }),
    'Monitor status',
  ) as { fields: Array<{ name: string; value: string }> };

  assert.equal(
    embed.fields.find((f) => f.name === 'Note')?.value.length,
    200,
  );
});

test('buildInjuryEmbed shows status change from previous to current', () => {
  const embed = buildInjuryEmbed(
    makeChange({ previousStatus: 'probable', currentStatus: 'doubtful' }),
    'Reduce stake',
  ) as { fields: Array<{ name: string; value: string }> };

  const changeField = embed.fields.find((f) => f.name === 'Change')?.value ?? '';
  assert.match(changeField, /Probable/);
  assert.match(changeField, /Doubtful/);
});

test('resolveInjuryChannelId returns DISCORD_INJURIES_CHANNEL_ID first', () => {
  assert.equal(
    resolveInjuryChannelId({ DISCORD_INJURIES_CHANNEL_ID: 'ch-injuries' }),
    'ch-injuries',
  );
});

test('resolveInjuryChannelId falls back to DISCORD_CANARY_CHANNEL_ID', () => {
  assert.equal(
    resolveInjuryChannelId({ DISCORD_CANARY_CHANNEL_ID: 'ch-canary' }),
    'ch-canary',
  );
});

test('resolveInjuryChannelId returns null when no channel configured', () => {
  assert.equal(resolveInjuryChannelId({}), null);
});
