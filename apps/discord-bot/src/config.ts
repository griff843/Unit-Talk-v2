import { loadEnvironment } from '@unit-talk/config';
import type { AppEnv } from '@unit-talk/config';

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
