import test from 'node:test';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPrMergeToManifest, createCommand } from './lane-manifest.js';
import {
  type LaneManifest,
  ROOT,
  createManifest,
  validateManifest,
  defaultProofPaths,
  issueToManifestPath,
  worktreePathForBranch,
  assertStatusTransition,
  readManifest,
  writeManifest,
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


// ═══════════════════════════════════════════════════════════════════════════
// UTV2-1668 — governed terminal supersession (lane-supersede CLI suite)
//
// Hosted in this file deliberately. `scripts/ops/lane-supersede.test.ts` was
// unreachable from any required command, so the wiring gate correctly refused
// it: its mutation battery would have been proven locally and never executed by
// CI. This entrypoint is already enumerated in `test:ops`, so every regression
// below runs under `pnpm verify`.
// ═══════════════════════════════════════════════════════════════════════════

import {
  durableRoot,
  prRepoFromUrl,
  resolveActingBranch,
  LEASE_STATES_STILL_HELD,
  transactionPath,
  validateInputs,
  normalizePrNumber,
  readPrTruth,
  isAncestorOfBase,
  transactionId,
  readTransaction,
  writeTransaction,
  verifyReleased,
  supersedeLane,
  parseArgv,
} from './lane-supersede.js';

const HEAD = 'aa9a9711ffd58c51c4020360b47647c3f55a430f';
const OTHER_HEAD = 'b'.repeat(40);

function seedManifest(issueId: string, overrides: Partial<LaneManifest> = {}): LaneManifest {
  const branch = `claude/${issueId.toLowerCase()}-fixture`;
  // writeManifest validates that the preflight token exists on disk.
  const tokenPath = path.join(ROOT, `.out/ops/preflight/${branch}.json`);
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify({ issue_id: issueId, branch }));
  const m: LaneManifest = {
    ...createManifest({
      issue_id: issueId,
      tier: 'T1',
      branch,
      worktree_path: worktreePathForBranch(branch),
      file_scope_lock: ['scripts/ops/lane-supersede.ts'],
      expected_proof_paths: defaultProofPaths(issueId, 'T1'),
      preflight_token: `.out/ops/preflight/${branch}.json`,
      status: 'started',
      now: '2026-08-13T12:00:00.000Z',
    }),
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1417',
    ...overrides,
  };
  writeManifest(m);
  return m;
}

function cleanup(issueId: string): void {
  fs.rmSync(issueToManifestPath(issueId), { force: true });
  fs.rmSync(path.join(ROOT, `.out/ops/preflight/claude/${issueId.toLowerCase()}-fixture.json`), { force: true });
  // Receipts are durable ACROSS worktrees by design, so they land under the
  // shared root -- not under this worktree. Cleaning the wrong root leaks state
  // into every later run and turns a fresh transaction into a false conflict.
  fs.rmSync(transactionPath(issueId), { force: true });
}

const MAIN_SHA = '9'.repeat(40);
const ACTOR = 'griff843';

/**
 * Routes the three authorities this command consults: PR state, the CURRENT
 * main SHA, and the authenticated identity. Each is separately overridable so a
 * regression can fail exactly one of them.
 */
const REPO = 'griff843/Unit-Talk-v2';

function ghStub(opts: { pr?: Record<string, unknown>; mainSha?: string | null; login?: string | null; repo?: string | null } = {}) {
  return (args: string[]) => {
    const joined = args.join(' ');
    if (joined.includes('repo view')) {
      return opts.repo === null
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: `${opts.repo ?? REPO}\n` };
    }
    if (joined.includes('commits/main')) {
      return opts.mainSha === null
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: `${opts.mainSha ?? MAIN_SHA}\n` };
    }
    if (joined.includes('api user')) {
      return opts.login === null
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: `${opts.login ?? ACTOR}\n` };
    }
    return {
      status: 0,
      stdout: JSON.stringify({
        number: 1417, state: 'CLOSED', merged: false, mergedAt: null,
        headRefOid: HEAD, headRefName: 'codex/utv2-1698-execution-truth',
        ...(opts.pr ?? {}),
      }),
    };
  };
}
function ghClosedUnmerged(overrides: Record<string, unknown> = {}) {
  return ghStub({ pr: overrides });
}

/** git stub: commit exists (0), and is NOT an ancestor of base (1). */
const gitNotAncestor = (args: string[]): number | null => (args[0] === 'cat-file' ? 0 : 1);
const gitIsAncestor = (args: string[]): number | null => (args[0] === 'cat-file' ? 0 : 0);

