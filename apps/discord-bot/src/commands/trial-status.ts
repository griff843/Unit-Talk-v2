import { createMemberEmbed } from '../embeds/presentation.js';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';
import { resolveMemberTier, type MemberTierContext } from '../tier-resolver.js';

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
  const embed = createMemberEmbed()
    .setTitle(`Your Unit Talk Access - ${formatTierDisplay(context.tier)}`)

    .setDescription(resolveTierDescription(context.tier))
    .setFooter({ text: 'Unit Talk - /trial-status' });

  if (context.isCapper) {
    embed.addFields({
      name: 'Capper Role',
      value:
        'You also hold the Capper contributor role. Use /pick to submit picks.',
      inline: false,
    });
  }

  return embed;
}

function formatTierDisplay(tier: MemberTierContext['tier']) {
  if (tier === 'vip-plus') {
    return 'VIP+';
  }
  if (tier === 'vip') {
    return 'VIP';
  }
  if (tier === 'trial') {
    return 'Trial';
  }
  if (tier === 'black-label') {
    return 'Black Label';
  }
  return 'Free';
}

function resolveTierDescription(tier: MemberTierContext['tier']) {
  switch (tier) {
    case 'trial':
      return "You're on a trial. You have temporary VIP-level access. Upgrade before your trial ends to keep it.";
    case 'vip':
      return "You're a VIP member. You have access to official capper picks, recaps, results, and the capper board.";
    case 'vip-plus':
      return "You're VIP+. You have access to everything in VIP. VIP+ market-intelligence features are not live yet.";
    case 'black-label':
      return "You're on a reserved tier.";
    case 'free':
    default:
      return 'Your settled results and recaps remain available. VIP adds active official picks and VIP community access.';
  }
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  return createTrialStatusCommand(loadBotConfig(rootDir));
}
