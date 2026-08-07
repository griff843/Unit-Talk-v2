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

test('UTV2-1563: a manifest reset to status "merged" is still resolved as the trusted own-lane manifest', () => {
  // A lane manifest legitimately sits at status "merged" between a PR
  // merging and ops:lane-close finishing full closure (or after a
  // deliberate reset from "done" back to "merged" to allow a genuine
  // re-run of the close). ACTIVE_STATUSES previously excluded "merged",
  // so the manifest -- and its own file_scope_lock -- became invisible to
  // this guard during that window, and no scope-override could compensate
  // either, since overrides only ever apply to an already-active manifest.
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['scripts/ci/file-scope-guard.ts'],
    manifests: [
      {
        issue_id: 'UTV2-1495',
        branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
        status: 'merged',
        file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
      },
    ],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
  assert.deepEqual(result.errors, []);
});

test('UTV2-1563: a manifest at status "merged" still enforces its file_scope_lock, not just passively resolved', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    changedFiles: ['apps/api/src/index.ts'],
    manifests: [
      {
        issue_id: 'UTV2-1495',
        branch: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
        status: 'merged',
        file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
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
  ]);
});

// ── UTV2-1571: merged historical scope vs. active edit-lock ownership ──────
//
// UTV2-1550 merged (PR #1239) but is stuck at status "merged" forever -- its
// own merge commit's required-check identity changed as a side effect of the
// very PR being evaluated, so G4 (truth-check's CI-green gate) can never
// pass for that specific merge SHA. Before this fix, ACTIVE_STATUSES treated
// "merged" as active for BOTH own-lane self-scope resolution AND foreign-lane
// conflict-blocking, so UTV2-1550's file_scope_lock (which legitimately
// includes package.json, per its real merged diff) permanently blocked every
// other lane (e.g. UTV2-1560) from touching package.json, with no way to
// release that lock short of falsifying the historical files_changed record
// (rejected, PR #1288). These tests prove the fix: a merged manifest keeps
// resolving as ITS OWN trusted scope (UTV2-1563's fix, unchanged) while no
// longer counting as an active edit-lock against ANYONE ELSE'S diff.

test('UTV2-1571: a merged historical lane no longer blocks a different lane touching the same locked path', () => {
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1560-continuation',
    changedFiles: ['package.json'],
    manifests: [
      {
        issue_id: 'UTV2-1560',
        branch: 'claude/utv2-1560-continuation',
        status: 'started',
        file_scope_lock: ['package.json'],
      },
      {
        // Models UTV2-1550: merged, files_changed includes package.json (the
        // real, immutable historical record from PR #1239), file_scope_lock
        // still declares it too (never falsified) -- but status "merged"
        // alone, with no live continuation, must not block UTV2-1560.
        issue_id: 'UTV2-1550',
        branch: 'claude/utv2-1550-executor-result-required-check-identity',
        status: 'merged',
        file_scope_lock: ['package.json', 'scripts/ops/executor-result-validate.ts'],
        files_changed: ['package.json', 'scripts/ops/executor-result-validate.ts'],
      },
    ],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.outside_scope, []);
});

test('UTV2-1571: a merged historical lane still resolves as its OWN branch\'s trusted self-scope while simultaneously not blocking a foreign lane (combined regression)', () => {
  const mergedManifest = {
    issue_id: 'UTV2-1550',
    branch: 'claude/utv2-1550-executor-result-required-check-identity',
    status: 'merged',
    file_scope_lock: ['package.json'],
    files_changed: ['package.json'],
  };
  const foreignManifest = {
    issue_id: 'UTV2-1560',
    branch: 'claude/utv2-1560-continuation',
    status: 'started',
    file_scope_lock: ['package.json'],
  };

  // Evaluated as UTV2-1550's own PR (in isolation -- no other lane holding an
  // active, overlapping lock exists yet): still resolves and still enforces
  // its own declared scope (unchanged UTV2-1563 behavior).
  const ownEvaluation = evaluateFileScopeGuard({
    prBranch: mergedManifest.branch,
    changedFiles: ['package.json'],
    manifests: [mergedManifest],
  });
  assert.equal(ownEvaluation.verdict, 'PASS');
  assert.equal(ownEvaluation.own_manifest_issue, 'UTV2-1550');

  // Evaluated as UTV2-1560's PR: the merged manifest must not appear as a
  // conflicting foreign lock.
  const foreignEvaluation = evaluateFileScopeGuard({
    prBranch: foreignManifest.branch,
    changedFiles: ['package.json'],
    manifests: [mergedManifest, foreignManifest],
  });
  assert.equal(foreignEvaluation.verdict, 'PASS');
  assert.deepEqual(foreignEvaluation.conflicts, []);
});

