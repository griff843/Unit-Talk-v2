import type { ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from './config.js';

/**
 * Foundation-level role access gate.
 *
 * Checks whether the interaction member holds at least one of the
 * required Discord role IDs. Role IDs differ per environment and must
 * NOT be hardcoded in source - supply them from bot config at call time.
 *
 * Returns false (access denied) when:
 *   - interaction.member is null or not a GuildMember
 *   - member.roles.cache is not available (APIInteractionGuildMember shape)
 *   - member holds none of the required roles
 */
export function checkRoles(
  interaction: ChatInputCommandInteraction,
  requiredRoles: string[],
): boolean {
  if (requiredRoles.length === 0) return true;

  const member = interaction.member;
  if (!member) return false;

  // GuildMember has roles.cache (Collection); APIInteractionGuildMember has
  // roles as string[]. We require the GuildMember form (needs GuildMembers intent).
  if (
    typeof member !== 'object' ||
    !('roles' in member) ||
    typeof member.roles !== 'object' ||
    !member.roles ||
    !('cache' in member.roles)
  ) {
    return false;
  }

  const cache = (member.roles as { cache: { has(id: string): boolean } }).cache;
  return requiredRoles.some((roleId) => cache.has(roleId));
}

/**
 * Roles allowed to read active (unsettled) picks.
 *
 * MEMBERSHIP_PRODUCT_CONTRACT.md §3.3: free access to settled results never
 * grants access to an active paid pick before settlement. Trial and Operator
 * are included only when configured; VIP, VIP+ and Capper are required config,
 * so the list is never empty and the router never treats it as unrestricted.
 */
export function requireActivePickRoles(
  config: Pick<BotConfig, 'trialRoleId' | 'vipRoleId' | 'vipPlusRoleId' | 'capperRoleId' | 'operatorRoleId'>,
): string[] {
  const roles = [
    config.trialRoleId,
    config.vipRoleId,
    config.vipPlusRoleId,
    config.capperRoleId,
    config.operatorRoleId,
  ].filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0);
  return roles.length > 0 ? roles : ['__active_pick_roles_not_configured__'];
}

export function requireOperatorRole(
  config: Pick<BotConfig, 'operatorRoleId'>,
): string[] {
  return config.operatorRoleId ? [config.operatorRoleId] : ['__operator_role_not_configured__'];
}
