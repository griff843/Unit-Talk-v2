import { buildUpgradePresentation } from '@unit-talk/domain';
import { EmbedBuilder } from 'discord.js';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';
import { resolveMemberTier, type MemberTierContext } from '../tier-resolver.js';

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
          content: '',
          embeds: [buildUpgradeEmbed(context)],
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
  return EmbedBuilder.from(buildUpgradePresentation(context.tier));
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  return createUpgradeCommand(loadBotConfig(rootDir));
}
