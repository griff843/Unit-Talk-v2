import { Client, GatewayIntentBits } from 'discord.js';

/**
 * Creates and returns a configured Discord.js Client with the intents required
 * for the foundation slice. Additional intents are added per-command when
 * ratified — not speculatively.
 *
 * Required intents:
 *   Guilds        — guild metadata, channel info
 *   GuildMembers  — member role cache (required for role guard)
 *   GuildMessages — message events in guild channels
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });
}

/**
 * QA sandbox startup path uses only non-privileged intents so the dedicated
 * QA bot can come online without requiring member intent approval.
 */
export function createQaSandboxDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
    ],
  });
}
