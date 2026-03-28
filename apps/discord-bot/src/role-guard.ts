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

export function requireOperatorRole(
  config: Pick<BotConfig, 'operatorRoleId'>,
): string[] {
  return config.operatorRoleId ? [config.operatorRoleId] : ['__operator_role_not_configured__'];
}
