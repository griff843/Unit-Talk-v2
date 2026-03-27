import {
  EmbedBuilder,
  SlashCommandBuilder,
  type APIEmbedField,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { ApiClientError, createApiClient, type ApiClient } from '../api-client.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';
import { buildRecapEmbedData } from '../embeds/recap-embed.js';

export interface CapperRecapPick {
  market: string;
  selection: string;
  result: 'win' | 'loss' | 'push';
  profitLossUnits: number;
  clvPercent: number | null;
  stakeUnits: number | null;
  settledAt: string;
}

export interface CapperRecapResponse {
  submittedBy: string;
  picks: CapperRecapPick[];
}

interface CapperRecapApiResponse {
  ok: true;
  data: CapperRecapResponse;
}

export function createRecapCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('recap')
      .setDescription('Show your last settled picks')
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription('Number of settled picks to show')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(20),
      ),
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const submittedBy = resolveSubmittedBy(interaction);
      const limit = interaction.options.getInteger('limit') ?? 10;

      try {
        const response = await apiClient.get<CapperRecapApiResponse>(
          buildCapperRecapPath({ submittedBy, limit }),
        );

        if (response.data.picks.length === 0) {
          await interaction.editReply({
            content: 'No settled picks found.',
            embeds: [],
          });
          return;
        }

        await interaction.editReply({
          content: '',
          embeds: [buildCapperRecapEmbed(response.data)],
        });
      } catch (error) {
        const content =
          error instanceof ApiClientError
            ? 'Recap is temporarily unavailable.'
            : 'Recap is temporarily unavailable.';
        await interaction.editReply({
          content,
          embeds: [],
        });
      }
    },
  };
}

export function buildCapperRecapEmbed(recap: CapperRecapResponse) {
  return new EmbedBuilder()
    .setTitle(`${recap.submittedBy} · Last ${recap.picks.length} Settled Picks`)
    .setColor(resolveSummaryColor(recap.picks))
    .addFields(recap.picks.map(buildRecapField));
}

function buildCapperRecapPath(input: { submittedBy: string; limit: number }) {
  const params = new URLSearchParams();
  params.set('submittedBy', input.submittedBy);
  params.set('limit', String(input.limit));
  return `/api/operator/capper-recap?${params.toString()}`;
}

function resolveSubmittedBy(interaction: ChatInputCommandInteraction) {
  const member = interaction.member;
  if (
    member &&
    typeof member === 'object' &&
    'displayName' in member &&
    typeof member.displayName === 'string'
  ) {
    const displayName = member.displayName.trim();
    if (displayName.length > 0) {
      return displayName;
    }
  }

  return interaction.user.username.trim();
}

function buildRecapField(pick: CapperRecapPick): APIEmbedField {
  const embedData = buildRecapEmbedData({
    market: pick.market,
    selection: pick.selection,
    result: pick.result,
    stakeUnits: pick.stakeUnits,
    profitLossUnits: pick.profitLossUnits,
    clvPercent: pick.clvPercent,
    submittedBy: '',
  });

  const fields = new Map(
    (embedData.fields ?? []).map((field) => [field.name, String(field.value)] as const),
  );

  return {
    name: `${mapResultToToken(pick.result)} · ${fields.get('P/L') ?? '0.0u'} · ${formatSettledAt(pick.settledAt)}`,
    value: [
      `**${fields.get('Market') ?? pick.market}**`,
      fields.get('Selection') ?? pick.selection,
      `P/L: ${fields.get('P/L') ?? '0.0u'}`,
      `CLV: ${fields.get('CLV%') ?? '—'}`,
      `Stake: ${fields.get('Stake') ?? '—'}`,
    ].join('\n'),
    inline: false,
  };
}

function resolveSummaryColor(picks: CapperRecapPick[]) {
  const firstResult = picks[0]?.result;
  if (firstResult === 'win') {
    return 0x22c55e;
  }
  if (firstResult === 'loss') {
    return 0xef4444;
  }
  return 0x9ca3af;
}

function mapResultToToken(result: CapperRecapPick['result']) {
  if (result === 'win') {
    return 'W';
  }
  if (result === 'loss') {
    return 'L';
  }
  return 'P';
}

function formatSettledAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createRecapCommand(createApiClient(config.apiUrl));
}
