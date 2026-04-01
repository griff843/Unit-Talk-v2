import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  createApiClient,
  type AlertsRecentResponse,
  type ApiClient,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';

const EMPTY_MESSAGE = 'No notable line movements detected in the current window.';
const ERROR_MESSAGE = 'Alert data temporarily unavailable.';

export function createHeatSignalCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('heat-signal')
      .setDescription('Show recent notable line movement signals')
      .addIntegerOption((option) =>
        option
          .setName('count')
          .setDescription('Number of recent detections to show')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(10),
      ),
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const count = interaction.options.getInteger('count') ?? 5;

      try {
        const response = apiClient.getRecentAlerts
          ? await apiClient.getRecentAlerts(count, 'notable')
          : await apiClient.get<AlertsRecentResponse>(
              `/api/alerts/recent?limit=${count}&minTier=notable`,
            );

        if (response.detections.length === 0) {
          await interaction.editReply({ content: EMPTY_MESSAGE, embeds: [] });
          return;
        }

        await interaction.editReply({
          content: '',
          embeds: [buildHeatSignalEmbed(response, count)],
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

export function buildHeatSignalEmbed(
  response: AlertsRecentResponse,
  requestedCount: number,
): EmbedBuilder {
  const detections = response.detections.slice(0, 5);
  const dominantTier = resolveDominantTier(detections);
  const footerTimestamp = detections[0]?.currentSnapshotAt ?? new Date().toISOString();

  return new EmbedBuilder()
    .setTitle(`Heat Signal - Top ${requestedCount} Line Movements`)
    .setColor(dominantTier === 'alert-worthy' ? 0xff6600 : 0xff9900)
    .setDescription(detections.map(formatDetectionLine).join('\n'))
    .setFooter({ text: `Last updated: ${footerTimestamp} - /heat-signal` });
}

function resolveDominantTier(detections: AlertsRecentResponse['detections']) {
  const counts = detections.reduce(
    (acc, detection) => {
      acc[detection.tier] += 1;
      return acc;
    },
    { notable: 0, 'alert-worthy': 0 },
  );

  return counts['alert-worthy'] > counts.notable ? 'alert-worthy' : 'notable';
}

function formatDetectionLine(detection: AlertsRecentResponse['detections'][number]) {
  const tierIcon = detection.tier === 'alert-worthy' ? 'ALERT' : 'NOTE';
  const arrow = detection.direction === 'up' ? 'UP' : 'DOWN';
  const unit = detection.marketType === 'moneyline' ? 'juice' : 'pts';
  const changeValue = `${detection.lineChange >= 0 ? '+' : ''}${detection.lineChange.toFixed(1)} ${unit}`;

  return [
    `[${tierIcon}]`,
    `**${detection.marketKey}**`,
    `- ${formatLineValue(detection.oldLine)} -> ${formatLineValue(detection.newLine)} (${changeValue})`,
    `- ${detection.bookmakerKey}`,
    `- ${arrow}`,
    `- ${detection.timeElapsedMinutes}m`,
    detection.velocity != null ? `- velocity ${detection.velocity.toFixed(2)}/min` : '',
  ].join(' ');
}

function formatLineValue(value: number) {
  return Number.isInteger(value) ? value.toFixed(1) : value.toString();
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createHeatSignalCommand(createApiClient(config.apiUrl));
}