function deps(extra: Record<string, unknown> = {}) {
  const leaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1668-lease-'));
  return {
    gh: ghStub(),
    gitStatus: gitNotAncestor,
    currentBranch: () => 'claude/utv2-1668-governed-supersession',
    acquireLock: () => ({ ok: true }),
    releaseLock: () => {},
    leaseRegistryDir: leaseDir,
    now: () => '2026-08-13T20:00:00.000Z',
    ...extra,
  };
}

// ── input validation (PM correction 1) ───────────────────────────────────────

test('every supersession input is mandatory', () => {
  const full = { issueId: 'UTV2-1698', reason: 'r', actor: 'a', successor: 'UTV2-1711', sourcePr: '1417', rejectedHead: HEAD };
  for (const key of Object.keys(full) as Array<keyof typeof full>) {
    const partial = { ...full };
    delete partial[key];
    const result = validateInputs(partial);
    assert.equal(result.ok, false, `${key} must be mandatory`);
    if (!result.ok) {
      assert.equal(result.code, 'missing_required_input');
      assert.match(result.message, /lane-supersede\.ts/, 'the refusal must name the corrected invocation');
    }
  }
  assert.equal(validateInputs(full).ok, true);
});

test('a lane may not supersede itself', () => {
  const r = validateInputs({ issueId: 'UTV2-1698', reason: 'r', actor: 'a', successor: 'UTV2-1698', sourcePr: '1417', rejectedHead: HEAD });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'successor_equals_source');
});

