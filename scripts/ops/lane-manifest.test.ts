import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyPrMergeToManifest, createCommand, main } from './lane-manifest.js';
import {
  type ScopeReleaseContext,
  type ScopeReleaseRefusalCode,
  type ScopeReleaseRequest,
  evaluateScopeRelease,
  runScopeRelease,
} from './scope-release.js';
import {
  type LaneManifest,
  ROOT,
  createManifest,
  defaultProofPaths,
  hashFileScopeLock,
  issueToManifestPath,
  validateScopeReleaseHistory,
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

test('applyPrMergeToManifest records merge SHA, PR URL, heartbeat, and status -- but no truth_check_history entry', () => {
  const result = applyPrMergeToManifest({
    manifest: manifest(),
    pr: mergedPr(),
    now: '2026-05-19T13:00:00.000Z',
  });

  assert.strictEqual(result.manifest.status, 'merged');
  assert.strictEqual(result.manifest.commit_sha, MERGE_SHA);
  assert.strictEqual(result.manifest.pr_url, PR_URL);
  assert.strictEqual(result.manifest.heartbeat_at, '2026-05-19T13:00:00.000Z');
  // UTV2-1613: this used to assert historyAppended === true and a fabricated
  // { verdict: 'pass', runner: 'manual', source: 'github_pr_merge_commit' }
  // entry -- a governance verdict this function never measured. record-merge
  // only binds GitHub merge state; it must never write to
  // truth_check_history at all.
  assert.strictEqual(result.historyAppended, false);
  assert.deepStrictEqual(result.manifest.truth_check_history, []);
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

test('applyPrMergeToManifest never touches pre-existing truth_check_history, including a legacy fabricated entry', () => {
  // UTV2-1613: this manifest carries a legacy entry of exactly the shape
  // record-merge used to fabricate. A re-run must not deduplicate it, must
  // not add a second one, and must not delete it either -- historical entries
  // are corrected by governed PRs (see ops:truth-history-audit), never by a
  // tool silently rewriting history on an ordinary call.
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

test('applyPrMergeToManifest starting from empty history stays empty -- it never fabricates one', () => {
  const result = applyPrMergeToManifest({
    manifest: manifest({ truth_check_history: [] }),
    pr: mergedPr(),
    now: '2026-05-19T15:00:00.000Z',
  });

  assert.deepStrictEqual(result.manifest.truth_check_history, []);
  assert.strictEqual(result.historyAppended, false);
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

// UTV2-1526: the manual/repair `ops:lane-manifest create` entry point bypasses
// ops:lane-start entirely and previously had no --executor/--model-profile support at
// all -- a Codex manifest created this way had executor left undefined. These tests
// close that gap so this caller is held to the same model-routing rules as lane-start.

test('lane-manifest create requires --model-profile when --executor is codex-cli', () => {
  const flags = new Map<string, string[]>([
    ['issue', ['UTV2-9901']],
    ['tier', ['T2']],
    ['branch', ['codex/utv2-9901-repair']],
    ['files', ['scripts/ops/lane-manifest.ts']],
    ['preflight-token', ['.out/ops/preflight/codex/utv2-9901-repair.json']],
    ['executor', ['codex-cli']],
  ]);
  assert.throws(() => createCommand(flags), /--model-profile is required/);
});

test('lane-manifest create rejects --model-profile for a non-Codex executor', () => {
  const flags = new Map<string, string[]>([
    ['issue', ['UTV2-9902']],
    ['tier', ['T2']],
    ['branch', ['claude/utv2-9902-repair']],
    ['files', ['scripts/ops/lane-manifest.ts']],
    ['preflight-token', ['.out/ops/preflight/claude/utv2-9902-repair.json']],
    ['executor', ['claude']],
    ['model-profile', ['codex-terra-medium']],
  ]);
  assert.throws(() => createCommand(flags), /model_routing is Codex-only/);
});

test('lane-manifest create resolves and persists model_routing for a valid Codex --model-profile', () => {
  const issueId = 'UTV2-9903';
  const manifestPath = issueToManifestPath(issueId);
  const tokenPath = '.out/ops/preflight/codex/utv2-9903-repair.json';
  const tokenAbsolutePath = path.join(ROOT, tokenPath);
  fs.mkdirSync(path.dirname(tokenAbsolutePath), { recursive: true });
  fs.writeFileSync(
    tokenAbsolutePath,
    JSON.stringify({
      schema_version: 1,
      branch: 'codex/utv2-9903-repair',
      head_sha: '0'.repeat(40),
      tier: 'T2',
      issue_id: issueId,
      generated_at: '2026-07-13T00:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      checks: { git: 'pass', env: 'pass', deps: 'pass' },
      status: 'pass',
    }),
  );
  try {
    const flags = new Map<string, string[]>([
      ['issue', [issueId]],
      ['tier', ['T2']],
      ['branch', ['codex/utv2-9903-repair']],
      ['files', ['scripts/ops/lane-manifest.ts']],
      ['preflight-token', [tokenPath]],
      ['executor', ['codex-cli']],
      ['model-profile', ['codex-terra-medium']],
    ]);
    createCommand(flags);
    const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LaneManifest;
    assert.strictEqual(written.model_routing?.profile, 'codex-terra-medium');
    assert.strictEqual(written.model_routing?.model, 'gpt-5.6-terra');
    assert.strictEqual(written.schema_version, 2);
  } finally {
    fs.rmSync(manifestPath, { force: true });
    fs.rmSync(tokenAbsolutePath, { force: true });
  }
});

// ── UTV2-1762: scope-release command surface ────────────────────────────────

test('scope-release is a routed subcommand and refuses an incomplete invocation', () => {
  const captured: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    // Unknown subcommands fall through to usage(); a routed one does not.
    assert.equal(main(['definitely-not-a-command']), 1);
    const usageText = captured.join('\n');
    assert.match(usageText, /scope-release UTV2-123 --pr 456/);

    captured.length = 0;
    // Routed, but missing --release-path: it must fail on its own argument
    // validation before any git/GitHub call, and must not print usage.
    assert.equal(main(['scope-release', 'UTV2-1729', '--pr', '1436']), 1);
    assert.match(captured.join('\n'), /Missing --release-path/);

    captured.length = 0;
    assert.equal(
      main(['scope-release', 'UTV2-1729', '--pr', 'not-a-number', '--release-path', 'a.ts']),
      1,
    );
    assert.match(captured.join('\n'), /--pr must be a PR number/);
  } finally {
    console.error = originalError;
  }
});

// ── UTV2-1762: scope-release command surface ────────────────────────────────

test('scope-release is a routed subcommand and refuses an incomplete invocation', () => {
  const captured: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    // Unknown subcommands fall through to usage(); a routed one does not.
    assert.equal(main(['definitely-not-a-command']), 1);
    assert.match(captured.join('\n'), /scope-release UTV2-123 --pr 456/);

    captured.length = 0;
    // Routed, but missing --release-path: it must fail on its own argument
    // validation before any git/GitHub call, and must not print usage.
    assert.equal(main(['scope-release', 'UTV2-1729', '--pr', '1436']), 1);
    assert.match(captured.join('\n'), /Missing --release-path/);

    captured.length = 0;
    assert.equal(
      main(['scope-release', 'UTV2-1729', '--pr', 'not-a-number', '--release-path', 'a.ts']),
      1,
    );
    assert.match(captured.join('\n'), /--pr must be a PR number/);
  } finally {
    console.error = originalError;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// UTV2-1762 — audited scope release
//
// These tests cover `scripts/ops/scope-release.ts`, the module behind the
// `scope-release` subcommand routed by this file. They live here rather than
// beside the implementation because `package.json`'s `test:ops` script is an
// explicit file list and is outside this lane's frozen `file_scope_lock`: a new
// `scope-release.test.ts` would be reachable from no package script or workflow
// command, which the executable-wiring gate in `ops:automation-coverage-check`
// correctly rejects (WIRING_TEST_UNWIRED_NEW). Baselining a brand-new suite as
// "unwired" would have been the dishonest way out. Splitting the file once
// `package.json` can be edited is follow-up work.
// ════════════════════════════════════════════════════════════════════════════

const BRANCH = 'codex/utv2-1729-proof-generator';
const WORKTREE = '/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1729-proof-generator';
const RELEASE_PR_URL = 'https://github.com/unit-talk/Unit-Talk-v2/pull/1436';
const HEAD_SHA = 'c3a6de03aa11bb22cc33dd44ee55ff6677889900';
const USED = 'scripts/ops/proof-generate.ts';
const UNUSED_A = 'scripts/ops/truth-check-lib.ts';
const UNUSED_B = 'scripts/ops/truth-check-lib.test.ts';

// validateManifest -- which the release re-runs against the manifest it is about
// to write, so a release can never produce an invalid manifest -- requires the
// preflight token to exist on disk. `.out/` is gitignored and per-worktree, so
// the fixture materializes its own token rather than depending on whichever
// tokens happen to be lying around in the checkout that runs the suite.
const PREFLIGHT_TOKEN = '.out/ops/preflight/codex/utv2-1729-scope-release-fixture.json';
fs.mkdirSync(path.join(ROOT, path.dirname(PREFLIGHT_TOKEN)), { recursive: true });
fs.writeFileSync(path.join(ROOT, PREFLIGHT_TOKEN), '{"fixture":true}', 'utf8');

function releaseManifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    ...createManifest({
      issue_id: 'UTV2-1729',
      tier: 'T2',
      lane_type: 'governance',
      executor: 'claude',
      branch: BRANCH,
      worktree_path: WORKTREE,
      file_scope_lock: [USED, UNUSED_A, UNUSED_B],
      expected_proof_paths: ['docs/06_status/proof/UTV2-1729/verification.md'],
      preflight_token: PREFLIGHT_TOKEN,
      status: 'in_review',
      now: '2026-08-20T00:00:00.000Z',
    }),
    pr_url: RELEASE_PR_URL,
    files_changed: ['scripts/ops/proof-generate.ts'],
    ...overrides,
  };
}

function releaseContext(overrides: Partial<ScopeReleaseContext> = {}): ScopeReleaseContext {
  const base = overrides.manifest ?? releaseManifest();
  return {
    manifest: base,
    repo_root: WORKTREE,
    current_branch: BRANCH,
    pr: {
      number: 1436,
      url: RELEASE_PR_URL,
      state: 'OPEN',
      head_sha: HEAD_SHA,
      changed_files: [USED, 'docs/06_status/lanes/UTV2-1729.json'],
    },
    working_tree: { staged: [], unstaged: [], untracked: [], unpushed: [] },
    other_manifests: [],
    now: '2026-08-28T03:00:00.000Z',
    ...overrides,
  };
}

function releaseRequest(overrides: Partial<ScopeReleaseRequest> = {}): ScopeReleaseRequest {
  return {
    issue_id: 'UTV2-1729',
    pr_number: 1436,
    expected_head_sha: HEAD_SHA,
    expected_lock_hash: hashFileScopeLock([USED, UNUSED_A, UNUSED_B]),
    release_paths: [UNUSED_A],
    actor: 'griff843',
    reason: 'path was never touched by PR #1436 and blocks UTV2-1759',
    ...overrides,
  };
}

function refusalCodes(result: { refusals: Array<{ code: ScopeReleaseRefusalCode }> }): ScopeReleaseRefusalCode[] {
  return [...new Set(result.refusals.map((refusal) => refusal.code))];
}

// ── 1. exact unused path can be released ────────────────────────────────────

test('releases an exact unused path and records a chained audit entry', () => {
  const result = evaluateScopeRelease(releaseRequest(), releaseContext());

  assert.equal(result.ok, true);
  assert.equal(result.code, 'scope_released');
  assert.deepEqual(result.resulting_file_scope_lock, [USED, UNUSED_B]);
  assert.equal(result.previous_lock_hash, hashFileScopeLock([USED, UNUSED_A, UNUSED_B]));
  assert.equal(result.resulting_lock_hash, hashFileScopeLock([USED, UNUSED_B]));

  const entry = result.audit_entry;
  assert.ok(entry);
  assert.equal(entry.actor, 'griff843');
  assert.equal(entry.pr_number, 1436);
  assert.equal(entry.head_sha, HEAD_SHA);
  assert.equal(entry.released_at, '2026-08-28T03:00:00.000Z');
  assert.deepEqual(entry.released_paths, [UNUSED_A]);
  assert.equal(entry.previous_lock_hash, result.previous_lock_hash);
  assert.equal(entry.resulting_lock_hash, result.resulting_lock_hash);
  assert.ok(entry.verifications.length > 0);
  assert.ok(entry.verifications.every((verification) => verification.status === 'pass'));

  // The written manifest must satisfy the audit-chain validator.
  assert.deepEqual(validateScopeReleaseHistory(result.manifest!, 'UTV2-1729.json'), []);
});

// ── 2. multiple exact unused paths released atomically ──────────────────────

test('releases multiple exact unused paths in a single atomic audit entry', () => {
  const result = evaluateScopeRelease(releaseRequest({ release_paths: [UNUSED_A, UNUSED_B] }), releaseContext());

  assert.equal(result.ok, true);
  assert.deepEqual(result.resulting_file_scope_lock, [USED]);
  assert.equal(result.manifest!.scope_release_history!.length, 1, 'one release => one entry, not one per path');
  assert.deepEqual(result.audit_entry!.released_paths, [UNUSED_A, UNUSED_B]);
  assert.deepEqual(validateScopeReleaseHistory(result.manifest!, 'UTV2-1729.json'), []);
});

// ── 3. widening refused ─────────────────────────────────────────────────────

test('refuses to widen scope: a path absent from file_scope_lock cannot be named', () => {
  const result = evaluateScopeRelease(
    releaseRequest({ release_paths: ['scripts/ops/lane-close.ts'] }),
    releaseContext(),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['path_not_in_lock']);
  assert.equal(result.manifest, null);
  assert.equal(result.resulting_file_scope_lock, null);
});

// ── 4. replacement refused (and partial failure writes nothing) ─────────────

test('refuses a replacement: one valid removal plus one unknown path releases neither', () => {
  const result = evaluateScopeRelease(
    releaseRequest({ release_paths: [UNUSED_A, 'scripts/ops/lane-close.ts'] }),
    releaseContext(),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['path_not_in_lock']);
  assert.equal(result.manifest, null, 'the valid half must not be applied on its own');
});

// ── 5. a path present in the PR diff is refused ─────────────────────────────

test('refuses to release a path the PR actually changed', () => {
  const result = evaluateScopeRelease(releaseRequest({ release_paths: [USED] }), releaseContext());

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['path_in_pr_diff']);
});

// ── 6. staged / unstaged / untracked / unpushed use is refused ──────────────

for (const [field, code] of [
  ['staged', 'path_in_staged_work'],
  ['unstaged', 'path_in_unstaged_work'],
  ['untracked', 'path_in_untracked_work'],
  ['unpushed', 'path_in_unpushed_work'],
] as Array<[keyof ScopeReleaseContext['working_tree'], ScopeReleaseRefusalCode]>) {
  test(`refuses to release a path with ${field} work in the lane worktree`, () => {
    const result = evaluateScopeRelease(
      releaseRequest(),
      releaseContext({
        working_tree: { staged: [], unstaged: [], untracked: [], unpushed: [], [field]: [UNUSED_A] },
      }),
    );

    assert.equal(result.ok, false);
    assert.deepEqual(refusalCodes(result), [code]);
  });
}

// ── 7. wrong PR / head / branch / lock hash are each refused ────────────────

test('refuses when GitHub returns a different PR than the one named', () => {
  const result = evaluateScopeRelease(
    releaseRequest(),
    releaseContext({ pr: { ...releaseContext().pr, number: 1437 } }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['pr_number_mismatch']);
});

test('refuses when the manifest pr_url points at a different PR', () => {
  const result = evaluateScopeRelease(
    releaseRequest(),
    releaseContext({ manifest: releaseManifest({ pr_url: 'https://github.com/unit-talk/Unit-Talk-v2/pull/9999' }) }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['pr_url_mismatch']);
});

test('refuses when the PR head SHA is not the exact expected head', () => {
  const result = evaluateScopeRelease(
    releaseRequest({ expected_head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    releaseContext(),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['head_sha_mismatch']);
});

test('refuses when the checked-out branch is not the lane branch', () => {
  const result = evaluateScopeRelease(releaseRequest(), releaseContext({ current_branch: 'main' }));

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['branch_mismatch']);
});

test('refuses when run outside the lane worktree', () => {
  const result = evaluateScopeRelease(
    releaseRequest(),
    releaseContext({ repo_root: '/home/griff843/code/Unit-Talk-v2' }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['not_in_lane_worktree']);
});

test('refuses when the pre-change file_scope_lock hash does not match', () => {
  const result = evaluateScopeRelease(releaseRequest({ expected_lock_hash: 'not-the-hash' }), releaseContext());

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['lock_hash_mismatch']);
});

test('refuses when a concurrent active lane already declares the path', () => {
  const other = releaseManifest({
    issue_id: 'UTV2-1759',
    branch: 'claude/utv2-1759-s1-lifecycle-scope',
    worktree_path: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1759',
    file_scope_lock: [UNUSED_A],
    pr_url: null,
    status: 'started',
  });
  const result = evaluateScopeRelease(releaseRequest(), releaseContext({ other_manifests: [other] }));

  assert.equal(result.ok, false);
  assert.deepEqual(refusalCodes(result), ['concurrent_lane_dependency']);
});

test('refuses a release that would empty file_scope_lock', () => {
  const single = releaseManifest({ file_scope_lock: [UNUSED_A] });
  const result = evaluateScopeRelease(
    releaseRequest({ expected_lock_hash: hashFileScopeLock([UNUSED_A]) }),
    releaseContext({ manifest: single, pr: { ...releaseContext().pr, changed_files: [] } }),
  );

  assert.equal(result.ok, false);
  assert.ok(refusalCodes(result).includes('empty_resulting_lock'));
});

// ── 8. partial failure writes nothing ───────────────────────────────────────

test('a refused release never persists a manifest', () => {
  const writes: LaneManifest[] = [];
  const result = runScopeRelease(releaseRequest({ release_paths: [UNUSED_A, 'scripts/ops/lane-close.ts'] }), {
    repoRoot: WORKTREE,
    readManifestFor: () => releaseManifest(),
    readOtherManifests: () => [],
    currentBranch: () => BRANCH,
    fetchPr: () => releaseContext().pr,
    collectWork: () => ({ staged: [], unstaged: [], untracked: [], unpushed: [] }),
    persist: (next) => writes.push(next),
    now: () => '2026-08-28T03:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(writes, [], 'no manifest may be written when any refusal fires');
});

test('a successful release persists exactly once', () => {
  const writes: LaneManifest[] = [];
  const result = runScopeRelease(releaseRequest(), {
    repoRoot: WORKTREE,
    readManifestFor: () => releaseManifest(),
    readOtherManifests: () => [],
    currentBranch: () => BRANCH,
    fetchPr: () => releaseContext().pr,
    collectWork: () => ({ staged: [], unstaged: [], untracked: [], unpushed: [] }),
    persist: (next) => writes.push(next),
    now: () => '2026-08-28T03:00:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].file_scope_lock, [USED, UNUSED_B]);
});

// ── 9. files_changed and lifecycle state remain byte-identical ──────────────

test('files_changed, identity, and lifecycle state are byte-identical across a release', () => {
  const before = releaseManifest();
  const beforeJson = JSON.stringify(before);
  const result = evaluateScopeRelease(releaseRequest(), releaseContext({ manifest: before }));
  const after = result.manifest!;

  assert.equal(JSON.stringify(before), beforeJson, 'the input manifest must not be mutated in place');

  for (const field of [
    'files_changed',
    'issue_id',
    'status',
    'commit_sha',
    'pr_url',
    'branch',
    'base_branch',
    'tier',
    'lane_type',
    'expected_proof_paths',
    'truth_check_history',
    'reopen_history',
    'started_at',
    'heartbeat_at',
    'closed_at',
  ] as Array<keyof LaneManifest>) {
    assert.equal(
      JSON.stringify(after[field]),
      JSON.stringify(before[field]),
      `${String(field)} must be byte-identical across a scope release`,
    );
  }

  const strip = (value: LaneManifest) => {
    const copy = { ...(value as unknown as Record<string, unknown>) };
    delete copy.file_scope_lock;
    delete copy.scope_release_history;
    return JSON.stringify(copy);
  };
  assert.equal(strip(after), strip(before), 'nothing outside file_scope_lock/scope_release_history may change');
});

// ── 11. missing / broken audit history fails validation ─────────────────────

test('a narrowed file_scope_lock with no audit history fails validation', () => {
  const narrowed = releaseManifest({ file_scope_lock: [USED, UNUSED_B] });
  // No scope_release_history at all: nothing to chain, so the shape validator
  // is silent -- the diff-level guard (file-scope-guard) is what rejects this.
  // What must NOT pass is a history that claims a state the lock does not hold.
  assert.deepEqual(validateScopeReleaseHistory(narrowed, 'UTV2-1729.json'), []);

  const forged = releaseManifest({
    file_scope_lock: [USED, UNUSED_B],
    scope_release_history: [
      {
        released_at: '2026-08-28T03:00:00.000Z',
        actor: 'griff843',
        reason: 'forged',
        pr_number: 1436,
        pr_url: RELEASE_PR_URL,
        head_sha: HEAD_SHA,
        previous_lock_hash: hashFileScopeLock([USED, UNUSED_A, UNUSED_B]),
        resulting_lock_hash: 'not-the-resulting-hash',
        released_paths: [UNUSED_A],
        verifications: [{ check: 'x', status: 'pass', detail: 'y' }],
      },
    ],
  });
  const errors = validateScopeReleaseHistory(forged, 'UTV2-1729.json');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not match the current file_scope_lock hash/);
});

test('an audit entry claiming a path that is still locked fails validation', () => {
  const inconsistent = releaseManifest({
    scope_release_history: [
      {
        released_at: '2026-08-28T03:00:00.000Z',
        actor: 'griff843',
        reason: 'claims a removal that did not happen',
        pr_number: 1436,
        pr_url: RELEASE_PR_URL,
        head_sha: HEAD_SHA,
        previous_lock_hash: 'x',
        resulting_lock_hash: hashFileScopeLock([USED, UNUSED_A, UNUSED_B]),
        released_paths: [UNUSED_A],
        verifications: [{ check: 'x', status: 'pass', detail: 'y' }],
      },
    ],
  });
  const errors = validateScopeReleaseHistory(inconsistent, 'UTV2-1729.json');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /still present in file_scope_lock/);
});

test('a rewritten audit chain fails validation', () => {
  const first = {
    released_at: '2026-08-28T03:00:00.000Z',
    actor: 'griff843',
    reason: 'first',
    pr_number: 1436,
    pr_url: RELEASE_PR_URL,
    head_sha: HEAD_SHA,
    previous_lock_hash: hashFileScopeLock([USED, UNUSED_A, UNUSED_B]),
    resulting_lock_hash: hashFileScopeLock([USED, UNUSED_B]),
    released_paths: [UNUSED_A],
    verifications: [{ check: 'x', status: 'pass' as const, detail: 'y' }],
  };
  const second = {
    ...first,
    reason: 'second',
    previous_lock_hash: 'a-hash-that-does-not-chain',
    resulting_lock_hash: hashFileScopeLock([USED]),
    released_paths: [UNUSED_B],
  };
  const broken = releaseManifest({ file_scope_lock: [USED], scope_release_history: [first, second] });
  const errors = validateScopeReleaseHistory(broken, 'UTV2-1729.json');
  assert.ok(errors.some((error) => /does not chain from/.test(error)));
});

// ── 12. mutation control ────────────────────────────────────────────────────
//
// Presence of a refusal and a green suite prove nothing on their own. This
// harness deletes each refusal from the module source one at a time, loads the
// mutant, and asserts the scenario that names that refusal now WRONGLY
// succeeds. If any refusal is decorative -- unreachable, shadowed by another
// check, or already dead -- its mutant still refuses and this test fails.

const MUTATION_SCENARIOS: Array<{
  code: ScopeReleaseRefusalCode;
  request: ScopeReleaseRequest;
  context: ScopeReleaseContext;
}> = [
  { code: 'path_not_in_lock', request: releaseRequest({ release_paths: ['scripts/ops/lane-close.ts'] }), context: releaseContext() },
  { code: 'path_in_pr_diff', request: releaseRequest({ release_paths: [USED] }), context: releaseContext() },
  {
    code: 'path_in_staged_work',
    request: releaseRequest(),
    context: releaseContext({ working_tree: { staged: [UNUSED_A], unstaged: [], untracked: [], unpushed: [] } }),
  },
  {
    code: 'path_in_unstaged_work',
    request: releaseRequest(),
    context: releaseContext({ working_tree: { staged: [], unstaged: [UNUSED_A], untracked: [], unpushed: [] } }),
  },
  {
    code: 'path_in_untracked_work',
    request: releaseRequest(),
    context: releaseContext({ working_tree: { staged: [], unstaged: [], untracked: [UNUSED_A], unpushed: [] } }),
  },
  {
    code: 'path_in_unpushed_work',
    request: releaseRequest(),
    context: releaseContext({ working_tree: { staged: [], unstaged: [], untracked: [], unpushed: [UNUSED_A] } }),
  },
  { code: 'not_in_lane_worktree', request: releaseRequest(), context: releaseContext({ repo_root: '/home/griff843/code/Unit-Talk-v2' }) },
  { code: 'branch_mismatch', request: releaseRequest(), context: releaseContext({ current_branch: 'main' }) },
  {
    code: 'issue_mismatch',
    request: releaseRequest({ issue_id: 'UTV2-9999' }),
    context: releaseContext(),
  },
  {
    code: 'pr_url_mismatch',
    request: releaseRequest(),
    context: releaseContext({ manifest: releaseManifest({ pr_url: 'https://github.com/unit-talk/Unit-Talk-v2/pull/9999' }) }),
  },
  { code: 'pr_number_mismatch', request: releaseRequest(), context: releaseContext({ pr: { ...releaseContext().pr, number: 1437 } }) },
  { code: 'pr_not_open', request: releaseRequest(), context: releaseContext({ pr: { ...releaseContext().pr, state: 'CLOSED' } }) },
  {
    code: 'head_sha_mismatch',
    request: releaseRequest({ expected_head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    context: releaseContext(),
  },
  { code: 'lock_hash_mismatch', request: releaseRequest({ expected_lock_hash: 'not-the-hash' }), context: releaseContext() },
  {
    code: 'manifest_lane_inactive',
    request: releaseRequest(),
    context: releaseContext({ manifest: releaseManifest({ status: 'done', closed_at: '2026-08-21T00:00:00.000Z', commit_sha: 'abc123' }) }),
  },
  {
    code: 'concurrent_lane_dependency',
    request: releaseRequest(),
    context: releaseContext({
      other_manifests: [
        releaseManifest({
          issue_id: 'UTV2-1759',
          branch: 'claude/utv2-1759-s1-lifecycle-scope',
          worktree_path: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1759',
          file_scope_lock: [UNUSED_A],
          pr_url: null,
          status: 'started',
        }),
      ],
    }),
  },
  { code: 'no_release_paths', request: releaseRequest({ release_paths: [] }), context: releaseContext() },
  {
    code: 'duplicate_release_path',
    request: releaseRequest({ release_paths: [UNUSED_A, UNUSED_A] }),
    context: releaseContext(),
  },
];

const MODULE_PATH = new URL('./scope-release.ts', import.meta.url).pathname;

function mutantSourceWithout(source: string, code: ScopeReleaseRefusalCode): string {
  // Replace every `refuse('<code>', ...)` call -- the formatter wraps most of
  // them across several lines -- with `void (...)`, leaving the rest of the
  // module byte-identical. Paren balancing is used rather than a line match so
  // that a multi-line call with parenthesized template arguments is removed
  // whole and the mutant still parses.
  const pattern = new RegExp(`refuse\\(\\s*'${code}'\\s*,`, 'g');
  let out = source;
  let removals = 0;
  for (;;) {
    pattern.lastIndex = 0;
    const match = pattern.exec(out);
    if (!match) break;
    const start = match.index;
    const open = out.indexOf('(', start);
    let depth = 0;
    let index = open;
    for (; index < out.length; index += 1) {
      if (out[index] === '(') depth += 1;
      else if (out[index] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    // A trailing comma before the closing paren is legal in a call but not in a
    // parenthesized expression, so trim it before rewrapping.
    const args = out.slice(open + 1, index).replace(/,\s*$/, '');
    out = `${out.slice(0, start)}void (${args})${out.slice(index + 1)}`;
    removals += 1;
    if (removals > 20) throw new Error(`runaway mutation for ${code}`);
  }
  assert.ok(removals > 0, `no refuse('${code}', ...) call found to mutate`);
  return out;
}

test('mutation control: every refusal is load-bearing', async () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const directory = path.dirname(MODULE_PATH);
  const written: string[] = [];

  try {
    for (const scenario of MUTATION_SCENARIOS) {
      // Baseline: the real module must refuse with exactly this code.
      const baseline = evaluateScopeRelease(scenario.request, scenario.context);
      assert.equal(baseline.ok, false, `baseline for ${scenario.code} must refuse`);
      assert.deepEqual(
        refusalCodes(baseline),
        [scenario.code],
        `scenario for ${scenario.code} must isolate that refusal and no other`,
      );

      const mutantPath = path.join(directory, `scope-release.__mutant_${scenario.code}__.ts`);
      fs.writeFileSync(mutantPath, mutantSourceWithout(source, scenario.code), 'utf8');
      written.push(mutantPath);

      const mutant = (await import(pathToFileURL(mutantPath).href)) as {
        evaluateScopeRelease: typeof evaluateScopeRelease;
      };
      const mutated = mutant.evaluateScopeRelease(scenario.request, scenario.context);
      assert.ok(
        !refusalCodes(mutated).includes(scenario.code),
        `removing the ${scenario.code} refusal must stop it firing -- if it survives its own deletion it is not the code that blocks this condition`,
      );
      // With that one refusal gone the scenario must get through, EXCEPT where
      // an independent later validator legitimately catches the same bad state
      // (e.g. an empty release produces an audit entry with no released_paths,
      // which validateScopeReleaseHistory rejects). Anything else surviving
      // would mean the scenario was never isolated to this refusal.
      const survivors = refusalCodes(mutated).filter((code) => code !== 'manifest_invalid_after_release');
      assert.deepEqual(
        survivors,
        [],
        `removing ${scenario.code} left unrelated refusals: ${survivors.join(', ')}`,
      );
    }
  } finally {
    for (const mutantPath of written) {
      fs.rmSync(mutantPath, { force: true });
    }
  }
});
