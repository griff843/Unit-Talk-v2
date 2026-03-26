import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface CommandHandler {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  requiredRoles?: string[] | undefined;
}

export type CommandRegistry = Map<string, CommandHandler>;

interface CommandModule {
  default?: CommandHandler;
  createDefaultCommand?: () => CommandHandler;
}

export async function loadCommandRegistry(): Promise<CommandRegistry> {
  const registry = new Map<string, CommandHandler>();
  const thisDir = fileURLToPath(new URL('.', import.meta.url));
  const commandsDir = join(thisDir, 'commands');

  let files: string[];
  try {
    files = await readdir(commandsDir);
  } catch {
    return registry;
  }

  const commandFiles = files.filter(
    (file) =>
      !file.endsWith('.d.ts') &&
      !file.endsWith('.map') &&
      (file.endsWith('.ts') || file.endsWith('.js')),
  );

  for (const file of commandFiles) {
    const module = (await import(pathToFileURL(join(commandsDir, file)).href)) as CommandModule;
    const handler = module.default ?? module.createDefaultCommand?.();
    if (handler?.data?.name) {
      registry.set(handler.data.name, handler);
    }
  }

  return registry;
}