test('the rejected head must be a full commit SHA', () => {
  const r = validateInputs({ issueId: 'UTV2-1698', reason: 'r', actor: 'a', successor: 'UTV2-1711', sourcePr: '1417', rejectedHead: 'aa9a971' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'invalid_rejected_head');
});

test('PR identity is accepted as a number, a #number or a URL', () => {
  assert.equal(normalizePrNumber('1417'), '1417');
  assert.equal(normalizePrNumber('#1417'), '1417');
  assert.equal(normalizePrNumber('https://github.com/griff843/Unit-Talk-v2/pull/1417'), '1417');
});

// ── GitHub authority (PM correction 3) ───────────────────────────────────────

test('an unreachable or unparseable GitHub fails closed', () => {
  assert.equal(readPrTruth('1417', () => ({ status: 1, stdout: '' })).ok, false);
  assert.equal(readPrTruth('1417', () => ({ status: 0, stdout: 'not json' })).ok, false);
  assert.equal(readPrTruth('1417', () => ({ status: 0, stdout: '{"state":"CLOSED"}' })).ok, false, 'missing head SHA must fail closed');
});

test('merge evidence is merged/mergedAt, never mergeCommit', () => {
  // GitHub populates mergeCommit with the POTENTIAL merge commit for an open or
  // closed-unmerged PR. Treating it as merge evidence would refuse every
  // legitimate supersession, so it must not be consulted.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-supersede.ts'), 'utf8');
  const call = source.slice(source.indexOf("['pr', 'view'"), source.indexOf("['pr', 'view'") + 200);
  assert.doesNotMatch(call, /mergeCommit/, 'mergeCommit must not be requested as merge evidence');
  assert.match(call, /merged,mergedAt/, 'merged and mergedAt are the authoritative signals');
});

test('ancestry is only decided on a commit that is actually present', () => {
  const absent = isAncestorOfBase(ROOT, HEAD, 'origin/main', () => 128);
  assert.equal(absent.ok, false, 'an absent commit cannot prove non-merge');
  assert.equal(isAncestorOfBase(ROOT, HEAD, 'origin/main', gitNotAncestor).ancestor, false);
  assert.equal(isAncestorOfBase(ROOT, HEAD, 'origin/main', gitIsAncestor).ancestor, true);
});

// ── transition tightening (PM correction 4) ──────────────────────────────────

test('a merged lane may not be relabelled non-shipped', () => {
  for (const terminal of ['superseded', 'failed', 'cancelled'] as const) {
    assert.throws(
      () => assertStatusTransition('merged', terminal),
      /Illegal manifest status transition/,
      `merged -> ${terminal} must be refused`,
    );
  }
  // The legitimate merged transitions survive.
  assert.doesNotThrow(() => assertStatusTransition('merged', 'done'));
  assert.doesNotThrow(() => assertStatusTransition('merged', 'reopened'));
});

// ── post-conditions ──────────────────────────────────────────────────────────

test('release verification requires exclusion from every capacity and lock set', () => {
  const superseded = { ...seedManifest('UTV2-99610'), status: 'superseded' as const, merge_sha: null };
  cleanup('UTV2-99610');
  const ok = verifyReleased(superseded, []);
  assert.equal(ok.ok, true);
  assert.equal(ok.checks.excluded_from_lock_conflict, true);
  assert.equal(ok.checks.excluded_from_total_capacity, true);
  assert.equal(ok.checks.excluded_from_executor_capacity, true);
  assert.equal(ok.checks.excluded_from_type_capacity, true);
  assert.equal(ok.checks.asserts_no_success, true);

  const heldLease = verifyReleased(superseded, [{ issue_id: superseded.issue_id, status: 'active' }]);
  assert.equal(heldLease.ok, false, 'an active lease means the lane still holds resources');
  assert.ok(heldLease.failures.includes('lease_not_active'));

  const stillActive = verifyReleased({ ...superseded, status: 'started' }, []);
  assert.equal(stillActive.ok, false);
  assert.ok(stillActive.failures.includes('excluded_from_lock_conflict'));
});

// ── end-to-end refusals ──────────────────────────────────────────────────────

const BASE = { reason: 'bounce-cap fail/reframe', actor: ACTOR, successor: 'UTV2-1711', sourcePr: '1417', rejectedHead: HEAD };

test('a shipped lane cannot be superseded', () => {
  const id = 'UTV2-99611';
  try {
    seedManifest(id, { status: 'merged', merge_sha: 'c'.repeat(40) });
    const r = supersedeLane({ ...BASE, issueId: id }, deps());
    assert.equal(r.ok, false);
    assert.equal(r.code, 'lane_already_shipped');
  } finally { cleanup(id); }
});

test('a PR identity that disagrees with the manifest fails closed', () => {
  const id = 'UTV2-99612';
  try {
    seedManifest(id);
    const r = supersedeLane({ ...BASE, issueId: id, sourcePr: '9999' }, deps());
    assert.equal(r.ok, false);
    assert.equal(r.code, 'pr_identity_conflict');
  } finally { cleanup(id); }
});

test('a lane with no recorded PR fails closed rather than guessing', () => {
  const id = 'UTV2-99613';
  try {
    seedManifest(id, { pr_url: null });
    const r = supersedeLane({ ...BASE, issueId: id }, deps());
    assert.equal(r.ok, false);
    assert.equal(r.code, 'pr_identity_unresolved');
  } finally { cleanup(id); }
});

test('an open or merged PR cannot be superseded', () => {
  const id = 'UTV2-99614';
  try {
    seedManifest(id);
    const open = supersedeLane({ ...BASE, issueId: id }, deps({ gh: ghClosedUnmerged({ state: 'OPEN' }) }));
    assert.equal(open.code, 'pr_not_closed_unmerged');
    const merged = supersedeLane({ ...BASE, issueId: id }, deps({ gh: ghClosedUnmerged({ merged: true, mergedAt: '2026-08-13T00:00:00Z' }) }));
    assert.equal(merged.code, 'pr_not_closed_unmerged');
  } finally { cleanup(id); }
});

test('a rejected head that is not the PR head fails closed', () => {
  const id = 'UTV2-99615';
  try {
    seedManifest(id);
    const r = supersedeLane({ ...BASE, issueId: id, rejectedHead: OTHER_HEAD }, deps());
    assert.equal(r.ok, false);
    assert.equal(r.code, 'rejected_head_mismatch');
  } finally { cleanup(id); }
});

test('a head that IS on main cannot be superseded — the work shipped', () => {
  const id = 'UTV2-99616';
  try {
    seedManifest(id);
    const r = supersedeLane({ ...BASE, issueId: id }, deps({ gitStatus: gitIsAncestor }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'rejected_head_on_main');
  } finally { cleanup(id); }
});

test('unverifiable GitHub state never becomes permission to proceed', () => {
  const id = 'UTV2-99617';
  try {
    seedManifest(id);
    // Every GitHub authority is unreachable. Whichever is consulted first, the
    // command must refuse -- no authority is optional and none may be inferred.
    const r = supersedeLane({ ...BASE, issueId: id }, deps({ gh: () => ({ status: 1, stdout: '' }) }));
    assert.equal(r.ok, false);
    assert.ok(
      ['pr_state_unverifiable', 'pr_repo_unresolved', 'actor_authority_unverified', 'main_sha_unverifiable'].includes(r.code),
      `unreachable GitHub must fail closed on some authority; got ${r.code}`,
    );
    assert.equal(readManifest(id).status, 'started', 'a refused supersession must not mutate the manifest');
  } finally { cleanup(id); }
});

// ── happy path, receipt, idempotency (PM correction 7) ───────────────────────

test('a closed unmerged lane reaches a terminal non-shipped state with resources released', () => {
  const id = 'UTV2-99618';
  try {
    seedManifest(id);
    const d = deps();
    const r = supersedeLane({ ...BASE, issueId: id }, d);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.code, 'lane_superseded');
    assert.equal(r.stage, 'complete');

    const m = readManifest(id);
    assert.equal(m.status, 'superseded');
    assert.ok(m.merge_sha == null, 'supersession must never fabricate a merge SHA');
    assert.equal(m.supersession?.successor_issue_id, 'UTV2-1711');
    assert.equal(m.supersession?.rejected_head, HEAD);
    assert.equal(m.supersession?.source_pr, '#1417');
    assert.equal(m.supersession?.actor, ACTOR);
    // PM correction 6: the claim is scoped to this PR only.
    assert.equal(m.supersession?.claim, 'source_pr_did_not_merge');
    assert.equal(readTransaction(id)?.stage, 'complete');
  } finally { cleanup(id); }
});

test('repeating the exact transition is idempotent success', () => {
  const id = 'UTV2-99619';
  try {
    seedManifest(id);
    const d = deps();
    assert.equal(supersedeLane({ ...BASE, issueId: id }, d).ok, true);
    const again = supersedeLane({ ...BASE, issueId: id }, d);
    assert.equal(again.ok, true);
    assert.equal(again.code, 'supersession_noop');
    assert.equal(again.idempotent, true);
  } finally { cleanup(id); }
});

test('a conflicting re-run fails closed instead of overwriting the terminal record', () => {
  const id = 'UTV2-99620';
  try {
    seedManifest(id);
    const d = deps();
    assert.equal(supersedeLane({ ...BASE, issueId: id }, d).ok, true);
    for (const conflict of [
      { successor: 'UTV2-9999' },
      { reason: 'a different reason' },
      { actor: 'someone-else' },
    ]) {
      const r = supersedeLane({ ...BASE, issueId: id, ...conflict }, d);
      assert.equal(r.ok, false, `conflicting ${Object.keys(conflict)[0]} must fail closed`);
      assert.equal(r.code, 'supersession_conflict');
    }
    assert.equal(readManifest(id).supersession?.successor_issue_id, 'UTV2-1711', 'the original record survives');
  } finally { cleanup(id); }
});

test('a crash between manifest commit and lease release stays visible and resumable', () => {
  const id = 'UTV2-99621';
  try {
    const seeded = seedManifest(id);
    const d = deps();
    const txId = transactionId({ issueId: id, ...BASE } as never);
    // Simulate the crash: manifest committed, receipt stuck mid-transaction.
    writeManifest({
      ...seeded,
      status: 'superseded',
      supersession: {
        reason: BASE.reason, actor: BASE.actor, at: '2026-08-13T20:00:00.000Z',
        source_pr: '#1417', source_branch: 'codex/utv2-1698-execution-truth',
        rejected_head: HEAD, successor_issue_id: 'UTV2-1711',
        claim: 'source_pr_did_not_merge', transaction_id: txId,
      },
    });
    writeTransaction({ transaction_id: txId, issue_id: id, stage: 'manifest_committed', inputs: { issueId: id, ...BASE } as never, updated_at: '2026-08-13T20:00:00.000Z' });

    assert.notEqual(readTransaction(id)?.stage, 'complete', 'an interrupted transaction is visibly incomplete');
    const resumed = supersedeLane({ ...BASE, issueId: id }, d);
    assert.equal(resumed.ok, true, `resume must complete: ${resumed.message}`);
    assert.equal(readTransaction(id)?.stage, 'complete');
  } finally { cleanup(id); }
});

test('success is withheld while any lease for the lane remains active', () => {
  // PM correction 5: the command must not report success until cleanup is
  // VERIFIED. `verifyReleased` being correct is not enough -- the production
  // path's use of it has to be load-bearing, which is only demonstrable by a
  // state where the release step runs and the post-condition still fails.
  //
  // A duplicated lease record does exactly that, and is a real leak shape:
  // `releaseLease` only rewrites `<ISSUE>.json`, while `readAllLeases` reads
  // every file in the registry, so a stray duplicate survives the release.
  const id = 'UTV2-99624';
  const d = deps();
  try {
    seedManifest(id);
    const canonical = path.join(d.leaseRegistryDir as string, `${id}.json`);
    const lease = {
      schema_version: 1, issue_id: id, branch: `claude/${id.toLowerCase()}-fixture`,
      owner: { user: 'tester', host: 'test-host', pid: 4242, session_id: 'test' }, executor: 'claude',
      status: 'active', file_scope_lock: ['scripts/ops/lane-supersede.ts'],
      cwd: ROOT, reserved_at: '2026-08-13T12:00:00.000Z',
      heartbeat_at: '2026-08-13T12:00:00.000Z', expires_at: '2026-08-14T12:00:00.000Z',
      reclaim_history: [],
    };
    fs.writeFileSync(canonical, JSON.stringify(lease));
    fs.writeFileSync(path.join(d.leaseRegistryDir as string, `${id}-DUPLICATE.json`), JSON.stringify(lease));

    const r = supersedeLane({ ...BASE, issueId: id }, d);
    assert.equal(r.ok, false, 'a still-held lease must block success');
    assert.equal(r.code, 'supersession_incomplete');
    assert.equal(r.verification?.lease_not_active, false);
    assert.notEqual(readTransaction(id)?.stage, 'complete', 'an unverified release must not be marked complete');
  } finally { cleanup(id); }
});

// ── bypass closed, with the remedy executed (PM correction 2) ────────────────

test('ops:lane-manifest update refuses superseded and the named remedy actually works', () => {
  const id = 'UTV2-99622';
  try {
    seedManifest(id);
    const refused = spawnSync('pnpm', ['exec', 'tsx', 'scripts/ops/lane-manifest.ts', 'update', id, '--status', 'superseded'], {
      cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
    });
    assert.notEqual(refused.status, 0, 'the raw status write must be refused');
    const combined = `${refused.stdout}${refused.stderr}`;
    // The refusal must be the DEDICATED bypass guard, not the shared
    // validator's schema rejection. Both fail closed and both name the
    // governed command, but only this one refuses before a write is attempted
    // and tells the operator what to run instead. Falling through to a schema
    // error would be a worse diagnosis for the same outcome.
    assert.match(combined, /Refusing to set status "superseded" through ops:lane-manifest update/,
      'the dedicated bypass guard must issue the refusal');
    assert.match(combined, /--reason .*--successor .*--source-pr .*--rejected-head .*--actor/s,
      'the refusal must name the full corrected invocation, not just the command');
    assert.equal(readManifest(id).status, 'started', 'the refused write must not have applied');

    // Execute the named remedy and observe it succeed. A refusal that names a
    // remedy is not tested until the remedy has been run and seen to work.
    const remedied = supersedeLane({ ...BASE, issueId: id }, deps());
    assert.equal(remedied.ok, true, `named remedy must succeed: ${remedied.message}`);
    assert.equal(readManifest(id).status, 'superseded');
  } finally { cleanup(id); }
});

// ── production CLI wiring (PM correction 8) ──────────────────────────────────

test('the production CLI parses its own documented flags', () => {
  const parsed = parseArgv([
    'UTV2-1698', '--reason', 'bounce-cap fail/reframe', '--successor', 'UTV2-1711',
    '--source-pr', '1417', '--rejected-head', HEAD, '--actor', 'pm',
  ]);
  assert.equal(parsed.issueId, 'UTV2-1698');
  assert.equal(parsed.successor, 'UTV2-1711');
  assert.equal(parsed.sourcePr, '1417');
  assert.equal(parsed.rejectedHead, HEAD);
  assert.equal(parsed.actor, 'pm');
  assert.equal(validateInputs(parsed).ok, true, 'the CLI-parsed shape must satisfy validation');
});

test('the production CLI entry point runs and fails closed on missing arguments', () => {
  const r = spawnSync('pnpm', ['exec', 'tsx', 'scripts/ops/lane-supersede.ts', 'UTV2-99623'], {
    cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
  });
  assert.notEqual(r.status, 0, 'an incomplete invocation must exit non-zero');
  const payload = JSON.parse(`${r.stdout}`.trim()) as { ok: boolean; code: string; message: string };
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'missing_required_input');
  assert.match(payload.message, /--reason/, 'the CLI must report every missing argument at once');
  assert.match(payload.message, /--actor/);
});

