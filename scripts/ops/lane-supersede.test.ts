import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  durableRoot,
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
import {
  ROOT,
  createManifest,
  defaultProofPaths,
  issueToManifestPath,
  worktreePathForBranch,
  assertStatusTransition,
  readManifest,
  writeManifest,
  type LaneManifest,
} from './shared.js';

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
function ghStub(opts: { pr?: Record<string, unknown>; mainSha?: string | null; login?: string | null } = {}) {
  return (args: string[]) => {
    const joined = args.join(' ');
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
    const r = supersedeLane({ ...BASE, issueId: id }, deps({ gh: () => ({ status: 1, stdout: '' }) }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'pr_state_unverifiable');
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
    assert.match(combined, /lane-supersede\.ts/, 'the refusal must name the governed command');
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
  // ROOT here is a worktree; the durable root must differ from it.
  assert.notEqual(durableRoot(ROOT), ROOT, 'a worktree must not be its own receipt root');
});
