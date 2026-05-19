import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrMergeToManifest } from './lane-manifest.js';
import {
  type LaneManifest,
  createManifest,
  defaultProofPaths,
  worktreePathForBranch,
} from './shared.js';

const PR_URL = 'https://github.com/unit-talk/Unit-Talk-v2/pull/1066';
const MERGE_SHA = 'abc123merge456';

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    ...createManifest({
      issue_id: 'UTV2-1066',
      tier: 'T2',
      branch: 'codex/utv2-1066-record-merge-sha',
      worktree_path: worktreePathForBranch('codex/utv2-1066-record-merge-sha'),
      file_scope_lock: ['scripts/ops/lane-manifest.ts'],
      expected_proof_paths: defaultProofPaths('UTV2-1066', 'T2'),
      preflight_token: '.out/ops/preflight/codex/utv2-1066-record-merge-sha.json',
      status: 'in_review',
      now: '2026-05-19T12:00:00.000Z',
    }),
    ...overrides,
  };
}

function mergedPr(overrides = {}) {
  return {
    input: PR_URL,
    url: PR_URL,
    merged: true,
    mergeSha: MERGE_SHA,
    state: 'merged',
    ...overrides,
  };
}

test('applyPrMergeToManifest records merge SHA, PR URL, heartbeat, status, and source history', () => {
  const result = applyPrMergeToManifest({
    manifest: manifest(),
    pr: mergedPr(),
    now: '2026-05-19T13:00:00.000Z',
  });

  assert.strictEqual(result.manifest.status, 'merged');
  assert.strictEqual(result.manifest.commit_sha, MERGE_SHA);
  assert.strictEqual(result.manifest.pr_url, PR_URL);
  assert.strictEqual(result.manifest.heartbeat_at, '2026-05-19T13:00:00.000Z');
  assert.strictEqual(result.historyAppended, true);
  assert.deepStrictEqual(result.manifest.truth_check_history, [
    {
      checked_at: '2026-05-19T13:00:00.000Z',
      verdict: 'pass',
      merge_sha: MERGE_SHA,
      failures: [],
      runner: 'manual',
      source: 'github_pr_merge_commit',
      pr_url: PR_URL,
    },
  ]);
});

test('applyPrMergeToManifest preserves Done status and existing PR URL', () => {
  const result = applyPrMergeToManifest({
    manifest: manifest({
      status: 'done',
      pr_url: 'https://github.com/unit-talk/Unit-Talk-v2/pull/999',
    }),
    pr: mergedPr(),
    now: '2026-05-19T13:00:00.000Z',
  });

  assert.strictEqual(result.manifest.status, 'done');
  assert.strictEqual(result.manifest.pr_url, 'https://github.com/unit-talk/Unit-Talk-v2/pull/999');
  assert.strictEqual(result.manifest.commit_sha, MERGE_SHA);
});

test('applyPrMergeToManifest is idempotent for an already recorded source entry', () => {
  const existing = manifest({
    status: 'merged',
    commit_sha: MERGE_SHA,
    pr_url: PR_URL,
    truth_check_history: [
      {
        checked_at: '2026-05-19T13:00:00.000Z',
        verdict: 'pass',
        merge_sha: MERGE_SHA,
        failures: [],
        runner: 'manual',
        source: 'github_pr_merge_commit',
        pr_url: PR_URL,
      } as LaneManifest['truth_check_history'][number],
    ],
  });

  const result = applyPrMergeToManifest({
    manifest: existing,
    pr: mergedPr(),
    now: '2026-05-19T14:00:00.000Z',
  });

  assert.strictEqual(result.manifest.truth_check_history.length, 1);
  assert.strictEqual(result.historyAppended, false);
  assert.strictEqual(result.manifest.heartbeat_at, '2026-05-19T14:00:00.000Z');
});

test('applyPrMergeToManifest fails clearly for unmerged PRs', () => {
  assert.throws(
    () =>
      applyPrMergeToManifest({
        manifest: manifest(),
        pr: mergedPr({ merged: false, mergeSha: null, state: 'open' }),
        now: '2026-05-19T13:00:00.000Z',
      }),
    /not merged or has no merge commit SHA/,
  );
});

test('applyPrMergeToManifest fails clearly when existing manifest SHA conflicts', () => {
  assert.throws(
    () =>
      applyPrMergeToManifest({
        manifest: manifest({ commit_sha: 'different-sha' }),
        pr: mergedPr(),
        now: '2026-05-19T13:00:00.000Z',
      }),
    /conflicts with PR merge SHA/,
  );
});
