import type { Interaction, ChatInputCommandInteraction } from 'discord.js';
import type { CommandRegistry } from './command-registry.js';
import { checkRoles } from './role-guard.js';

const UNKNOWN_COMMAND_REPLY = 'Unknown command.';
const ACCESS_DENIED_REPLY = "You don't have access to this command.";
const ERROR_REPLY = 'An unexpected error occurred. Please try again later.';
const UNAVAILABLE_REPLY = 'Service temporarily unavailable - try again shortly.';

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
 *   4. deferReply({ ephemeral: true }) <- MUST happen before any I/O
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
    if (!interaction.isChatInputCommand()) return;

    const command = registry.get(interaction.commandName);

    if (!command) {
      await interaction.reply({ content: UNKNOWN_COMMAND_REPLY, ephemeral: true });
      return;
    }

    if (
      command.requiredRoles !== undefined &&
      !checkRoles(interaction as ChatInputCommandInteraction, command.requiredRoles)
    ) {
      await interaction.reply({ content: ACCESS_DENIED_REPLY, ephemeral: true });
      return;
    }

    // deferReply MUST happen before any async work (ack-within-3s discipline)
    await interaction.deferReply({ ephemeral: true });

    try {
      await command.execute(interaction as ChatInputCommandInteraction);
    } catch (err) {
      logger.error('[router] Command execute error', err);
      await interaction.editReply({ content: ERROR_REPLY });
    }
  };
}
