/**
 * Member Tier Sync Handler tests
 *
 * Coverage:
 *   - Role add → activateTier called with correct args
 *   - Role remove → deactivateTier called
 *   - Idempotent: second role add → no second activateTier (InMemory no-op)
 *   - Capper role add → welcome embed still posted (existing behavior preserved)
 *   - Non-tier role change → no tier repository call
 *
 * Tests run with: tsx --test apps/discord-bot/src/member-tier-sync.test.ts
 * No live Discord connection required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryMemberTierRepository } from '@unit-talk/db';
import { createMemberTierSyncHandler } from './handlers/member-tier-sync-handler.js';
import type { BotConfig } from './config.js';
import type { Client, GuildMember, PartialGuildMember } from 'discord.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const testConfig: Pick<
  BotConfig,
  | 'capperRoleId'
  | 'vipRoleId'
  | 'vipPlusRoleId'
  | 'trialRoleId'
  | 'operatorRoleId'
  | 'capperChannelId'
> = {
  capperRoleId: 'role-capper',
  vipRoleId: 'role-vip',
  vipPlusRoleId: 'role-vip-plus',
  trialRoleId: 'role-trial',
  operatorRoleId: 'role-operator',
  capperChannelId: 'channel-capper',
};

function makeMember(roleIds: string[], id = 'user-123'): GuildMember {
  const cache = new Map(roleIds.map((r) => [r, { id: r }]));
  return {
    id,
    partial: false,
    pending: null,
    displayName: 'TestUser',
    user: { username: 'testuser' },
    roles: { cache },
  } as unknown as GuildMember;
}

type SendRecord = { embeds: unknown[] };

function makeClient(sends: SendRecord[] = []): Client {
  const textChannel = {
    isTextBased: () => true,
    send: async (opts: { embeds: unknown[] }) => {
      sends.push(opts);
    },
  };
  return {
    channels: {
      cache: new Map([['channel-capper', textChannel]]),
      fetch: async () => textChannel,
    },
  } as unknown as Client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('role add → activateTier called with correct tier', async () => {
  const repo = new InMemoryMemberTierRepository();
  const client = makeClient();
  const handler = createMemberTierSyncHandler(testConfig, client, repo);

  const oldMember = makeMember([]) as unknown as PartialGuildMember;
  const newMember = makeMember(['role-vip']);

  await handler(oldMember, newMember);

  const active = await repo.getActiveTiers('user-123');
  assert.equal(active.length, 1);
  const row = active[0];
  assert.ok(row != null);
  assert.equal(row.tier, 'vip');
  assert.equal(row.discord_id, 'user-123');
  assert.equal(row.effective_until, null);
});

test('role remove → deactivateTier called, effective_until set', async () => {
  const repo = new InMemoryMemberTierRepository();
  const client = makeClient();
  const handler = createMemberTierSyncHandler(testConfig, client, repo);

  // First add the role
  await handler(
    makeMember([]) as unknown as PartialGuildMember,
    makeMember(['role-vip-plus']),
  );

  // Now remove the role
  await handler(
    makeMember(['role-vip-plus']) as unknown as PartialGuildMember,
    makeMember([]),
  );

  const active = await repo.getActiveTiers('user-123');
  assert.equal(active.length, 0, 'No active tiers after removal');

  const history = await repo.getTierHistory('user-123');
  assert.equal(history.length, 1);
  const histRow = history[0];
  assert.ok(histRow != null);
  assert.notEqual(histRow.effective_until, null, 'effective_until must be set');
});

test('idempotent: second role add does not create duplicate row', async () => {
  const repo = new InMemoryMemberTierRepository();
  const client = makeClient();
  const handler = createMemberTierSyncHandler(testConfig, client, repo);

  const oldMember = makeMember([]) as unknown as PartialGuildMember;
  const newMember = makeMember(['role-trial']);

  // First add
  await handler(oldMember, newMember);
  // Second add (same transition — should be no-op)
  await handler(oldMember, newMember);

  const active = await repo.getActiveTiers('user-123');
  assert.equal(active.length, 1, 'Only one active row after two identical adds');

  const history = await repo.getTierHistory('user-123');
  assert.equal(history.length, 1, 'Only one row in history');
});

test('capper role add → welcome embed posted to capper channel', async () => {
  const sends: SendRecord[] = [];
  const client = makeClient(sends);
  const repo = new InMemoryMemberTierRepository();
  const handler = createMemberTierSyncHandler(testConfig, client, repo);

  const oldMember = makeMember([]) as unknown as PartialGuildMember;
  const newMember = makeMember(['role-capper']);

  await handler(oldMember, newMember);

  // Tier should be activated
  const active = await repo.getActiveTiers('user-123');
  assert.equal(active.length, 1);
  const row = active[0];
  assert.ok(row != null);
  assert.equal(row.tier, 'capper');

  // Welcome embed should have been sent
  assert.equal(sends.length, 1, 'One message sent to capper channel');
  const sent = sends[0];
  assert.ok(sent != null);
  assert.ok(Array.isArray(sent.embeds), 'embeds array present');
  assert.equal(sent.embeds.length, 1);
});

test('non-tier role change → no repository calls', async () => {
  const repo = new InMemoryMemberTierRepository();
  const client = makeClient();
  const handler = createMemberTierSyncHandler(testConfig, client, repo);

  const oldMember = makeMember([]) as unknown as PartialGuildMember;
  const newMember = makeMember(['role-completely-unknown-XYZ']);

  await handler(oldMember, newMember);

  const counts = await repo.getTierCounts();
  const total = Object.values(counts).reduce((a: number, b: number) => a + b, 0);
  assert.equal(total, 0, 'No tier rows should be created for unknown role');
});

test('multiple roles added at once → multiple tier activations', async () => {
  const repo = new InMemoryMemberTierRepository();
  const client = makeClient();
  const handler = createMemberTierSyncHandler(testConfig, client, repo);

  const oldMember = makeMember([]) as unknown as PartialGuildMember;
  const newMember = makeMember(['role-vip', 'role-capper']);

  await handler(oldMember, newMember);

  const active = await repo.getActiveTiers('user-123');
  assert.equal(active.length, 2);
  const tiers = active.map((r) => r.tier).sort();
  assert.deepEqual(tiers, ['capper', 'vip']);
});
