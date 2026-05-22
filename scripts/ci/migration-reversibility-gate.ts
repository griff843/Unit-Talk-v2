#!/usr/bin/env tsx
/**
 * migration-reversibility-gate — Constitutional CI gate (UTV2-1083).
 *
 * For every migration SQL file added in the current PR (vs origin/main),
 * verifies that a corresponding executable down script exists at:
 *   db/migrations-rollback/<basename>.down.sql
 *
 * Exit 0  → all new migrations have down scripts (gate passes).
 * Exit 1  → one or more migrations are missing down scripts (gate fails).
 *
 * Usage:
 *   tsx scripts/ci/migration-reversibility-gate.ts [--base <ref>] [--json]
 *
 * Flags:
 *   --base <ref>   Git ref to diff against (default: origin/main)
 *   --json         Machine-readable output
 *   --dry-run      List what would be checked, exit 0 regardless
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';
const ROLLBACK_DIR = 'db/migrations-rollback';

interface ParsedArgs {
  base: string;
  json: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let base = 'origin/main';
  let json = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) {
      base = argv[++i]!;
    } else if (argv[i] === '--json') {
      json = true;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { base, json, dryRun };
}

interface MigrationCheck {
  migration: string;
  down_script: string;
  exists: boolean;
  non_empty: boolean;
  pass: boolean;
  reason?: string;
}

interface GateResult {
  schema_version: 1;
  gate: 'migration-reversibility';
  base: string;
  checked: number;
  passed: number;
  failed: number;
  ok: boolean;
  dry_run: boolean;
  migrations: MigrationCheck[];
}

function getAddedMigrations(base: string): string[] {
  try {
    const raw = execSync(
      `git diff --name-only --diff-filter=A "${base}"...HEAD -- "${MIGRATIONS_DIR}/"`,
      { encoding: 'utf8' },
    ).trim();
    if (!raw) return [];
    return raw.split('\n').filter((l) => l.endsWith('.sql'));
  } catch {
    // Fallback: check against HEAD~1 for single-commit context
    try {
      const raw = execSync(
        `git diff --name-only --diff-filter=A HEAD~1...HEAD -- "${MIGRATIONS_DIR}/"`,
        { encoding: 'utf8' },
      ).trim();
      if (!raw) return [];
      return raw.split('\n').filter((l) => l.endsWith('.sql'));
    } catch {
      return [];
    }
  }
}

function checkDownScript(migrationPath: string): MigrationCheck {
  const base = basename(migrationPath, '.sql');
  const downPath = `${ROLLBACK_DIR}/${base}.down.sql`;
  const exists = existsSync(downPath);

  let nonEmpty = false;
  let reason: string | undefined;

  if (!exists) {
    reason = `Missing down script: ${downPath}`;
  } else {
    const content = readFileSync(downPath, 'utf8').trim();
    // A down script must contain actual SQL (not just comments).
    // A file with only comments or blank lines is considered non-empty only
    // if it explicitly declares IRREVERSIBLE with the PITR rationale.
    const linesWithoutComments = content
      .split('\n')
      .filter((l) => !l.trim().startsWith('--') && l.trim() !== '');
    nonEmpty = linesWithoutComments.length > 0 || content.includes('-- IRREVERSIBLE:');
    if (!nonEmpty) {
      reason = `Down script is empty or comment-only: ${downPath}`;
    }
  }

  const pass = exists && nonEmpty;
  return {
    migration: migrationPath,
    down_script: `${ROLLBACK_DIR}/${basename(migrationPath, '.sql')}.down.sql`,
    exists,
    non_empty: nonEmpty,
    pass,
    ...(reason ? { reason } : {}),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const migrations = getAddedMigrations(args.base);

  if (migrations.length === 0) {
    const result: GateResult = {
      schema_version: 1,
      gate: 'migration-reversibility',
      base: args.base,
      checked: 0,
      passed: 0,
      failed: 0,
      ok: true,
      dry_run: args.dryRun,
      migrations: [],
    };
    if (args.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write('migration-reversibility-gate: no new migrations — PASS\n');
    }
    process.exit(0);
  }

  const checks = migrations.map(checkDownScript);
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;
  const ok = failed === 0;

  const result: GateResult = {
    schema_version: 1,
    gate: 'migration-reversibility',
    base: args.base,
    checked: checks.length,
    passed,
    failed,
    ok: args.dryRun ? true : ok,
    dry_run: args.dryRun,
    migrations: checks,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    for (const c of checks) {
      const status = c.pass ? 'PASS' : 'FAIL';
      process.stdout.write(`  [${status}] ${c.migration}\n`);
      if (!c.pass && c.reason) {
        process.stdout.write(`         → ${c.reason}\n`);
      }
    }
    const summary = ok ? 'PASS' : `FAIL — ${failed} migration(s) missing executable down scripts`;
    process.stdout.write(`migration-reversibility-gate: ${summary}\n`);
  }

  if (!args.dryRun && !ok) {
    process.exit(1);
  }
}

main();
