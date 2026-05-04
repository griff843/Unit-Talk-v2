import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';
import { createQaSandboxDiscordClient } from './client.js';
import { loadCommandRegistry } from './command-registry.js';
import { createInteractionHandler } from './router.js';
import { loadQaBotConfig } from './config.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function seedProcessEnvForQaSandbox(): void {
  const env = loadEnvironment(repoRoot);
  const config = loadQaBotConfig(repoRoot);

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }

  process.env.DISCORD_BOT_TOKEN = config.token;
  process.env.DISCORD_CLIENT_ID = config.clientId;
  process.env.DISCORD_GUILD_ID = config.guildId;
  process.env.DISCORD_CAPPER_ROLE_ID = config.capperRoleId;
  process.env.DISCORD_VIP_ROLE_ID = config.vipRoleId;
  process.env.DISCORD_VIP_PLUS_ROLE_ID = config.vipPlusRoleId;
  if (config.trialRoleId) {
    process.env.DISCORD_TRIAL_ROLE_ID = config.trialRoleId;
  } else {
    delete process.env.DISCORD_TRIAL_ROLE_ID;
  }
  process.env.DISCORD_CAPPER_CHANNEL_ID = config.capperChannelId;
  if (config.operatorRoleId) {
    process.env.DISCORD_OPERATOR_ROLE_ID = config.operatorRoleId;
  } else {
    delete process.env.DISCORD_OPERATOR_ROLE_ID;
  }
  process.env.UNIT_TALK_API_URL = config.apiUrl;
}

async function main() {
  let config;
  try {
    seedProcessEnvForQaSandbox();
    config = loadQaBotConfig(repoRoot);
  } catch (err) {
    console.error('[discord-bot:qa-sandbox] Startup failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const client = createQaSandboxDiscordClient();
  const registry = await loadCommandRegistry(repoRoot);

  client.once('ready', (readyClient) => {
    console.log(`[discord-bot:qa-sandbox] Ready as ${readyClient.user.tag}`);
  });

  client.on('interactionCreate', createInteractionHandler(registry));

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      console.log(`[discord-bot:qa-sandbox] ${signal} received - destroying client`);
      client.destroy();
      process.exit(0);
    });
  }

  await client.login(config.token);
}

main().catch((err) => {
  console.error('[discord-bot:qa-sandbox] Fatal error:', err);
  process.exit(1);
});
