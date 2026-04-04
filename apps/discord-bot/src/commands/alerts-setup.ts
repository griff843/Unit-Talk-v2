import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  createApiClient,
  type AlertStatusResponse,
  type ApiClient,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';
import { requireOperatorRole } from '../role-guard.js';

const ERROR_MESSAGE = 'Alert status temporarily unavailable.';

export function createAlertsSetupCommand(
  apiClient: ApiClient,
  requiredRoles: string[],
): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('alerts-setup')
      .setDescription('Show alert agent status (operator only)'),
    requiredRoles,
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        const status = apiClient.getAlertStatus
          ? await apiClient.getAlertStatus()
          : await apiClient.get<AlertStatusResponse>('/api/alerts/status');

        await interaction.editReply({
          content: '',
          embeds: [buildAlertsSetupEmbed(status)],
        });
      } catch {
        await interaction.editReply({
          content: ERROR_MESSAGE,
          embeds: [],
        });
      }
    },
  };
}

export function buildAlertsSetupEmbed(status: AlertStatusResponse): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Alert Agent Status')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Agent', value: status.enabled ? 'Enabled' : 'Disabled', inline: false },
      { name: 'Mode', value: status.effectiveMode.toUpperCase(), inline: false },
      {
        name: 'System Picks',
        value:
          status.systemPicksEnabled && status.effectiveMode === 'live'
            ? 'Enabled'
            : status.systemPicksEnabled
              ? 'Configured (suppressed outside LIVE mode)'
              : 'Disabled',
        inline: false,
      },
      { name: 'Min Tier', value: status.minTier, inline: false },
      { name: 'Lookback', value: `${status.lookbackMinutes} minutes`, inline: false },
      {
        name: 'Active Sports',
        value: status.activeSports.join(', '),
        inline: false,
      },
      {
        name: 'System Pick Markets',
        value: status.systemPickEligibleMarketTypes.join(', '),
        inline: false,
      },
      { name: 'Last Hour - Notable', value: `${status.last1h.notable} signals`, inline: false },
      {
        name: 'Last Hour - Alert-Worthy',
        value: `${status.last1h.alertWorthy} signals`,
        inline: false,
      },
      { name: 'Last Hour - Notified', value: `${status.last1h.notified} sent`, inline: false },
      { name: 'Last Detection', value: status.lastDetectedAt ?? '-', inline: false },
    );
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createAlertsSetupCommand(
    createApiClient(config.apiUrl),
    requireOperatorRole(config),
  );
}
