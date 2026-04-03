#!/usr/bin/env node
/**
 * Guards against duplicate Supabase migration version prefixes.
 * Two files with the same leading timestamp (first 14 chars) will cause
 * `supabase db push` to fail on schema_migrations_pkey.
 *
 * Usage: node scripts/check-migration-versions.mjs
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
const sqlFiles = entries
  .filter((e) => e.isFile() && e.name.endsWith('.sql'))
  .map((e) => e.name);

// Migration version = leading numeric prefix (up to first non-digit character after the timestamp)
// e.g. "202604010001_foo.sql" → version prefix "202604010001"
const versionMap = new Map();
const duplicates = [];

for (const file of sqlFiles) {
  const match = /^(\d+)_/.exec(file);
  if (!match) continue;
  const version = match[1];
  if (versionMap.has(version)) {
    duplicates.push({ version, files: [versionMap.get(version), file] });
  } else {
    versionMap.set(version, file);
  }
}

if (duplicates.length > 0) {
  console.error('[check-migration-versions] Duplicate migration version(s) found:\n');
  for (const { version, files } of duplicates) {
    console.error(`  Version ${version}:`);
    for (const f of files) {
      console.error(`    supabase/migrations/${f}`);
    }
  }
  console.error(
    `\n${duplicates.length} duplicate(s). Rename one of the conflicting files before merging.`,
  );
  process.exit(1);
} else {
  console.log(`[check-migration-versions] ${sqlFiles.length} migration file(s) verified — no duplicate versions.`);
}
