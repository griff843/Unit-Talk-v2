import type { GuildMember } from 'discord.js';
import type { BotConfig } from './config.js';

export interface MemberTierContext {
  discordUserId: string;
  tier: 'free' | 'trial' | 'vip' | 'vip-plus' | 'black-label';
  isCapper: boolean;
  isVip: boolean;
  isVipPlus: boolean;
  isTrial: boolean;
  resolvedAt: string;
}

export function resolveMemberTier(
  member: Pick<GuildMember, 'id' | 'roles'>,
  config: Pick<BotConfig, 'capperRoleId' | 'vipRoleId' | 'vipPlusRoleId' | 'trialRoleId'>,
): MemberTierContext {
  const isVipPlus = member.roles.cache.has(config.vipPlusRoleId);
  const isVip = member.roles.cache.has(config.vipRoleId);
  const isTrial = config.trialRoleId !== null && member.roles.cache.has(config.trialRoleId);
  const isCapper = member.roles.cache.has(config.capperRoleId);

  return {
    discordUserId: member.id,
    tier: isVipPlus ? 'vip-plus' : isVip ? 'vip' : isTrial ? 'trial' : 'free',
    isCapper,
    isVip,
    isVipPlus,
    isTrial,
    resolvedAt: new Date().toISOString(),
  };
}
