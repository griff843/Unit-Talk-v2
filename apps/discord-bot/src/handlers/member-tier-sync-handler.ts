import type { GuildMember, PartialGuildMember } from 'discord.js';
import type { BotConfig } from '../config.js';
import type { ApiClient } from '../api-client.js';

/**
 * Builds a map of role ID → tier name from bot config.
 * Role IDs that are absent or empty in config are excluded — optional env vars.
 */
function buildRoleTierMap(config: BotConfig): Map<string, string> {
  const map = new Map<string, string>();

  if (config.vipPlusRoleId) map.set(config.vipPlusRoleId, 'vip-plus');
  if (config.vipRoleId) map.set(config.vipRoleId, 'vip');
  if (config.trialRoleId) map.set(config.trialRoleId, 'trial');
  if (config.capperRoleId) map.set(config.capperRoleId, 'capper');
  if (config.operatorRoleId) map.set(config.operatorRoleId, 'operator');

  return map;
}

/**
 * Returns a guildMemberUpdate event handler that syncs member tier changes to the API
 * whenever tier-relevant roles are added or removed.
 *
 * All errors are swallowed — this must never crash the bot process.
 */
export function createMemberTierSyncHandler(
  config: BotConfig,
  apiClient: ApiClient,
) {
  return async function handleGuildMemberUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    try {
      const roleTierMap = buildRoleTierMap(config);

      const oldRoleIds = new Set(oldMember.roles.cache.keys());
      const newRoleIds = new Set(newMember.roles.cache.keys());

      const addedRoleIds = [...newRoleIds].filter((id) => !oldRoleIds.has(id));
      const removedRoleIds = [...oldRoleIds].filter((id) => !newRoleIds.has(id));

      const syncTasks: Array<Promise<void>> = [];

      for (const roleId of addedRoleIds) {
        const tier = roleTierMap.get(roleId);
        if (tier) {
          syncTasks.push(
            apiClient.syncMemberTier?.({
              discord_id: newMember.id,
              tier,
              action: 'activate',
              source: 'discord-role',
            }) ?? Promise.resolve(),
          );
        }
      }

      for (const roleId of removedRoleIds) {
        const tier = roleTierMap.get(roleId);
        if (tier) {
          syncTasks.push(
            apiClient.syncMemberTier?.({
              discord_id: newMember.id,
              tier,
              action: 'deactivate',
              source: 'discord-role',
            }) ?? Promise.resolve(),
          );
        }
      }

      await Promise.allSettled(syncTasks);
    } catch (err) {
      console.error('[member-tier-sync] unhandled handler error (swallowed):', err);
    }
  };
}
