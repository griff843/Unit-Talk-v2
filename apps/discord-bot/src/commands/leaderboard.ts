import {
  memberPages,
  replyWithPages,
  replyWithPrivateError,
} from '../embeds/presentation.js';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  ApiClientError,
  createApiClient,
  type ApiClient,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';

export interface LeaderboardEntry {
  rank: number;
  capper: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  roiPct: number | null;
  avgClvPct: number | null;
  streak: number;
}

export interface LeaderboardResponse {
  window: 7 | 14 | 30 | 90;
  sport: string | null;
  minPicks: number;
  entries: LeaderboardEntry[];
  observedAt: string;
}

interface LeaderboardApiResponse {
  ok: true;
  data: LeaderboardResponse;
}

export function createLeaderboardCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription(
        'Show the top cappers in the selected settled-pick window',
      )
      .addIntegerOption((option) =>
        option
          .setName('window')
          .setDescription('Trailing window in days')
          .setRequired(false)
          .addChoices(
            { name: '7 days', value: 7 },
            { name: '14 days', value: 14 },
            { name: '30 days', value: 30 },
            { name: '90 days', value: 90 },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('sport')
          .setDescription('Optional sport filter, e.g. NBA or MLB')
          .setRequired(false)
          .setMaxLength(20),
      )
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription('Number of ranked cappers to show')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(25),
      ),
    responseVisibility: 'public',
    async execute(interaction: ChatInputCommandInteraction) {
      const window = (interaction.options.getInteger('window') ?? 30) as
        | 7
        | 14
        | 30
        | 90;
      const sport = normalizeOptionalString(
        interaction.options.getString('sport'),
      );
      const limit = interaction.options.getInteger('limit') ?? 10;

      try {
        const response = await apiClient.get<LeaderboardApiResponse>(
          buildLeaderboardPath({
            window,
            limit,
            ...(sport ? { sport } : {}),
          }),
        );
        await replyWithPages(
          interaction,
          buildLeaderboardEmbeds(response.data),
        );
      } catch (error) {
        const content =
          error instanceof ApiClientError
            ? 'Leaderboard is temporarily unavailable.'
            : 'Leaderboard is temporarily unavailable.';
        await replyWithPrivateError(interaction, content, true);
      }
    },
  };
}

export function buildLeaderboardEmbed(leaderboard: LeaderboardResponse) {
  return buildLeaderboardEmbeds(leaderboard)[0]!;
}
export function buildLeaderboardEmbeds(leaderboard: LeaderboardResponse) {
  return memberPages('leaderboard', {
    title: `Leaderboard · Last ${leaderboard.window} Days${leaderboard.sport ? ` (${leaderboard.sport})` : ''}`,
    description: leaderboard.entries.length
      ? undefined
      : `No cappers with ≥${leaderboard.minPicks} settled picks in this window.`,
    timestamp: leaderboard.observedAt,
    fields: [
      ...leaderboard.entries.map((entry) => ({
        name: `#${entry.rank} ${entry.capper}`,
        value: formatLeaderboardLine(entry) + ` · ${entry.picks} settled picks`,
      })),
      {
        name: 'Sample',
        value: `Min ${leaderboard.minPicks} settled picks · ${leaderboard.window}-day window · /stats for details`,
      },
    ],
  });
}

function buildLeaderboardPath(input: {
  window: 7 | 14 | 30 | 90;
  sport?: string;
  limit: number;
}) {
  const params = new URLSearchParams();
  params.set('last', String(input.window));
  params.set('limit', String(input.limit));

  if (input.sport) {
    params.set('sport', input.sport);
  }

  return `/api/operator/leaderboard?${params.toString()}`;
}

function formatLeaderboardLine(entry: LeaderboardEntry) {
  const parts = [
    `${entry.wins}\u2013${entry.losses}\u2013${entry.pushes}`,
    entry.winRate != null && Number.isFinite(entry.winRate)
      ? formatPercent(entry.winRate)
      : '',
    entry.roiPct != null && Number.isFinite(entry.roiPct)
      ? `${formatSignedPercent(entry.roiPct)} ROI`
      : '',
  ];

  const streak = formatStreak(entry.streak);
  if (streak) {
    parts.push(streak);
  }

  return parts.filter(Boolean).join('  ');
}

function formatPercent(value: number | null) {
  if (value === null) {
    return 'n/a';
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number | null) {
  if (value === null) {
    return 'n/a';
  }

  const normalized = value.toFixed(1);
  return value > 0 ? `+${normalized}%` : `${normalized}%`;
}

function formatStreak(value: number) {
  if (value > 0) {
    return `\u{1F525}${Math.abs(value)}`;
  }
  if (value < 0) {
    return `\u{1F9CA}${Math.abs(value)}`;
  }
  return '';
}

function normalizeOptionalString(value: string | null) {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createLeaderboardCommand(
    createApiClient(config.apiUrl, config.apiKey),
  );
}
