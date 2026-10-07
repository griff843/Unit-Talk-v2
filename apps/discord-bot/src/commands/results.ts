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
  type RecentSettlement,
  type SettlementsRecentResponse,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';

const PAGE_SIZE = 10;

export function createResultsCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('results')
      .setDescription('Show recent settled results with outcome visibility'),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        const settlements = apiClient.getRecentSettlements
          ? await apiClient.getRecentSettlements(50)
          : await apiClient.get<SettlementsRecentResponse>(
              '/api/settlements/recent?limit=50',
            );
        const settledPicks = apiClient.getPicksByStatus
          ? await apiClient.getPicksByStatus(['settled'], 200)
          : await apiClient.get<PicksQueryResponse>(
              '/api/picks?status=settled&limit=200',
            );

        if (settlements.settlements.length === 0) {
          await interaction.editReply({
            content: '',
            embeds: [
              createMemberEmbed().setDescription(
                'No recent results are available yet.',
              ),
            ],
          });
          return;
        }

        await replyWithPages(
          interaction,
          buildResultsEmbeds(settlements.settlements, settledPicks.picks),
        );
      } catch {
        await replyWithPrivateError(
          interaction,
          'Results are temporarily unavailable.',
        );
      }
    },
  };
}

export function buildResultsEmbeds(
  settlements: RecentSettlement[],
  picks: QueriedPick[],
) {
  const picksById = new Map(picks.map((pick) => [pick.id, pick] as const));
  const pages = paginate(settlements, PAGE_SIZE);

  return pages.flatMap((page, index) =>
    memberTextPages(
      pages.length > 1
        ? `Recent Results - Page ${index + 1}/${pages.length}`
        : 'Recent Results',
      page
        .map((settlement) =>
          formatSettlementLine(
            settlement,
            picksById.get(settlement.pick_id) ?? null,
          ),
        )
        .join('\n'),
    ),
  );
}

function formatSettlementLine(
  settlement: RecentSettlement,
  pick: QueriedPick | null,
) {
  const selection = pick?.selection ?? 'Settled pick';
  const market = pick?.market;
  const profitLossUnits = computeProfitLossUnits(settlement.result, pick);

  return [
    `[${String(settlement.result ?? settlement.status).toUpperCase()}]`,
    `**${selection}**`,
    market ? `(${market})` : '',
    profitLossUnits != null ? `- ${formatUnits(profitLossUnits)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function computeProfitLossUnits(
  result: string | null,
  pick: QueriedPick | null,
) {
  if (!pick) {
    return null;
  }

  const stake =
    typeof pick.stake_units === 'number' && Number.isFinite(pick.stake_units)
      ? pick.stake_units
      : null;
  if (stake === null) return null;

  if (result === 'push') {
    return 0;
  }

  if (result === 'loss') {
    return -stake;
  }

  if (result !== 'win') {
    return null;
  }

  if (
    typeof pick.odds !== 'number' ||
    !Number.isFinite(pick.odds) ||
    pick.odds === 0
  ) {
    return null;
  }

  return pick.odds > 0
    ? stake * (pick.odds / 100)
    : stake * (100 / Math.abs(pick.odds));
}

function formatUnits(value: number | null) {
  if (value === null) {
    return 'P/L n/a';
  }

  const rounded = Math.round(value * 100) / 100;
  const normalized = Number.isInteger(rounded)
    ? rounded.toFixed(1)
    : rounded.toString();
  return `${rounded >= 0 ? '+' : ''}${normalized}u`;
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
  return createResultsCommand(createApiClient(config.apiUrl, config.apiKey));
}
