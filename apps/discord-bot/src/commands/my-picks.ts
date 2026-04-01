import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  ApiClientError,
  createApiClient,
  type ApiClient,
  type PicksQueryResponse,
  type QueriedPick,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import type { CommandHandler } from '../command-registry.js';

const MY_PICK_STATUSES = ['validated', 'queued', 'posted', 'settled'];
const PAGE_SIZE = 10;

export function createMyPicksCommand(apiClient: ApiClient): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('my-picks')
      .setDescription('Show picks that match your Discord identity'),
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        const response = apiClient.getPicksByStatus
          ? await apiClient.getPicksByStatus(MY_PICK_STATUSES, 200)
          : await apiClient.get<PicksQueryResponse>(
              `/api/picks?status=${MY_PICK_STATUSES.join(',')}&limit=200`,
            );

        const myPicks = filterPicksForIdentity(response.picks, interaction);
        if (myPicks.length === 0) {
          await interaction.editReply({
            content: 'No picks matched your Discord identity.',
            embeds: [],
          });
          return;
        }

        await interaction.editReply({
          content: '',
          embeds: buildMyPicksEmbeds(myPicks),
        });
      } catch (error) {
        await interaction.editReply({
          content:
            error instanceof ApiClientError
              ? 'My picks is temporarily unavailable.'
              : 'My picks is temporarily unavailable.',
          embeds: [],
        });
      }
    },
  };
}

export function filterPicksForIdentity(
  picks: QueriedPick[],
  interaction: Pick<ChatInputCommandInteraction, 'user' | 'member'>,
) {
  const candidateNames = new Set<string>();
  candidateNames.add(interaction.user.username.trim().toLowerCase());

  const globalName = interaction.user.globalName?.trim().toLowerCase();
  if (globalName) {
    candidateNames.add(globalName);
  }

  const member = interaction.member;
  if (
    member &&
    typeof member === 'object' &&
    'displayName' in member &&
    typeof member.displayName === 'string' &&
    member.displayName.trim().length > 0
  ) {
    candidateNames.add(member.displayName.trim().toLowerCase());
  }

  return picks.filter((pick) => {
    const metadata = asRecord(pick.metadata);
    const submittedBy =
      typeof metadata?.['submittedBy'] === 'string'
        ? metadata['submittedBy']
        : typeof metadata?.['capper'] === 'string'
        ? metadata['capper']
        : null;

    return submittedBy != null && candidateNames.has(submittedBy.trim().toLowerCase());
  });
}

export function buildMyPicksEmbeds(picks: QueriedPick[]) {
  const pages = paginate(picks, PAGE_SIZE);

  return pages.map((page, index) =>
    new EmbedBuilder()
      .setTitle(
        pages.length > 1
          ? `My Picks - Page ${index + 1}/${pages.length}`
          : 'My Picks',
      )
      .setColor(0x8b5cf6)
      .setDescription(
        page
          .map((pick) =>
            [
              `[${pick.status.toUpperCase()}]`,
              `**${pick.selection}**`,
              `(${pick.market})`,
              formatOdds(pick.odds),
            ].join(' '),
          )
          .join('\n'),
      ),
  );
}

function formatOdds(odds: number | null) {
  if (typeof odds !== 'number' || !Number.isFinite(odds)) {
    return '(odds n/a)';
  }

  return odds > 0 ? `(+${odds})` : `(${odds})`;
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
  return createMyPicksCommand(createApiClient(config.apiUrl));
}
