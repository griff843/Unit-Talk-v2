import {
  createMemberEmbed,
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
            content: '',
            embeds: [
              createMemberEmbed('service-alert').setDescription(
                'No settled picks found.',
              ),
            ],
          });
          return;
        }

        await replyWithPages(
          interaction,
          buildCapperRecapEmbeds(response.data),
        );
      } catch (error) {
        const content =
          error instanceof ApiClientError
            ? 'Recap is temporarily unavailable.'
            : 'Recap is temporarily unavailable.';
        await replyWithPrivateError(interaction, content);
      }
    },
  };
}

export function buildCapperRecapEmbed(recap: CapperRecapResponse) {
  return buildCapperRecapEmbeds(recap)[0]!;
}
export function buildCapperRecapEmbeds(recap: CapperRecapResponse) {
  return memberPages('capper-record', {
    title: `${recap.submittedBy} · Last ${recap.picks.length} Settled Picks`,
    fields: recap.picks.map((pick) => {
      const data = buildRecapEmbedData({
        ...pick,
        submittedBy: recap.submittedBy,
        settledAt: pick.settledAt,
      });
      const values = data.fields
        .filter((field) => field.name !== 'Capper')
        .map(
          (field) =>
            `${field.name === 'CLV% (vs SGO close)' ? 'CLV' : field.name}: ${field.value}`,
        );
      return {
        name: `${mapResultToToken(pick.result)} · ${formatSettledAt(pick.settledAt)}`,
        value: values.join('\n'),
      };
    }),
  });
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
  return createRecapCommand(createApiClient(config.apiUrl, config.apiKey));
}
