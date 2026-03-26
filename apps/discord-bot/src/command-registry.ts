import type {
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * Typed contract that every command module must satisfy.
 * Command handlers are loaded from ./commands/ at startup.
 * The registry is immutable at runtime.
 */
export interface CommandHandler {
  /** discord.js builder - name, description, options */
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  /** Interaction handler. deferReply() must already be called by the router. */
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** Discord role IDs. If present, role guard runs before execute(). */
  requiredRoles?: string[] | undefined;
}

/** Keyed by slash command name. Immutable after startup. */
export type CommandRegistry = Map<string, CommandHandler>;

interface CommandModule {
  default?: CommandHandler;
  createDefaultCommand?: (rootDir?: string) => CommandHandler;
}

/**
 * Loads all command modules from the ./commands/ directory relative to this
 * file and returns an immutable Map keyed by command name.
 *
 * Handles the empty-directory case gracefully (returns empty registry).
 * Loads .ts modules under tsx-driven source execution and .js modules after build.
 */
export async function loadCommandRegistry(rootDir?: string): Promise<CommandRegistry> {
  const registry = new Map<string, CommandHandler>();
  const thisDir = fileURLToPath(new URL('.', import.meta.url));
  const commandsDir = join(thisDir, 'commands');

  let files: string[];
  try {
    files = await readdir(commandsDir);
  } catch {
    // commands/ directory missing or unreadable - valid at foundation stage
    return registry;
  }

  const commandFiles = files.filter((file) => {
    if (file.endsWith('.d.ts') || file.endsWith('.map')) {
      return false;
    }

    return file.endsWith('.js') || file.endsWith('.ts');
  });

  for (const file of commandFiles) {
    const filePath = join(commandsDir, file);
    const module = (await import(pathToFileURL(filePath).href)) as CommandModule;
    const handler = module.default ?? module.createDefaultCommand?.(rootDir);
    if (handler?.data?.name) {
      registry.set(handler.data.name, handler);
    }
  }

  return registry;
}
