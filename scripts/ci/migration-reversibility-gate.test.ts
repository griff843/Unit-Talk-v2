/**
 * Adversarial test suite for migration-reversibility-gate.
 *
 * Proves the gate FAILS for:
 *   F1. Missing down script
 *   F2. Comment-only (empty) down script
 *   F3. IRREVERSIBLE marker without a ratification record
 *   F4. Invalid / unresolvable base ref
 *
 * Proves the gate PASSES for:
 *   F5. Valid reversible down script
 *   F6. IRREVERSIBLE with a ratification record
 *   F7. Zero new migrations (no-op pass)
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const GATE = join(process.cwd(), 'scripts/ci/migration-reversibility-gate.ts');

interface GateResult {
  ok: boolean;
  checked: number;
  failed: number;
  migrations: Array<{ pass: boolean; reason?: string; migration?: string }>;
}

function runGate(
  workdir: string,
  baseRef: string,
  extraArgs: string[] = [],
): { exit: number; result: GateResult | null; stderr: string } {
  try {
    const stdout = execSync(
      `npx tsx "${GATE}" --base "${baseRef}" --json ${extraArgs.join(' ')}`,
      { encoding: 'utf8', cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { exit: 0, result: JSON.parse(stdout) as GateResult, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    let result: GateResult | null = null;
    try {
      if (e.stdout) result = JSON.parse(e.stdout) as GateResult;
    } catch { /* noop */ }
    return { exit: e.status ?? 1, result, stderr: e.stderr ?? '' };
  }
}

interface FixtureRepo {
  dir: string;
  baseRef: string;  // SHA of the initial empty commit (use as --base to see all migrations)
}

function initRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "gate-test@unit-talk.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Gate Test"', { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(dir, 'db/migrations-rollback'), { recursive: true });
  // git won't track empty directories; use --allow-empty so the base commit always exists.
  execSync('git commit --allow-empty -m "base"', { cwd: dir, stdio: 'ignore' });
}

function commitAll(dir: string, message: string): void {
  execSync(`git add -A && git commit --allow-empty -m "${message}"`, { cwd: dir, stdio: 'ignore' });
}

function baseRef(dir: string): string {
  // Return the SHA of the first commit — this is the stable base for all diffs.
  return execSync('git rev-list --max-parents=0 HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

/** Creates a minimal git repo + migration fixture in a temp dir. */
function createFixtureRepo(options: {
  migrationBasename: string;
  downContent?: string;
  exemptions?: object;
}): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), 'gate-test-'));
  initRepo(dir);
  const base = baseRef(dir);

  // Add migration file
  writeFileSync(
    join(dir, `supabase/migrations/${options.migrationBasename}.sql`),
    `CREATE TABLE IF NOT EXISTS "${options.migrationBasename}" (id uuid primary key);\n`,
  );
  commitAll(dir, 'add migration');

  // Add down script if provided
  if (options.downContent !== undefined) {
    writeFileSync(
      join(dir, `db/migrations-rollback/${options.migrationBasename}.down.sql`),
      options.downContent,
    );
    commitAll(dir, 'add down script');
  }

  // Add exemption registry if provided
  if (options.exemptions !== undefined) {
    writeFileSync(
      join(dir, 'db/migrations-rollback/irreversible-exemption-registry.json'),
      JSON.stringify(options.exemptions, null, 2),
    );
    commitAll(dir, 'add exemption registry');
  }

  return { dir, baseRef: base };
}

