import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommandManifest } from '../src/command-manifest.js';
import { manifestContentsMatch } from '../src/command-manifest-file.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestPath = resolve(repoRoot, 'apps/discord-bot/command-manifest.json');

async function main() {
  const mode = process.argv.includes('--check') ? 'check' : 'write';
  primeManifestEnvironment();
  const manifest = await buildCommandManifest(repoRoot);
  const nextContent = `${JSON.stringify(manifest, null, 2)}\n`;

  if (mode === 'write') {
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, nextContent, 'utf8');
    console.log(
      `[command-manifest] Wrote ${manifest.length} command definition(s) to ${manifestPath}`,
    );
    process.exit(0);
    return;
  }

  let existingContent = '';
  try {
    existingContent = await readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(
      `Command manifest missing at ${manifestPath}. Run pnpm --filter @unit-talk/discord-bot command-manifest:write.`,
    );
  }

  if (!manifestContentsMatch(existingContent, nextContent)) {
    throw new Error(
      'Discord command manifest is out of date. Run pnpm --filter @unit-talk/discord-bot command-manifest:write.',
    );
  }

  console.log(
    `[command-manifest] Verified ${manifest.length} command definition(s) against ${manifestPath}`,
  );
  process.exit(0);
}

function primeManifestEnvironment() {
  const defaults: Record<string, string> = {
    DISCORD_BOT_TOKEN: 'manifest-token',
    DISCORD_CLIENT_ID: 'manifest-client-id',
    DISCORD_GUILD_ID: 'manifest-guild-id',
    DISCORD_CAPPER_ROLE_ID: 'manifest-capper-role-id',
    DISCORD_VIP_ROLE_ID: 'manifest-vip-role-id',
    DISCORD_VIP_PLUS_ROLE_ID: 'manifest-vip-plus-role-id',
    DISCORD_CAPPER_CHANNEL_ID: 'manifest-capper-channel-id',
    UNIT_TALK_API_URL: 'http://127.0.0.1:4000',
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

main().catch((error: unknown) => {
  console.error(
    '[command-manifest] Failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
