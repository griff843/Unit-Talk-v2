export const memberTiers = [
  'free',
  'trial',
  'vip',
  'vip-plus',
  'capper',
  'operator',
] as const;

export type MemberTier = (typeof memberTiers)[number];

export interface DiscordRoleTierMapping {
  roleId: string;
  tier: MemberTier;
}
