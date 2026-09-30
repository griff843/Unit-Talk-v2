import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  type AlertsRecentResponse,
  type ApiClient,
  createApiClient,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import { requireVipPlusRoles } from '../role-guard.js';
import type { CommandHandler } from '../command-registry.js';

const EMPTY_MESSAGE =
  'Line-movement alerts are not live yet. There are no detections to show.';

export function createHeatSignalCommand(
  _apiClient: ApiClient,
  requiredRoles: string[] = ['__vip_plus_roles_not_configured__'],
): CommandHandler {
  return {
    requiredRoles,
    data: new SlashCommandBuilder()
      .setName('heat-signal')
      .setDescription('Line-movement alerts (not live yet)')
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
      await interaction.editReply({ content: EMPTY_MESSAGE, embeds: [] });
    },
  };
}

export function buildHeatSignalEmbed(
  response: AlertsRecentResponse,
  requestedCount: number,
): EmbedBuilder {
  const detections = response.detections.slice(0, 5);
  const dominantTier = resolveDominantTier(detections);
  const footerTimestamp =
    detections[0]?.currentSnapshotAt ?? new Date().toISOString();

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

function formatDetectionLine(
  detection: AlertsRecentResponse['detections'][number],
) {
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
    detection.velocity != null
      ? `- velocity ${detection.velocity.toFixed(2)}/min`
      : '',
  ].join(' ');
}

function formatLineValue(value: number) {
  return Number.isInteger(value) ? value.toFixed(1) : value.toString();
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createHeatSignalCommand(
    createApiClient(config.apiUrl, config.apiKey),
    requireVipPlusRoles(config),
  );
}
