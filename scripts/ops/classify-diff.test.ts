import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseNameStatus, formatReport, parseArgv, main } from './classify-diff.js';

// ── name-status parsing ───────────────────────────────────────────────────
// A rename emits three NUL-delimited fields. Losing the source path here would
// reintroduce, one layer up, the exact hole the classifier was fixed for.

test('a rename is parsed into both its paths', () => {
  const files = parseNameStatus('R100\0.github/CODEOWNERS\0docs/notes.txt\0');
  assert.deepEqual(files, [
    { filename: 'docs/notes.txt', previous_filename: '.github/CODEOWNERS', status: 'renamed' },
  ]);
});

test('adds, modifies and deletes are parsed with one path each', () => {
  const files = parseNameStatus('A\0a.ts\0M\0b.ts\0D\0c.ts\0');
  assert.deepEqual(files.map((f) => [f.filename, f.status]), [
    ['a.ts', 'added'],
    ['b.ts', 'modified'],
    ['c.ts', 'removed'],
  ]);
  assert.ok(files.every((f) => f.previous_filename === undefined));
});

test('a path containing a newline survives NUL parsing', () => {
  // The reason this reads -z rather than the newline form.
  const files = parseNameStatus('M\0docs/we\nird.md\0');
  assert.deepEqual(files, [{ filename: 'docs/we\nird.md', status: 'modified' }]);
});

test('a truncated record is dropped rather than half-parsed', () => {
  assert.deepEqual(parseNameStatus('R100\0only-one-path\0'), []);
});

// ── argument handling ─────────────────────────────────────────────────────

test('base defaults to origin/main and head to HEAD', () => {
  assert.deepEqual(parseArgv([]), { base: 'origin/main', head: 'HEAD', json: false });
});

test('explicit flags win', () => {
  assert.deepEqual(parseArgv(['--base', 'main', '--head', 'feature', '--json']), {
    base: 'main',
    head: 'feature',
    json: true,
  });
});

// ── report ────────────────────────────────────────────────────────────────
// The finding this command answers is that an operator could believe a risk
// check passed while learning nothing. The report must always state the verdict.

test('an auto report states the verdict and that it is a preview', () => {
  const out = formatReport([{ filename: 'a.ts', status: 'modified' }], { authority: 'auto', reasons: [], surfaces: [] }, false);
  assert.match(out, /authority: auto/);
  assert.match(out, /Merge Gate is the authority; this is a preview/);
});

test('a human report names the surfaces and the artifacts required', () => {
  const out = formatReport(
    [{ filename: 'supabase/migrations/1.sql', status: 'added' }],
    { authority: 'human', reasons: ['Production DDL — touched by: supabase/migrations/1.sql'], surfaces: ['production-ddl-and-data'] },
    false,
  );
  assert.match(out, /authority: human/);
  assert.match(out, /production-ddl-and-data/);
  assert.match(out, /griff-approved/);
  assert.match(out, /pm-verdict\/v1/);
});

test('--json emits a machine-readable verdict', () => {
  const out = formatReport([{ filename: 'a.ts', status: 'modified' }], { authority: 'human', reasons: ['r'], surfaces: ['secrets'] }, true);
  assert.deepEqual(JSON.parse(out), { authority: 'human', surfaces: ['secrets'], reasons: ['r'], files: 1 });
});

// ── end to end, against a real repo and the real policy ───────────────────

function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classify-diff-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'test');
  // The real policy and the real classifier: this test must fail if either moves.
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(path.join(dir, 'docs/05_operations'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts/ops'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'docs/05_operations/RESERVED_RISK_SURFACES.json'),
    path.join(dir, 'docs/05_operations/RESERVED_RISK_SURFACES.json'),
  );
  fs.copyFileSync(path.join(root, 'scripts/ops/merge-authority.cjs'), path.join(dir, 'scripts/ops/merge-authority.cjs'));
  run('add', '-A');
  run('commit', '-qm', 'base');
  return dir;
}

function capture(fn: () => number): { code: number; out: string } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (c: string) => boolean }).write = (c: string) => {
    chunks.push(String(c));
    return true;
  };
  try {
    return { code: fn(), out: chunks.join('') };
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
}

