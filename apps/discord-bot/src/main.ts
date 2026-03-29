import { createDiscordClient } from './client.js';
import { loadCommandRegistry } from './command-registry.js';
import { createInteractionHandler } from './router.js';
import { loadBotConfig } from './config.js';
import { createCapperOnboardingHandler } from './handlers/capper-onboarding-handler.js';

async function main() {
  let config;
  try {
    config = loadBotConfig();
  } catch (err) {
    console.error('[discord-bot] Startup failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const client = createDiscordClient();
  const registry = await loadCommandRegistry();

  client.once('ready', (readyClient) => {
    console.log(`[discord-bot] Ready as ${readyClient.user.tag}`);
  });

  client.on('interactionCreate', createInteractionHandler(registry));
  client.on('guildMemberUpdate', createCapperOnboardingHandler(config, client));

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
