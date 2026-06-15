#!/usr/bin/env node
/**
 * Migration linter — catches high-risk patterns in Supabase migration files.
 *
 * UTV2-528: Complements the per-PR Supabase branch workflow by catching
 * obvious hazards early, before branch-based `test:db` verifies runtime truth.
 *
 * Rules:
 *   D1  DROP TABLE without -- lint-override: drop-table
 *   D2  DROP COLUMN without -- lint-override: drop-column
 *   D3  TRUNCATE without -- lint-override: truncate
 *   A1  UPDATE/DELETE/TRUNCATE against audit_log (never allowed)
 *   C1  ADD CONSTRAINT ... CHECK without DROP CONSTRAINT for same name
 *       (sibling-constraint drift — the UTV2-519 breach class)
 *   C2  NOT NULL column addition without DEFAULT
 *   H1  Hardcoded UUID literal (production-specific data in migration)
 *
 * Escape hatch:
 *   Add a SQL comment `-- lint-override: <rule-id>` on the same line or
 *   the line immediately above the flagged statement.
 *
 * Usage:
 *   node scripts/lint-migrations.mjs                    # lint all migrations
 *   node scripts/lint-migrations.mjs --changed-only     # lint only git-changed files
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

// The schema baseline replay-root (UTV2-1274) is a full pg_dump snapshot of live, not a
// forward migration. Forward-migration hygiene rules (e.g. C1 sibling-constraint paired-DROP)
// do not apply to a from-scratch snapshot — its fidelity is verified by Live Schema Parity
// against live, not by incremental-change linting. It is skipped here (loudly, never silently).
const BASELINE_REPLAY_ROOT = '00000000000000_baseline_live_schema.sql';

const rules = [
  {
    id: 'D1',
    name: 'DROP TABLE without override',
    pattern: /\bDROP\s+TABLE\b/i,
    override: 'drop-table',
    message: 'DROP TABLE detected. Add `-- lint-override: drop-table` if intentional.',
  },
  {
    id: 'D2',
    name: 'DROP COLUMN without override',
    pattern: /\bDROP\s+COLUMN\b/i,
    override: 'drop-column',
    message: 'DROP COLUMN detected. Add `-- lint-override: drop-column` if intentional.',
  },
  {
    id: 'D3',
    name: 'TRUNCATE without override',
    pattern: /\bTRUNCATE\b/i,
    check: (_match, _fileContent, line) => !/\baudit_log\b/i.test(line),
    override: 'truncate',
    message: 'TRUNCATE detected. Add `-- lint-override: truncate` if intentional.',
  },
  {
    id: 'A1',
    name: 'audit_log mutation',
    pattern: /\b(?:DELETE\s+FROM|UPDATE|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:public\.)?audit_log\b/i,
    message: 'audit_log is immutable. UPDATE, DELETE, and TRUNCATE are not permitted in migrations.',
  },
  {
    id: 'C1',
    name: 'ADD CONSTRAINT CHECK without paired DROP',
    pattern: /\bADD\s+CONSTRAINT\s+(\w+)\s+CHECK\b/i,
    check: (match, fileContent) => {
      const constraintName = match[1];
      const dropPattern = new RegExp(`DROP\\s+CONSTRAINT\\s+(IF\\s+EXISTS\\s+)?${constraintName}\\b`, 'i');
      return !dropPattern.test(fileContent);
    },
    message: 'ADD CONSTRAINT CHECK without a preceding DROP CONSTRAINT for the same name. Risk: sibling-constraint drift (UTV2-519 class). Add a DROP IF EXISTS before the ADD, or `-- lint-override: sibling-constraint`.',
    override: 'sibling-constraint',
  },
  {
    id: 'C2',
    name: 'NOT NULL column without DEFAULT',
    pattern: /\bADD\s+COLUMN\s+\w+\s+\w+[^;]*\bNOT\s+NULL\b/i,
    check: (match, _fileContent, line) => {
      return !/\bDEFAULT\b/i.test(line);
    },
    message: 'ADD COLUMN ... NOT NULL without DEFAULT. Existing rows will fail. Add a DEFAULT or `-- lint-override: not-null-no-default`.',
    override: 'not-null-no-default',
  },
  {
    id: 'H1',
    name: 'Hardcoded UUID literal',
    pattern: /['"]([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})['"]/i,
    check: (match, _fileContent, line) => {
      // Allow UUIDs in gen_random_uuid() calls and comments
      if (/gen_random_uuid|-- /i.test(line)) return false;
      return true;
    },
    message: 'Hardcoded UUID detected. UUIDs differ between environments. Use a lookup/subselect instead, or `-- lint-override: hardcoded-uuid`.',
    override: 'hardcoded-uuid',
  },
];

async function getChangedMigrations() {
  try {
    const output = execSync('git diff --name-only origin/main -- supabase/migrations/', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\n').filter(Boolean).map(f => join(process.cwd(), f));
  } catch {
    return [];
  }
}

async function getAllMigrations() {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.sql'))
    .map(e => join(MIGRATIONS_DIR, e.name));
}

export function hasOverride(lines, lineIndex, overrideKey) {
  const currentLine = lines[lineIndex] ?? '';
  const prevLine = lineIndex > 0 ? lines[lineIndex - 1] ?? '' : '';
  const overridePattern = `lint-override:\\s*${overrideKey}`;
  const regex = new RegExp(overridePattern, 'i');
  return regex.test(currentLine) || regex.test(prevLine);
}

export function lintMigrationContent(content, fileName = '(inline)') {
  const lines = content.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure comment lines
    if (/^\s*--/.test(line)) continue;

    for (const rule of rules) {
      const match = rule.pattern.exec(line);
      if (!match) continue;

      // Check rule-specific validation
      if (rule.check && !rule.check(match, content, line)) continue;

      // Check for override
      if (rule.override && hasOverride(lines, i, rule.override)) continue;

      findings.push({
        file: fileName,
        line: i + 1,
        rule: rule.id,
        name: rule.name,
        message: rule.message,
        statement: line.trim().substring(0, 160),
      });
    }
  }

  return findings;
}

export async function lintFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const fileName = filePath.split(/[/\\]/).pop();
  return lintMigrationContent(content, fileName);
}

export async function main(argv = process.argv.slice(2)) {
  const changedOnly = argv.includes('--changed-only');
  const collected = changedOnly ? await getChangedMigrations() : await getAllMigrations();
  const files = collected.filter((f) => {
    const base = f.split(/[/\\]/).pop();
    if (base === BASELINE_REPLAY_ROOT) {
      console.log(`[lint-migrations] Skipping schema baseline replay-root ${base} (snapshot, not a forward migration; fidelity verified by Live Schema Parity).`);
      return false;
    }
    return true;
  });

  if (files.length === 0) {
    console.log('[lint-migrations] No migration files to lint.');
    return 0;
  }

  let totalFindings = 0;
  const allFindings = [];

  for (const file of files) {
    const findings = await lintFile(file);
    if (findings.length > 0) {
      allFindings.push(...findings);
      totalFindings += findings.length;
    }
  }

  if (totalFindings > 0) {
    console.error(`[lint-migrations] ${totalFindings} finding(s) in ${files.length} file(s):\n`);
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.name}`);
      console.error(`    ${f.message}`);
      console.error(`    > ${f.statement}`);
      console.error('');
    }
    console.error('Override: add `-- lint-override: <rule-id>` on the same line or the line above.');
    console.error('Rules: D1 (drop-table), D2 (drop-column), D3 (truncate), A1 (audit-log-mutation), C1 (sibling-constraint), C2 (not-null-no-default), H1 (hardcoded-uuid)');
    return 1;
  }

  console.log(`[lint-migrations] ${files.length} migration file(s) checked — no findings.`);
  return 0;
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  process.exitCode = await main();
}
