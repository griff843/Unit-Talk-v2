import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './shared.js';

type GateOutput = {
  verdict: 'PASS' | 'FAIL';
  proofDir: string;
  sha: string | null;
  failures: string[];
  warnings: string[];
  checkedAt: string;
};

const tempDirs: string[] = [];
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const scriptPath = path.join(ROOT, 'scripts', 'ops', 'runtime-verifier-gate.ts');

after(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function makeTempDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'rv-gate-'));
  tempDirs.push(d);
  return d;
}

function runGate(args: string[]): { status: number | null; output: GateOutput } {
  const result = spawnSync(process.execPath, [TSX, scriptPath, ...args, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.strictEqual(result.error, undefined);
  assert.notStrictEqual(result.stdout.trim(), '');
  return { status: result.status, output: JSON.parse(result.stdout) as GateOutput };
}

const VALID_CONTENT = [
  '# Runtime Verification — UTV2-1005',
  '**Merge SHA:** abcdefabcdefabcdefabcdefabcdefabcdefabcd',
  '',
  '## Verification',
  '',
  '- [x] `pnpm verify` exits 0: PASS',
  '- [x] `tsx --test scripts/ops/runtime-verifier-gate.test.ts` — 8 tests, 0 failures: PASS',
].join('\n');

test('passes for a valid runtime-verification file with required section', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'runtime-verification.md'), VALID_CONTENT);

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
  assert.deepStrictEqual(result.output.failures, []);
});

test('fails when proof dir does not exist', () => {
  const missing = path.join(os.tmpdir(), 'rv-gate-does-not-exist');

  const result = runGate(['--proof-dir', missing]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /does not exist/);
});

test('fails when no runtime-verification file is present', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'diff-summary.md'), '## Summary\nSome diff.');

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /No runtime-verification file/);
});

test('fails when runtime-verification file contains placeholder text', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'runtime-verification.md'),
    '## Verification\nMerge SHA: TBD — will be added at merge.',
  );

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /Placeholder text.*TBD/);
});

test('fails when runtime-verification file missing required section heading', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'runtime-verification.md'),
    '# Runtime Verification\nSome unstructured content without headings.',
  );

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /missing required verification section/);
});

test('fails when sha provided but not found in proof file', () => {
  const proofDir = makeTempDir();
  const sha = '0123456789abcdef0123456789abcdef01234567';
  writeFileSync(path.join(proofDir, 'runtime-verification.md'), VALID_CONTENT);

  const result = runGate(['--proof-dir', proofDir, '--sha', sha]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /SHA.*not found/);
});

test('passes when sha is provided and found in proof file', () => {
  const sha = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'runtime-verification.md'),
    `## Verification\nMerge SHA: ${sha}\n- [x] verify: PASS`,
  );

  const result = runGate(['--proof-dir', proofDir, '--sha', sha]);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
  assert.strictEqual(result.output.sha, sha);
  assert.deepStrictEqual(result.output.failures, []);
});

test('warns but passes when verification file is stale (beyond max-age-hours)', () => {
  const proofDir = makeTempDir();
  const filePath = path.join(proofDir, 'runtime-verification.md');
  writeFileSync(filePath, VALID_CONTENT);

  // Backdate the file by 10 days
  const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  utimesSync(filePath, old, old);

  const result = runGate(['--proof-dir', proofDir, '--max-age-hours', '1']);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
  assert.deepStrictEqual(result.output.failures, []);
  assert.ok(result.output.warnings.length > 0);
  assert.match(result.output.warnings.join('\n'), /last modified/);
});

test('fails when proof dir has no markdown files at all', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'result.json'), '{"ok":true}');

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /No markdown files/);
});
