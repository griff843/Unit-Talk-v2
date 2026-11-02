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
      value: 'Use the [Unit Talk pick form](https://picks.unit-talk.com/submit).',
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
      return 'Your trial includes access to the VIP channels. For help with your trial or access, open a private ticket in <#1285609124050108436>.';
    case 'vip':
      return 'Your access includes the VIP channels. For help finding your way around, visit <#1559933414281322586>.';
    case 'vip-plus':
      return 'Your access includes the VIP and VIP+ channels. For help finding your way around, visit <#1559933414281322586>.';
    case 'black-label':
      return 'For help with your access, open a private ticket in <#1285609124050108436>.';
    case 'free':
    default:
      return 'Welcome to Unit Talk. Join the conversation in our public channels. For help with your access, open a private ticket in <#1285609124050108436>.';
  }
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  return createTrialStatusCommand(loadBotConfig(rootDir));
}
