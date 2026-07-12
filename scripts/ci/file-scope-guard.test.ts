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

test('trusted resolution (UTV2-1521 regression): a manifest-embedded scope_override is never honored, even if well-formed', () => {
  // Before UTV2-1521, a well-formed-looking scope_override object embedded in
  // the manifest's head content was trusted directly -- a self-certification
  // loophole, since the manifest is part of the PR's own diff. This proves
  // that shape is categorically ignored now: base/first-commit content always
  // wins regardless of what the head manifest claims about itself.
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

  const manifests = resolveTrustedManifests(source, 'base', 'head');
  assert.deepEqual(manifests, [
    {
      issue_id: 'UTV2-1496',
      branch: 'claude/utv2-1496-overlap',
      status: 'in_progress',
      file_scope_lock: ['apps/api/src/routes/foo.ts'],
    },
  ]);

  // And even if it somehow were honored, evaluateFileScopeGuard doesn't read
  // scope_override off the manifest at all anymore -- only externalOverrides.
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1496-overlap',
    changedFiles: ['apps/api/src/index.ts'],
    manifests,
  });
  assert.equal(result.verdict, 'FAIL');
});

// ── External scope-override authorization (UTV2-1521) ───────────────────────

const BASE_OVERRIDE = {
  issue_id: 'UTV2-1496',
  pr_number: 42,
  head_sha: 'abc123',
  paths: ['apps/api/src/index.ts'],
  authorized_by: 'griff843',
  reason: 'legitimate scope correction',
};

const OWN_MANIFEST = {
  issue_id: 'UTV2-1496',
  branch: 'claude/utv2-1496-overlap',
  status: 'in_progress',
  file_scope_lock: ['apps/api/src/routes/foo.ts'],
};

test('external override: self-authored override on a PR that is not the target PR is rejected', () => {
  // "Self-authored" in the new model means an override whose PR/head-SHA
  // context doesn't match what's actually being evaluated -- since the
  // override itself always comes from an authenticated GitHub comment (the
  // workflow step only ever writes authenticated matches), the guard's own
  // fail-closed responsibility is to reject any context mismatch outright.
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1496-overlap',
    changedFiles: ['apps/api/src/index.ts'],
    manifests: [OWN_MANIFEST],
    externalOverrides: [BASE_OVERRIDE],
    prNumber: 999, // does not match BASE_OVERRIDE.pr_number
    headSha: 'abc123',
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.outside_scope, [
    { file: 'apps/api/src/index.ts', branch: 'claude/utv2-1496-overlap', issue_id: 'UTV2-1496' },
  ]);
});

test('external override: stale override (head SHA no longer matches) is rejected', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1496-overlap',
    changedFiles: ['apps/api/src/index.ts'],
    manifests: [OWN_MANIFEST],
    externalOverrides: [BASE_OVERRIDE],
    prNumber: 42,
    headSha: 'def456', // a new commit landed after the override was posted
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.outside_scope, [
    { file: 'apps/api/src/index.ts', branch: 'claude/utv2-1496-overlap', issue_id: 'UTV2-1496' },
  ]);
});

test('external override: wrong-issue override does not apply to a different lane', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1496-overlap',
    changedFiles: ['apps/api/src/index.ts'],
    manifests: [OWN_MANIFEST],
    externalOverrides: [{ ...BASE_OVERRIDE, issue_id: 'UTV2-9999' }],
    prNumber: 42,
    headSha: 'abc123',
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.outside_scope, [
    { file: 'apps/api/src/index.ts', branch: 'claude/utv2-1496-overlap', issue_id: 'UTV2-1496' },
  ]);
});

test('external override: wrong-PR override does not apply', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1496-overlap',
    changedFiles: ['apps/api/src/index.ts'],
    manifests: [OWN_MANIFEST],
    externalOverrides: [{ ...BASE_OVERRIDE, pr_number: 7 }],
    prNumber: 42,
    headSha: 'abc123',
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.outside_scope, [
    { file: 'apps/api/src/index.ts', branch: 'claude/utv2-1496-overlap', issue_id: 'UTV2-1496' },
  ]);
});

test('external override: valid override matching issue/PR/head-SHA authorizes exactly its listed paths', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1496-overlap',
    changedFiles: ['apps/api/src/index.ts'],
    manifests: [OWN_MANIFEST],
    externalOverrides: [BASE_OVERRIDE],
    prNumber: 42,
    headSha: 'abc123',
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});

test('external override: a valid override for a DIFFERENT lane does not leak into this one', () => {
  // Guards against the exact Codex UTV2-1518 finding: an override authorized
  // for one issue/PR must never widen a different lane's scope, even if a
  // valid (correctly-authenticated) override object exists somewhere in the
  // externalOverrides list.
  const otherLaneManifest = {
    issue_id: 'UTV2-1497',
    branch: 'claude/utv2-1497-other-lane',
    status: 'in_progress',
    file_scope_lock: ['scripts/ops/foo.ts'],
  };

  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1497-other-lane',
    changedFiles: ['apps/api/src/index.ts'],
    manifests: [otherLaneManifest],
    externalOverrides: [BASE_OVERRIDE], // authorized for UTV2-1496, not UTV2-1497
    prNumber: 42,
    headSha: 'abc123',
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.outside_scope, [
    { file: 'apps/api/src/index.ts', branch: 'claude/utv2-1497-other-lane', issue_id: 'UTV2-1497' },
  ]);
});

test('own manifest resolution (UTV2-1524 regression): a continuation PR from a renamed branch still finds its own lane by issue ID', () => {
  // Reproduces the exact findOwnManifest trap: a lane merges, its manifest on
  // origin/main still names the ORIGINAL branch, but a follow-up PR opens
  // from a differently-named branch for the same issue. Exact branch-string
  // equality alone makes the manifest invisible as "this PR's own lane" and
  // silently disables any otherwise-valid scope-override for it.
  const mergedLaneManifest = {
    issue_id: 'UTV2-1516',
    branch: 'codex/utv2-1516-throttle-verify-concurrency',
    status: 'in_review',
    file_scope_lock: ['scripts/ops/proof-generate.ts'],
  };

  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1516-follow-up-different-branch-name',
    changedFiles: ['scripts/ops/proof-generate.ts'],
    manifests: [mergedLaneManifest],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});

test('own manifest resolution (UTV2-1524 regression): a valid scope-override still applies through the issue-ID fallback', () => {
  const mergedLaneManifest = {
    issue_id: 'UTV2-1516',
    branch: 'codex/utv2-1516-throttle-verify-concurrency',
    status: 'in_review',
    file_scope_lock: ['scripts/ops/proof-generate.ts'],
  };
  const followUpBranch = 'claude/utv2-1516-follow-up-different-branch-name';
  const override = {
    issue_id: 'UTV2-1516',
    pr_number: 99,
    head_sha: 'deadbeef',
    paths: ['docs/06_status/KNOWN_DEBT.md'],
    authorized_by: 'griff843',
    reason: 'follow-up fix needs an extra file',
  };

  const result = evaluateFileScopeGuard({
    prBranch: followUpBranch,
    changedFiles: ['docs/06_status/KNOWN_DEBT.md'],
    manifests: [mergedLaneManifest],
    externalOverrides: [override],
    prNumber: 99,
    headSha: 'deadbeef',
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});
