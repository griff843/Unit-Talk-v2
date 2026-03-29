import type { GuildMember, PartialGuildMember } from 'discord.js';
import { createDiscordClient } from './client.js';
import { loadCommandRegistry } from './command-registry.js';
import { createInteractionHandler } from './router.js';
import { loadBotConfig } from './config.js';
import { createCapperOnboardingHandler } from './handlers/capper-onboarding-handler.js';
import { syncMemberTierFromRoleChange } from './handlers/member-tier-sync-handler.js';
import {
  DatabaseMemberTierRepository,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

function tryCreateMemberTierRepository(): DatabaseMemberTierRepository | null {
  try {
    const env = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    return new DatabaseMemberTierRepository(connection);
  } catch {
    return null;
  }
}

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

  const memberTierRepository = tryCreateMemberTierRepository();
  if (!memberTierRepository) {
    console.warn('[discord-bot] No Supabase credentials — member tier sync disabled');
  }

  client.once('ready', (readyClient) => {
    console.log(`[discord-bot] Ready as ${readyClient.user.tag}`);
  });

  client.on('interactionCreate', createInteractionHandler(registry));

  client.on(
    'guildMemberUpdate',
    async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> => {
      // Capper onboarding (welcome embed)
      await createCapperOnboardingHandler(config, client)(oldMember, newMember);

      // Member tier sync
      if (memberTierRepository) {
        try {
          const oldRoleIds = new Set(oldMember.roles.cache.keys());
          const newRoleIds = [...newMember.roles.cache.keys()];
          const addedRoles = newRoleIds.filter((id) => !oldRoleIds.has(id));
          const removedRoles = [...oldRoleIds].filter((id) => !newMember.roles.cache.has(id));

          await syncMemberTierFromRoleChange(
            newMember.id,
            newMember.user?.username,
            addedRoles,
            removedRoles,
            memberTierRepository,
          );
        } catch (err) {
          console.error('[discord-bot] member tier sync error (swallowed):', err);
        }
      }
    },
  );

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
