import { loadEnvironment } from '@unit-talk/config';

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string;
  operatorWebUrl: string;
}

export function loadBotConfig(): BotConfig {
  const env = loadEnvironment();
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const guildId = env.DISCORD_GUILD_ID?.trim();
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const operatorWebUrl = process.env.OPERATOR_WEB_URL?.trim();

  const missing: string[] = [];
  if (!token) missing.push('DISCORD_BOT_TOKEN');
  if (!guildId) missing.push('DISCORD_GUILD_ID');
  if (!clientId) missing.push('DISCORD_CLIENT_ID');
  if (!operatorWebUrl) missing.push('OPERATOR_WEB_URL');

  if (missing.length > 0) {
    throw new Error(
      `Discord bot startup failed - missing required env vars: ${missing.join(', ')}`,
    );
  }

  return {
    token: token!,
    clientId: clientId!,
    guildId: guildId!,
    operatorWebUrl: operatorWebUrl!,
  };
}