test('UTV2-1571: an active continuation (status "reopened") of a previously-merged lane still blocks other lanes', () => {
  // A merged lane resumed via a genuine continuation transitions back to an
  // active status (TRANSITIONS in scripts/ops/shared.ts: merged -> reopened
  // is the only path back to active). Once that happens, normal conflict
  // blocking must resume exactly as for any other active lane -- the
  // "merged never blocks" exemption must NOT leak into genuinely active
  // continuations.
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1560-continuation',
    changedFiles: ['package.json'],
    manifests: [
      {
        issue_id: 'UTV2-1560',
        branch: 'claude/utv2-1560-continuation',
        status: 'started',
        file_scope_lock: ['package.json'],
      },
      {
        issue_id: 'UTV2-1550',
        branch: 'claude/utv2-1550-executor-result-required-check-identity',
        status: 'reopened',
        file_scope_lock: ['package.json'],
        files_changed: ['package.json'],
      },
    ],
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.conflicts, [
    {
      file: 'package.json',
      locked_by: 'UTV2-1550',
      lane_branch: 'claude/utv2-1550-executor-result-required-check-identity',
      lock_pattern: 'package.json',
    },
  ]);
});

test('UTV2-1571: files_changed (historical record) is never consulted for conflict-blocking, even when it diverges from file_scope_lock', () => {
  // Post-merge, a lane's file_scope_lock and files_changed can legitimately
  // diverge in principle (files_changed is the immutable ground truth;
  // file_scope_lock is what was declared at lane-start). Prove the guard
  // only ever reads file_scope_lock for this determination -- a path present
  // in files_changed but absent from file_scope_lock must never trigger a
  // conflict, regardless of manifest status.
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/some-other-lane',
    changedFiles: ['scripts/ops/workflow-hardening.test.ts'],
    manifests: [
      {
        issue_id: 'UTV2-1550',
        branch: 'claude/utv2-1550-executor-result-required-check-identity',
        status: 'started', // even in an ACTIVE status
        file_scope_lock: ['package.json'],
        files_changed: ['package.json', 'scripts/ops/workflow-hardening.test.ts'],
      },
    ],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.conflicts, []);
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

test('own lane proof directory (UTV2-1518 reopened): a fresh multi-commit lane whose SECOND commit adds proof files still passes without needing them in expected_proof_paths', () => {
  // Reproduces the exact two-commit T3 docs-lane failure hit live on
  // UTV2-1428: `ops:lane-start` commits the manifest with
  // expected_proof_paths: [] (nothing generated yet), then a LATER commit
  // runs `ops:proof-generate` and adds diff-summary.md/verification.md.
  // Trusted resolution locks expected_proof_paths to the FIRST commit's
  // (empty) content, so the guard must not depend on expected_proof_paths
  // to permit these files -- they are the lane's own canonical proof
  // bookkeeping and must always be allowed via ownLaneControlPlanePatterns.
  const source = fakeGitSource({
    refs: {
      base: {},
      head: {
        'docs/06_status/lanes/UTV2-1600.json': JSON.stringify({
          issue_id: 'UTV2-1600',
          branch: 'claude/utv2-1600-fresh-docs-lane',
          status: 'started',
          file_scope_lock: ['docs/05_operations/SOME_DOC.md'],
          expected_proof_paths: [
            'docs/06_status/proof/UTV2-1600/diff-summary.md',
            'docs/06_status/proof/UTV2-1600/verification.md',
          ],
        }),
      },
      'first-commit-sha': {
        'docs/06_status/lanes/UTV2-1600.json': JSON.stringify({
          issue_id: 'UTV2-1600',
          branch: 'claude/utv2-1600-fresh-docs-lane',
          status: 'started',
          file_scope_lock: ['docs/05_operations/SOME_DOC.md'],
          expected_proof_paths: [],
        }),
      },
    },
    firstAdditions: {
      'base..head::docs/06_status/lanes/UTV2-1600.json': 'first-commit-sha',
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head');
  // Confirms the premise: trusted content is locked to the first commit's
  // EMPTY expected_proof_paths, not head's widened (later-committed) value.
  assert.deepEqual(manifests[0].expected_proof_paths, []);

  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1600-fresh-docs-lane',
    changedFiles: [
      'docs/05_operations/SOME_DOC.md',
      'docs/06_status/proof/UTV2-1600/diff-summary.md',
      'docs/06_status/proof/UTV2-1600/verification.md',
    ],
    manifests,
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});

test('own lane proof directory (UTV2-1518 reopened): files outside the proof directory still require file_scope_lock/expected_proof_paths declaration', () => {
  // Companion to the test above: the proof-directory exemption must not
  // become a general escape hatch. A file outside the lane's declared
  // file_scope_lock and outside its proof directory still fails closed.
  const source = fakeGitSource({
    refs: {
      base: {},
      head: {
        'docs/06_status/lanes/UTV2-1600.json': JSON.stringify({
          issue_id: 'UTV2-1600',
          branch: 'claude/utv2-1600-fresh-docs-lane',
          status: 'started',
          file_scope_lock: ['docs/05_operations/SOME_DOC.md'],
          expected_proof_paths: [],
        }),
      },
      'first-commit-sha': {
        'docs/06_status/lanes/UTV2-1600.json': JSON.stringify({
          issue_id: 'UTV2-1600',
          branch: 'claude/utv2-1600-fresh-docs-lane',
          status: 'started',
          file_scope_lock: ['docs/05_operations/SOME_DOC.md'],
          expected_proof_paths: [],
        }),
      },
    },
    firstAdditions: {
      'base..head::docs/06_status/lanes/UTV2-1600.json': 'first-commit-sha',
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head');
  const result = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1600-fresh-docs-lane',
    changedFiles: [
      'docs/05_operations/SOME_DOC.md',
      'docs/06_status/proof/UTV2-1600/diff-summary.md',
      'apps/api/src/unrelated.ts',
    ],
    manifests,
  });

  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.outside_scope, [
    { file: 'apps/api/src/unrelated.ts', branch: 'claude/utv2-1600-fresh-docs-lane', issue_id: 'UTV2-1600' },
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

test('trusted resolution excludes parked manifests from active scope evaluation', () => {
  const source = fakeGitSource({
    refs: {
      base: {
        'docs/06_status/lanes/UTV2-1601.json': JSON.stringify({
          issue_id: 'UTV2-1601',
          branch: 'codex/utv2-1601-active-lane',
          status: 'started',
          file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
        }),
        'docs/06_status/lanes/parked/UTV2-1602.json': JSON.stringify({
          issue_id: 'UTV2-1602',
          branch: 'codex/utv2-1602-parked-lane',
          status: 'started',
          file_scope_lock: ['scripts/ci/file-scope-guard.ts'],
        }),
      },
      head: {},
    },
  });

  const manifests = resolveTrustedManifests(source, 'base', 'head');
  assert.deepEqual(manifests.map((manifest) => manifest.issue_id), ['UTV2-1601']);

  const result = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1601-active-lane',
    changedFiles: ['scripts/ci/file-scope-guard.ts'],
    manifests,
  });
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.conflicts, []);
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

// ── Own-manifest continuation binding (UTV2-1524 P1 correction) ────────────
//
// findOwnManifest's issue-ID fallback exists for a real case (a continuation
// PR for an already-merged-but-unclosed lane, opened from a renamed branch)
// but an issue ID merely embedded in a branch name is not, by itself, proof
// that this PR continues that lane -- any branch could contain that token.
// Codex's P1 review of the first cut of this fix found exactly that: the
// fallback matched on issue ID alone, letting an unrelated branch inherit
// another lane's file_scope_lock and be silently excluded from conflict
// detection. The fallback must require a trusted continuation binding: an
// externally authorized scope-override/v1 comment bound to the exact issue,
// PR number, and head SHA -- the same GitHub-attested trust anchor already
// used to widen path scope.

const MERGED_LANE_MANIFEST = {
  issue_id: 'UTV2-1516',
  branch: 'codex/utv2-1516-throttle-verify-concurrency',
  status: 'in_review',
  file_scope_lock: ['scripts/ops/proof-generate.ts'],
};
const CONTINUATION_BRANCH = 'claude/utv2-1516-follow-up-different-branch-name';
const VALID_CONTINUATION_OVERRIDE = {
  issue_id: 'UTV2-1516',
  pr_number: 99,
  head_sha: 'deadbeef',
  paths: ['docs/06_status/KNOWN_DEBT.md'],
  authorized_by: 'griff843',
  reason: 'follow-up fix needs an extra file',
};

test('own manifest resolution: exact branch match still passes with no override needed', () => {
  const result = evaluateFileScopeGuard({
    prBranch: MERGED_LANE_MANIFEST.branch,
    changedFiles: ['scripts/ops/proof-generate.ts'],
    manifests: [MERGED_LANE_MANIFEST],
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});

test('own manifest resolution (UTV2-1524 P1 correction): a same-issue continuation with NO authorization fails closed', () => {
  // This is the exact premise Codex flagged as unsafe: no override at all is
  // provided, yet the branch embeds the same issue ID as an existing active
  // manifest. The fallback must NOT resolve ownManifest from the issue-ID
  // token alone.
  const result = evaluateFileScopeGuard({
    prBranch: CONTINUATION_BRANCH,
    changedFiles: ['docs/06_status/KNOWN_DEBT.md'],
    manifests: [MERGED_LANE_MANIFEST],
  });

  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.own_manifest_issue, null);
  assert.match(result.errors.join('\n'), /No active lane manifest found/);
});

test('own manifest resolution (UTV2-1524 P1 correction): an unrelated branch containing the same issue ID cannot inherit the manifest scope, and cannot bypass conflict detection', () => {
  // `codex/utv2-1516-unrelated` embeds the same issue ID as MERGED_LANE_MANIFEST
  // purely by coincidence/copy-paste, but is not actually that lane's
  // continuation and carries no authorization. It must not inherit
  // MERGED_LANE_MANIFEST's file_scope_lock, and MERGED_LANE_MANIFEST must
  // still be evaluated as a foreign lane for conflict purposes -- i.e. the
  // exact `manifest === ownManifest` skip must not fire for it.
  const unrelatedBranch = 'codex/utv2-1516-unrelated';
  const result = evaluateFileScopeGuard({
    prBranch: unrelatedBranch,
    changedFiles: ['scripts/ops/proof-generate.ts'],
    manifests: [MERGED_LANE_MANIFEST],
  });

  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.own_manifest_issue, null);
  assert.deepEqual(result.conflicts, [
    {
      file: 'scripts/ops/proof-generate.ts',
      locked_by: 'UTV2-1516',
      lane_branch: 'codex/utv2-1516-throttle-verify-concurrency',
      lock_pattern: 'scripts/ops/proof-generate.ts',
    },
  ]);
});

test('own manifest resolution (UTV2-1524 P1 correction): a properly authorized, PR-number-bound and head-SHA-bound continuation succeeds', () => {
  const result = evaluateFileScopeGuard({
    prBranch: CONTINUATION_BRANCH,
    changedFiles: ['docs/06_status/KNOWN_DEBT.md'],
    manifests: [MERGED_LANE_MANIFEST],
    externalOverrides: [VALID_CONTINUATION_OVERRIDE],
    prNumber: 99,
    headSha: 'deadbeef',
  });

  assert.equal(result.verdict, 'PASS');
  assert.equal(result.own_manifest_issue, 'UTV2-1516');
  assert.deepEqual(result.outside_scope, []);
});

test('own manifest resolution (UTV2-1524 P1 correction): a stale continuation override (head SHA no longer matches) fails closed', () => {
  const result = evaluateFileScopeGuard({
    prBranch: CONTINUATION_BRANCH,
    changedFiles: ['docs/06_status/KNOWN_DEBT.md'],
    manifests: [MERGED_LANE_MANIFEST],
    externalOverrides: [VALID_CONTINUATION_OVERRIDE],
    prNumber: 99,
    headSha: 'a-new-commit-landed-after-the-override-was-posted',
  });

  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.own_manifest_issue, null);
});

test('own manifest resolution (UTV2-1524 P1 correction): a wrong-PR continuation override fails closed', () => {
  const result = evaluateFileScopeGuard({
    prBranch: CONTINUATION_BRANCH,
    changedFiles: ['docs/06_status/KNOWN_DEBT.md'],
    manifests: [MERGED_LANE_MANIFEST],
    externalOverrides: [VALID_CONTINUATION_OVERRIDE],
    prNumber: 7, // does not match VALID_CONTINUATION_OVERRIDE.pr_number
    headSha: 'deadbeef',
  });

  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.own_manifest_issue, null);
});

test('own manifest resolution (UTV2-1524 P1 correction): a wrong-issue continuation override does not authorize a different lane\'s branch', () => {
  const result = evaluateFileScopeGuard({
    prBranch: CONTINUATION_BRANCH,
    changedFiles: ['docs/06_status/KNOWN_DEBT.md'],
    manifests: [MERGED_LANE_MANIFEST],
    externalOverrides: [{ ...VALID_CONTINUATION_OVERRIDE, issue_id: 'UTV2-9999' }],
    prNumber: 99,
    headSha: 'deadbeef',
  });

  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.own_manifest_issue, null);
});

test('own manifest resolution (UTV2-1524 P1 correction): a valid continuation override does not authorize paths beyond its declared scope', () => {
  // The override only lists docs/06_status/KNOWN_DEBT.md. Even though it
  // successfully authorizes the continuation binding (ownManifest resolves),
  // a second changed file that is in neither the override's paths nor the
  // manifest's own file_scope_lock/expected_proof_paths must still be flagged.
  const result = evaluateFileScopeGuard({
    prBranch: CONTINUATION_BRANCH,
    changedFiles: ['docs/06_status/KNOWN_DEBT.md', 'apps/api/src/unrelated.ts'],
    manifests: [MERGED_LANE_MANIFEST],
    externalOverrides: [VALID_CONTINUATION_OVERRIDE],
    prNumber: 99,
    headSha: 'deadbeef',
  });

  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.own_manifest_issue, 'UTV2-1516');
  assert.deepEqual(result.outside_scope, [
    { file: 'apps/api/src/unrelated.ts', branch: CONTINUATION_BRANCH, issue_id: 'UTV2-1516' },
  ]);
});

test('resolveApplicableOverride: when two comments match the same head SHA, the later one wins', () => {
  const earlier = {
    issue_id: 'UTV2-1516',
    pr_number: 99,
    head_sha: 'deadbeef',
    paths: ['docs/06_status/KNOWN_DEBT.md'],
    authorized_by: 'griff843',
    reason: 'first pass, incomplete path list',
  };
  const later = {
    issue_id: 'UTV2-1516',
    pr_number: 99,
    head_sha: 'deadbeef',
    paths: ['docs/06_status/KNOWN_DEBT.md', 'apps/api/src/unrelated.ts'],
    authorized_by: 'griff843',
    reason: 'corrected: this is the complete path set for this head SHA',
  };

  const result = evaluateFileScopeGuard({
    prBranch: CONTINUATION_BRANCH,
    changedFiles: ['docs/06_status/KNOWN_DEBT.md', 'apps/api/src/unrelated.ts'],
    manifests: [MERGED_LANE_MANIFEST],
    externalOverrides: [earlier, later],
    prNumber: 99,
    headSha: 'deadbeef',
  });

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.outside_scope, []);
});