test('an ordinary change classifies auto against a real git range', () => {
  const dir = scratchRepo();
  fs.mkdirSync(path.join(dir, 'apps/smart-form/lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps/smart-form/lib/util.ts'), 'export const x = 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'change'], { cwd: dir });

  const { code, out } = capture(() => main(['--base', 'HEAD~1', '--head', 'HEAD'], dir));
  assert.equal(code, 0);
  assert.match(out, /authority: auto/);
});

test('a migration classifies human against a real git range', () => {
  const dir = scratchRepo();
  fs.mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'supabase/migrations/900_x.sql'), 'SELECT 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'migration'], { cwd: dir });

  const { code, out } = capture(() => main(['--base', 'HEAD~1', '--head', 'HEAD'], dir));
  assert.equal(code, 0);
  assert.match(out, /authority: human/);
  assert.match(out, /production-ddl-and-data/);
});

test('a rename out of a reserved path classifies human end to end', () => {
  // The whole point of reading -z and passing previous_filename through.
  const dir = scratchRepo();
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github/CODEOWNERS'), '* @griff843\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'add codeowners'], { cwd: dir });
  execFileSync('git', ['mv', '.github/CODEOWNERS', 'notes.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'rename'], { cwd: dir });

  const { code, out } = capture(() => main(['--base', 'HEAD~1', '--head', 'HEAD'], dir));
  assert.equal(code, 0);
  assert.match(out, /authority: human/);
  assert.match(out, /merge-authority/);
});

test('an empty range says so instead of reporting a reservation the gate would not make', () => {
  const dir = scratchRepo();
  const { code, out } = capture(() => main(['--base', 'HEAD', '--head', 'HEAD'], dir));
  assert.equal(code, 0);
  assert.match(out, /Nothing to classify/);
});

// ── manifests reach the classifier ────────────────────────────────────────
// Round 7: the CLI omitted the `manifests` input the manifest rules need, so
// the classifier saw a changed package.json it had not been given and reserved
// it as `unclassifiable`. Every diff touching any package.json reported
// `human`. A preview that disagrees with the gate in the RESTRICTIVE direction
// is still wrong -- it routes ordinary work to a human who did not need to see
// it, which is the cost RMA exists to remove.

test('adding an ordinary test script to a manifest stays automatic', () => {
  const dir = scratchRepo();
  const manifest = (scripts: Record<string, string>) =>
    fs.writeFileSync(path.join(dir, 'apps/demo/package.json'), JSON.stringify({ name: 'demo', scripts }, null, 2));
  fs.mkdirSync(path.join(dir, 'apps/demo'), { recursive: true });
  manifest({ test: 'tsx --test test/a.test.ts' });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'manifest'], { cwd: dir });
  manifest({ test: 'tsx --test test/a.test.ts test/b.test.ts' });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'extend tests'], { cwd: dir });

  const { code, out } = capture(() => main(['--base', 'HEAD~1', '--head', 'HEAD'], dir));
  assert.equal(code, 0);
  assert.doesNotMatch(out, /unclassifiable/, 'the manifest contents never reached the classifier');
  assert.match(out, /authority: auto/);
});

test('a neutered manifest script is still caught by the CLI', () => {
  // The other direction: supplying manifests must not make the CLI blind to a
  // script that stops running work.
  const dir = scratchRepo();
  fs.mkdirSync(path.join(dir, 'apps/demo'), { recursive: true });
  const manifest = (scripts: Record<string, string>) =>
    fs.writeFileSync(path.join(dir, 'apps/demo/package.json'), JSON.stringify({ name: 'demo', scripts }, null, 2));
  manifest({ test: 'tsx --test test/a.test.ts' });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'manifest'], { cwd: dir });
  manifest({ test: 'echo skipped' });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'neuter'], { cwd: dir });

  const { code, out } = capture(() => main(['--base', 'HEAD~1', '--head', 'HEAD'], dir));
  assert.equal(code, 0);
  assert.match(out, /authority: human/);
  assert.match(out, /neutered-workspace-script/);
});
