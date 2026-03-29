import type { MemberTierRepository } from '@unit-talk/db';
import type { DiscordRoleTierMapping, MemberTier } from '@unit-talk/contracts';

/**
 * Reads the role-to-tier mappings from env vars.
 * Empty roleId entries are filtered out (env var not set).
 */
export function readRoleTierMappings(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): DiscordRoleTierMapping[] {
  return ([
    { roleId: env['DISCORD_VIP_ROLE_ID'] ?? '',       tier: 'vip' as MemberTier },
    { roleId: env['DISCORD_VIP_PLUS_ROLE_ID'] ?? '',  tier: 'vip-plus' as MemberTier },
    { roleId: env['DISCORD_TRIAL_ROLE_ID'] ?? '',     tier: 'trial' as MemberTier },
    { roleId: env['DISCORD_CAPPER_ROLE_ID'] ?? '',    tier: 'capper' as MemberTier },
    { roleId: env['DISCORD_OPERATOR_ROLE_ID'] ?? '',  tier: 'operator' as MemberTier },
  ] satisfies DiscordRoleTierMapping[]).filter((m) => m.roleId !== '');
}

/**
 * Syncs member tier assignments from Discord role changes.
 *
 * - Role added → activateTier (idempotent)
 * - Role removed → deactivateTier (idempotent)
 *
 * Errors are thrown; the caller is responsible for swallowing/logging.
 */
export async function syncMemberTierFromRoleChange(
  discordId: string,
  discordUsername: string | undefined,
  addedRoles: string[],
  removedRoles: string[],
  memberTierRepository: MemberTierRepository,
): Promise<void> {
  const mappings = readRoleTierMappings();

  for (const { roleId, tier } of mappings) {
    if (addedRoles.includes(roleId)) {
      await memberTierRepository.activateTier({
        discordId,
        discordUsername,
        tier,
        source: 'discord-role',
        changedBy: 'discord-bot',
        reason: `Discord role ${roleId} added`,
      });
    }

    if (removedRoles.includes(roleId)) {
      await memberTierRepository.deactivateTier({
        discordId,
        tier,
        changedBy: 'discord-bot',
        reason: `Discord role ${roleId} removed`,
      });
    }
  }
}