// ── PM additions: authority, freshness, isolation, cross-worktree recovery ───

test('actor authority is attested by GitHub, never self-declared', () => {
  const id = 'UTV2-99625';
  try {
    seedManifest(id);
    const mismatch = supersedeLane({ ...BASE, issueId: id, actor: 'someone-else' }, deps({ gh: ghStub() }));
    assert.equal(mismatch.ok, false, 'a declared actor that is not the authenticated identity must fail closed');
    assert.equal(mismatch.code, 'actor_authority_unverified');

    const unresolvable = supersedeLane({ ...BASE, issueId: id }, deps({ gh: ghStub({ login: null }) }));
    assert.equal(unresolvable.ok, false, 'no authenticated identity is not permission to self-attest');
    assert.equal(unresolvable.code, 'actor_authority_unverified');
    assert.equal(readManifest(id).status, 'started', 'an unauthorised attempt must not mutate the manifest');
  } finally { cleanup(id); }
});

test('ancestry is judged against GitHub current main, not a stale local ref', () => {
  const id = 'UTV2-99626';
  try {
    seedManifest(id);
    const stale = supersedeLane({ ...BASE, issueId: id }, deps({ gh: ghStub({ mainSha: null }) }));
    assert.equal(stale.ok, false, 'an unreadable remote main must fail closed rather than fall back to local');
    assert.equal(stale.code, 'main_sha_unverifiable');

    // The ancestry comparison must actually receive the REMOTE sha.
    const seen: string[] = [];
    supersedeLane({ ...BASE, issueId: id }, deps({
      gh: ghStub(),
      gitStatus: (args: string[]) => { seen.push(args.join(' ')); return args[0] === 'cat-file' ? 0 : 1; },
    }));
    assert.ok(
      seen.some((cmd) => cmd.includes('merge-base') && cmd.includes(MAIN_SHA)),
      `ancestry must compare against GitHub main ${MAIN_SHA}; saw ${JSON.stringify(seen)}`,
    );
    assert.ok(
      !seen.some((cmd) => cmd.includes('merge-base') && cmd.includes('origin/main')),
      'ancestry must not be decided against a local ref',
    );
  } finally { cleanup(id); }
});

