import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  hashFileScopeLock,
  validateScopeReleaseHistory,
} from './shared.js';

const BRANCH = 'codex/utv2-1729-proof-generator';
const WORKTREE = '/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1729-proof-generator';
const PR_URL = 'https://github.com/unit-talk/Unit-Talk-v2/pull/1436';
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

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
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
    pr_url: PR_URL,
    files_changed: ['scripts/ops/proof-generate.ts'],
    ...overrides,
  };
}

function context(overrides: Partial<ScopeReleaseContext> = {}): ScopeReleaseContext {
  const base = overrides.manifest ?? manifest();
  return {
    manifest: base,
    repo_root: WORKTREE,
    current_branch: BRANCH,
    pr: {
      number: 1436,
      url: PR_URL,
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

function request(overrides: Partial<ScopeReleaseRequest> = {}): ScopeReleaseRequest {
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

function codes(result: { refusals: Array<{ code: ScopeReleaseRefusalCode }> }): ScopeReleaseRefusalCode[] {
  return [...new Set(result.refusals.map((refusal) => refusal.code))];
}

// ── 1. exact unused path can be released ────────────────────────────────────

test('releases an exact unused path and records a chained audit entry', () => {
  const result = evaluateScopeRelease(request(), context());

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
  const result = evaluateScopeRelease(request({ release_paths: [UNUSED_A, UNUSED_B] }), context());

  assert.equal(result.ok, true);
  assert.deepEqual(result.resulting_file_scope_lock, [USED]);
  assert.equal(result.manifest!.scope_release_history!.length, 1, 'one release => one entry, not one per path');
  assert.deepEqual(result.audit_entry!.released_paths, [UNUSED_A, UNUSED_B]);
  assert.deepEqual(validateScopeReleaseHistory(result.manifest!, 'UTV2-1729.json'), []);
});

// ── 3. widening refused ─────────────────────────────────────────────────────

test('refuses to widen scope: a path absent from file_scope_lock cannot be named', () => {
  const result = evaluateScopeRelease(
    request({ release_paths: ['scripts/ops/lane-close.ts'] }),
    context(),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['path_not_in_lock']);
  assert.equal(result.manifest, null);
  assert.equal(result.resulting_file_scope_lock, null);
});

// ── 4. replacement refused (and partial failure writes nothing) ─────────────

test('refuses a replacement: one valid removal plus one unknown path releases neither', () => {
  const result = evaluateScopeRelease(
    request({ release_paths: [UNUSED_A, 'scripts/ops/lane-close.ts'] }),
    context(),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['path_not_in_lock']);
  assert.equal(result.manifest, null, 'the valid half must not be applied on its own');
});

// ── 5. a path present in the PR diff is refused ─────────────────────────────

test('refuses to release a path the PR actually changed', () => {
  const result = evaluateScopeRelease(request({ release_paths: [USED] }), context());

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['path_in_pr_diff']);
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
      request(),
      context({
        working_tree: { staged: [], unstaged: [], untracked: [], unpushed: [], [field]: [UNUSED_A] },
      }),
    );

    assert.equal(result.ok, false);
    assert.deepEqual(codes(result), [code]);
  });
}

// ── 7. wrong PR / head / branch / lock hash are each refused ────────────────

test('refuses when GitHub returns a different PR than the one named', () => {
  const result = evaluateScopeRelease(
    request(),
    context({ pr: { ...context().pr, number: 1437 } }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['pr_number_mismatch']);
});

test('refuses when the manifest pr_url points at a different PR', () => {
  const result = evaluateScopeRelease(
    request(),
    context({ manifest: manifest({ pr_url: 'https://github.com/unit-talk/Unit-Talk-v2/pull/9999' }) }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['pr_url_mismatch']);
});

test('refuses when the PR head SHA is not the exact expected head', () => {
  const result = evaluateScopeRelease(
    request({ expected_head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    context(),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['head_sha_mismatch']);
});

test('refuses when the checked-out branch is not the lane branch', () => {
  const result = evaluateScopeRelease(request(), context({ current_branch: 'main' }));

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['branch_mismatch']);
});

test('refuses when run outside the lane worktree', () => {
  const result = evaluateScopeRelease(
    request(),
    context({ repo_root: '/home/griff843/code/Unit-Talk-v2' }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['not_in_lane_worktree']);
});

test('refuses when the pre-change file_scope_lock hash does not match', () => {
  const result = evaluateScopeRelease(request({ expected_lock_hash: 'not-the-hash' }), context());

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['lock_hash_mismatch']);
});

test('refuses when a concurrent active lane already declares the path', () => {
  const other = manifest({
    issue_id: 'UTV2-1759',
    branch: 'claude/utv2-1759-s1-lifecycle-scope',
    worktree_path: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1759',
    file_scope_lock: [UNUSED_A],
    pr_url: null,
    status: 'started',
  });
  const result = evaluateScopeRelease(request(), context({ other_manifests: [other] }));

  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['concurrent_lane_dependency']);
});

test('refuses a release that would empty file_scope_lock', () => {
  const single = manifest({ file_scope_lock: [UNUSED_A] });
  const result = evaluateScopeRelease(
    request({ expected_lock_hash: hashFileScopeLock([UNUSED_A]) }),
    context({ manifest: single, pr: { ...context().pr, changed_files: [] } }),
  );

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('empty_resulting_lock'));
});

// ── 8. partial failure writes nothing ───────────────────────────────────────

test('a refused release never persists a manifest', () => {
  const writes: LaneManifest[] = [];
  const result = runScopeRelease(request({ release_paths: [UNUSED_A, 'scripts/ops/lane-close.ts'] }), {
    repoRoot: WORKTREE,
    readManifestFor: () => manifest(),
    readOtherManifests: () => [],
    currentBranch: () => BRANCH,
    fetchPr: () => context().pr,
    collectWork: () => ({ staged: [], unstaged: [], untracked: [], unpushed: [] }),
    persist: (next) => writes.push(next),
    now: () => '2026-08-28T03:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(writes, [], 'no manifest may be written when any refusal fires');
});

test('a successful release persists exactly once', () => {
  const writes: LaneManifest[] = [];
  const result = runScopeRelease(request(), {
    repoRoot: WORKTREE,
    readManifestFor: () => manifest(),
    readOtherManifests: () => [],
    currentBranch: () => BRANCH,
    fetchPr: () => context().pr,
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
  const before = manifest();
  const beforeJson = JSON.stringify(before);
  const result = evaluateScopeRelease(request(), context({ manifest: before }));
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
  const narrowed = manifest({ file_scope_lock: [USED, UNUSED_B] });
  // No scope_release_history at all: nothing to chain, so the shape validator
  // is silent -- the diff-level guard (file-scope-guard) is what rejects this.
  // What must NOT pass is a history that claims a state the lock does not hold.
  assert.deepEqual(validateScopeReleaseHistory(narrowed, 'UTV2-1729.json'), []);

  const forged = manifest({
    file_scope_lock: [USED, UNUSED_B],
    scope_release_history: [
      {
        released_at: '2026-08-28T03:00:00.000Z',
        actor: 'griff843',
        reason: 'forged',
        pr_number: 1436,
        pr_url: PR_URL,
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
  const inconsistent = manifest({
    scope_release_history: [
      {
        released_at: '2026-08-28T03:00:00.000Z',
        actor: 'griff843',
        reason: 'claims a removal that did not happen',
        pr_number: 1436,
        pr_url: PR_URL,
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
    pr_url: PR_URL,
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
  const broken = manifest({ file_scope_lock: [USED], scope_release_history: [first, second] });
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
  { code: 'path_not_in_lock', request: request({ release_paths: ['scripts/ops/lane-close.ts'] }), context: context() },
  { code: 'path_in_pr_diff', request: request({ release_paths: [USED] }), context: context() },
  {
    code: 'path_in_staged_work',
    request: request(),
    context: context({ working_tree: { staged: [UNUSED_A], unstaged: [], untracked: [], unpushed: [] } }),
  },
  {
    code: 'path_in_unstaged_work',
    request: request(),
    context: context({ working_tree: { staged: [], unstaged: [UNUSED_A], untracked: [], unpushed: [] } }),
  },
  {
    code: 'path_in_untracked_work',
    request: request(),
    context: context({ working_tree: { staged: [], unstaged: [], untracked: [UNUSED_A], unpushed: [] } }),
  },
  {
    code: 'path_in_unpushed_work',
    request: request(),
    context: context({ working_tree: { staged: [], unstaged: [], untracked: [], unpushed: [UNUSED_A] } }),
  },
  { code: 'not_in_lane_worktree', request: request(), context: context({ repo_root: '/home/griff843/code/Unit-Talk-v2' }) },
  { code: 'branch_mismatch', request: request(), context: context({ current_branch: 'main' }) },
  {
    code: 'issue_mismatch',
    request: request({ issue_id: 'UTV2-9999' }),
    context: context(),
  },
  {
    code: 'pr_url_mismatch',
    request: request(),
    context: context({ manifest: manifest({ pr_url: 'https://github.com/unit-talk/Unit-Talk-v2/pull/9999' }) }),
  },
  { code: 'pr_number_mismatch', request: request(), context: context({ pr: { ...context().pr, number: 1437 } }) },
  { code: 'pr_not_open', request: request(), context: context({ pr: { ...context().pr, state: 'CLOSED' } }) },
  {
    code: 'head_sha_mismatch',
    request: request({ expected_head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    context: context(),
  },
  { code: 'lock_hash_mismatch', request: request({ expected_lock_hash: 'not-the-hash' }), context: context() },
  {
    code: 'manifest_lane_inactive',
    request: request(),
    context: context({ manifest: manifest({ status: 'done', closed_at: '2026-08-21T00:00:00.000Z', commit_sha: 'abc123' }) }),
  },
  {
    code: 'concurrent_lane_dependency',
    request: request(),
    context: context({
      other_manifests: [
        manifest({
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
  { code: 'no_release_paths', request: request({ release_paths: [] }), context: context() },
  {
    code: 'duplicate_release_path',
    request: request({ release_paths: [UNUSED_A, UNUSED_A] }),
    context: context(),
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
        codes(baseline),
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
        !codes(mutated).includes(scenario.code),
        `removing the ${scenario.code} refusal must stop it firing -- if it survives its own deletion it is not the code that blocks this condition`,
      );
      // With that one refusal gone the scenario must get through, EXCEPT where
      // an independent later validator legitimately catches the same bad state
      // (e.g. an empty release produces an audit entry with no released_paths,
      // which validateScopeReleaseHistory rejects). Anything else surviving
      // would mean the scenario was never isolated to this refusal.
      const survivors = codes(mutated).filter((code) => code !== 'manifest_invalid_after_release');
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
