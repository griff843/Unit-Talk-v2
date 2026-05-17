import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type GateOutput = {
  verdict: 'PASS' | 'FAIL';
  proofDir: string;
  sha: string | null;
  failures: string[];
  warnings: string[];
  checkedAt: string;
};

const tempDirs: string[] = [];
const scriptPath = path.resolve('scripts/ops/proof-auditor-gate.ts');

after(() => {
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'proof-gate-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function runGate(args: string[]): { status: number | null; output: GateOutput } {
  const result = spawnSync('npx', ['tsx', scriptPath, ...args, '--json'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.strictEqual(result.error, undefined);
  assert.notStrictEqual(result.stdout.trim(), '');

  return {
    status: result.status,
    output: JSON.parse(result.stdout) as GateOutput,
  };
}

test('passes for a valid proof dir with required sections and no placeholders', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'proof.md'),
    ['## Summary', 'Complete proof.', '## Evidence', 'Evidence captured.', '## Verification', 'Checks passed.'].join(
      '\n',
    ),
  );

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
  assert.deepStrictEqual(result.output.failures, []);
  assert.deepStrictEqual(result.output.warnings, []);
});

test('fails when proof dir does not exist', () => {
  const missingDir = path.join(os.tmpdir(), 'proof-gate-missing-dir');

  const result = runGate(['--proof-dir', missingDir]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /Proof dir does not exist/);
});

test('fails when proof dir contains no markdown files', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'proof.txt'), '## Summary\nText file only.');

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /contains no markdown files/);
});

test('fails when a proof file contains placeholder text', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'proof.md'), '## Summary\nTODO complete this.');

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /TODO/);
});

test('fails when proof files have no required sections', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'proof.md'), '# Proof\nContent without required headings.');

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /No required markdown section/);
});

test('fails when sha is passed but not found in proof files', () => {
  const proofDir = makeTempDir();
  const sha = '0123456789abcdef0123456789abcdef01234567';
  writeFileSync(path.join(proofDir, 'proof.md'), '## Summary\nValid proof without the requested binding.');

  const result = runGate(['--proof-dir', proofDir, '--sha', sha]);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.strictEqual(result.output.sha, sha);
  assert.match(result.output.failures.join('\n'), /SHA binding not found/);
});

test('passes when sha is passed and found in proof files', () => {
  const proofDir = makeTempDir();
  const sha = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
  writeFileSync(path.join(proofDir, 'proof.md'), `## Summary\nCommit: ${sha}`);

  const result = runGate(['--proof-dir', proofDir, '--sha', sha]);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
  assert.strictEqual(result.output.sha, sha);
  assert.deepStrictEqual(result.output.failures, []);
});

test('warns but passes when a markdown proof file exceeds 100KB', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'proof.md'), `## Summary\n${'a'.repeat(101 * 1024)}`);

  const result = runGate(['--proof-dir', proofDir]);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
  assert.deepStrictEqual(result.output.failures, []);
  assert.ok(result.output.warnings.length > 0);
});
