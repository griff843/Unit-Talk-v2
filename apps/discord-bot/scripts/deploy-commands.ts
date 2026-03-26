import { REST, Routes } from 'discord.js';
import { loadCommandRegistry } from '../src/command-registry.js';
import { loadBotConfig } from '../src/config.js';

async function deployCommands() {
  const config = loadBotConfig();
  const registry = await loadCommandRegistry();
  const payloads = [...registry.values()].map((command) => command.data.toJSON());

  const rest = new REST().setToken(config.token);
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: payloads },
  );

  console.log(`[deploy-commands] Successfully registered ${payloads.length} command(s).`);
}

deployCommands().catch((error: unknown) => {
  console.error('[deploy-commands] Failed:', error);
  process.exit(1);
});
