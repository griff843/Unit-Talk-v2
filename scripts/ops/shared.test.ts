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
    'docs/06_status/proof/UTV2-539/verification.log',
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
