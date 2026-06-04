import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const scriptPath = path.join(ROOT, 'scripts', 'ops', 'proof-auditor-gate.ts');

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
  const result = spawnSync(process.execPath, [TSX, scriptPath, ...args, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
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

test('warns but passes when sha is passed but not found in proof files', () => {
  const proofDir = makeTempDir();
  const sha = '0123456789abcdef0123456789abcdef01234567';
  writeFileSync(path.join(proofDir, 'proof.md'), '## Summary\nValid proof without the requested binding.');

  const result = runGate(['--proof-dir', proofDir, '--sha', sha]);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
  assert.strictEqual(result.output.sha, sha);
  assert.deepStrictEqual(result.output.failures, []);
  assert.match(result.output.warnings.join('\n'), /advisory only/);
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

test('fails execution-bound proof when required command is only mentioned', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'proof.md'),
    [
      '## Summary',
      'String-only DB proof.',
      '## Evidence',
      'The proof says pnpm test:db was run, but includes no captured execution output.',
      '## Verification',
      'pnpm test:db',
    ].join('\n'),
  );

  const result = runGate(['--proof-dir', proofDir, '--require-executed-command', 'pnpm test:db']);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /lacks node:test pass evidence/);
});

test('fails execution-bound proof when required command is not referenced', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'proof.md'),
    [
      '## Summary',
      'DB proof omitted.',
      '## Evidence',
      'The proof includes no DB smoke command reference.',
      '## Verification',
      'No DB smoke evidence captured.',
    ].join('\n'),
  );

  const result = runGate(['--proof-dir', proofDir, '--require-executed-command', 'pnpm test:db']);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /not referenced/);
});

test('fails execution-bound proof when required command evidence has skipped node:test output', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'proof.md'),
    [
      '## Summary',
      'Skipped DB proof.',
      '## Evidence',
      'Command: pnpm test:db',
      'TAP version 13',
      '# tests 5',
      '# pass 4',
      '# fail 0',
      '# cancelled 0',
      '# skipped 1',
      '## Verification',
      'Live DB smoke included skipped tests.',
    ].join('\n'),
  );

  const result = runGate(['--proof-dir', proofDir, '--require-executed-command', 'pnpm test:db']);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /lacks node:test pass evidence/);
});

test('passes execution-bound proof when required command has node:test pass output', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'proof.md'),
    [
      '## Summary',
      'Execution-bound DB proof.',
      '## Evidence',
      'Command: pnpm test:db',
      'TAP version 13',
      '# tests 5',
      '# pass 5',
      '# fail 0',
      '# cancelled 0',
      '# skipped 0',
      '## Verification',
      'Live DB smoke completed.',
    ].join('\n'),
  );

  const result = runGate(['--proof-dir', proofDir, '--require-executed-command', 'pnpm test:db']);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
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

test('fails when sha format is invalid (not 40 hex chars)', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'proof.md'), '## Summary\nValid proof.');

  const result = runGate(['--proof-dir', proofDir, '--sha', 'not-a-sha']);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /Invalid --sha/);
});

test('fails r2 r-level check when determinism keyword is absent', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'proof.md'),
    '## Summary\nProof coverage for r2 gate.\n## Evidence\nSome evidence.\n## Verification\nPassed.',
  );

  const result = runGate(['--proof-dir', proofDir, '--r-level', 'r2']);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /determinism/);
});

test('passes r2 r-level check when determinism keyword is present', () => {
  const proofDir = makeTempDir();
  writeFileSync(
    path.join(proofDir, 'proof.md'),
    '## Summary\nProof covers determinism guarantees.\n## Evidence\nDeterminism verified.\n## Verification\nAll checks passed.',
  );

  const result = runGate(['--proof-dir', proofDir, '--r-level', 'r2']);

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.output.verdict, 'PASS');
  assert.deepStrictEqual(result.output.failures, []);
});

test('fails when r-level format is invalid', () => {
  const proofDir = makeTempDir();
  writeFileSync(path.join(proofDir, 'proof.md'), '## Summary\nValid proof.');

  const result = runGate(['--proof-dir', proofDir, '--r-level', 'bad-level']);

  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.verdict, 'FAIL');
  assert.match(result.output.failures.join('\n'), /Invalid --r-level/);
});
