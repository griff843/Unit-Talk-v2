/**
 * UTV2-356 migration orphan audit.
 * Uses the Supabase CLI (supabase migration list --linked) to compare
 * on-disk migration files vs remote applied state.
 *
 * Requires: SUPABASE_ACCESS_TOKEN in environment (local.env)
 * Run with: tsx scripts/utv2-356-migration-audit.ts
 * Exits 0 if clean, 1 if drift detected.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

// Read SUPABASE_ACCESS_TOKEN from local.env (not in @unit-talk/config schema)
function readLocalEnvToken(): string {
  for (const f of ['local.env', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf-8').split('\n')) {
      const m = /^SUPABASE_ACCESS_TOKEN=(.+)$/.exec(line.trim());
      if (m) return m[1].trim();
    }
  }
  return process.env['SUPABASE_ACCESS_TOKEN'] ?? '';
}

const token = readLocalEnvToken();
if (!token) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN not set — cannot verify remote migration state');
  process.exit(1);
}

const onDisk = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`\n── Migration Orphan Audit ─────────────────────────────────────`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Files on disk: ${onDisk.length}`);

let cliOutput: string;
try {
  cliOutput = execSync('npx supabase migration list --linked', {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    encoding: 'utf-8',
    timeout: 30_000,
  });
} catch (err) {
  console.error('supabase migration list failed:', (err as Error).message);
  process.exit(1);
}

// Parse the CLI table output — lines look like: " 202603200001 | 202603200001 | ..."
const appliedPrefixes = new Set<string>();
for (const line of cliOutput.split('\n')) {
  const match = /^\s+(\d{12,})\s*\|/.exec(line);
  if (match) appliedPrefixes.add(match[1].trim());
}

console.log(`Applied in Supabase (remote): ${appliedPrefixes.size}`);

// Disk files use format: <timestamp>_<description>.sql
// CLI remote records use only the timestamp prefix (no description).
// Compare on timestamp prefix only (digits before first underscore or end of string).
function toPrefix(name: string): string {
  return name.replace('.sql', '').split('_')[0];
}

const diskPrefixes = onDisk.map(toPrefix);
const orphans = diskPrefixes.filter((p) => !appliedPrefixes.has(p));
const ghosts = [...appliedPrefixes].filter((p) => !diskPrefixes.includes(p));

console.log(`\nOrphans (on disk, NOT applied): ${orphans.length}`);
if (orphans.length > 0) orphans.forEach((f) => console.log(`  ORPHAN: ${f}`));

console.log(`Ghosts (applied, NOT on disk): ${ghosts.length}`);
if (ghosts.length > 0) ghosts.forEach((f) => console.log(`  GHOST: ${f}`));

if (orphans.length === 0 && ghosts.length === 0) {
  console.log(`\nResult: CLEAN`);
  console.log(`  ${onDisk.length} migration files — all applied, none orphaned`);
  console.log(`  Head: ${diskPrefixes.at(-1)}`);
  process.exit(0);
} else {
  console.log('\nResult: DRIFT DETECTED — stop and report to PM before proceeding');
  process.exit(1);
}
