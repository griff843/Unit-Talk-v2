import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFileScopeGuard,
  matchesLockPattern,
  resolveTrustedManifests,
  type GitManifestSource,
} from './file-scope-guard.js';

/**
 * In-memory fake of the git-backed manifest source so the "trusted baseline"
 * resolution logic can be tested without a real git repository. Modeled as
 * ref -> path -> content, plus a manually declared "first commit that added
 * this path" per (base, head, path) triple.
 */
function fakeGitSource(input: {
  refs: Record<string, Record<string, string>>;
  firstAdditions?: Record<string, string>; // key: `${base}..${head}::${path}` -> sha
}): GitManifestSource {
  return {
    listPathsAtRef(ref: string): string[] {
      return Object.keys(input.refs[ref] ?? {});
    },
    readFileAtRef(ref: string, filePath: string): string | null {
      return input.refs[ref]?.[filePath] ?? null;
    },
    firstAddingCommit(base: string, head: string, filePath: string): string | null {
      return input.firstAdditions?.[`${base}..${head}::${filePath}`] ?? null;
    },
  };
}

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

test('trusted resolution: a pre-existing manifest cannot be widened by a same-PR modification', () => {
  const source = fakeGitSource({
    refs: {
      base: {
        'docs/06_status/lanes/UTV2-1496.json': JSON.stringify({
          issue_id: 'UTV2-1496',
          branch: 'claude/utv2-1496-overlap',
          status: 'in_progress',
          file_scope_lock: ['apps/api/src/routes/foo.ts'],
        }),
      },
      head: {
        // The PR's own tree widens its own lock to also cover apps/api/src/index.ts —
        // this must be ignored; base-branch content is authoritative for manifests
        // that already existed before the PR.
        'docs/06_status/lanes/UTV2-1496.json': JSON.stringify({
          issue_id: 'UTV2-1496',
          branch: 'claude/utv2-1496-overlap',
          status: 'in_progress',
          file_scope_lock: ['apps/api/src/routes/foo.ts', 'apps/api/src/index.ts'],
        }),
      },
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head');
  assert.deepEqual(manifests, [
    {
      issue_id: 'UTV2-1496',
      branch: 'claude/utv2-1496-overlap',
      status: 'in_progress',
      file_scope_lock: ['apps/api/src/routes/foo.ts'],
    },
  ]);
});

test('trusted resolution: a manifest newly introduced by this branch is locked to its first-committed content', () => {
  const source = fakeGitSource({
    refs: {
      base: {}, // brand-new lane: manifest does not exist on the base branch at all
      head: {
        // Tip content has been widened by a later commit in the same PR after
        // lane-start's original declaration.
        'docs/06_status/lanes/UTV2-1495.json': JSON.stringify({
          issue_id: 'UTV2-1495',
          branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
          status: 'started',
          file_scope_lock: ['scripts/ci/file-scope-guard.ts', 'apps/api/src/index.ts'],
        }),
      },
      'first-commit-sha': {
        // The content as originally declared by lane-start's commit.
        'docs/06_status/lanes/UTV2-1495.json': JSON.stringify({
          issue_id: 'UTV2-1495',
          branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
          status: 'started',
          file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
        }),
      },
    },
    firstAdditions: {
      'base..head::docs/06_status/lanes/UTV2-1495.json': 'first-commit-sha',
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head');
  assert.deepEqual(manifests, [
    {
      issue_id: 'UTV2-1495',
      branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
      status: 'started',
      file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
    },
  ]);
});

test('trusted resolution + evaluateFileScopeGuard: a same-PR manifest widening attempt still fails the check', () => {
  // End-to-end regression for the Codex P1 finding: a PR that touches an
  // out-of-scope file and simultaneously widens its own manifest's
  // file_scope_lock in the same diff must still FAIL, because trusted
  // resolution ignores the widened (head) content in favor of the
  // first-committed declaration.
  const source = fakeGitSource({
    refs: {
      base: {},
      head: {
        'docs/06_status/lanes/UTV2-1495.json': JSON.stringify({
          issue_id: 'UTV2-1495',
          branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
          status: 'started',
          file_scope_lock: ['scripts/ci/file-scope-guard.ts', 'apps/api/src/index.ts'],
        }),
      },
      'first-commit-sha': {
        'docs/06_status/lanes/UTV2-1495.json': JSON.stringify({
          issue_id: 'UTV2-1495',
          branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
          status: 'started',
          file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
        }),
      },
    },
    firstAdditions: {
      'base..head::docs/06_status/lanes/UTV2-1495.json': 'first-commit-sha',
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head');
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['scripts/ci/file-scope-guard.ts', 'apps/api/src/index.ts'],
    manifests,
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.outside_scope, [
    {
      file: 'apps/api/src/index.ts',
      branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
      issue_id: 'UTV2-1495',
    },
  ]);
});

test('trusted resolution: malformed JSON at the resolved ref is skipped, not thrown', () => {
  const source = fakeGitSource({
    refs: {
      base: { 'docs/06_status/lanes/UTV2-1497.json': '{not valid json' },
      head: {},
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head');
  assert.deepEqual(manifests, []);
});

test('trusted resolution: a well-formed scope_override on the PR branch manifest is honored', () => {
  const source = fakeGitSource({
    refs: {
      base: {
        'docs/06_status/lanes/UTV2-1496.json': JSON.stringify({
          issue_id: 'UTV2-1496',
          branch: 'claude/utv2-1496-overlap',
          status: 'in_progress',
          file_scope_lock: ['apps/api/src/routes/foo.ts'],
        }),
      },
      head: {
        'docs/06_status/lanes/UTV2-1496.json': JSON.stringify({
          issue_id: 'UTV2-1496',
          branch: 'claude/utv2-1496-overlap',
          status: 'in_progress',
          file_scope_lock: ['apps/api/src/routes/foo.ts', 'apps/api/src/index.ts'],
          scope_override: {
            approved_by: 'PM',
            reason: 'legitimate scope correction, documented with evidence',
            evidence: 'https://linear.app/unit-talk-v2/issue/UTV2-1496#comment-123',
          },
        }),
      },
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head', 'claude/utv2-1496-overlap');
  assert.deepEqual(manifests, [
    {
      issue_id: 'UTV2-1496',
      branch: 'claude/utv2-1496-overlap',
      status: 'in_progress',
      file_scope_lock: ['apps/api/src/routes/foo.ts', 'apps/api/src/index.ts'],
      scope_override: {
        approved_by: 'PM',
        reason: 'legitimate scope correction, documented with evidence',
        evidence: 'https://linear.app/unit-talk-v2/issue/UTV2-1496#comment-123',
      },
    },
  ]);
});

test('trusted resolution: a well-formed scope_override on another lane manifest is ignored', () => {
  const source = fakeGitSource({
    refs: {
      base: {
        'docs/06_status/lanes/UTV2-1496.json': JSON.stringify({
          issue_id: 'UTV2-1496',
          branch: 'claude/utv2-1496-overlap',
          status: 'in_progress',
          file_scope_lock: ['apps/api/src/routes/foo.ts'],
        }),
      },
      head: {
        'docs/06_status/lanes/UTV2-1496.json': JSON.stringify({
          issue_id: 'UTV2-1496',
          branch: 'claude/utv2-1496-overlap',
          status: 'in_progress',
          file_scope_lock: ['apps/api/src/routes/foo.ts', 'apps/api/src/index.ts'],
          scope_override: {
            approved_by: 'PM',
            reason: 'legitimate scope correction, documented with evidence',
            evidence: 'https://linear.app/unit-talk-v2/issue/UTV2-1496#comment-123',
          },
        }),
      },
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head', 'codex/utv2-1495-hard-file-scope-lock-enforcement');
  assert.deepEqual(manifests, [
    {
      issue_id: 'UTV2-1496',
      branch: 'claude/utv2-1496-overlap',
      status: 'in_progress',
      file_scope_lock: ['apps/api/src/routes/foo.ts'],
    },
  ]);
});

test('trusted resolution: a malformed scope_override (missing evidence) is never honored', () => {
  const source = fakeGitSource({
    refs: {
      base: {
        'docs/06_status/lanes/UTV2-1496.json': JSON.stringify({
          issue_id: 'UTV2-1496',
          branch: 'claude/utv2-1496-overlap',
          status: 'in_progress',
          file_scope_lock: ['apps/api/src/routes/foo.ts'],
        }),
      },
      head: {
        'docs/06_status/lanes/UTV2-1496.json': JSON.stringify({
          issue_id: 'UTV2-1496',
          branch: 'claude/utv2-1496-overlap',
          status: 'in_progress',
          file_scope_lock: ['apps/api/src/routes/foo.ts', 'apps/api/src/index.ts'],
          scope_override: {
            approved_by: 'PM',
            reason: 'no evidence link supplied',
            // evidence intentionally omitted
          },
        }),
      },
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head', 'claude/utv2-1496-overlap');
  assert.deepEqual(manifests, [
    {
      issue_id: 'UTV2-1496',
      branch: 'claude/utv2-1496-overlap',
      status: 'in_progress',
      file_scope_lock: ['apps/api/src/routes/foo.ts'],
    },
  ]);
});
