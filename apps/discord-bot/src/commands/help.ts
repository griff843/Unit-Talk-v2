import { createMemberEmbed } from '../embeds/presentation.js';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { CommandHandler } from '../command-registry.js';

/**
 * One entry per deployed slash command.
 * Keep in sync with the files in this directory.
 * Descriptions are intentionally duplicated from each builder so that /help
 * has no runtime dependency on the other command modules.
 */
const COMMAND_ENTRIES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'stats', description: 'View settled server results.' },
  { name: 'leaderboard', description: 'Compare capper results.' },
  { name: 'trial-status', description: 'Check your server access.' },
];

export function createHelpCommand(): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show all available commands and their descriptions'),

    // responseVisibility omitted → router uses ephemeral (private) by default
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const lines = COMMAND_ENTRIES.map(
        ({ name, description }) => `**/${name}** — ${description}`,
      );

      const embed = createMemberEmbed()
        .setTitle('Unit Talk — Member Tools')
        .setDescription(
          `${lines.join('\n')}\n\nNeed a hand? Visit <#1559933414281322586> or open a private ticket in <#1285609124050108436>.`,
        );

      await interaction.editReply({ embeds: [embed] });
    },
  };
}

/** Auto-loaded by loadCommandRegistry — no runtime deps required. */
export function createDefaultCommand(): CommandHandler {
  return createHelpCommand();
}