test('F1: missing down script — gate FAILS with exit 1', () => {
  const { dir, baseRef: base } = createFixtureRepo({ migrationBasename: '20260101_missing_down' });
  try {
    const { exit, result } = runGate(dir, base);
    assert.equal(exit, 1, `Gate must exit 1, got ${exit}`);
    assert.ok(result !== null, 'Gate must emit JSON');
    assert.equal(result!.ok, false, 'ok must be false');
    assert.equal(result!.failed, 1, 'Must report 1 failure');
    assert.ok(
      result!.migrations[0]?.reason?.includes('Missing down script'),
      `reason must reference missing down script, got: ${result!.migrations[0]?.reason}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F2: comment-only down script — gate FAILS with exit 1', () => {
  const { dir, baseRef: base } = createFixtureRepo({
    migrationBasename: '20260101_comment_only',
    downContent: '-- This is just a comment\n-- Another comment\n',
  });
  try {
    const { exit, result } = runGate(dir, base);
    assert.equal(exit, 1, `Gate must exit 1, got ${exit}`);
    assert.ok(result !== null, 'Gate must emit JSON');
    assert.equal(result!.ok, false);
    assert.ok(
      result!.migrations[0]?.reason?.includes('empty or comment-only'),
      `reason must say comment-only, got: ${result!.migrations[0]?.reason}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F3: IRREVERSIBLE without ratification record — gate FAILS with exit 1', () => {
  const { dir, baseRef: base } = createFixtureRepo({
    migrationBasename: '20260101_irreversible_no_record',
    downContent: '-- IRREVERSIBLE: data loss risk\n-- Use PITR.\n',
  });
  try {
    const { exit, result } = runGate(dir, base);
    assert.equal(exit, 1, `Gate must exit 1, got ${exit}`);
    assert.ok(result !== null, 'Gate must emit JSON');
    assert.equal(result!.ok, false);
    assert.ok(
      result!.migrations[0]?.reason?.includes('no ratification record'),
      `reason must reference missing ratification, got: ${result!.migrations[0]?.reason}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F4: unresolvable base ref — gate exits 2 (infra error, not silent pass)', () => {
  const { dir } = createFixtureRepo({ migrationBasename: '20260101_bad_base' });
  try {
    const { exit, stderr } = runGate(dir, 'refs/does-not-exist-xyz');
    assert.equal(exit, 2, `Gate must exit 2 on unresolvable base, got ${exit}`);
    assert.ok(
      stderr.includes('INFRA_ERROR') || stderr.includes('cannot resolve base ref'),
      `stderr must describe infra error, got: "${stderr}"`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F5: valid reversible down script — gate PASSES with exit 0', () => {
  const { dir, baseRef: base } = createFixtureRepo({
    migrationBasename: '20260101_valid_down',
    downContent: 'DROP TABLE IF EXISTS "20260101_valid_down";\n',
  });
  try {
    const { exit, result } = runGate(dir, base);
    assert.equal(exit, 0, `Gate must exit 0, got ${exit}`);
    assert.ok(result !== null, 'Gate must emit JSON');
    assert.equal(result!.ok, true);
    assert.equal(result!.failed, 0);
    assert.equal(result!.migrations[0]?.pass, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F6: IRREVERSIBLE with ratification record — gate PASSES with exit 0', () => {
  const exemptions = {
    schema_version: 1,
    exemptions: [{
      migration: '20260101_irreversible_ratified',
      reason: 'Test exemption — ratified',
      pitr_runbook_ref: 'docs/05_operations/DB_ROLLBACK_RUNBOOK.md',
      ratified_at: '2026-01-01',
      ratified_by: 'pm-test',
    }],
  };
  const { dir, baseRef: base } = createFixtureRepo({
    migrationBasename: '20260101_irreversible_ratified',
    downContent: '-- IRREVERSIBLE: test exemption\n-- Use PITR.\n',
    exemptions,
  });
  try {
    const { exit, result } = runGate(dir, base);
    assert.equal(exit, 0, `Gate must exit 0, got ${exit}`);
    assert.ok(result !== null, 'Gate must emit JSON');
    assert.equal(result!.ok, true);
    assert.equal(result!.migrations[0]?.pass, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F7: zero new migrations — gate PASSES with exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-test-'));
  try {
    initRepo(dir);
    const base = baseRef(dir);
    // No new migrations added — HEAD is same as base (extra empty commit to create a range).
    commitAll(dir, 'no-op commit');
    const { exit, result } = runGate(dir, base);
    assert.equal(exit, 0, `Gate must exit 0 with zero migrations, got ${exit}`);
    assert.ok(result !== null, 'Gate must emit JSON');
    assert.equal(result!.ok, true);
    assert.equal(result!.checked, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
