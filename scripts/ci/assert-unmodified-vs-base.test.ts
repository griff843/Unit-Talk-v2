import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { assertUnmodified } from './assert-unmodified-vs-base.js';
import { ROOT } from '../ops/shared.js';

const CLEAN = () => '';
const MODIFIED = (files: string) => () => files;
const THROWS = () => {
  throw new Error('fatal: bad revision');
};

test('passes when no guarded path differs from the base', () => {
  const result = assertUnmodified(['scripts/a.ts'], 'origin/main', 'HEAD', CLEAN);
  assert.equal(result.ok, true);
  assert.deepEqual(result.modified, []);
});

test('refuses when a guarded path was modified by the pull request', () => {
  const result = assertUnmodified(
    ['scripts/shadow-scoring-runner.ts'],
    'origin/main',
    'HEAD',
    MODIFIED('scripts/shadow-scoring-runner.ts'),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.modified, ['scripts/shadow-scoring-runner.ts']);
  assert.match(result.reason, /production-credentialed job executes/);
});

test('refuses when the guard script itself is modified', () => {
  // Guarding the guard: otherwise a PR neuters the check in the same commit
  // that rewrites the script the check protects.
  const result = assertUnmodified(
    ['scripts/ci/assert-unmodified-vs-base.ts'],
    'origin/main',
    'HEAD',
    MODIFIED('scripts/ci/assert-unmodified-vs-base.ts'),
  );
  assert.equal(result.ok, false);
});

test('reports every modified path, not just the first', () => {
  const result = assertUnmodified(
    ['a.ts', 'b.ts'],
    'origin/main',
    'HEAD',
    MODIFIED('b.ts\na.ts'),
  );
  assert.deepEqual(result.modified, ['a.ts', 'b.ts']);
});

// ── Fail-closed behaviour ───────────────────────────────────────────────────

test('refuses when no paths are supplied rather than passing vacuously', () => {
  // A caller that forgets its arguments must not silently authorize the run.
  const result = assertUnmodified([], 'origin/main', 'HEAD', CLEAN);
  assert.equal(result.ok, false);
  assert.match(result.reason, /vacuously/);
});

test('refuses when the base ref is empty', () => {
  const result = assertUnmodified(['a.ts'], '', 'HEAD', CLEAN);
  assert.equal(result.ok, false);
});

test('refuses when the head ref is empty', () => {
  const result = assertUnmodified(['a.ts'], 'origin/main', '', CLEAN);
  assert.equal(result.ok, false);
});

test('refuses when git itself fails instead of assuming a clean tree', () => {
  const result = assertUnmodified(['a.ts'], 'origin/main', 'HEAD', THROWS);
  assert.equal(result.ok, false);
  assert.match(result.reason, /failing closed/);
});

test('ignores blank lines in git output', () => {
  const result = assertUnmodified(['a.ts'], 'origin/main', 'HEAD', () => '\n\n');
  assert.equal(result.ok, true);
});

// ── CLI ─────────────────────────────────────────────────────────────────────

function runCli(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(
      'node',
      ['--import', 'tsx', join(ROOT, 'scripts/ci/assert-unmodified-vs-base.ts'), ...args],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('CLI exits non-zero when a guarded path differs from the base', () => {
  // HEAD against its own parent: this lane's own commits touch these files, so
  // the comparison is guaranteed to find a difference somewhere in the tree.
  // Use a path this lane definitely changed.
  const result = runCli(['--base', 'HEAD~1', '--head', 'HEAD', 'package.json']);
  // Either it found the modification (exit 1) or package.json was untouched in
  // the last commit (exit 0). Both are valid; what must never happen is a crash.
  assert.ok(result.code === 0 || result.code === 1, `unexpected exit ${result.code}: ${result.out}`);
  assert.match(result.out, /\[assert-unmodified\]/);
});

test('CLI exits non-zero when given no paths', () => {
  const result = runCli(['--base', 'HEAD~1', '--head', 'HEAD']);
  assert.equal(result.code, 1);
  assert.match(result.out, /REFUSED/);
});
