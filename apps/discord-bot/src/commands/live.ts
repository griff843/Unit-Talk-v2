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

export function createLiveCommand(
  apiClient: ApiClient,
  requiredRoles: string[],
): CommandHandler {
  return {
    requiredRoles,
    data: new SlashCommandBuilder()
      .setName('live')
      .setDescription('Show active picks that are still live on the board'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        const response = await apiClient.get<PicksQueryResponse>(
          '/api/member/picks?status=posted&limit=50',
        );

        if (response.count === 0) {
          await interaction.editReply({
            content: '',
            embeds: [
              createMemberEmbed().setDescription(
                'No active picks are live right now.',
              ),
            ],
          });
          return;
        }

        await replyWithPages(interaction, buildLiveEmbeds(response.picks));
      } catch {
        await replyWithPrivateError(
          interaction,
          'Live board is temporarily unavailable.',
        );
      }
    },
  };
}

export function buildLiveEmbeds(picks: QueriedPick[]) {
  const pages = paginate(picks, PAGE_SIZE);

  return pages.flatMap((page, index) =>
    memberTextPages(
      pages.length > 1
        ? `Live Board - Page ${index + 1}/${pages.length}`
        : 'Live Board',
      page.map(formatBoardLine).join('\n'),
    ),
  );
}

function formatBoardLine(pick: QueriedPick) {
  return [
    `[${pick.status.toUpperCase()}]`,
    `**${pick.selection}**`,
    `(${pick.market})`,
    formatOdds(pick.odds),
    formatStake(pick.stake_units),
    readSubmittedBy(pick),
    formatShortTimestamp(pick.created_at),
  ]
    .filter(Boolean)
    .join(' ');
}

function readSubmittedBy(pick: QueriedPick) {
  const metadata = asRecord(pick.metadata);
  const submittedBy =
    typeof metadata?.['submittedBy'] === 'string'
      ? metadata['submittedBy']
      : typeof metadata?.['capper'] === 'string'
        ? metadata['capper']
        : null;

  return submittedBy?.trim() || '';
}

function formatOdds(odds: number | null) {
  if (typeof odds !== 'number' || !Number.isFinite(odds)) {
    return '';
  }

  return odds > 0 ? `(+${odds})` : `(${odds})`;
}

function formatStake(stakeUnits: number | null) {
  if (typeof stakeUnits !== 'number' || !Number.isFinite(stakeUnits)) {
    return '';
  }

  return `${stakeUnits.toFixed(1)}u`;
}

function formatShortTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
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
  return createLiveCommand(
    createApiClient(config.apiUrl, config.apiKey),
    requireActivePickRoles(config),
  );
}