test('the superseded lane\'s own branch is never written from', () => {
  const id = 'UTV2-99627';
  try {
    const seeded = seedManifest(id);
    const r = supersedeLane({ ...BASE, issueId: id }, deps({ currentBranch: () => seeded.branch }));
    assert.equal(r.ok, false, 'running from the closed PR branch must be refused');
    assert.equal(r.code, 'refuses_to_write_superseded_branch');
    assert.equal(readManifest(id).status, 'started', 'the preserved branch must be left untouched');
  } finally { cleanup(id); }
});

test('the transaction receipt is durable across worktrees', () => {
  // A receipt written per-worktree is invisible to a resume from any other
  // checkout, so an interrupted supersession would silently restart instead of
  // resuming. The durable root is the parent of the shared git dir, which every
  // worktree of the repository resolves to identically.
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
  });
  assert.equal(common.status, 0, 'git must resolve a common dir');
  const expected = path.dirname(common.stdout.trim());
  assert.equal(durableRoot(ROOT), expected);
  assert.ok(
    transactionPath('UTV2-99628').startsWith(expected),
    'receipts must live under the shared root, not the per-worktree root',
  );

  // The property is that the root is the SHARED one, whatever the checkout is:
  // in a plain clone the common dir is `<root>/.git`, so the durable root is
  // the repo root itself; in a worktree the common dir points back at the main
  // checkout, so it is NOT the worktree. Asserting `!== ROOT` unconditionally
  // would encode the environment the test happened to run in rather than the
  // behaviour, and would fail in CI, which is a plain clone.
  const inWorktree = path.basename(common.stdout.trim()) !== '.git'
    || path.dirname(common.stdout.trim()) !== ROOT;
  if (inWorktree) {
    assert.notEqual(durableRoot(ROOT), ROOT, 'inside a worktree the receipt root must be the shared checkout');
  } else {
    assert.equal(durableRoot(ROOT), ROOT, 'in a plain clone the shared root is the repository root');
  }
});

