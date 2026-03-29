import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';
import {
  resolveMemberTier,
  type MemberTierContext,
} from '../tier-resolver.js';

const TIER_COLORS = {
  free: 0x99aab5,
  trial: 0x57f287,
  vip: 0x5865f2,
  vip_plus: 0xffd700,
  black_label: 0x111111,
} as const;

export function createTrialStatusCommand(
  config: ReturnType<typeof loadBotConfig>,
): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('trial-status')
      .setDescription('Show your current access tier and what it includes'),
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const member = interaction.member as GuildMember;
      const context = resolveMemberTier(member, config);

      await interaction.editReply({
        content: '',
        embeds: [buildTrialStatusEmbed(context)],
      });
    },
  };
}

export function buildTrialStatusEmbed(context: MemberTierContext) {
  const embed = new EmbedBuilder()
    .setTitle(`Your Unit Talk Access - ${formatTierDisplay(context.tier)}`)
    .setColor(TIER_COLORS[context.tier])
    .setDescription(resolveTierDescription(context.tier))
    .setFooter({ text: 'Unit Talk - /trial-status' });

  if (context.isCapper) {
    embed.addFields({
      name: 'Capper Role',
      value: 'You also hold the Capper contributor role. Use /pick to submit picks.',
      inline: false,
    });
  }

  return embed;
}

function formatTierDisplay(tier: MemberTierContext['tier']) {
  if (tier === 'vip_plus') {
    return 'VIP+';
  }
  if (tier === 'vip') {
    return 'VIP';
  }
  if (tier === 'trial') {
    return 'Trial';
  }
  if (tier === 'black_label') {
    return 'Black Label';
  }
  return 'Free';
}

function resolveTierDescription(tier: MemberTierContext['tier']) {
  switch (tier) {
    case 'trial':
      return "You're on a trial. You have temporary VIP-level access. Upgrade before your trial ends to keep it.";
    case 'vip':
      return "You're a VIP member. You have access to Best Bets, recaps, and the full capper board.";
    case 'vip_plus':
      return "You're VIP+. You have access to all VIP surfaces plus Trader Insights.";
    case 'black_label':
      return "You're on a reserved tier.";
    case 'free':
    default:
      return 'You have free access to Unit Talk. Upgrade to VIP for full pick board and capper access.';
  }
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  return createTrialStatusCommand(loadBotConfig(rootDir));
}
