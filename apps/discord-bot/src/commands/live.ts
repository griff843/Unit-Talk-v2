import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  ApiClientError,
  createApiClient,
  type ApiClient,
  type PicksQueryResponse,
  type QueriedPick,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';

const LIVE_STATUSES = ['validated', 'queued', 'posted'];
const PAGE_SIZE = 10;

export function createLiveCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('live')
      .setDescription('Show active picks that are still live on the board'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        const response = apiClient.getPicksByStatus
          ? await apiClient.getPicksByStatus(LIVE_STATUSES, 50)
          : await apiClient.get<PicksQueryResponse>(
              `/api/picks?status=${LIVE_STATUSES.join(',')}&limit=50`,
            );

        if (response.count === 0) {
          await interaction.editReply({
            content: 'No active picks are live right now.',
            embeds: [],
          });
          return;
        }

        await interaction.editReply({
          content: '',
          embeds: buildLiveEmbeds(response.picks),
        });
      } catch (error) {
        await interaction.editReply({
          content:
            error instanceof ApiClientError
              ? 'Live board is temporarily unavailable.'
              : 'Live board is temporarily unavailable.',
          embeds: [],
        });
      }
    },
  };
}

export function buildLiveEmbeds(picks: QueriedPick[]) {
  const pages = paginate(picks, PAGE_SIZE);

  return pages.map((page, index) =>
    new EmbedBuilder()
      .setTitle(
        pages.length > 1
          ? `Live Board - Page ${index + 1}/${pages.length}`
          : 'Live Board',
      )
      .setColor(0x22c55e)
      .setDescription(page.map(formatBoardLine).join('\n')),
  );
}

function formatBoardLine(pick: QueriedPick) {
  return [
    `[${pick.status.toUpperCase()}]`,
    `**${pick.selection}**`,
    `(${pick.market})`,
    formatOdds(pick.odds),
    formatStake(pick.stake_units),
    `- ${readSubmittedBy(pick)}`,
    `- ${formatShortTimestamp(pick.created_at)}`,
  ].join(' ');
}

function readSubmittedBy(pick: QueriedPick) {
  const metadata = asRecord(pick.metadata);
  const submittedBy =
    typeof metadata?.['submittedBy'] === 'string'
      ? metadata['submittedBy']
      : typeof metadata?.['capper'] === 'string'
      ? metadata['capper']
      : null;

  return submittedBy?.trim() || 'Unit Talk';
}

function formatOdds(odds: number | null) {
  if (typeof odds !== 'number' || !Number.isFinite(odds)) {
    return '(odds n/a)';
  }

  return odds > 0 ? `(+${odds})` : `(${odds})`;
}

function formatStake(stakeUnits: number | null) {
  if (typeof stakeUnits !== 'number' || !Number.isFinite(stakeUnits)) {
    return 'stake n/a';
  }

  return `${stakeUnits.toFixed(1)}u`;
}

function formatShortTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 16).replace('T', ' ');
}

function paginate<T>(items: T[], pageSize: number) {
  const pages: T[][] = [];

  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }

  return pages;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createLiveCommand(createApiClient(config.apiUrl));
}
