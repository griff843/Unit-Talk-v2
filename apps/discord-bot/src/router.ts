import type { Interaction, ChatInputCommandInteraction } from 'discord.js';
import type { CommandRegistry } from './command-registry.js';
import { checkRoles } from './role-guard.js';
import { buildPrivatePresentation } from '@unit-talk/domain';
import { replyWithPrivateError } from './embeds/presentation.js';

const UNKNOWN_COMMAND_REPLY = 'Unknown command.';
const ACCESS_DENIED_REPLY = "You don't have access to this command.";
const ERROR_REPLY = 'An unexpected error occurred. Please try again later.';
const UNAVAILABLE_REPLY =
  'Service temporarily unavailable - try again shortly.';
const RETIRED_ONBOARDING_BUTTON_IDS = new Set([
  'capper_submit_first_pick',
  'capper_handbook',
  'capper_dashboard',
]);
const RETIRED_ONBOARDING_REPLY =
  'This older onboarding button is no longer available. Open the Unit Talk server and use /help for current commands.';

export { UNAVAILABLE_REPLY };

/**
 * Returns the interactionCreate event handler that dispatches to command handlers.
 *
 * Dispatch order (enforced):
 *   1. Ignore non-chat-input interactions silently
 *   2. Look up command by name in registry
 *      -> not found: reply ephemeral 'Unknown command'
 *   3. Run role guard if command.requiredRoles is defined
 *      -> guard fails: reply ephemeral access denied
 *   4. deferReply({ ephemeral }) <- MUST happen before any I/O
 *   5. command.execute(interaction)
 *   6. On uncaught error: editReply generic message + log full error
 *
 * Ack-within-3s discipline: deferReply() is called before execute() always.
 */
export function createInteractionHandler(
  registry: CommandRegistry,
  logger: { error(msg: string, err?: unknown): void } = console,
) {
  return async (interaction: Interaction): Promise<void> => {
    if (typeof interaction.isButton === 'function' && interaction.isButton()) {
      const isCurrentBotMessage =
        RETIRED_ONBOARDING_BUTTON_IDS.has(interaction.customId) &&
        typeof interaction.message?.author?.id === 'string' &&
        interaction.message.author.id.length > 0 &&
        typeof interaction.client?.user?.id === 'string' &&
        interaction.client.user.id.length > 0 &&
        interaction.message.author.id === interaction.client.user.id;

      if (!isCurrentBotMessage || interaction.replied || interaction.deferred) {
        return;
      }

      try {
        await interaction.reply({
          content: RETIRED_ONBOARDING_REPLY,
          ...(interaction.inGuild() ? { ephemeral: true } : {}),
        });
      } catch {
        logger.error('[router] Retired onboarding button reply failed');
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = registry.get(interaction.commandName);

    if (!command) {
      await interaction.reply(
        buildPrivatePresentation('bot-error', UNKNOWN_COMMAND_REPLY),
      );
      return;
    }

    if (
      command.requiredRoles !== undefined &&
      !checkRoles(
        interaction as ChatInputCommandInteraction,
        command.requiredRoles,
      )
    ) {
      await interaction.reply(
        buildPrivatePresentation('access-denied', ACCESS_DENIED_REPLY),
      );
      return;
    }

    const isEphemeral = command.responseVisibility !== 'public';

    // deferReply MUST happen before any async work (ack-within-3s discipline)
    await interaction.deferReply({ ephemeral: isEphemeral });

    try {
      await command.execute(interaction as ChatInputCommandInteraction);
    } catch (err) {
      logger.error('[router] Command execute error', err);
      await replyWithPrivateError(
        interaction as ChatInputCommandInteraction,
        ERROR_REPLY,
        !isEphemeral,
      );
    }
  };
}
