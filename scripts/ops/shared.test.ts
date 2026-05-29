import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManifest,
  defaultProofPaths,
  normalizeFileScopePath,
  normalizeRepoRelativePath,
  validateBranchName,
  validateManifest,
  worktreePathForBranch,
} from './shared.js';

test('normalizeFileScopePath canonicalizes repo-relative file paths', () => {
  const normalized = normalizeFileScopePath('.\\docs\\05_operations\\EXECUTION_TRUTH_MODEL.md');
  assert.strictEqual(normalized, 'docs/05_operations/EXECUTION_TRUTH_MODEL.md');
});

test('normalizeFileScopePath rejects parent traversal', () => {
  assert.throws(
    () => normalizeFileScopePath('../docs/05_operations/EXECUTION_TRUTH_MODEL.md'),
    /Parent traversal is not allowed/,
  );
});

test('normalizeFileScopePath accepts non-existent proof paths without requiring existence', () => {
  // Proof paths are intent declarations — the lane will create them.
  // They must not throw even when the file does not exist on disk.
  const normalized = normalizeFileScopePath(
    'docs/06_status/proof/UTV2-9999/diff-summary.md',
  );
  assert.strictEqual(normalized, 'docs/06_status/proof/UTV2-9999/diff-summary.md');
});

test('normalizeFileScopePath still rejects parent traversal for proof paths', () => {
  assert.throws(
    () => normalizeFileScopePath('../docs/06_status/proof/UTV2-9999/diff-summary.md'),
    /Parent traversal is not allowed/,
  );
});

test('normalizeRepoRelativePath allows canonical deleted-file style paths', () => {
  const normalized = normalizeRepoRelativePath('docs/06_status/lanes/deleted-file.json');
  assert.strictEqual(normalized, 'docs/06_status/lanes/deleted-file.json');
});

test('validateBranchName enforces ratified branch format', () => {
  assert.doesNotThrow(() => validateBranchName('codex/utv2-539-truth-check'));
  assert.throws(() => validateBranchName('Codex/UTV2-539-truth-check'), /lowercase/);
  assert.throws(() => validateBranchName('codex/utv2-539'), /<owner>\/<issue-id-lowercase>-<slug>/);
});

test('defaultProofPaths are tier-aware', () => {
  assert.deepStrictEqual(defaultProofPaths('UTV2-539', 'T1'), ['docs/06_status/proof/UTV2-539/evidence.json']);
  assert.deepStrictEqual(defaultProofPaths('UTV2-539', 'T2'), [
    'docs/06_status/proof/UTV2-539/diff-summary.md',
    'docs/06_status/proof/UTV2-539/verification.md',
  ]);
  assert.deepStrictEqual(defaultProofPaths('UTV2-539', 'T3'), []);
});

test('validateManifest accepts a canonical done status manifest', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-539',
    tier: 'T2',
    branch: 'codex/utv2-539-truth-check',
    worktree_path: worktreePathForBranch('codex/utv2-539-truth-check'),
    file_scope_lock: ['docs/05_operations/EXECUTION_TRUTH_MODEL.md'],
    expected_proof_paths: defaultProofPaths('UTV2-539', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-539-truth-check.json',
  });
  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  const errors = validateManifest(manifest);
  assert.deepStrictEqual(errors, []);
});

test('validateManifest rejects dispatch-auto for active lane manifests', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1025',
    tier: 'T2',
    branch: 'codex/utv2-1025-preflight-token-validation',
    worktree_path: worktreePathForBranch('codex/utv2-1025-preflight-token-validation'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1025', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1025-preflight-token-validation.json',
  });
  manifest.preflight_token = 'dispatch-auto';

  assert.match(
    validateManifest(manifest).join('\n'),
    /preflight_token must reference a real preflight token file, not dispatch-auto/,
  );
});

test('validateManifest preserves legacy closed dispatch-auto compatibility', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1026',
    tier: 'T2',
    branch: 'codex/utv2-1026-legacy-token',
    worktree_path: worktreePathForBranch('codex/utv2-1026-legacy-token'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1026', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1026-legacy-token.json',
  });
  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  manifest.preflight_token = 'dispatch-auto';

  assert.deepStrictEqual(validateManifest(manifest), []);
});

test('createManifest can require a real preflight token file for lane starts', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1027',
        tier: 'T2',
        branch: 'codex/utv2-1027-missing-token',
        worktree_path: worktreePathForBranch('codex/utv2-1027-missing-token'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1027', 'T2'),
        preflight_token: '.out/ops/preflight/codex/utv2-1027-missing-token.json',
        requireExistingPreflightToken: true,
      }),
    /preflight_token file does not exist/,
  );
});

test('validateManifest accepts Windows absolute worktree paths on non-Windows runners', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1062',
    tier: 'T2',
    branch: 'codex/utv2-1062-cross-platform-closeout',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1062', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1062-cross-platform-closeout.json',
  });
  manifest.status = 'merged';
  manifest.created_by = 'codex-cli';
  manifest.execution_location = {
    mode: 'main-control',
    cwd: 'C:\\Dev\\Unit-Talk-v2-main',
    package_install: 'not_required',
  };

  const errors = validateManifest(manifest).filter((entry) =>
    entry.includes('worktree_path') || entry.includes('execution_location.cwd'),
  );
  assert.deepStrictEqual(errors, []);
});
