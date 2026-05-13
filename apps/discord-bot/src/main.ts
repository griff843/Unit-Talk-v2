import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assertProductionRuntimeConfig,
  loadEnvironment,
  type AppEnv,
} from '@unit-talk/config';
import { createDiscordClient } from './client.js';
import { loadCommandRegistry } from './command-registry.js';
import { createInteractionHandler } from './router.js';
import { loadBotConfig } from './config.js';
import { createCapperOnboardingHandler } from './handlers/capper-onboarding-handler.js';
import { createMemberTierSyncHandler } from './handlers/member-tier-sync-handler.js';
import { createApiClient } from './api-client.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function seedProcessEnvFromRoot(): AppEnv {
  const env = loadEnvironment(repoRoot);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }
  return env;
}

export function createDiscordBotStartupConfig(env: AppEnv) {
  return assertProductionRuntimeConfig(env, {
    service: 'discord-bot',
    runtimeModeKey: 'UNIT_TALK_DISCORD_BOT_RUNTIME_MODE',
    requiredKeys: [
      'DISCORD_BOT_TOKEN',
      'DISCORD_CLIENT_ID',
      'DISCORD_GUILD_ID',
      'DISCORD_CAPPER_ROLE_ID',
      'DISCORD_VIP_ROLE_ID',
      'DISCORD_VIP_PLUS_ROLE_ID',
      'DISCORD_CAPPER_CHANNEL_ID',
      'UNIT_TALK_API_URL',
    ],
    persistenceMode: 'not_applicable',
    dryRun: false,
    workerTargets: [],
  });
}

async function main() {
  let config;
  try {
    const env = seedProcessEnvFromRoot();
    const startupConfig = createDiscordBotStartupConfig(env);
    config = loadBotConfig(repoRoot);
    console.log(
      JSON.stringify({
        ...startupConfig,
        status: 'starting',
      }),
    );
  } catch (err) {
    console.error('[discord-bot] Startup failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const client = createDiscordClient();
  const registry = await loadCommandRegistry(repoRoot);
  const apiClient = createApiClient(config.apiUrl, config.apiKey);

  client.once('ready', (readyClient) => {
    console.log(`[discord-bot] Ready as ${readyClient.user.tag}`);
  });

  client.on('interactionCreate', createInteractionHandler(registry));
  client.on('guildMemberUpdate', createCapperOnboardingHandler(config, client));
  client.on('guildMemberUpdate', createMemberTierSyncHandler(config, apiClient));

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      console.log(`[discord-bot] ${signal} received — destroying client`);
      client.destroy();
      process.exit(0);
    });
  }

  await client.login(config.token);
}

function isMainModule() {
  const invokedPath = process.argv[1];
  return Boolean(
    invokedPath &&
      path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url)),
  );
}

if (isMainModule()) {
  main().catch((err) => {
    console.error('[discord-bot] Fatal error:', err);
    process.exit(1);
  });
}
