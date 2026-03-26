/**
 * Guild-scoped slash command registration script.
 *
 * Usage: pnpm --filter @unit-talk/discord-bot deploy-commands
 *   (or: tsx scripts/deploy-commands.ts)
 *
 * Registration flow:
 *   1. Load config - same required vars as bot startup
 *   2. Import all CommandHandler modules from src/commands/
 *   3. Extract command.data.toJSON() from each handler
 *   4. REST PUT /applications/{CLIENT_ID}/guilds/{GUILD_ID}/commands
 *      (full replace - idempotent; removes stale commands automatically)
 *   5. Log count of registered commands on success
 *
 * Guild-scoped only - global registration requires a separate explicit decision.
 * Deploy-time operation only - the bot process never registers commands at login.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { REST, Routes } from 'discord.js';
import { loadEnvironment } from '@unit-talk/config';
import { parseBotConfig } from '../src/config.js';
import { loadCommandRegistry } from '../src/command-registry.js';

// Compute repo root from this script's location so deploy-commands works
// regardless of the working directory (e.g., when run via `pnpm --filter`).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function deployCommands(): Promise<void> {
  const config = parseBotConfig(loadEnvironment(repoRoot));
  const registry = await loadCommandRegistry(repoRoot);

  const commandPayloads = [...registry.values()].map((cmd) => cmd.data.toJSON());

  console.log(
    `[deploy-commands] Deploying ${commandPayloads.length} command(s) to guild ${config.guildId}...`,
  );

  const rest = new REST().setToken(config.token);

  const data = await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commandPayloads },
  );

  const count = Array.isArray(data) ? data.length : 0;
  console.log(`[deploy-commands] Successfully registered ${count} command(s).`);
}

deployCommands().catch((err: unknown) => {
  console.error('[deploy-commands] Failed:', err);
  process.exit(1);
});
