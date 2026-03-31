import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { ApiClientError, createApiClient, type ApiClient } from '../api-client.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';

export interface CapperStatsResponse {
  scope: 'capper' | 'server';
  capper: string | null;
  window: 7 | 14 | 30 | 90;
  sport: string | null;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  roiPct: number | null;
  avgClvPct: number | null;
  beatsLine: number | null;
  picksWithClv: number;
  lastFive: Array<'W' | 'L' | 'P'>;
}

interface StatsApiResponse {
  ok: true;
  data: CapperStatsResponse;
}

export function createStatsCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show settled pick performance for a capper or the full server')
      .addUserOption((option) =>
        option.setName('capper').setDescription('Capper to evaluate').setRequired(false),
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
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const capper = resolveCapperName(interaction);
      const window = (interaction.options.getInteger('window') ?? 30) as 7 | 14 | 30 | 90;
      const sport = normalizeOptionalString(interaction.options.getString('sport'));
      const path = buildStatsPath({
        ...(capper ? { capper } : {}),
        ...(sport ? { sport } : {}),
        window,
      });

      try {
        const response = await apiClient.get<StatsApiResponse>(path);
        await interaction.editReply({
          embeds: [buildStatsEmbed(response.data)],
        });
      } catch (error) {
        const content =
          error instanceof ApiClientError
            ? 'Stats are temporarily unavailable.'
            : 'Stats are temporarily unavailable.';
        await interaction.editReply({
          content,
          embeds: [],
        });
      }
    },
  };
}

export function buildStatsEmbed(stats: CapperStatsResponse) {
  const title =
    stats.scope === 'capper'
      ? `${stats.capper ?? 'Unknown'} · Last ${stats.window} Days${stats.sport ? ` (${stats.sport})` : ''}`
      : `Server · Last ${stats.window} Days${stats.sport ? ` (${stats.sport})` : ''}`;

  const embed = new EmbedBuilder().setTitle(title).setColor(resolveEmbedColor(stats));

  if (stats.picks === 0) {
    embed.setDescription('No settled picks in this window.');
    return embed;
  }

  embed.addFields({
    name: 'Record',
    value: `${stats.wins}-${stats.losses}-${stats.pushes}`,
    inline: true,
  });
  embed.addFields({
    name: 'Win Rate',
    value: formatFractionPercent(stats.winRate),
    inline: true,
  });

  if (stats.picks >= 5) {
    embed.addFields({
      name: 'ROI',
      value: formatSignedPercent(stats.roiPct),
      inline: true,
    });
  }

  if (stats.picks >= 5 && stats.picksWithClv > 0) {
    embed.addFields({
      name: 'Avg CLV% (vs SGO close)',
      value: `${formatSignedPercent(stats.avgClvPct)} (${stats.picksWithClv} picks with closing line data)`,
      inline: false,
    });
    embed.addFields({
      name: 'Beats Line',
      value: formatFractionPercent(stats.beatsLine),
      inline: true,
    });
  }

  if (stats.picks >= 5) {
    embed.addFields({
      name: 'Last 5',
      value: stats.lastFive.join('  '),
      inline: false,
    });
  }

  if (stats.picks < 5) {
    embed.setFooter({
      text: 'Insufficient sample for CLV stats.',
    });
  }

  return embed;
}

function buildStatsPath(input: {
  capper?: string;
  window: 7 | 14 | 30 | 90;
  sport?: string;
}) {
  const params = new URLSearchParams();
  params.set('last', String(input.window));
  if (input.capper) {
    params.set('capper', input.capper);
  }
  if (input.sport) {
    params.set('sport', input.sport);
  }

  return `/api/operator/stats?${params.toString()}`;
}

function resolveCapperName(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('capper');
  if (!user) {
    return undefined;
  }

  const member = interaction.options.getMember('capper');
  if (
    member &&
    typeof member === 'object' &&
    'displayName' in member &&
    typeof member.displayName === 'string' &&
    member.displayName.trim().length > 0
  ) {
    return member.displayName.trim();
  }

  const globalName = user.globalName?.trim();
  return globalName || user.username.trim();
}

function resolveEmbedColor(stats: CapperStatsResponse) {
  if (stats.picks < 10 || stats.winRate === null) {
    return 0x9ca3af;
  }
  if (stats.winRate >= 0.55) {
    return 0x22c55e;
  }
  if (stats.winRate >= 0.45) {
    return 0xeab308;
  }
  return 0xef4444;
}

function formatFractionPercent(value: number | null) {
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

function normalizeOptionalString(value: string | null) {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createStatsCommand(createApiClient(config.apiUrl));
}
