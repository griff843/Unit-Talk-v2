/**
 * InMemoryMemberTierRepository tests
 *
 * Coverage:
 *   - activate → row exists in getActiveTiers
 *   - deactivate → effective_until set, no longer in getActiveTiers
 *   - getTierCounts returns correct counts
 *   - idempotent activate (second call returns same row, no duplicate)
 *
 * Tests run with: tsx --test packages/db/src/member-tier-repository.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryMemberTierRepository } from './runtime-repositories.js';

test('activate → row exists in getActiveTiers', async () => {
  const repo = new InMemoryMemberTierRepository();

  await repo.activateTier({
    discordId: 'user-1',
    discordUsername: 'alice',
    tier: 'vip',
    source: 'discord-role',
    changedBy: 'bot',
  });

  const active = await repo.getActiveTiers('user-1');
  assert.equal(active.length, 1);
  const row = active[0];
  assert.ok(row != null);
  assert.equal(row.tier, 'vip');
  assert.equal(row.discord_id, 'user-1');
  assert.equal(row.discord_username, 'alice');
  assert.equal(row.effective_until, null);
});

test('deactivate → effective_until set, no longer in getActiveTiers', async () => {
  const repo = new InMemoryMemberTierRepository();

  await repo.activateTier({
    discordId: 'user-2',
    tier: 'vip-plus',
    source: 'manual',
    changedBy: 'operator',
  });

  await repo.deactivateTier({
    discordId: 'user-2',
    tier: 'vip-plus',
    changedBy: 'operator',
    reason: 'subscription ended',
  });

  const active = await repo.getActiveTiers('user-2');
  assert.equal(active.length, 0, 'No active tiers after deactivation');

  const history = await repo.getTierHistory('user-2');
  assert.equal(history.length, 1);
  const histRow = history[0];
  assert.ok(histRow != null);
  assert.notEqual(histRow.effective_until, null, 'effective_until must be set');
});

test('getTierCounts returns correct counts', async () => {
  const repo = new InMemoryMemberTierRepository();

  await repo.activateTier({ discordId: 'u1', tier: 'vip', source: 'discord-role', changedBy: 'bot' });
  await repo.activateTier({ discordId: 'u2', tier: 'vip', source: 'discord-role', changedBy: 'bot' });
  await repo.activateTier({ discordId: 'u3', tier: 'capper', source: 'manual', changedBy: 'admin' });

  const counts = await repo.getTierCounts();

  assert.equal(counts['vip'], 2);
  assert.equal(counts['capper'], 1);
  assert.equal(counts['free'], 0);
  assert.equal(counts['trial'], 0);
  assert.equal(counts['vip-plus'], 0);
  assert.equal(counts['operator'], 0);
});

test('idempotent activate: second call returns same row, no duplicate', async () => {
  const repo = new InMemoryMemberTierRepository();

  const first = await repo.activateTier({
    discordId: 'user-4',
    tier: 'trial',
    source: 'discord-role',
    changedBy: 'bot',
  });

  const second = await repo.activateTier({
    discordId: 'user-4',
    tier: 'trial',
    source: 'discord-role',
    changedBy: 'bot',
  });

  assert.equal(first.id, second.id, 'Same row returned on second activate');

  const active = await repo.getActiveTiers('user-4');
  assert.equal(active.length, 1, 'Only one active row');
});

test('deactivate no-op when no active tier', async () => {
  const repo = new InMemoryMemberTierRepository();

  // Should not throw
  await repo.deactivateTier({
    discordId: 'user-99',
    tier: 'operator',
    changedBy: 'bot',
  });

  const active = await repo.getActiveTiers('user-99');
  assert.equal(active.length, 0);
});

test('getActiveMembersForTier returns only active members of that tier', async () => {
  const repo = new InMemoryMemberTierRepository();

  await repo.activateTier({ discordId: 'u1', tier: 'vip', source: 'discord-role', changedBy: 'bot' });
  await repo.activateTier({ discordId: 'u2', tier: 'vip', source: 'discord-role', changedBy: 'bot' });
  await repo.activateTier({ discordId: 'u3', tier: 'capper', source: 'manual', changedBy: 'admin' });

  // Deactivate u1 vip
  await repo.deactivateTier({ discordId: 'u1', tier: 'vip', changedBy: 'bot' });

  const vipMembers = await repo.getActiveMembersForTier('vip');
  assert.equal(vipMembers.length, 1);
  const vipMember = vipMembers[0];
  assert.ok(vipMember != null);
  assert.equal(vipMember.discord_id, 'u2');
});

test('getTierHistory returns all rows ordered by created_at', async () => {
  const repo = new InMemoryMemberTierRepository();

  await repo.activateTier({ discordId: 'u5', tier: 'trial', source: 'discord-role', changedBy: 'bot' });
  await repo.deactivateTier({ discordId: 'u5', tier: 'trial', changedBy: 'bot' });
  await repo.activateTier({ discordId: 'u5', tier: 'vip', source: 'discord-role', changedBy: 'bot' });

  const history = await repo.getTierHistory('u5');
  assert.equal(history.length, 2);
  const first = history[0];
  const second = history[1];
  assert.ok(first != null);
  assert.ok(second != null);
  // trial was first
  assert.equal(first.tier, 'trial');
  assert.equal(second.tier, 'vip');
});
