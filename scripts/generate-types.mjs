/**
 * Cross-platform Supabase type generation.
 *
 * Replaces `supabase gen types typescript --linked | tail -n +2` which is:
 *   - Unix-only (tail is not available on Windows)
 *   - Does not inject SUPABASE_ACCESS_TOKEN from local.env into the subprocess,
 *     so the CLI sees no auth token and fails with 403.
 *
 * This script reads credentials from local.env and passes them explicitly
 * to the Supabase CLI subprocess environment.
 *
 * Usage:
 *   node scripts/generate-types.mjs
 *
 * Required (in local.env or process environment) — one of:
 *   Option A (preferred): SUPABASE_ACCESS_TOKEN — personal access token from
 *     https://supabase.com/dashboard/account/tokens
 *     Used with: --project-id (same as --linked, but explicit)
 *
 *   Option B (fallback): SUPABASE_DB_URL — full postgres connection string
 *     e.g. postgresql://postgres.ref:[PASSWORD]@pooler-host:5432/postgres
 *     OR:  SUPABASE_DB_PASSWORD — DB password (script constructs URL from project-ref)
 *     Used with: --db-url (bypasses Management API entirely)
 *
 * Project ref is read from supabase/.temp/project-ref (set by `supabase link`).
 * Output: packages/db/src/database.types.ts
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

// --- Read env files ---
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = new Map();
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

function getEnv(key) {
  return process.env[key] ?? localEnv.get(key) ?? dotEnv.get(key);
}

// --- Resolve project ref ---
const projectRefPath = path.join(root, 'supabase', '.temp', 'project-ref');
if (!fs.existsSync(projectRefPath)) {
  console.error('ERROR: supabase/.temp/project-ref not found.');
  console.error('       Run: npx supabase link --project-ref feownrheeefbcsehtsiw');
  process.exit(1);
}
const projectRef = fs.readFileSync(projectRefPath, 'utf8').trim();

// --- Output path ---
const outputPath = path.join(root, 'packages', 'db', 'src', 'database.types.ts');

// --- Build CLI args and env ---
const supabaseEnv = { ...process.env };

const accessToken = getEnv('SUPABASE_ACCESS_TOKEN');
const dbUrl = getEnv('SUPABASE_DB_URL');
const dbPassword = getEnv('SUPABASE_DB_PASSWORD');

let args;
let mode;

if (dbUrl) {
  // Option B1: explicit full DB URL — checked first so it takes priority over access token.
  // Use this for direct DB connections (schema introspection) when Management API is slow.
  // URL-encode the password segment to handle special chars (@, [], <>, etc).
  const encodedDbUrl = dbUrl.replace(/^(postgresql?:\/\/[^:]+):(.+)@(.+)$/, (_, prefix, pass, suffix) => {
    return `${prefix}:${encodeURIComponent(pass)}@${suffix}`;
  });
  args = ['supabase', 'gen', 'types', 'typescript', '--db-url', encodedDbUrl, '--schema', 'public'];
  mode = '--db-url (explicit SUPABASE_DB_URL)';
} else if (accessToken) {
  // Option A: use --project-id with access token injected into subprocess env.
  // This is equivalent to --linked but works even when the token is only in local.env.
  supabaseEnv['SUPABASE_ACCESS_TOKEN'] = accessToken;
  args = ['supabase', 'gen', 'types', 'typescript', '--project-id', projectRef, '--schema', 'public'];
  mode = '--project-id (access token injected from local.env)';
} else if (dbPassword) {
  // Option B2: construct pooler URL from project ref + password.
  // Uses Supavisor session pooler (port 5432) which supports DDL introspection.
  // If your project is in a different region, set SUPABASE_DB_URL directly instead.
  const encoded = encodeURIComponent(dbPassword);
  const constructedUrl = `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`;
  args = ['supabase', 'gen', 'types', 'typescript', '--db-url', constructedUrl, '--schema', 'public'];
  mode = '--db-url (constructed from SUPABASE_DB_PASSWORD — Ohio region assumed)';
  console.warn('WARN: Region assumed to be us-east-2 (Ohio). If this fails, set SUPABASE_DB_URL explicitly.');
} else {
  console.error('ERROR: No Supabase credentials found. Set one of:');
  console.error('  SUPABASE_ACCESS_TOKEN  — personal access token (preferred)');
  console.error('  SUPABASE_DB_URL        — full postgres connection string');
  console.error('  SUPABASE_DB_PASSWORD   — DB password (region assumed: us-east-2)');
  process.exit(1);
}

console.log(`Project: ${projectRef}`);
console.log(`Mode:    ${mode}`);
console.log(`Output:  ${path.relative(root, outputPath)}`);

// --- Run supabase gen types ---
const result = spawnSync('npx', args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: supabaseEnv,
  shell: true,
});

if (result.error) {
  console.error('ERROR: Failed to spawn supabase CLI:', result.error.message);
  process.exit(1);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status !== 0) {
  console.error(`ERROR: supabase gen types exited with code ${result.status}`);
  if (result.stdout) {
    console.error('stdout preview:', result.stdout.slice(0, 800));
  }
  process.exit(result.status ?? 1);
}

// --- Strip CLI banner lines (anything before the first TypeScript line) ---
const lines = result.stdout.split(/\r?\n/);
const firstTsLine = lines.findIndex(
  (line) => line.startsWith('export') || line.startsWith('//') || line.startsWith('/*'),
);
const content = firstTsLine === -1 ? result.stdout : lines.slice(firstTsLine).join('\n');

if (!content.trim()) {
  console.error('ERROR: Generated output is empty after stripping banner.');
  console.error('       Raw stdout length:', result.stdout.length);
  console.error('       First 200 chars:', result.stdout.slice(0, 200));
  process.exit(1);
}

// --- Safety check: do not write an obviously partial file ---
if (!content.includes('Database') && !content.includes('export type')) {
  console.error('ERROR: Output does not look like valid TypeScript types. Not writing.');
  console.error('       First 400 chars:', content.slice(0, 400));
  process.exit(1);
}

// --- Write output ---
fs.writeFileSync(outputPath, content, 'utf8');
console.log(`Done. ${content.split('\n').length} lines written.`);
