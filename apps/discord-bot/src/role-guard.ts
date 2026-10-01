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
  if (
    requiredRoles.length === 0 ||
    requiredRoles.some(
      (roleId) => roleId.length === 0 || roleId !== roleId.trim(),
    ) ||
    new Set(requiredRoles).size !== requiredRoles.length
  ) {
    return false;
  }

  if (
    typeof interaction.guildId !== 'string' ||
    interaction.guildId.length === 0
  ) {
    return false;
  }

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

  const cache = (member.roles as { cache?: { has?: unknown } }).cache;
  const hasRole = cache?.has;
  if (typeof hasRole !== 'function') {
    return false;
  }
  return requiredRoles.some((roleId) => hasRole.call(cache, roleId) === true);
}

const INVALID_MEMBER_ACCESS_ROLE = '__member_access_role_config_invalid__';

type MemberAccessRoleConfig = Pick<
  BotConfig,
  | 'trialRoleId'
  | 'vipRoleId'
  | 'vipPlusRoleId'
  | 'capperRoleId'
  | 'operatorRoleId'
>;

function resolveMemberAccessRoles(
  config: MemberAccessRoleConfig,
  allowedKeys: Array<keyof MemberAccessRoleConfig>,
): string[] {
  const entries: Array<
    [keyof MemberAccessRoleConfig, string | null | undefined]
  > = [
    ['trialRoleId', config.trialRoleId],
    ['vipRoleId', config.vipRoleId],
    ['vipPlusRoleId', config.vipPlusRoleId],
    ['capperRoleId', config.capperRoleId],
    ['operatorRoleId', config.operatorRoleId],
  ];
  const requiredKeys: Array<keyof MemberAccessRoleConfig> = [
    'vipRoleId',
    'vipPlusRoleId',
    'capperRoleId',
  ];

  for (const key of requiredKeys) {
    const value = config[key];
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value !== value.trim()
    ) {
      return [INVALID_MEMBER_ACCESS_ROLE];
    }
  }

  const configured = entries.filter(
    (entry): entry is [keyof MemberAccessRoleConfig, string] => {
      return entry[1] !== null && entry[1] !== undefined;
    },
  );
  if (
    configured.some(
      ([, value]) => value.length === 0 || value !== value.trim(),
    ) ||
    new Set(configured.map(([, value]) => value)).size !== configured.length
  ) {
    return [INVALID_MEMBER_ACCESS_ROLE];
  }

  return allowedKeys.flatMap((key) => {
    const value = config[key];
    return typeof value === 'string' ? [value] : [];
  });
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
  config: MemberAccessRoleConfig,
): string[] {
  return resolveMemberAccessRoles(config, [
    'trialRoleId',
    'vipRoleId',
    'vipPlusRoleId',
    'capperRoleId',
    'operatorRoleId',
  ]);
}

/** VIP+ intelligence is also readable by Capper and Operator staff roles. */
export function requireVipPlusRoles(config: MemberAccessRoleConfig): string[] {
  return resolveMemberAccessRoles(config, [
    'vipPlusRoleId',
    'capperRoleId',
    'operatorRoleId',
  ]);
}

export function requireOperatorRole(
  config: Pick<BotConfig, 'operatorRoleId'>,
): string[] {
  return config.operatorRoleId
    ? [config.operatorRoleId]
    : ['__operator_role_not_configured__'];
}
