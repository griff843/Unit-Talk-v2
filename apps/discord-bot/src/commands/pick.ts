import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  V1_REFERENCE_DATA,
  type MarketTypeId,
} from '@unit-talk/contracts';
import type { SubmissionPayload } from '@unit-talk/contracts';
import { createApiClient, ApiClientError, type ApiClient } from '../api-client.js';
import { loadBotConfig } from '../config.js';
import { UNAVAILABLE_REPLY } from '../router.js';
import type { CommandHandler } from '../command-registry.js';

const MARKET_TYPE_LABELS: Record<MarketTypeId, string> = {
  'player-prop': 'Player Prop',
  moneyline: 'Moneyline',
  spread: 'Spread',
  total: 'Total',
  'team-total': 'Team Total',
};

const INVALID_PICK_REPLY_PREFIX = 'Pick submission failed:';
const SUCCESS_PREFIX = 'Pick submitted.';

interface SubmitPickApiResponse {
  ok: true;
  data: {
    submissionId: string;
    pickId: string;
    lifecycleState: string;
    promotionStatus: string;
    promotionTarget: string | null;
    outboxEnqueued: boolean;
  };
}

interface ApiErrorShape {
  ok?: false;
  error?: {
    message?: string;
  };
}

export function createPickCommand(
  apiClient: ApiClient,
  capperRoleId: string,
): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('pick')
      .setDescription('Submit a capper pick through the canonical API path')
      .addStringOption((option) =>
        option
          .setName('sport')
          .setDescription('Sport')
          .setRequired(true)
          .addChoices(...V1_REFERENCE_DATA.sports.map((sport) => ({
            name: sport.name,
            value: sport.id,
          }))),
      )
      .addStringOption((option) =>
        option
          .setName('market_type')
          .setDescription('Market type')
          .setRequired(true)
          .addChoices(
            ...Object.entries(MARKET_TYPE_LABELS).map(([value, name]) => ({
              name,
              value,
            })),
          ),
      )
      .addStringOption((option) =>
        option
          .setName('event_name')
          .setDescription('Matchup or event')
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName('selection')
          .setDescription('Selection text exactly as you want it submitted')
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
          .setName('units')
          .setDescription('Stake in units')
          .setRequired(true)
          .setMinValue(0.5)
          .setMaxValue(5),
      )
      .addIntegerOption((option) =>
        option
          .setName('conviction')
          .setDescription('Capper conviction from 1 to 10')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(10),
      )
      .addNumberOption((option) =>
        option
          .setName('line')
          .setDescription('Optional line, e.g. 27.5 or -3.5')
          .setRequired(false)
          .setMinValue(-999.5)
          .setMaxValue(999.5),
      )
      .addStringOption((option) =>
        option
          .setName('sportsbook')
          .setDescription('Optional sportsbook')
          .setRequired(false)
          .addChoices(...V1_REFERENCE_DATA.sportsbooks.map((sportsbook) => ({
            name: sportsbook.name,
            value: sportsbook.id,
          }))),
      ),
    requiredRoles: [capperRoleId],
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const payload = parsePickSubmission(interaction);

      try {
        const response = await apiClient.post<SubmitPickApiResponse>(
          '/api/submissions',
          payload,
        );

        await interaction.editReply({
          content: formatSuccessReply(response.data),
        });
      } catch (error) {
        await interaction.editReply({
          content: formatFailureReply(error),
        });
      }
    },
  };
}

export function parsePickSubmission(
  interaction: PickInteractionOptions,
): SubmissionPayload {
  const sport = readRequiredString(interaction, 'sport');
  const marketType = readMarketType(interaction);
  const eventName = readRequiredString(interaction, 'event_name');
  const selection = readRequiredString(interaction, 'selection');
  const odds = readOdds(interaction);
  const units = readUnits(interaction);
  const conviction = readConviction(interaction);
  const line = readOptionalLine(interaction);
  const sportsbook = readOptionalString(interaction, 'sportsbook');
  const capper = resolveCapperName(interaction);

  return {
    source: 'discord-bot',
    submittedBy: capper,
    market: `${sport} - ${MARKET_TYPE_LABELS[marketType]}`,
    selection,
    line,
    odds,
    stakeUnits: units,
    eventName,
    metadata: {
      ticketType: 'single',
      sport,
      marketType,
      capper,
      sportsbook,
      eventName,
      promotionScores: {
        trust: conviction * 10,
      },
    },
  };
}

type PickInteractionOptions = Pick<
  ChatInputCommandInteraction,
  'options' | 'user' | 'member'
>;

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

function readMarketType(interaction: PickInteractionOptions): MarketTypeId {
  const marketType = readRequiredString(interaction, 'market_type');
  if (!(marketType in MARKET_TYPE_LABELS)) {
    throw new Error('market_type must be one of the supported V2 market types.');
  }

  return marketType as MarketTypeId;
}

function readOdds(interaction: PickInteractionOptions): number {
  const odds = interaction.options.getInteger('odds', true);
  if (odds === 0 || Math.abs(odds) < 100 || Math.abs(odds) > 50000) {
    throw new Error('odds must be an American odds integer between -50000 and 50000, excluding 0.');
  }

  return odds;
}

function readUnits(interaction: PickInteractionOptions): number {
  const units = interaction.options.getNumber('units', true);
  if (units < 0.5 || units > 5) {
    throw new Error('units must be between 0.5 and 5.0.');
  }

  return units;
}

function readConviction(interaction: PickInteractionOptions): number {
  const conviction = interaction.options.getInteger('conviction', true);
  if (conviction < 1 || conviction > 10) {
    throw new Error('conviction must be between 1 and 10.');
  }

  return conviction;
}

function readOptionalLine(interaction: PickInteractionOptions): number | undefined {
  const line = interaction.options.getNumber('line');
  if (line == null) {
    return undefined;
  }

  if (Math.abs(line) > 999.5) {
    throw new Error('line must be between -999.5 and 999.5.');
  }

  return line;
}

function resolveCapperName(interaction: PickInteractionOptions): string {
  const member = interaction.member;
  if (
    member &&
    typeof member === 'object' &&
    'displayName' in member &&
    typeof member.displayName === 'string' &&
    member.displayName.trim().length > 0
  ) {
    return member.displayName.trim();
  }

  const globalName = interaction.user.globalName?.trim();
  if (globalName) {
    return globalName;
  }

  return interaction.user.username.trim();
}

function formatSuccessReply(data: SubmitPickApiResponse['data']): string {
  const target = data.promotionTarget ?? 'manual lane';
  const enqueueState = data.outboxEnqueued ? 'yes' : 'no';

  return [
    SUCCESS_PREFIX,
    `Submission ID: ${data.submissionId}`,
    `Pick ID: ${data.pickId}`,
    `Lifecycle: ${data.lifecycleState}`,
    `Promotion: ${data.promotionStatus}`,
    `Target: ${target}`,
    `Outbox enqueued: ${enqueueState}`,
  ].join('\n');
}

function formatFailureReply(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status == null) {
      return UNAVAILABLE_REPLY;
    }

    const apiMessage = extractApiErrorMessage(error.detail);
    if (apiMessage) {
      return `${INVALID_PICK_REPLY_PREFIX} ${apiMessage}`;
    }

    return `${INVALID_PICK_REPLY_PREFIX} API returned ${error.status}.`;
  }

  if (error instanceof Error) {
    return `${INVALID_PICK_REPLY_PREFIX} ${error.message}`;
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
  const apiClient = createApiClient(config.apiUrl);
  return createPickCommand(apiClient, config.capperRoleId);
}
