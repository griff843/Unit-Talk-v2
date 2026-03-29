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

const HIGHEST_TIER_REPLY = "You're already on our highest active tier.";

export function createUpgradeCommand(
  config: ReturnType<typeof loadBotConfig>,
): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('upgrade')
      .setDescription('See your upgrade path and what higher tiers unlock'),
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const member = interaction.member as GuildMember;
      const context = resolveMemberTier(member, config);

      if (context.tier === 'vip-plus') {
        await interaction.editReply({
          content: HIGHEST_TIER_REPLY,
          embeds: [],
        });
        return;
      }

      await interaction.editReply({
        content: '',
        embeds: [buildUpgradeEmbed(context)],
      });
    },
  };
}

export function buildUpgradeEmbed(context: MemberTierContext) {
  return new EmbedBuilder()
    .setTitle('Upgrade Your Access')
    .setColor(0x5865f2)
    .setDescription(resolveUpgradeDescription(context.tier))
    .addFields({
      name: 'Ready to upgrade?',
      value: 'Contact an operator in #support or reach out to staff directly.',
      inline: false,
    })
    .setFooter({ text: 'Unit Talk - /upgrade - V1 upgrade path' });
}

function resolveUpgradeDescription(tier: MemberTierContext['tier']) {
  switch (tier) {
    case 'trial':
      return [
        "You're currently on a trial with VIP-level access.",
        '**VIP** - Keep everything you have now, permanently.',
        '**VIP+** - Add Trader Insights on top.',
      ].join('\n');
    case 'vip':
      return '**VIP+** - Adds Trader Insights and higher-access surfaces to your current VIP access.';
    case 'black-label':
    case 'vip-plus':
      return HIGHEST_TIER_REPLY;
    case 'free':
    default:
      return [
        '**VIP** - Full pick board, capper board access, Best Bets, recaps.',
        '**VIP+** - Everything in VIP plus Trader Insights.',
      ].join('\n');
  }
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  return createUpgradeCommand(loadBotConfig(rootDir));
}
