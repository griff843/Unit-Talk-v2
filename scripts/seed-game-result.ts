/**
 * scripts/seed-game-result.ts
 *
 * Proof fixture script: inserts one row into game_results with source: 'manual'.
 * Requires migration 012 (game_results table) to exist in the database.
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-game-result.ts \
 *     --event-id <event-external-id> \
 *     --market-key <market-key> \
 *     --actual-value <number> \
 *     [--participant-external-id <participant-external-id>]
 *
 * Credentials read from local.env (falls back to .env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

// --- Env loading (same pattern as scripts/generate-types.mjs) ---
function parseEnvFile(filePath: string): Map<string, string> {
  if (!fs.existsSync(filePath)) return new Map();
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = trimmed.indexOf('=');
    if (sep === -1) continue;
    result.set(trimmed.slice(0, sep).trim(), trimmed.slice(sep + 1).trim());
  }
  return result;
}

const localEnv = parseEnvFile(path.join(root, 'local.env'));
const dotEnv = parseEnvFile(path.join(root, '.env'));

function getEnv(key: string): string | undefined {
  return process.env[key] ?? localEnv.get(key) ?? dotEnv.get(key);
}

// --- CLI arg parser ---
function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args.set(key, next);
        i++;
      } else {
        // Boolean flag (no value) — store empty string so .has() works
        args.set(key, '');
      }
    }
  }
  return args;
}

function printUsage(): void {
  console.log('Usage:');
  console.log('  pnpm exec tsx scripts/seed-game-result.ts \\');
  console.log('    --event-id <event-external-id> \\');
  console.log('    --market-key <market-key> \\');
  console.log('    --actual-value <number> \\');
  console.log('    [--participant-external-id <participant-external-id>]');
  console.log('');
  console.log('Required:');
  console.log('  --event-id                   External ID of the event (events.external_id)');
  console.log('  --market-key                 Market key, e.g. points-all-game-ou');
  console.log('  --actual-value               Numeric result value');
  console.log('');
  console.log('Optional:');
  console.log('  --participant-external-id    External ID of the participant (participants.external_id)');
  console.log('  --help                       Print this usage and exit');
  console.log('');
  console.log('Example:');
  console.log('  pnpm exec tsx scripts/seed-game-result.ts \\');
  console.log('    --event-id sgo-event-abc123 --market-key points-all-game-ou --actual-value 25');
}

// --- Main ---
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.has('help')) {
    printUsage();
    process.exit(0);
  }

  const eventExternalId = args.get('event-id');
  const participantExternalId = args.get('participant-external-id') ?? null;
  const marketKey = args.get('market-key');
  const actualValueStr = args.get('actual-value');

  if (!eventExternalId || !marketKey || !actualValueStr) {
    console.error('ERROR: Required args: --event-id  --market-key  --actual-value');
    console.error('       Optional:      --participant-external-id');
    console.error('       Run with --help for full usage.');
    process.exit(1);
  }

  const actualValue = Number(actualValueStr);
  if (!Number.isFinite(actualValue)) {
    console.error(`ERROR: --actual-value must be a finite number, got: ${actualValueStr}`);
    process.exit(1);
  }

  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in local.env or .env');
    process.exit(1);
  }

  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // --- Look up event by external_id ---
  const eventUrl =
    `${supabaseUrl}/rest/v1/events` +
    `?external_id=eq.${encodeURIComponent(eventExternalId)}&select=id`;

  const eventRes = await fetch(eventUrl, { headers });
  if (!eventRes.ok) {
    console.error(`ERROR: events lookup failed: ${eventRes.status} ${eventRes.statusText}`);
    process.exit(1);
  }

  const events = (await eventRes.json()) as Array<{ id: string }>;
  if (events.length === 0) {
    console.error(`ERROR: no event found with external_id = '${eventExternalId}'`);
    process.exit(1);
  }
  const eventId = events[0]!.id;

  // --- Look up participant by external_id (optional) ---
  let participantId: string | null = null;
  if (participantExternalId) {
    const participantUrl =
      `${supabaseUrl}/rest/v1/participants` +
      `?external_id=eq.${encodeURIComponent(participantExternalId)}&select=id`;

    const participantRes = await fetch(participantUrl, { headers });
    if (!participantRes.ok) {
      console.error(
        `ERROR: participants lookup failed: ${participantRes.status} ${participantRes.statusText}`,
      );
      process.exit(1);
    }

    const participants = (await participantRes.json()) as Array<{ id: string }>;
    if (participants.length === 0) {
      console.error(
        `ERROR: no participant found with external_id = '${participantExternalId}'`,
      );
      process.exit(1);
    }
    participantId = participants[0]!.id;
  }

  // --- Insert game_results row ---
  const now = new Date().toISOString();
  const insertBody = {
    event_id: eventId,
    participant_id: participantId,
    market_key: marketKey,
    actual_value: actualValue,
    source: 'manual',
    sourced_at: now,
  };

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/game_results`, {
    method: 'POST',
    headers,
    body: JSON.stringify(insertBody),
  });

  if (!insertRes.ok) {
    const errorText = await insertRes.text();
    console.error(`ERROR: game_results insert failed: ${insertRes.status} ${insertRes.statusText}`);
    console.error(errorText);
    process.exit(1);
  }

  const rows = (await insertRes.json()) as Array<{ id: string }>;
  const insertedId = rows[0]?.id;
  if (!insertedId) {
    console.error('ERROR: insert appeared to succeed but no id returned');
    process.exit(1);
  }

  console.log(`OK  game_results row inserted`);
  console.log(`    id             = ${insertedId}`);
  console.log(`    event_id       = ${eventId}`);
  if (participantId) {
    console.log(`    participant_id = ${participantId}`);
  }
  console.log(`    market_key     = ${marketKey}`);
  console.log(`    actual_value   = ${actualValue}`);
  console.log(`    source         = manual`);
  console.log(`    sourced_at     = ${now}`);
}

main().catch((err: unknown) => {
  console.error('ERROR:', err);
  process.exit(1);
});

