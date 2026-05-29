import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateProofBundle } from './proof-check.js';

function writeLane(repoRoot: string, lane: string, artifacts: string[]): void {
  const laneDir = path.join(repoRoot, '.lane', 'lanes');
  fs.mkdirSync(laneDir, { recursive: true });
  fs.writeFileSync(
    path.join(laneDir, `${lane}.yml`),
    [
      'schema_version: 1',
      `lane_id: ${lane}`,
      `lane_type: ${lane}`,
      'allowed_path_globs:',
      '  - scripts/**',
      'forbidden_path_globs: []',
      'required_proof_artifacts:',
      ...artifacts.map((artifact) => `  - ${artifact}`),
      'ci_requirements:',
      '  - pnpm verify',
      'merge_policy: green verify',
      'concurrency_notes: no overlap',
      '',
    ].join('\n'),
    'utf8',
  );
}

test('proof bundle validator reports missing artifacts for a lane', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-check-'));
  writeLane(repoRoot, 'verification', ['diff-summary.md', 'verification.md']);
  fs.mkdirSync(path.join(repoRoot, 'proof', 'UTV2-959'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'proof', 'UTV2-959', 'diff-summary.md'), 'ok\n', 'utf8');

  const result = validateProofBundle({ issue: 'UTV2-959', lane: 'verification', repoRoot });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['verification.md']);
});

test('proof bundle validator passes when all lane artifacts exist', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-check-'));
  writeLane(repoRoot, 'hygiene', ['diff-summary.md', 'verification.md']);
  const proofDir = path.join(repoRoot, 'proof', 'UTV2-956');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(proofDir, 'diff-summary.md'), 'ok\n', 'utf8');
  fs.writeFileSync(path.join(proofDir, 'verification.md'), 'ok\n', 'utf8');

  const result = validateProofBundle({ issue: 'UTV2-956', lane: 'hygiene', repoRoot });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});
