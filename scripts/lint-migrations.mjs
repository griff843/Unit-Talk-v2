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

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const changedOnly = process.argv.includes('--changed-only');

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
    override: 'truncate',
    message: 'TRUNCATE detected. Add `-- lint-override: truncate` if intentional.',
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

function hasOverride(lines, lineIndex, overrideKey) {
  const currentLine = lines[lineIndex] ?? '';
  const prevLine = lineIndex > 0 ? lines[lineIndex - 1] ?? '' : '';
  const overridePattern = `lint-override:\\s*${overrideKey}`;
  const regex = new RegExp(overridePattern, 'i');
  return regex.test(currentLine) || regex.test(prevLine);
}

async function lintFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');
  const findings = [];
  const fileName = filePath.split(/[/\\]/).pop();

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
        snippet: line.trim().substring(0, 120),
      });
    }
  }

  return findings;
}

// Main
const files = changedOnly ? await getChangedMigrations() : await getAllMigrations();

if (files.length === 0) {
  console.log('[lint-migrations] No migration files to lint.');
  process.exit(0);
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
    console.error(`    > ${f.snippet}`);
    console.error('');
  }
  console.error(`Override: add \`-- lint-override: <rule-id>\` on the same line or the line above.`);
  console.error(`Rules: D1 (drop-table), D2 (drop-column), D3 (truncate), C1 (sibling-constraint), C2 (not-null-no-default), H1 (hardcoded-uuid)`);
  process.exit(1);
} else {
  console.log(`[lint-migrations] ${files.length} migration file(s) checked — no findings.`);
}
