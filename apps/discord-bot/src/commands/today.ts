import {
  memberTextPages,
  createMemberEmbed,
  replyWithPrivateError,
  replyWithPages,
} from '../embeds/presentation.js';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  createApiClient,
  type ApiClient,
  type PicksQueryResponse,
  type QueriedPick,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import { requireActivePickRoles } from '../role-guard.js';
import type { CommandHandler } from '../command-registry.js';

const PAGE_SIZE = 10;

export function createTodayCommand(
  apiClient: ApiClient,
  requiredRoles: string[],
): CommandHandler {
  return {
    requiredRoles,
    data: new SlashCommandBuilder()
      .setName('today')
      .setDescription("Show picks created in today's board window"),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        const response = await apiClient.get<PicksQueryResponse>(
          '/api/member/picks?status=posted,settled&limit=200',
        );

        const todayPicks = filterTodayPicks(response.picks);
        if (todayPicks.length === 0) {
          await interaction.editReply({
            content: '',
            embeds: [
              createMemberEmbed().setDescription(
                "No picks have been posted in today's board window yet.",
              ),
            ],
          });
          return;
        }

        await replyWithPages(interaction, buildTodayEmbeds(todayPicks));
      } catch {
        await replyWithPrivateError(
          interaction,
          'Today board is temporarily unavailable.',
        );
      }
    },
  };
}

export function filterTodayPicks(picks: QueriedPick[], now: Date = new Date()) {
  return picks.filter((pick) => isSameUtcDay(pick.created_at, now));
}

export function buildTodayEmbeds(picks: QueriedPick[]) {
  const pages = paginate(picks, PAGE_SIZE);

  return pages.flatMap((page, index) =>
    memberTextPages(
      pages.length > 1
        ? `Today's Picks - Page ${index + 1}/${pages.length}`
        : "Today's Picks",
      page
        .map((pick) =>
          [
            `[${pick.status.toUpperCase()}]`,
            `**${pick.selection}**`,
            pick.market ? `(${pick.market})` : '',
            formatShortTimestamp(pick.created_at),
          ]
            .filter(Boolean)
            .join(' '),
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
    return '';
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
  return createTodayCommand(
    createApiClient(config.apiUrl, config.apiKey),
    requireActivePickRoles(config),
  );
}
