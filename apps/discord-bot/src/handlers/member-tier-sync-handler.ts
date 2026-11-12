import type { GuildMember, PartialGuildMember } from 'discord.js';
import type { BotConfig } from '../config.js';
import { buildMemberTierSyncFailure, type ApiClient } from '../api-client.js';

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
 * This must never crash the bot process, but no failure is silent: a failed sync
 * is logged as a structured `member_tier_sync.failed` error, and one failed
 * role never blocks the other roles in the same update.
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
      const syncParams: Array<{ discord_id: string; tier: string; action: 'activate' | 'deactivate' }> = [];

      for (const roleId of addedRoleIds) {
        const tier = roleTierMap.get(roleId);
        if (tier) {
          syncParams.push({ discord_id: newMember.id, tier, action: 'activate' });
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
          syncParams.push({ discord_id: newMember.id, tier, action: 'deactivate' });
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

      const results = await Promise.allSettled(syncTasks);
      results.forEach((result, index) => {
        const params = syncParams[index];
        if (result.status === 'rejected' && params) {
          console.error(JSON.stringify(buildMemberTierSyncFailure(params, result.reason)));
        }
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'member_tier_sync.handler_error',
          code: err instanceof Error ? 'handler_error' : 'unexpected_error',
        }),
      );
    }
  };
}
