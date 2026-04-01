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

const TODAY_STATUSES = ['validated', 'queued', 'posted', 'settled'];
const PAGE_SIZE = 10;

export function createTodayCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('today')
      .setDescription("Show picks created in today's board window"),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        const response = apiClient.getPicksByStatus
          ? await apiClient.getPicksByStatus(TODAY_STATUSES, 200)
          : await apiClient.get<PicksQueryResponse>(
              `/api/picks?status=${TODAY_STATUSES.join(',')}&limit=200`,
            );

        const todayPicks = filterTodayPicks(response.picks);
        if (todayPicks.length === 0) {
          await interaction.editReply({
            content: 'No picks have been posted in today\'s board window yet.',
            embeds: [],
          });
          return;
        }

        await interaction.editReply({
          content: '',
          embeds: buildTodayEmbeds(todayPicks),
        });
      } catch (error) {
        await interaction.editReply({
          content:
            error instanceof ApiClientError
              ? 'Today board is temporarily unavailable.'
              : 'Today board is temporarily unavailable.',
          embeds: [],
        });
      }
    },
  };
}

export function filterTodayPicks(picks: QueriedPick[], now: Date = new Date()) {
  return picks.filter((pick) => isSameUtcDay(pick.created_at, now));
}

export function buildTodayEmbeds(picks: QueriedPick[]) {
  const pages = paginate(picks, PAGE_SIZE);

  return pages.map((page, index) =>
    new EmbedBuilder()
      .setTitle(
        pages.length > 1
          ? `Today's Picks - Page ${index + 1}/${pages.length}`
          : "Today's Picks",
      )
      .setColor(0x3b82f6)
      .setDescription(
        page
          .map((pick) =>
            [
              `[${pick.status.toUpperCase()}]`,
              `**${pick.selection}**`,
              `(${pick.market})`,
              `- ${formatShortTimestamp(pick.created_at)}`,
            ].join(' '),
          )
          .join('\n'),
      ),
  );
}

function isSameUtcDay(value: string, now: Date) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return (
    parsed.getUTCFullYear() === now.getUTCFullYear() &&
    parsed.getUTCMonth() === now.getUTCMonth() &&
    parsed.getUTCDate() === now.getUTCDate()
  );
}

function formatShortTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(11, 16) + ' UTC';
}

function paginate<T>(items: T[], pageSize: number) {
  const pages: T[][] = [];

  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }

  return pages;
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createTodayCommand(createApiClient(config.apiUrl));
}
