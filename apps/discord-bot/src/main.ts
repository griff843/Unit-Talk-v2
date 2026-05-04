import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';
import { createDiscordClient } from './client.js';
import { loadCommandRegistry } from './command-registry.js';
import { createInteractionHandler } from './router.js';
import { loadBotConfig } from './config.js';
import { createCapperOnboardingHandler } from './handlers/capper-onboarding-handler.js';
import { createMemberTierSyncHandler } from './handlers/member-tier-sync-handler.js';
import { createApiClient } from './api-client.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function seedProcessEnvFromRoot(): void {
  const env = loadEnvironment(repoRoot);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }
}

async function main() {
  let config;
  try {
    seedProcessEnvFromRoot();
    config = loadBotConfig(repoRoot);
  } catch (err) {
    console.error('[discord-bot] Startup failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const client = createDiscordClient();
  const registry = await loadCommandRegistry(repoRoot);
  const apiClient = createApiClient(config.apiUrl);

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

main().catch((err) => {
  console.error('[discord-bot] Fatal error:', err);
  process.exit(1);
});
