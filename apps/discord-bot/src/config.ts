import { loadEnvironment } from '@unit-talk/config';
import type { AppEnv } from '@unit-talk/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string;
  capperRoleId: string;
  vipRoleId: string;
  vipPlusRoleId: string;
  trialRoleId: string | null;
  capperChannelId: string;
  operatorRoleId?: string | undefined;
  apiUrl: string;
  appEnv: AppEnv['UNIT_TALK_APP_ENV'];
}

type QaRoleMap = {
  admin?: string;
  operator?: string;
  capper?: string;
  vip?: string;
  vipPlus?: string;
  free?: string;
  noAccess?: string;
};

type QaChannelMap = {
  qaBotLog?: string;
  qaAccessCheck?: string;
  qaPickDelivery?: string;
  freePicks?: string;
  vipPicks?: string;
  vipPlusPicks?: string;
  adminOps?: string;
  recap?: string;
};

type QaDiscordMap = {
  guildId?: string;
  roles?: QaRoleMap;
  channels?: QaChannelMap;
};

function resolveEnvPath(rootDir: string, candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
}

function loadQaDiscordMap(rootDir: string, candidate: string, expectedLabel: string): QaDiscordMap {
  const resolvedPath = resolveEnvPath(rootDir, candidate);
  if (!existsSync(resolvedPath)) {
    throw new Error(`${expectedLabel} file not found: ${resolvedPath}`);
  }

  const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8')) as QaDiscordMap;
  return parsed;
}

function mergeQaDiscordMaps(roleMap: QaDiscordMap, channelMap: QaDiscordMap): QaDiscordMap {
  const guildId = roleMap.guildId ?? channelMap.guildId;
  return {
    ...(guildId ? { guildId } : {}),
    roles: {
      ...(roleMap.roles ?? {}),
      ...(channelMap.roles ?? {}),
    },
    channels: {
      ...(roleMap.channels ?? {}),
      ...(channelMap.channels ?? {}),
    },
  };
}

function resolveQaCapperChannelId(channels: QaChannelMap): string | undefined {
  return channels.qaAccessCheck ?? channels.qaBotLog;
}

/**
 * Validates that all required Discord bot env vars are present and returns a
 * typed BotConfig. Accepts an AppEnv for testability — call loadBotConfig()
 * for production use, or parseBotConfig(mockEnv) in tests.
 */
export function parseBotConfig(env: AppEnv): BotConfig {
  const token = env.DISCORD_BOT_TOKEN;
  const clientId = env.DISCORD_CLIENT_ID;
  const guildId = env.DISCORD_GUILD_ID;
  const capperRoleId = env.DISCORD_CAPPER_ROLE_ID;
  const vipRoleId = env.DISCORD_VIP_ROLE_ID;
  const vipPlusRoleId = env.DISCORD_VIP_PLUS_ROLE_ID;
  const trialRoleId = env.DISCORD_TRIAL_ROLE_ID ?? null;
  const capperChannelId = env.DISCORD_CAPPER_CHANNEL_ID;
  const operatorRoleId = env.DISCORD_OPERATOR_ROLE_ID;
  const apiUrl = env.UNIT_TALK_API_URL;

  const missing: string[] = [];
  if (!token) missing.push('DISCORD_BOT_TOKEN');
  if (!clientId) missing.push('DISCORD_CLIENT_ID');
  if (!guildId) missing.push('DISCORD_GUILD_ID');
  if (!capperRoleId) missing.push('DISCORD_CAPPER_ROLE_ID');
  if (!vipRoleId) missing.push('DISCORD_VIP_ROLE_ID');
  if (!vipPlusRoleId) missing.push('DISCORD_VIP_PLUS_ROLE_ID');
  if (!capperChannelId) missing.push('DISCORD_CAPPER_CHANNEL_ID');
  if (!apiUrl) missing.push('UNIT_TALK_API_URL');

  if (missing.length > 0) {
    throw new Error(
      `Discord bot startup failed — missing required env vars: ${missing.join(', ')}`,
    );
  }

  return {
    token: token!,
    clientId: clientId!,
    guildId: guildId!,
    capperRoleId: capperRoleId!,
    vipRoleId: vipRoleId!,
    vipPlusRoleId: vipPlusRoleId!,
    trialRoleId,
    capperChannelId: capperChannelId!,
    operatorRoleId,
    apiUrl: apiUrl!,
    appEnv: env.UNIT_TALK_APP_ENV,
  };
}

