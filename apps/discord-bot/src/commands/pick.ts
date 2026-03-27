import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { SlashCommandBuilder as Builder } from 'discord.js';
import type { ApiClient } from '../api-client.js';
import { ApiClientError } from '../api-client.js';
import { UNAVAILABLE_REPLY } from '../router.js';
import type { CommandHandler } from '../command-registry.js';

function formatMarketType(raw: string): string {
  return raw
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export interface PickSubmissionPayload {
  source: string;
  submittedBy: string;
  market: string;
  selection: string;
  line: number | undefined;
  odds: number;
  stakeUnits: number;
  eventName: string;
  metadata: {
    ticketType: string;
    sport: string;
    marketType: string;
    capper: string;
    sportsbook?: string;
    eventName: string;
    promotionScores: { trust: number };
  };
}

export function parsePickSubmission(
  interaction: ChatInputCommandInteraction,
): PickSubmissionPayload {
  const sport = interaction.options.getString('sport', true);
  const marketType = interaction.options.getString('market_type', true);
  const eventName = interaction.options.getString('event_name', true);
  const selection = interaction.options.getString('selection', true);
  const odds = interaction.options.getInteger('odds', true);
  const units = interaction.options.getNumber('units', true);
  const conviction = interaction.options.getInteger('conviction', true);
  const line = interaction.options.getNumber('line') ?? undefined;
  const sportsbook = interaction.options.getString('sportsbook') ?? undefined;

  if (odds > -100 && odds < 100) {
    throw new Error('odds must be an American odds integer (e.g. -110, +150)');
  }

  if (units < 0.5 || units > 5.0) {
    throw new Error('units must be between 0.5 and 5.0');
  }

  const capper =
    (interaction.member as { displayName?: string } | null)?.displayName ??
    interaction.user.globalName ??
    interaction.user.username;

  return {
    source: 'discord-bot',
    submittedBy: capper,
    market: `${sport} - ${formatMarketType(marketType)}`,
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
      ...(sportsbook !== undefined ? { sportsbook } : {}),
      eventName,
      promotionScores: {
        trust: conviction * 10,
      },
    },
  };
}

export function createPickCommand(apiClient: ApiClient, capperRoleId: string): CommandHandler {
  const data = new Builder()
    .setName('pick')
    .setDescription('Submit a pick for distribution')
    .addStringOption((o) => o.setName('sport').setDescription('Sport (e.g. NBA, NFL)').setRequired(true))
    .addStringOption((o) => o.setName('market_type').setDescription('Market type').setRequired(true))
    .addStringOption((o) => o.setName('event_name').setDescription('Event name').setRequired(true))
    .addStringOption((o) => o.setName('selection').setDescription('Your pick selection').setRequired(true))
    .addIntegerOption((o) => o.setName('odds').setDescription('American odds').setRequired(true))
    .addNumberOption((o) => o.setName('units').setDescription('Units (0.5–5.0)').setRequired(true))
    .addIntegerOption((o) => o.setName('conviction').setDescription('Conviction score 1–10').setRequired(true))
    .addNumberOption((o) => o.setName('line').setDescription('Line (optional)'))
    .addStringOption((o) => o.setName('sportsbook').setDescription('Sportsbook (optional)'));

  return {
    data: data as unknown as SlashCommandBuilder,
    requiredRoles: [capperRoleId],
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      let payload: PickSubmissionPayload;
      try {
        payload = parsePickSubmission(interaction);
      } catch (err) {
        await interaction.editReply({
          content: err instanceof Error ? err.message : 'Invalid input.',
        });
        return;
      }

      try {
        const result = await apiClient.post<{
          ok: boolean;
          submissionId: string;
          pickId: string;
        }>('/api/submissions', payload);

        await interaction.editReply({
          content: `Pick submitted.\nSubmission ID: ${result.submissionId}\nPick ID: ${result.pickId}`,
        });
      } catch (err) {
        if (err instanceof ApiClientError && err.status !== undefined && err.detail) {
          try {
            const parsed = JSON.parse(err.detail) as {
              error?: { message?: string };
            };
            const message = parsed.error?.message;
            if (message) {
              await interaction.editReply({
                content: `Pick submission failed: ${message}`,
              });
              return;
            }
          } catch {
            // fall through to unavailable reply
          }
        }
        await interaction.editReply({ content: UNAVAILABLE_REPLY });
      }
    },
  };
}
