import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFileScopeGuard, matchesLockPattern } from './file-scope-guard.js';

test('matchesLockPattern supports exact, directory, and doublestar locks', () => {
  assert.equal(matchesLockPattern('apps/api/src/index.ts', 'apps/api/src/index.ts'), true);
  assert.equal(matchesLockPattern('apps/api/src/routes/foo.ts', 'apps/api/src'), true);
  assert.equal(matchesLockPattern('apps/api/src/routes/foo.ts', 'apps/api/src/**'), true);
  assert.equal(matchesLockPattern('apps/api/test/foo.ts', 'apps/api/src/**'), false);
});

test('own lane permits declared file_scope_lock paths', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['scripts/ci/file-scope-guard.ts'],
    manifests: [
      {
        issue_id: 'UTV2-1495',
        branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
        status: 'started',
        file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
      },
    ],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});

test('own lane permits declared expected proof paths', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['docs/06_status/proof/UTV2-1495/verification.md'],
    manifests: [
      {
        issue_id: 'UTV2-1495',
        branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
        status: 'started',
        file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
        expected_proof_paths: ['docs/06_status/proof/UTV2-1495/verification.md'],
      },
    ],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});

test('own lane permits its issue-specific control-plane files', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: [
      '.ops/sync/UTV2-1495.yml',
      'docs/06_status/lanes/UTV2-1495.json',
      'docs/06_status/proof/UTV2-1495/.gitkeep',
    ],
    manifests: [
      {
        issue_id: 'UTV2-1495',
        branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
        status: 'started',
        file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
      },
    ],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});

test('own lane rejects files outside file scope and expected proofs', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['apps/api/src/index.ts', 'docs/06_status/lanes/UTV2-1496.json'],
    manifests: [
      {
        issue_id: 'UTV2-1495',
        branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
        status: 'started',
        file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
        expected_proof_paths: ['docs/06_status/proof/UTV2-1495/verification.md'],
      },
    ],
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.outside_scope, [
    {
      file: 'apps/api/src/index.ts',
      branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
      issue_id: 'UTV2-1495',
    },
    {
      file: 'docs/06_status/lanes/UTV2-1496.json',
      branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
      issue_id: 'UTV2-1495',
    },
  ]);
});

test('lane branch without an active own manifest fails closed', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['scripts/ci/file-scope-guard.ts'],
    manifests: [],
  });

  assert.equal(result.verdict, 'FAIL');
  assert.match(result.errors.join('\n'), /No active lane manifest found/);
});

test('guard reports overlaps with other active lane locks', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['scripts/ci/file-scope-guard.ts'],
    manifests: [
      {
        issue_id: 'UTV2-1495',
        branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
        status: 'started',
        file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
      },
      {
        issue_id: 'UTV2-1496',
        branch: 'claude/utv2-1496-overlap',
        status: 'in_progress',
        file_scope_lock: ['scripts/ci/**'],
      },
    ],
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.conflicts, [
    {
      file: 'scripts/ci/file-scope-guard.ts',
      locked_by: 'UTV2-1496',
      lane_branch: 'claude/utv2-1496-overlap',
      lock_pattern: 'scripts/ci/**',
    },
  ]);
});

test('guard ignores done lane locks', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['scripts/ci/file-scope-guard.ts'],
    manifests: [
      {
        issue_id: 'UTV2-1495',
        branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
        status: 'started',
        file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
      },
      {
        issue_id: 'UTV2-1496',
        branch: 'claude/utv2-1496-overlap',
        status: 'done',
        file_scope_lock: ['scripts/ci/**'],
      },
    ],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.conflicts, []);
});
