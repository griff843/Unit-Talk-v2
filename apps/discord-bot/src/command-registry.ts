import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { createPickCommand } from './commands/pick.js';
import { createApiClient } from './api-client.js';
import { loadEnvironment } from '@unit-talk/config';
import { parseBotConfig } from './config.js';

export interface CommandHandler {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  requiredRoles?: string[];
}

export type CommandRegistry = Map<string, CommandHandler>;

export async function loadCommandRegistry(): Promise<CommandRegistry> {
  const env = loadEnvironment();
  const config = parseBotConfig(env);
  const apiClient = createApiClient(config.apiUrl);

  const registry: CommandRegistry = new Map();

  const pickCommand = createPickCommand(apiClient, config.capperRoleId);
  registry.set(pickCommand.data.name, pickCommand);

  return registry;
}
