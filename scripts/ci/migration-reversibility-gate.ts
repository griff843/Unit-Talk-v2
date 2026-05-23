#!/usr/bin/env tsx
/**
 * migration-reversibility-gate — Constitutional CI gate (UTV2-1083).
 *
 * For every migration SQL file added in the current PR (vs origin/main),
 * verifies that a corresponding executable down script exists at:
 *   db/migrations-rollback/<basename>.down.sql
 *
 * For scripts marked IRREVERSIBLE, verifies a machine-readable ratification
 * record exists in db/migrations-rollback/irreversible-exemption-registry.json.
 *
 * Exit 0  → all new migrations have valid down scripts (gate passes).
 * Exit 1  → one or more migrations are missing down scripts, or have
 *            IRREVERSIBLE markers without a ratification record (gate fails).
 * Exit 2  → infrastructure error (invalid base ref, unreadable files).
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
const EXEMPTION_REGISTRY = `${ROLLBACK_DIR}/irreversible-exemption-registry.json`;

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

interface IrreversibleExemption {
  migration: string;
  reason: string;
  pitr_runbook_ref: string;
  ratified_at: string;
  ratified_by: string;
}

interface IrreversibleExemptionRegistry {
  schema_version: 1;
  exemptions: IrreversibleExemption[];
}

function loadExemptionRegistry(): IrreversibleExemptionRegistry {
  if (!existsSync(EXEMPTION_REGISTRY)) {
    return { schema_version: 1, exemptions: [] };
  }
  try {
    return JSON.parse(readFileSync(EXEMPTION_REGISTRY, 'utf8')) as IrreversibleExemptionRegistry;
  } catch {
    return { schema_version: 1, exemptions: [] };
  }
}

interface MigrationCheck {
  migration: string;
  down_script: string;
  exists: boolean;
  non_empty: boolean;
  is_irreversible: boolean;
  irreversible_ratified: boolean;
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

/**
 * Returns the list of SQL files added relative to base..HEAD.
 * Exits with code 2 if the base ref cannot be resolved (fail-closed on infra error).
 */
function getAddedMigrations(base: string): string[] {
  try {
    // Verify the base ref is resolvable before running the diff.
    execSync(`git rev-parse --verify "${base}"`, { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    process.stderr.write(
      `migration-reversibility-gate: INFRA_ERROR — cannot resolve base ref: ${base}\n` +
      `  If running locally, ensure you have fetched: git fetch origin\n`,
    );
    process.exit(2);
  }

  const raw = execSync(
    `git diff --name-only --diff-filter=A "${base}"...HEAD -- "${MIGRATIONS_DIR}/"`,
    { encoding: 'utf8' },
  ).trim();
  if (!raw) return [];
  return raw.split('\n').filter((l) => l.endsWith('.sql'));
}

function checkDownScript(
  migrationPath: string,
  exemptions: IrreversibleExemptionRegistry,
): MigrationCheck {
  const base = basename(migrationPath, '.sql');
  const downPath = `${ROLLBACK_DIR}/${base}.down.sql`;
  const exists = existsSync(downPath);

  let nonEmpty = false;
  let isIrreversible = false;
  let irreversibleRatified = false;
  let reason: string | undefined;

  if (!exists) {
    reason = `Missing down script: ${downPath}`;
  } else {
    const content = readFileSync(downPath, 'utf8').trim();
    isIrreversible = content.includes('-- IRREVERSIBLE:');

    if (isIrreversible) {
      // IRREVERSIBLE is only valid with a machine-readable ratification record.
      const entry = exemptions.exemptions.find(
        (e) => e.migration === base || e.migration === `${base}.sql`,
      );
      irreversibleRatified = entry !== undefined;
      nonEmpty = true; // content exists

      if (!irreversibleRatified) {
        reason =
          `Down script marked IRREVERSIBLE but no ratification record found in ` +
          `${EXEMPTION_REGISTRY}. Add an exemption entry with ratified_at + ratified_by.`;
      }
    } else {
      // Non-IRREVERSIBLE: must have executable SQL (not just comments/blank lines).
      const linesWithoutComments = content
        .split('\n')
        .filter((l) => !l.trim().startsWith('--') && l.trim() !== '');
      nonEmpty = linesWithoutComments.length > 0;
      if (!nonEmpty) {
        reason = `Down script is empty or comment-only: ${downPath}`;
      }
    }
  }

  const pass = isIrreversible ? (exists && nonEmpty && irreversibleRatified) : (exists && nonEmpty);
  return {
    migration: migrationPath,
    down_script: `${ROLLBACK_DIR}/${base}.down.sql`,
    exists,
    non_empty: nonEmpty,
    is_irreversible: isIrreversible,
    irreversible_ratified: irreversibleRatified,
    pass,
    ...(reason ? { reason } : {}),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const exemptions = loadExemptionRegistry();
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

  const checks = migrations.map((m) => checkDownScript(m, exemptions));
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
    const summary = ok ? 'PASS' : `FAIL — ${failed} migration(s) missing valid down scripts`;
    process.stdout.write(`migration-reversibility-gate: ${summary}\n`);
  }

  if (!args.dryRun && !ok) {
    process.exit(1);
  }
}

main();
