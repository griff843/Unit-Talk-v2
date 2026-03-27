import type { AppEnv } from '@unit-talk/config';

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string;
  capperRoleId: string;
  apiUrl: string;
  appEnv: string;
}

export function parseBotConfig(env: AppEnv): BotConfig {
  const missing: string[] = [];

  if (!env.DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN');
  if (!env.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
  if (!env.DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID');
  if (!env.DISCORD_CAPPER_ROLE_ID) missing.push('DISCORD_CAPPER_ROLE_ID');
  if (!env.UNIT_TALK_API_URL) missing.push('UNIT_TALK_API_URL');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    token: env.DISCORD_BOT_TOKEN!,
    clientId: env.DISCORD_CLIENT_ID!,
    guildId: env.DISCORD_GUILD_ID!,
    capperRoleId: env.DISCORD_CAPPER_ROLE_ID!,
    apiUrl: env.UNIT_TALK_API_URL!,
    appEnv: env.UNIT_TALK_APP_ENV,
  };
}
