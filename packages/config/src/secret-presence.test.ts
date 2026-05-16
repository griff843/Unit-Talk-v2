import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProductionSecrets,
  checkProductionSecretPresence,
  formatSecretPresenceLog,
} from './secret-presence.js';
import type { AppEnv } from './env.js';

function makeBaseEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    UNIT_TALK_APP_ENV: 'local',
    UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\dev\\unit-talk-v2',
    UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
    LINEAR_TEAM_KEY: 'UTV2',
    LINEAR_TEAM_NAME: 'unit-talk-v2',
    NOTION_WORKSPACE_NAME: 'unit-talk-v2',
    SLACK_WORKSPACE_NAME: 'unit-talk-v2',
    ...overrides,
  };
}

function makeProductionEnv(secretOverrides: Record<string, string | undefined> = {}): AppEnv {
  return makeBaseEnv({
    NODE_ENV: 'production',
    UNIT_TALK_APP_ENV: 'production',
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key-value',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-value',
    DISCORD_BOT_TOKEN: 'bot-token-value',
    DISCORD_CLIENT_ID: 'client-id-value',
    UNIT_TALK_BOT_API_KEY: 'bot-api-key-value',
    UNIT_TALK_INGESTOR_API_KEY: 'ingestor-api-key-value',
    ...secretOverrides,
  });
}

test('checkProductionSecretPresence marks all keys present when fully populated', () => {
  const report = checkProductionSecretPresence(makeProductionEnv());
  assert.equal(report.allGroupsPresent, true);
  assert.equal(report.productionLike, true);
  for (const group of report.groups) {
    assert.equal(group.allPresent, true);
    for (const entry of group.entries) {
      assert.equal(entry.class, 'present');
    }
  }
});

test('checkProductionSecretPresence marks missing key correctly', () => {
  const env = makeProductionEnv({ DISCORD_CLIENT_ID: undefined });
  const report = checkProductionSecretPresence(env);
  const discord = report.groups.find((g) => g.name === 'discord');
  assert.ok(discord);
  const clientId = discord.entries.find((e) => e.key === 'DISCORD_CLIENT_ID');
  assert.equal(clientId?.class, 'missing');
  assert.equal(discord.allPresent, false);
  assert.equal(report.allGroupsPresent, false);
});

test('checkProductionSecretPresence detects placeholder values', () => {
  for (const placeholder of ['your-token-here', '<REPLACE_ME>', 'xxx', 'changeme', 'placeholder-value']) {
    const env = makeProductionEnv({ DISCORD_BOT_TOKEN: placeholder });
    const report = checkProductionSecretPresence(env);
    const discord = report.groups.find((g) => g.name === 'discord');
    const token = discord?.entries.find((e) => e.key === 'DISCORD_BOT_TOKEN');
    assert.equal(token?.class, 'placeholder', `Expected placeholder for "${placeholder}"`);
  }
});

test('checkProductionSecretPresence is not production-like in local env', () => {
  const report = checkProductionSecretPresence(makeBaseEnv());
  assert.equal(report.productionLike, false);
});

test('checkProductionSecretPresence is production-like when NODE_ENV=production', () => {
  const report = checkProductionSecretPresence(makeBaseEnv({ NODE_ENV: 'production' }));
  assert.equal(report.productionLike, true);
});

test('assertProductionSecrets passes when all secrets are present', () => {
  const report = assertProductionSecrets(makeProductionEnv());
  assert.equal(report.allGroupsPresent, true);
});

test('assertProductionSecrets throws with missing key name in message', () => {
  const env = makeProductionEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
  assert.throws(
    () => assertProductionSecrets(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('SUPABASE_SERVICE_ROLE_KEY'), `message was: ${err.message}`);
      assert.ok(err.message.includes('missing'), `message was: ${err.message}`);
      return true;
    },
  );
});

test('assertProductionSecrets throws with placeholder key name in message', () => {
  const env = makeProductionEnv({ UNIT_TALK_BOT_API_KEY: 'your-key-here' });
  assert.throws(
    () => assertProductionSecrets(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('UNIT_TALK_BOT_API_KEY'), `message was: ${err.message}`);
      assert.ok(err.message.includes('placeholder'), `message was: ${err.message}`);
      return true;
    },
  );
});

test('assertProductionSecrets does not throw in non-production environment', () => {
  const env = makeBaseEnv();
  const report = assertProductionSecrets(env);
  assert.equal(report.productionLike, false);
});

test('formatSecretPresenceLog contains no secret values', () => {
  const env = makeProductionEnv();
  const report = checkProductionSecretPresence(env);
  const log = formatSecretPresenceLog(report);
  const logStr = JSON.stringify(log);

  const secretValues = [
    'anon-key-value',
    'service-role-value',
    'bot-token-value',
    'client-id-value',
    'bot-api-key-value',
    'ingestor-api-key-value',
  ];
  for (const value of secretValues) {
    assert.ok(!logStr.includes(value), `Log must not expose secret value: ${value}`);
  }
});

test('formatSecretPresenceLog includes key names and presence classes', () => {
  const env = makeProductionEnv({ DISCORD_CLIENT_ID: undefined });
  const report = checkProductionSecretPresence(env);
  const log = formatSecretPresenceLog(report) as {
    groups: Array<{ name: string; entries: Array<{ key: string; class: string }> }>;
  };

  const discord = log.groups.find((g) => g.name === 'discord');
  assert.ok(discord);
  const clientId = discord.entries.find((e) => e.key === 'DISCORD_CLIENT_ID');
  assert.equal(clientId?.class, 'missing');
});
