import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { ApiClientError, createApiClient, type ApiClient } from '../api-client.js';
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
      .setDescription('Show the top cappers in the selected settled-pick window')
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
      const window = (interaction.options.getInteger('window') ?? 30) as 7 | 14 | 30 | 90;
      const sport = normalizeOptionalString(interaction.options.getString('sport'));
      const limit = interaction.options.getInteger('limit') ?? 10;

      try {
        const response = await apiClient.get<LeaderboardApiResponse>(
          buildLeaderboardPath({
            window,
            limit,
            ...(sport ? { sport } : {}),
          }),
        );
        await interaction.editReply({
          embeds: [buildLeaderboardEmbed(response.data)],
        });
      } catch (error) {
        const content =
          error instanceof ApiClientError
            ? 'Leaderboard is temporarily unavailable.'
            : 'Leaderboard is temporarily unavailable.';
        await interaction.editReply({
          content,
          embeds: [],
        });
      }
    },
  };
}

export function buildLeaderboardEmbed(leaderboard: LeaderboardResponse) {
  const title = `\u{1F3C6} Leaderboard \u2014 Last ${leaderboard.window} Days${
    leaderboard.sport ? ` (${leaderboard.sport})` : ''
  }`;

  const embed = new EmbedBuilder().setTitle(title).setColor(0xffd700).setFooter({
    text: `Min ${leaderboard.minPicks} settled picks · ${leaderboard.window}-day window · /stats @capper for details`,
  });

  if (leaderboard.entries.length === 0) {
    embed.setDescription(
      `No cappers with \u2265${leaderboard.minPicks} settled picks in this window.`,
    );
    return embed;
  }

  for (const entry of leaderboard.entries.slice(0, 10)) {
    embed.addFields({
      name: `#${entry.rank} ${entry.capper}`,
      value: formatLeaderboardLine(entry),
      inline: false,
    });
  }

  return embed;
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
    formatPercent(entry.winRate),
    `${formatSignedPercent(entry.roiPct)} ROI`,
  ];

  const streak = formatStreak(entry.streak);
  if (streak) {
    parts.push(streak);
  }

  return parts.join('  ');
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
  return createLeaderboardCommand(createApiClient(config.apiUrl));
}
