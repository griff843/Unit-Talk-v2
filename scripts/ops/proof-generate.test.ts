import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildDiffSummary,
  buildRuntimeVerification,
  collectProofGitTruth,
  generateProofArtifacts,
  standardProofPaths,
  type ProofGitTruth,
} from './proof-generate.js';
import type { LaneManifest } from './shared.js';

const HEAD_SHA = '1111111111111111111111111111111111111111';
const MERGE_SHA = '2222222222222222222222222222222222222222';

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1170',
    lane_type: 'verification',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: '.out/worktrees/codex__utv2-1170-proof-generate',
    branch: 'codex/utv2-1170-proof-generate',
    base_branch: 'main',
    commit_sha: MERGE_SHA,
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1170',
    files_changed: ['scripts/ops/proof-generate.ts', 'scripts/ops/proof-generate.test.ts'],
    file_scope_lock: ['scripts/ops/proof-generate.ts', 'scripts/ops/proof-generate.test.ts'],
    expected_proof_paths: [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
    ],
    status: 'merged',
    started_at: '2026-05-25T00:00:00.000Z',
    heartbeat_at: '2026-05-25T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/codex/utv2-1170-proof-generate.json',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

function gitTruth(overrides: Partial<ProofGitTruth> = {}): ProofGitTruth {
  return {
    head_sha: HEAD_SHA,
    merge_sha: MERGE_SHA,
    diff_base_ref: `${MERGE_SHA}^1`,
    diff_target_ref: MERGE_SHA,
    diff_stat: ' scripts/ops/proof-generate.ts | 250 +++++++++++++++++++++',
    name_status: [
      'A\tscripts/ops/proof-generate.ts',
      'A\tscripts/ops/proof-generate.test.ts',
    ].join('\n'),
    ...overrides,
  };
}

function input(overrides: Partial<LaneManifest> = {}) {
  return {
    manifest: manifest(overrides),
    generatedAt: '2026-05-25T16:00:00.000Z',
    gitTruth: gitTruth({ merge_sha: overrides.commit_sha === null ? null : MERGE_SHA }),
  };
}

test('standard proof paths target diff summary and runtime verification docs', () => {
  assert.deepStrictEqual(standardProofPaths('utv2-1170'), {
    'diff-summary.md': 'docs/06_status/proof/UTV2-1170/diff-summary.md',
    'runtime-verification.md': 'docs/06_status/proof/UTV2-1170/runtime-verification.md',
  });
});

test('generated artifacts include manifest metadata, git truth, and SHA bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-generate-'));
  try {
    const result = generateProofArtifacts(input(), { root });
    const diffPath = path.join(root, 'docs/06_status/proof/UTV2-1170/diff-summary.md');
    const runtimePath = path.join(root, 'docs/06_status/proof/UTV2-1170/runtime-verification.md');

    assert.deepStrictEqual(result.generated_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
    ]);
    assert.strictEqual(result.head_sha, HEAD_SHA);
    assert.strictEqual(result.merge_sha, MERGE_SHA);
    assert.strictEqual(fs.existsSync(diffPath), true);
    assert.strictEqual(fs.existsSync(runtimePath), true);

    const diffContent = fs.readFileSync(diffPath, 'utf8');
    const runtimeContent = fs.readFileSync(runtimePath, 'utf8');
    assert.match(diffContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
    assert.match(diffContent, new RegExp(`Merge SHA: ${MERGE_SHA}`));
    assert.match(diffContent, /A\tscripts\/ops\/proof-generate\.ts/);
    assert.match(runtimeContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
    assert.match(runtimeContent, new RegExp(`Merge SHA: ${MERGE_SHA}`));
    assert.match(runtimeContent, /^## Verification/m);
    assert.match(runtimeContent, /`pnpm type-check`/);
    assert.match(runtimeContent, /`pnpm test`/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing artifacts are updated when they are missing current SHA bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-stale-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'diff-summary.md'), 'Merge SHA: stale\n', 'utf8');
    fs.writeFileSync(path.join(proofDir, 'runtime-verification.md'), 'Head SHA: stale\n', 'utf8');

    const result = generateProofArtifacts(input(), { root });

    assert.deepStrictEqual(result.generated_paths, []);
    assert.deepStrictEqual(result.updated_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
    ]);
    assert.deepStrictEqual(result.stale_paths_replaced, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
    ]);
    assert.match(
      fs.readFileSync(path.join(proofDir, 'runtime-verification.md'), 'utf8'),
      new RegExp(`Merge SHA: ${MERGE_SHA}`),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unchanged artifacts are not rewritten', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-unchanged-'));
  try {
    const first = generateProofArtifacts(input(), { root });
    const second = generateProofArtifacts(input(), { root });

    assert.strictEqual(first.generated_paths.length, 2);
    assert.deepStrictEqual(second.generated_paths, []);
    assert.deepStrictEqual(second.updated_paths, []);
    assert.deepStrictEqual(second.unchanged_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pre-merge artifacts bind head SHA and use N/A for merge SHA', () => {
  const preMergeInput = {
    ...input({ commit_sha: null }),
    gitTruth: gitTruth({ merge_sha: null, diff_base_ref: 'base-sha', diff_target_ref: HEAD_SHA }),
  };

  const diffContent = buildDiffSummary(preMergeInput);
  const runtimeContent = buildRuntimeVerification(preMergeInput);

  assert.match(diffContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
  assert.match(diffContent, /Merge SHA: N\/A/);
  assert.match(runtimeContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
  assert.match(runtimeContent, /Merge SHA: N\/A/);
});

test('collectProofGitTruth prefers manifest merge SHA and diffs against first parent', () => {
  const calls: string[][] = [];
  const collected = collectProofGitTruth(manifest(), {
    root: '/tmp/nonexistent-proof-root',
    gitRunner: (args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse HEAD') {
        return { ok: true, stdout: HEAD_SHA, stderr: '' };
      }
      if (args.join(' ') === `diff --stat ${MERGE_SHA}^1 ${MERGE_SHA}`) {
        return { ok: true, stdout: 'stat output', stderr: '' };
      }
      if (args.join(' ') === `diff --name-status ${MERGE_SHA}^1 ${MERGE_SHA}`) {
        return { ok: true, stdout: 'M\tfile.ts', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: 'unexpected' };
    },
  });

  assert.strictEqual(collected.head_sha, HEAD_SHA);
  assert.strictEqual(collected.merge_sha, MERGE_SHA);
  assert.strictEqual(collected.diff_base_ref, `${MERGE_SHA}^1`);
  assert.strictEqual(collected.diff_target_ref, MERGE_SHA);
  assert.strictEqual(collected.diff_stat, 'stat output');
  assert.deepStrictEqual(calls.slice(-2), [
    ['diff', '--stat', `${MERGE_SHA}^1`, MERGE_SHA],
    ['diff', '--name-status', `${MERGE_SHA}^1`, MERGE_SHA],
  ]);
});
