import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildT2ProofBundle,
  generateT2ProofBundle,
  isEligibleT2OpsLane,
} from './t2-proof-bundle.js';
import type { LaneManifest } from './shared.js';

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1067',
    lane_type: 'governance',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: '.out/worktrees/codex__utv2-1067-t2-proof-bundle',
    branch: 'codex/utv2-1067-t2-proof-bundle',
    base_branch: 'main',
    commit_sha: 'abc123merge',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1067',
    files_changed: ['scripts/ops/t2-proof-bundle.ts', 'scripts/ops/t2-proof-bundle.test.ts'],
    file_scope_lock: ['scripts/ops/t2-proof-bundle.ts', 'scripts/ops/t2-proof-bundle.test.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-1067/t2-proof-bundle.md'],
    status: 'merged',
    started_at: '2026-05-19T00:00:00.000Z',
    heartbeat_at: '2026-05-19T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/codex/utv2-1067-t2-proof-bundle.json',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

function input(overrides: Partial<LaneManifest> = {}) {
  return {
    manifest: manifest(overrides),
    generatedAt: '2026-05-19T18:30:00.000Z',
    diffSummary: 'scripts/ops/t2-proof-bundle.ts | 120 ++++++++++',
    verificationSummary: 'pnpm verify: PASS',
    rLevelOutput: 'R-level compliance: PASS',
  };
}

test('eligible T2 ops lane writes missing declared proof path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-'));
  try {
    const result = generateT2ProofBundle(input(), { root });
    const proofPath = path.join(root, 'docs/06_status/proof/UTV2-1067/t2-proof-bundle.md');

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.generated_paths, ['docs/06_status/proof/UTV2-1067/t2-proof-bundle.md']);
    assert.strictEqual(fs.existsSync(proofPath), true);
    const content = fs.readFileSync(proofPath, 'utf8');
    assert.match(content, /PR URL: https:\/\/github\.com\/griff843\/Unit-Talk-v2\/pull\/1067/);
    assert.match(content, /Merge SHA: abc123merge/);
    assert.match(content, /pnpm verify: PASS/);
    assert.match(content, /R-level compliance: PASS/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime and T1 lanes are not eligible for generated T2 proof', () => {
  assert.strictEqual(isEligibleT2OpsLane(manifest({ lane_type: 'runtime' })), false);
  assert.strictEqual(isEligibleT2OpsLane(manifest({ tier: 'T1' })), false);

  const runtime = generateT2ProofBundle(input({ lane_type: 'runtime' }), {
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-runtime-')),
  });
  assert.strictEqual(runtime.ok, false);
  assert.strictEqual(runtime.code, 'proof_ineligible');
});

test('missing merge SHA is a hard failure', () => {
  const result = generateT2ProofBundle(input({ commit_sha: null }), {
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-sha-')),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'missing_merge_sha');
});

test('generated proof content is SHA-bound', () => {
  const content = buildT2ProofBundle(input());

  assert.match(content, /Merge SHA: abc123merge/);
  assert.match(content, /This proof bundle is bound to merge SHA abc123merge\./);
});

test('existing proof path is skipped unless force is supplied', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-existing-'));
  try {
    const proofPath = path.join(root, 'docs/06_status/proof/UTV2-1067/t2-proof-bundle.md');
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, 'existing proof\n', 'utf8');

    const skipped = generateT2ProofBundle(input(), { root });
    assert.deepStrictEqual(skipped.generated_paths, []);
    assert.deepStrictEqual(skipped.skipped_paths, ['docs/06_status/proof/UTV2-1067/t2-proof-bundle.md']);
    assert.strictEqual(fs.readFileSync(proofPath, 'utf8'), 'existing proof\n');

    const forced = generateT2ProofBundle(input(), { root, force: true });
    assert.deepStrictEqual(forced.generated_paths, ['docs/06_status/proof/UTV2-1067/t2-proof-bundle.md']);
    assert.match(fs.readFileSync(proofPath, 'utf8'), /Merge SHA: abc123merge/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
