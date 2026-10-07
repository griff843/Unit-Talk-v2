import { createMemberEmbed } from '../embeds/presentation.js';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  createApiClient,
  type ApiClient,
  type QueriedPick,
} from '../api-client.js';
import { loadBotConfig } from '../config.js';
import { requireActivePickRoles } from '../role-guard.js';
import type { CommandHandler } from '../command-registry.js';

const PAGE_SIZE = 10;
const UNAVAILABLE_MESSAGE =
  'My picks is unavailable until Discord accounts are linked to a canonical member identity.';

export function createMyPicksCommand(
  _apiClient: ApiClient,
  requiredRoles: string[] = ['__active_pick_roles_not_configured__'],
): CommandHandler {
  return {
    requiredRoles,
    data: new SlashCommandBuilder()
      .setName('my-picks')
      .setDescription('Show picks that match your Discord identity'),
    responseVisibility: 'private',
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      await interaction.editReply({
        content: '',
        embeds: [createMemberEmbed().setDescription(UNAVAILABLE_MESSAGE)],
      });
    },
  };
}

export function buildMyPicksEmbeds(picks: QueriedPick[]) {
  const pages = paginate(picks, PAGE_SIZE);

  return pages.map((page, index) =>
    createMemberEmbed()
      .setTitle(
        pages.length > 1
          ? `My Picks - Page ${index + 1}/${pages.length}`
          : 'My Picks',
      )

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
    return '';
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

export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createMyPicksCommand(
    createApiClient(config.apiUrl, config.apiKey),
    requireActivePickRoles(config),
  );
}
