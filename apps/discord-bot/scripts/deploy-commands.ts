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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { REST, Routes } from 'discord.js';
import { loadEnvironment } from '@unit-talk/config';
import { parseBotConfig } from '../src/config.js';
import { buildCommandManifest } from '../src/command-manifest.js';
import { isDeepStrictEqual } from 'node:util';

type CommandPayload = Awaited<ReturnType<typeof buildCommandManifest>>[number];
interface RegistrationRest {
  get(route: `/${string}`): Promise<unknown>;
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Discord adds server-owned IDs/defaults to its response. Compare every field
// authored by the builder, including nested options and choices.
function authoredFields(actual: unknown, expected: unknown): unknown {
  if (Array.isArray(expected)) {
    if (expected.length === 0 && actual === undefined) return [];
    if (!Array.isArray(actual)) return actual;
    return actual.map((value, index) => authoredFields(value, expected[index]));
  }
  if (!record(expected) || !record(actual)) return actual;
  return Object.fromEntries(
    Object.entries(expected).map(([key, value]) => [
      key,
      actual[key] === undefined &&
      value === false &&
      ['required', 'autocomplete'].includes(key)
        ? false
        : authoredFields(actual[key], value),
    ]),
  );
}

export async function registerGuildCommands(
  rest: RegistrationRest,
  config: { clientId: string; guildId: string },
  payloads: CommandPayload[],
) {
  if (payloads.length === 0)
    throw new Error('Refusing an empty command manifest');
  // REST omits builder fields whose value is undefined. Verify that same
  // serialized definition rather than treating server defaults as drift.
  const definitions = JSON.parse(JSON.stringify(payloads)) as CommandPayload[];
  const application = await rest.get(Routes.oauth2CurrentApplication());
  if (!record(application) || application.id !== config.clientId) {
    throw new Error('Token application does not match configured application');
  }
  const route = Routes.applicationGuildCommands(
    config.clientId,
    config.guildId,
  );
  // Existing full replacement removes stale guild commands; never use global routes.
  await rest.put(route, { body: definitions });
  const inventory = await rest.get(route);
  if (!Array.isArray(inventory) || inventory.length !== payloads.length) {
    throw new Error('Guild command inventory count does not match manifest');
  }
  for (const expected of definitions) {
    const matches = inventory.filter(
      (item: unknown) => record(item) && item.name === expected.name,
    );
    const actual: unknown = matches[0];
    if (
      matches.length !== 1 ||
      !record(actual) ||
      actual.application_id !== config.clientId ||
      (actual.guild_id !== undefined && actual.guild_id !== config.guildId) ||
      !isDeepStrictEqual(authoredFields(actual, expected), expected)
    ) {
      throw new Error('Guild command inventory does not match manifest');
    }
  }
  return {
    applicationId: config.clientId,
    guildId: config.guildId,
    count: inventory.length,
    commands: payloads.map((command) => command.name).sort(),
  };
}

// Compute repo root from this script's location so deploy-commands works
// regardless of the working directory (e.g., when run via `pnpm --filter`).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function deployCommands(): Promise<void> {
  const config = parseBotConfig(loadEnvironment(repoRoot));
  const commandPayloads = await buildCommandManifest(repoRoot);

  console.log(
    `[deploy-commands] Deploying ${commandPayloads.length} command(s) to guild ${config.guildId}...`,
  );

  const rest = new REST().setToken(config.token);

  const result = await registerGuildCommands(rest, config, commandPayloads);
  console.log(
    JSON.stringify({ event: 'discord.guild_commands.verified', ...result }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  deployCommands().catch(() => {
    // REST errors can carry request bodies/headers. Never print raw errors or credentials.
    console.error(
      '[deploy-commands] FAILED: production guild command registration was not verified.',
    );
    process.exitCode = 1;
  });
}
