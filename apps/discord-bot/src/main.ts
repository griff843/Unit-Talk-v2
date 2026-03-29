import { createDiscordClient } from './client.js';
import { loadCommandRegistry } from './command-registry.js';
import { createInteractionHandler } from './router.js';
import { loadBotConfig } from './config.js';
import { createMemberTierSyncHandler } from './handlers/member-tier-sync-handler.js';
import { InMemoryMemberTierRepository } from '@unit-talk/db';

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

  // TODO(UTV2-165): Replace InMemoryMemberTierRepository with DatabaseMemberTierRepository
  // once Supabase credentials are available in the discord-bot service context.
  const memberTierRepository = new InMemoryMemberTierRepository();

  client.once('ready', (readyClient) => {
    console.log(`[discord-bot] Ready as ${readyClient.user.tag}`);
  });

  client.on('interactionCreate', createInteractionHandler(registry));
  client.on('guildMemberUpdate', createMemberTierSyncHandler(config, client, memberTierRepository));

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
