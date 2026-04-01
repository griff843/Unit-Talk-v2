import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandHandler } from '../command-registry.js';

/**
 * One entry per deployed slash command.
 * Keep in sync with the files in this directory.
 * Descriptions are intentionally duplicated from each builder so that /help
 * has no runtime dependency on the other command modules.
 */
const COMMAND_ENTRIES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'alerts-setup', description: 'Show alert agent status (operator only)' },
  { name: 'heat-signal', description: 'Show recent notable line movement signals' },
  { name: 'live', description: 'Show active picks that are still live on the board' },
  { name: 'today', description: "Show picks created in today's board window" },
  { name: 'my-picks', description: 'Show picks that match your Discord identity' },
  { name: 'results', description: 'Show recent settled results with outcome visibility' },
  { name: 'trial-status', description: 'Show your current access tier and what it includes' },
  { name: 'upgrade', description: 'See your upgrade path and what higher tiers unlock' },
  { name: 'pick',        description: 'Submit a capper pick through the canonical API path' },
  { name: 'stats',       description: 'Show settled pick performance for a capper or the full server' },
  { name: 'leaderboard', description: 'Show the top cappers in the selected settled-pick window' },
  { name: 'help',        description: 'Show all available commands and their descriptions' },
  { name: 'recap',       description: 'Show your last settled picks' },
];

export function createHelpCommand(): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show all available commands and their descriptions'),

    // responseVisibility omitted → router uses ephemeral (private) by default
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const lines = COMMAND_ENTRIES.map(({ name, description }) => `**/${name}** — ${description}`);

      const embed = new EmbedBuilder()
        .setTitle('Unit Talk — Available Commands')
        .setColor(0x5865f2)
        .setDescription(lines.join('\n'));

      await interaction.editReply({ embeds: [embed] });
    },
  };
}

/** Auto-loaded by loadCommandRegistry — no runtime deps required. */
export function createDefaultCommand(): CommandHandler {
  return createHelpCommand();
}