// ── review findings, exact head d17277fa ─────────────────────────────────────

test('validation and the terminal write happen inside the serialized merge lock', () => {
  // FINDING 1. GitHub state is a snapshot: between reading it and committing
  // `superseded`, the PR can be reopened and merged. Without serialization the
  // command reports success for work that shipped.
  const id = 'UTV2-99630';
  try {
    seedManifest(id);
    const refused = supersedeLane({ ...BASE, issueId: id }, deps({ acquireLock: () => ({ ok: false, code: 'merge_lock_held' }) }));
    assert.equal(refused.ok, false, 'no lock means no terminal write');
    assert.equal(refused.code, 'merge_mutex_unavailable');
    assert.equal(readManifest(id).status, 'started');

    // The PR merging under the lock must be caught by the in-lock re-read.
    let call = 0;
    const flips = (args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('repo view')) return { status: 0, stdout: `${REPO}\n` };
      if (joined.includes('commits/main')) return { status: 0, stdout: `${MAIN_SHA}\n` };
      if (joined.includes('api user')) return { status: 0, stdout: `${ACTOR}\n` };
      call += 1;
      return {
        status: 0,
        stdout: JSON.stringify({
          number: 1417, state: 'CLOSED',
          merged: call > 1, mergedAt: call > 1 ? '2026-08-13T23:00:00Z' : null,
          headRefOid: HEAD, headRefName: 'codex/utv2-1698-execution-truth',
        }),
      };
    };
    const raced = supersedeLane({ ...BASE, issueId: id }, deps({ gh: flips }));
    assert.equal(raced.ok, false, 'a PR that merged under the lock must be refused');
    assert.equal(raced.code, 'pr_not_closed_unmerged');
    assert.equal(readManifest(id).status, 'started', 'the raced attempt must not have written a terminal');
  } finally { cleanup(id); }
});

