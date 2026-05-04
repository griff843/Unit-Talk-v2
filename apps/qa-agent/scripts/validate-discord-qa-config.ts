import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type DiscordQaMap = {
  guildId: string;
  roles: Record<string, string>;
  channels: Record<string, string>;
};

const REQUIRED_ENV_KEYS = [
  'DISCORD_QA_BOT_TOKEN',
  'DISCORD_QA_CLIENT_ID',
  'DISCORD_QA_GUILD_ID',
  'DISCORD_QA_ROLE_MAP',
  'DISCORD_QA_CHANNEL_MAP',
  'UNIT_TALK_QA_API_URL',
] as const;

const REQUIRED_ROLE_KEYS = ['admin', 'operator', 'capper', 'vip', 'vipPlus', 'free', 'noAccess'] as const;
const REQUIRED_CHANNEL_KEYS = [
  'qaBotLog',
  'qaAccessCheck',
  'qaPickDelivery',
  'freePicks',
  'vipPicks',
  'vipPlusPicks',
  'adminOps',
  'recap',
] as const;

const QA_AGENT_DISCORD_FILES = [
  'apps/qa-agent/src/adapters/unit-talk/index.ts',
  'apps/qa-agent/src/adapters/unit-talk/surfaces/discord/skills/access-check.ts',
  'apps/qa-agent/src/adapters/unit-talk/surfaces/discord/skills/pick-delivery.ts',
] as const;

function parseEnvFile(filePath: string): Map<string, string> {
  const content = readFileSync(filePath, 'utf8');
  const env = new Map<string, string>();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    env.set(key, value);
  }

  return env;
}

function loadQaMap(filePath: string): DiscordQaMap {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<DiscordQaMap>;
  assert.ok(parsed && typeof parsed === 'object', 'QA map must be a JSON object');
  assert.ok(parsed.roles && typeof parsed.roles === 'object', 'QA map roles must be an object');
  assert.ok(parsed.channels && typeof parsed.channels === 'object', 'QA map channels must be an object');

  return {
    guildId: typeof parsed.guildId === 'string' ? parsed.guildId : '',
    roles: parsed.roles as Record<string, string>,
    channels: parsed.channels as Record<string, string>,
  };
}

function ensureNonEmpty(name: string, value: string | undefined): string {
  assert.ok(value && value.trim().length > 0, `${name} must be present and non-empty`);
  return value;
}

function validateMapShape(map: DiscordQaMap): void {
  assert.ok(map.guildId.trim().length > 0, 'QA map guildId must be non-empty');
  for (const key of REQUIRED_ROLE_KEYS) {
    assert.ok(map.roles[key]?.trim().length, `QA map roles.${key} must be non-empty`);
  }
  for (const key of REQUIRED_CHANNEL_KEYS) {
    assert.ok(map.channels[key]?.trim().length, `QA map channels.${key} must be non-empty`);
  }
}

function validateQaAgentEnvUsage(repoRoot: string): { qaRefs: string[]; prodRefs: string[] } {
  const qaRefs: string[] = [];
  const prodRefs: string[] = [];

  for (const relativePath of QA_AGENT_DISCORD_FILES) {
    const content = readFileSync(path.join(repoRoot, relativePath), 'utf8');

    if (content.includes('DISCORD_QA_') || content.includes('UNIT_TALK_QA_API_URL')) {
      qaRefs.push(relativePath);
    }

    if (
      content.includes('DISCORD_BOT_TOKEN')
      || content.includes('DISCORD_CLIENT_ID')
      || content.includes('DISCORD_GUILD_ID')
    ) {
      prodRefs.push(relativePath);
    }
  }

  return { qaRefs, prodRefs };
}

function main(): number {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..', '..');
  const envPath = path.join(repoRoot, 'local.env');
  const expectedGuildId = '1195598141026742343';

  try {
    assert.ok(existsSync(envPath), `Missing local.env at ${envPath}`);

    const env = parseEnvFile(envPath);
    const resolvedEnv = new Map<string, string>();

    for (const key of REQUIRED_ENV_KEYS) {
      resolvedEnv.set(key, ensureNonEmpty(key, env.get(key)));
    }

    const qaRoleMapRaw = resolvedEnv.get('DISCORD_QA_ROLE_MAP')!;
    const qaChannelMapRaw = resolvedEnv.get('DISCORD_QA_CHANNEL_MAP')!;
    const qaRoleMapPath = path.resolve(repoRoot, qaRoleMapRaw);
    const qaChannelMapPath = path.resolve(repoRoot, qaChannelMapRaw);

    assert.strictEqual(
      resolvedEnv.get('DISCORD_QA_GUILD_ID'),
      expectedGuildId,
      `DISCORD_QA_GUILD_ID must match sandbox guild ${expectedGuildId}`,
    );
    assert.ok(existsSync(qaRoleMapPath), `DISCORD_QA_ROLE_MAP file not found: ${qaRoleMapPath}`);
    assert.ok(existsSync(qaChannelMapPath), `DISCORD_QA_CHANNEL_MAP file not found: ${qaChannelMapPath}`);

    const roleMap = loadQaMap(qaRoleMapPath);
    const channelMap = loadQaMap(qaChannelMapPath);
    validateMapShape(roleMap);
    validateMapShape(channelMap);

    assert.strictEqual(roleMap.guildId, expectedGuildId, 'Role map guildId must match sandbox guild');
    assert.strictEqual(channelMap.guildId, expectedGuildId, 'Channel map guildId must match sandbox guild');

    const { qaRefs, prodRefs } = validateQaAgentEnvUsage(repoRoot);
    assert.ok(qaRefs.length > 0, 'Expected QA-agent Discord files to reference DISCORD_QA_* config');
    assert.strictEqual(
      prodRefs.length,
      0,
      `QA-agent Discord files must not reference production Discord env vars: ${prodRefs.join(', ')}`,
    );

    console.log('PASS: Discord QA sandbox config validation');
    console.log(`- local.env present with ${REQUIRED_ENV_KEYS.length} required QA env vars`);
    console.log(`- sandbox guild ID matches expected value ${expectedGuildId}`);
    console.log('- QA role/channel map files load successfully');
    console.log(`- QA map contains ${REQUIRED_ROLE_KEYS.length} roles and ${REQUIRED_CHANNEL_KEYS.length} channels`);
    console.log(`- QA-agent Discord flow files reference QA-only env vars in ${qaRefs.length} files`);
    console.log('- No production Discord env vars are referenced by QA-agent Discord flow files');
    console.log('- Bot token presence verified without printing the token');
    console.log('- No Discord API or production guild calls were performed');
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('FAIL: Discord QA sandbox config validation');
    console.error(detail);
    return 1;
  }
}

process.exitCode = main();
