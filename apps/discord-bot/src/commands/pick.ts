import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SubmissionPayload } from '@unit-talk/contracts';
import { createApiClient, ApiClientError, type ApiClient } from '../api-client.js';
import { loadBotConfig } from '../config.js';
import { UNAVAILABLE_REPLY } from '../router.js';
import type { CommandHandler } from '../command-registry.js';

interface SubmitPickApiResponse {
  ok: true;
  data: {
    submissionId: string;
    pickId: string;
  };
}

interface ApiErrorShape {
  ok?: false;
  error?: {
    message?: string;
  };
}

type PickInteractionOptions = Pick<ChatInputCommandInteraction, 'options' | 'user'>;

export function createPickCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('pick')
      .setDescription('Submit a pick directly through the canonical API path')
      .addStringOption((option) =>
        option
          .setName('market')
          .setDescription('Market label, e.g. NBA - Moneyline')
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName('selection')
          .setDescription('Selection text to submit')
          .setRequired(true)
          .setMaxLength(100),
      )
      .addIntegerOption((option) =>
        option
          .setName('odds')
          .setDescription('American odds, e.g. -110 or 150')
          .setRequired(true)
          .setMinValue(-50000)
          .setMaxValue(50000),
      )
      .addNumberOption((option) =>
        option
          .setName('stake_units')
          .setDescription('Stake in units')
          .setRequired(true)
          .setMinValue(0.01)
          .setMaxValue(1000),
      )
      .addStringOption((option) =>
        option
          .setName('event_name')
          .setDescription('Optional event or matchup label')
          .setRequired(false)
          .setMaxLength(100),
      ),
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        const payload = parsePickSubmission(interaction);
        const response = await apiClient.post<SubmitPickApiResponse>(
          '/api/submissions',
          payload,
        );

        await interaction.editReply({
          content: '',
          embeds: [buildSuccessEmbed(response.data, payload)],
        });
      } catch (error) {
        await interaction.editReply({
          content: formatFailureReply(error),
          embeds: [],
        });
      }
    },
  };
}

export function parsePickSubmission(
  interaction: PickInteractionOptions,
): SubmissionPayload {
  return {
    source: 'discord-bot',
    submittedBy: interaction.user.username.trim(),
    market: readRequiredString(interaction, 'market'),
    selection: readRequiredString(interaction, 'selection'),
    odds: readOdds(interaction),
    stakeUnits: readStakeUnits(interaction),
    eventName: readOptionalString(interaction, 'event_name'),
  };
}

function buildSuccessEmbed(
  data: SubmitPickApiResponse['data'],
  payload: SubmissionPayload,
) {
  return new EmbedBuilder()
    .setTitle('Pick Submitted')
    .setColor(0x22c55e)
    .addFields(
      { name: 'Submission ID', value: data.submissionId, inline: false },
      { name: 'Pick ID', value: data.pickId, inline: false },
      { name: 'Market', value: payload.market, inline: false },
      { name: 'Selection', value: payload.selection, inline: false },
    );
}

function readRequiredString(
  interaction: PickInteractionOptions,
  name: string,
): string {
  const value = interaction.options.getString(name, true).trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function readOptionalString(
  interaction: PickInteractionOptions,
  name: string,
): string | undefined {
  const value = interaction.options.getString(name);
  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOdds(interaction: PickInteractionOptions): number {
  const odds = interaction.options.getInteger('odds', true);
  if (odds === 0 || Math.abs(odds) < 100 || Math.abs(odds) > 50000) {
    throw new Error('odds must be an American odds integer between -50000 and 50000, excluding 0.');
  }

  return odds;
}

function readStakeUnits(interaction: PickInteractionOptions): number {
  const stakeUnits = interaction.options.getNumber('stake_units', true);
  if (!Number.isFinite(stakeUnits) || stakeUnits <= 0) {
    throw new Error('stake_units must be a positive number.');
  }

  return stakeUnits;
}

function formatFailureReply(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status == null) {
      return UNAVAILABLE_REPLY;
    }

    const apiMessage = extractApiErrorMessage(error.detail);
    if (apiMessage) {
      return `Pick submission failed: ${apiMessage}`;
    }

    return `Pick submission failed: API returned ${error.status}.`;
  }

  if (error instanceof Error) {
    return `Pick submission failed: ${error.message}`;
  }

  return 'Pick submission failed. Please try again later.';
}

function extractApiErrorMessage(detail?: string): string | null {
  if (!detail) {
    return null;
  }

  try {
    const parsed = JSON.parse(detail) as ApiErrorShape;
    return parsed.error?.message?.trim() || null;
  } catch {
    return detail.trim() || null;
  }
}

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createPickCommand(createApiClient(config.apiUrl));
}