export function parseQaBotConfig(env: AppEnv, qaMap: QaDiscordMap): BotConfig {
  const token = env.DISCORD_QA_BOT_TOKEN;
  const clientId = env.DISCORD_QA_CLIENT_ID;
  const guildId = env.DISCORD_QA_GUILD_ID ?? qaMap.guildId;
  const capperRoleId = qaMap.roles?.capper;
  const vipRoleId = qaMap.roles?.vip;
  const vipPlusRoleId = qaMap.roles?.vipPlus;
  const capperChannelId = resolveQaCapperChannelId(qaMap.channels ?? {});
  const operatorRoleId = qaMap.roles?.operator;
  const apiUrl = env.UNIT_TALK_QA_API_URL;

  const missing: string[] = [];
  if (!token) missing.push('DISCORD_QA_BOT_TOKEN');
  if (!clientId) missing.push('DISCORD_QA_CLIENT_ID');
  if (!guildId) missing.push('DISCORD_QA_GUILD_ID');
  if (!capperRoleId) missing.push('qaMap.roles.capper');
  if (!vipRoleId) missing.push('qaMap.roles.vip');
  if (!vipPlusRoleId) missing.push('qaMap.roles.vipPlus');
  if (!capperChannelId) missing.push('qaMap.channels.qaAccessCheck|qaBotLog');
  if (!apiUrl) missing.push('UNIT_TALK_QA_API_URL');

  if (missing.length > 0) {
    throw new Error(
      `Discord QA sandbox startup failed - missing required QA config: ${missing.join(', ')}`,
    );
  }

  return {
    token: token!,
    clientId: clientId!,
    guildId: guildId!,
    capperRoleId: capperRoleId!,
    vipRoleId: vipRoleId!,
    vipPlusRoleId: vipPlusRoleId!,
    trialRoleId: null,
    capperChannelId: capperChannelId!,
    operatorRoleId,
    apiUrl: apiUrl!,
    appEnv: env.UNIT_TALK_APP_ENV,
  };
}

/**
 * Loads and validates bot configuration from the standard env-file chain.
 * Throws if any required var is absent.
 * In production entry point, catch this and process.exit(1).
 *
 * @param rootDir - Optional explicit repo root for env-file resolution.
 *   Defaults to `process.cwd()`. Pass an explicit path when the script is run
 *   from a package subdirectory (e.g., via `pnpm --filter`).
 */
export function loadBotConfig(rootDir?: string): BotConfig {
  const env = loadEnvironment(rootDir);
  return parseBotConfig(env);
}

export function loadQaBotConfig(rootDir = process.cwd()): BotConfig {
  const env = loadEnvironment(rootDir);
  const roleMapPath = env.DISCORD_QA_ROLE_MAP;
  const channelMapPath = env.DISCORD_QA_CHANNEL_MAP;

  const missing: string[] = [];
  if (!roleMapPath) missing.push('DISCORD_QA_ROLE_MAP');
  if (!channelMapPath) missing.push('DISCORD_QA_CHANNEL_MAP');
  if (missing.length > 0) {
    throw new Error(
      `Discord QA sandbox startup failed - missing required QA env vars: ${missing.join(', ')}`,
    );
  }

  const roleMap = loadQaDiscordMap(rootDir, roleMapPath!, 'DISCORD_QA_ROLE_MAP');
  const channelMap = loadQaDiscordMap(rootDir, channelMapPath!, 'DISCORD_QA_CHANNEL_MAP');
  return parseQaBotConfig(env, mergeQaDiscordMaps(roleMap, channelMap));
}