test('the head landing on main under the lock is caught before the terminal write', () => {
  const id = 'UTV2-99631';
  try {
    seedManifest(id);
    let checks = 0;
    const landsLate = (args: string[]) => {
      if (args[0] === 'cat-file') return 0;
      checks += 1;
      return checks > 1 ? 0 : 1; // not an ancestor pre-lock, ancestor in-lock
    };
    const r = supersedeLane({ ...BASE, issueId: id }, deps({ gitStatus: landsLate }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'rejected_head_on_main');
    assert.equal(readManifest(id).status, 'started');
  } finally { cleanup(id); }
});

test('PR identity includes the repository, not just the number', () => {
  // FINDING 3. `gh pr view 123` attests PR #123 in THIS repository, so a
  // manifest URL for another repository must not agree on the number alone.
  const id = 'UTV2-99632';
  try {
    seedManifest(id, { pr_url: 'https://github.com/other/repo/pull/1417' });
    const r = supersedeLane({ ...BASE, issueId: id }, deps());
    assert.equal(r.ok, false, 'a foreign-repository PR must not authorize supersession');
    assert.equal(r.code, 'pr_repo_conflict');

    const unresolved = supersedeLane({ ...BASE, issueId: id }, deps({ gh: ghStub({ repo: null }) }));
    assert.equal(unresolved.ok, false);
    assert.equal(unresolved.code, 'pr_repo_unresolved');
  } finally { cleanup(id); }
  assert.equal(prRepoFromUrl('https://github.com/griff843/Unit-Talk-v2/pull/1417'), 'griff843/Unit-Talk-v2');
  assert.equal(prRepoFromUrl('1417'), null, 'a bare number carries no repository');
});

test('a detached or unreadable HEAD fails closed', () => {
  // FINDING 4. `--abbrev-ref HEAD` yields the literal "HEAD" when detached and
  // '' on failure; neither equals the superseded branch, so a bare inequality
  // check silently passes and the terminal record lands nowhere reviewable.
  assert.equal(resolveActingBranch('HEAD').ok, false);
  assert.equal(resolveActingBranch('').ok, false);
  assert.equal(resolveActingBranch('  ').ok, false);
  assert.equal(resolveActingBranch('claude/utv2-1668-governed-supersession').ok, true);

  const id = 'UTV2-99633';
  try {
    seedManifest(id);
    for (const branch of ['HEAD', '']) {
      const r = supersedeLane({ ...BASE, issueId: id }, deps({ currentBranch: () => branch }));
      assert.equal(r.ok, false, `branch "${branch}" must be refused`);
      assert.equal(r.code, 'acting_branch_unresolved');
      assert.equal(readManifest(id).status, 'started');
    }
  } finally { cleanup(id); }
});

test('a stale-reclaim lease still counts as held', () => {
  // FINDING 5. The registry treats `stale_reclaim_required` as holding file
  // scope, so reporting release while one survives lets the lane keep blocking
  // new work.
  assert.ok(LEASE_STATES_STILL_HELD.has('active'));
  assert.ok(LEASE_STATES_STILL_HELD.has('stale_reclaim_required'), 'stale_reclaim_required still holds scope');

  const superseded = { ...seedManifest('UTV2-99634'), status: 'superseded' as const };
  cleanup('UTV2-99634');
  for (const status of ['active', 'stale_reclaim_required']) {
    const v = verifyReleased(superseded, [{ issue_id: superseded.issue_id, status }]);
    assert.equal(v.ok, false, `${status} must block success`);
    assert.ok(v.failures.includes('lease_not_active'));
  }
  assert.equal(verifyReleased(superseded, [{ issue_id: superseded.issue_id, status: 'released' }]).ok, true);
});

test('the shared merge mutex is never taken to reject an already-rejectable request', () => {
  // The pre-lock checks are not redundant with the in-lock re-reads: the merge
  // mutex is a GLOBAL serialization point, and grabbing it to refuse something
  // already refusable stalls every other lane's closeout. Each condition below
  // must be decided BEFORE acquisition.
  const cases: Array<[string, ReturnType<typeof deps>]> = [
    ['already merged', deps({ gh: ghStub({ pr: { merged: true, mergedAt: '2026-08-13T00:00:00Z' } }) })],
    ['head already on main', deps({ gitStatus: gitIsAncestor })],
    ['GitHub unreachable', deps({ gh: () => ({ status: 1, stdout: '' }) })],
    ['head mismatch', deps()],
  ];
  for (const [label, d] of cases) {
    const id = 'UTV2-99635';
    try {
      seedManifest(id);
      let acquired = 0;
      const input = label === 'head mismatch'
        ? { ...BASE, issueId: id, rejectedHead: OTHER_HEAD }
        : { ...BASE, issueId: id };
      const r = supersedeLane(input, { ...d, acquireLock: () => { acquired += 1; return { ok: true }; } });
      assert.equal(r.ok, false, `${label} must be refused`);
      assert.equal(acquired, 0, `${label}: the global merge mutex must not be acquired to issue this refusal`);
    } finally { cleanup(id); }
  }
});

test('an unreadable PR is reported as unverifiable, not as an open PR', () => {
  // Only the PR read fails; every other authority answers. Without the explicit
  // guard the flow falls through to the state comparison with `state`
  // undefined and refuses as `pr_not_closed_unmerged` -- which tells the
  // operator the PR is open when the truth is that GitHub could not be read.
  // Both fail closed, so the outcome is unchanged; the DIAGNOSIS is not, and
  // conflating "unknown" with "known bad" is how evidence stops meaning
  // anything.
  const id = 'UTV2-99636';
  try {
    seedManifest(id);
    const prReadFails = (args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('repo view')) return { status: 0, stdout: `${REPO}\n` };
      if (joined.includes('commits/main')) return { status: 0, stdout: `${MAIN_SHA}\n` };
      if (joined.includes('api user')) return { status: 0, stdout: `${ACTOR}\n` };
      return { status: 1, stdout: '' };
    };
    const r = supersedeLane({ ...BASE, issueId: id }, deps({ gh: prReadFails }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'pr_state_unverifiable', 'an unreadable PR must not be reported as an open one');
    assert.match(r.message, /unable to read PR/);
  } finally { cleanup(id); }
});

test('the shared validator rejects a superseded manifest without a governed record', () => {
  // FINDING 2. The bypass refusal covered only `ops:lane-manifest update`,
  // while any other writer that goes through validateManifest -- notably the
  // repair-packet path, which writes an arbitrary VALIDATED manifest -- could
  // reach the terminal with no PR, head, ancestry, actor or lease checks.
  const base = { ...seedManifest('UTV2-99640'), status: 'superseded' as const };
  cleanup('UTV2-99640');

  const bare = validateManifest({ ...base, supersession: undefined });
  assert.ok(
    bare.some((e) => /requires a supersession record/.test(e)),
    `a superseded manifest with no record must be rejected; got ${JSON.stringify(bare)}`,
  );
  assert.ok(bare.some((e) => /lane-supersede\.ts/.test(e)), 'the rejection must name the governed path');

  const record = {
    reason: 'r', actor: 'a', at: '2026-08-13T20:00:00.000Z', source_pr: '#1417',
    source_branch: 'codex/x', rejected_head: HEAD, successor_issue_id: 'UTV2-1711',
    claim: 'source_pr_did_not_merge' as const, transaction_id: 'tx',
  };
  assert.deepEqual(validateManifest({ ...base, supersession: record }), [], 'a complete record validates');

  for (const field of ['reason', 'actor', 'at', 'source_pr', 'source_branch', 'rejected_head', 'successor_issue_id', 'transaction_id'] as const) {
    const errs = validateManifest({ ...base, supersession: { ...record, [field]: '' } });
    assert.ok(errs.some((e) => e.includes(`supersession.${field} is required`)), `${field} must be required`);
  }

  const widened = validateManifest({
    ...base,
    supersession: { ...record, claim: 'work_never_landed_anywhere' as unknown as typeof record.claim },
  });
  assert.ok(
    widened.some((e) => /may not assert that equivalent content never landed/.test(e)),
    'the claim may not be widened beyond this PR',
  );

  const selfSucceeded = validateManifest({ ...base, supersession: { ...record, successor_issue_id: base.issue_id } });
  assert.ok(selfSucceeded.some((e) => /may not equal the superseded issue/.test(e)));

  const strayRecord = validateManifest({ ...base, status: 'started', supersession: record });
  assert.ok(
    strayRecord.some((e) => /only valid on status "superseded"/.test(e)),
    'a supersession record on a non-superseded lane must be rejected',
  );
});
