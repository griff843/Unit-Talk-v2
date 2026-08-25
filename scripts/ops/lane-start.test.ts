import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildSyncYmlWithTaskContract,
  buildTaskContract,
  generateDispatchExecutionPacketResult,
  readTaskContract,
  renderTaskContract,
  type TaskContract,
} from './execution-packet.js';
import { ROOT, type LaneManifest } from './shared.js';
import {
  captureOrReadTaskContract,
  type ExistingBranchReadmissionToken,
  fetchLinearTaskSource,
  findMissingReadmissionScopePaths,
  isPermittedControlRegistryPath,
  mirrorPreflightTokenToWorktree,
  persistLaneTaskContract,
  validateReadmissionTokenRequest,
} from './lane-start.js';

test('lane-start captures Linear truth without exposing its token in process arguments', () => {
  const token = 'token-fixture';
  const source = fetchLinearTaskSource('UTV2-1734', token, ((_command, args, options) => {
    assert.equal(args.includes('https://api.linear.app/graphql'), true);
    assert.equal(args.includes('--config'), true);
    assert.equal(args.join(' ').includes(token), false);
    assert.match(String(options?.input), /Authorization: token-fixture/u);
    return {
      status: 0,
      stdout: JSON.stringify({ data: { issue: {
        identifier: 'UTV2-1734',
        title: 'Deliver the task contract',
        url: 'https://linear.app/unit-talk-v2/issue/UTV2-1734',
        description: '## Acceptance criteria\n- Prompt contains the work order.',
      } } }),
      stderr: '',
      error: undefined,
    };
  }) as typeof import('node:child_process')['spawnSync']);

  assert.equal(source.identifier, 'UTV2-1734');
  assert.equal(source.title, 'Deliver the task contract');
});

test('a sanctioned executor dispatch captures, persists, and renders a legacy lane contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-legacy-lane-contract-'));
  const laneRoot = path.join(root, 'lane-worktree');
  const syncDir = path.join(root, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  fs.mkdirSync(laneRoot, { recursive: true });
  fs.writeFileSync(path.join(syncDir, 'UTV2-1667.yml'), 'version: 1\nentities:\n  issues:\n    - UTV2-1667\n', 'utf8');

  const description = '## Scope\n- Preserve this legacy lane without a bulk migration.';
  const manifest = {
    issue_id: 'UTV2-1667', branch: 'codex/utv2-1667-legacy-lane', tier: 'T2',
    lane_type: 'governance', executor: 'codex-cli', worktree_path: laneRoot,
    file_scope_lock: ['scripts/ops/codex-exec.ts'], expected_proof_paths: [], blocked_by: [],
  } as LaneManifest;
  const result = generateDispatchExecutionPacketResult(manifest, {}, {
    root,
    linearToken: 'token-fixture',
    runner: ((_command, _args) => ({
      status: 0,
      stdout: JSON.stringify({ data: { issue: {
        identifier: 'UTV2-1667', title: 'Legacy objective',
        url: 'https://linear.app/unit-talk-v2/issue/UTV2-1667', description,
      } } }),
      stderr: '', error: undefined,
    })) as typeof import('node:child_process')['spawnSync'],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.packet.task_contract.objective, 'Legacy objective');
  assert.deepEqual(result.packet.task_contract.acceptance_criteria, [description]);
  assert.match(renderTaskContract(result.packet.task_contract), /Preserve this legacy lane/u);
  assert.deepEqual(readTaskContract('UTV2-1667', root), result.packet.task_contract);
  assert.deepEqual(readTaskContract('UTV2-1667', laneRoot), result.packet.task_contract);
});

test('lane-start reuses a valid contract and fails closed on an invalid one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-existing-contract-'));
  const syncDir = path.join(root, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  const contract = buildTaskContract({
    identifier: 'UTV2-1734', title: 'Objective',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-1734',
    description: '## Acceptance criteria\n- Criterion.',
  }, '2000-01-01T00:00:00.000Z');
  const syncPath = path.join(syncDir, 'UTV2-1734.yml');
  fs.writeFileSync(syncPath, buildSyncYmlWithTaskContract('UTV2-1734', contract), 'utf8');

  let fetched = false;
  const runner = ((_command: string, _args: readonly string[]) => {
    fetched = true;
    throw new Error('must not fetch');
  }) as typeof import('node:child_process')['spawnSync'];
  assert.deepEqual(captureOrReadTaskContract('UTV2-1734', 'token-fixture', root, runner), contract);
  assert.equal(fetched, false);

  fs.writeFileSync(syncPath, fs.readFileSync(syncPath, 'utf8').replace('Criterion.', 'Changed.'), 'utf8');
  assert.throws(
    () => captureOrReadTaskContract('UTV2-1734', 'token-fixture', root, runner),
    /hash verification failed/u,
  );
  assert.equal(fetched, false);
});

function readmissionToken(): ExistingBranchReadmissionToken {
  return {
    schema_version: 1,
    branch: 'codex/utv2-1584-existing-branch-readmission',
    head_sha: 'a'.repeat(40),
    tier: 'T1',
    issue_id: 'UTV2-1584',
    generated_at: '2026-07-24T00:00:00.000Z',
    expires_at: '2026-07-24T00:15:00.000Z',
    checks: { git: 'pass', env: 'pass', deps: 'pass' },
    status: 'pass',
    mode: 'existing-branch-readmission',
    branch_head_sha: 'b'.repeat(40),
    origin_main_sha: 'a'.repeat(40),
    open_pr_number: 1303,
    open_pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1303',
    open_pr_base_ref: 'main',
    ahead_count: 9,
    behind_count: 4,
    requested_lane_type: 'governance',
    executor: 'codex-cli',
    file_scope: ['scripts/ops/lane-start.ts', 'scripts/ops/preflight.ts'],
    previous_lane_type: 'hygiene',
    no_worktree: true,
    no_active_lease: true,
    no_active_merge_mutex: true,
  };
}

// UTV2-1492: lane-start.ts now owns declared-proof-path validation for T1
// (moved out of preflight.ts's removed PX5 check) and scaffolds the empty
// proof directory as a mechanical side effect of manifest creation, so
// operators/executors never need to hand-create it before preflight.

test('lane-start rejects a T1 lane with no expected_proof_paths declared', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(
    source,
    /tier === 'T1' && manifest\.expected_proof_paths\.length === 0/,
    'lane-start must guard against a T1 lane declaring zero expected proof paths',
  );
});

test('lane-start scaffolds the empty proof directory inside the worktree', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(
    source,
    /worktreeProofDir = path\.join\(worktreePath, 'docs', '06_status', 'proof', issueId\)/,
    'lane-start must scaffold docs/06_status/proof/<issue>/ inside the worktree',
  );
  assert.match(
    source,
    /docs\/06_status\/proof\/\$\{issueId\}\/\.gitkeep/,
    'the scaffolded proof directory placeholder must be committed alongside the manifest and sync file',
  );
});

test('lane-start does not scaffold the proof directory in the main checkout', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.doesNotMatch(
    source,
    /path\.join\(ROOT, 'docs', '06_status', 'proof', issueId\)/,
    'the main checkout must stay clean/control-plane-only; proof scaffolding belongs to the worktree only',
  );
});

test('lane-start validates T3 docs-only fast path without creating lane state', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(source, /docs-only-fast-path/, 'lane-start should expose an explicit docs-only fast-path flag');
  assert.match(source, /code: 'docs_only_fast_path'/, 'valid docs-only fast path should emit a distinct no-op result');
  assert.match(source, /tier !== 'T3'/, 'docs-only fast path must be restricted to T3 lanes');
  assert.match(source, /validatePreflightToken\(issueId, branch, currentHead\)/, 'docs-only fast path should still require current preflight');
  assert.match(source, /normalized\.startsWith\('docs\/06_status\/'\)/, 'docs-only fast path should allow status docs');
  assert.match(source, /worktree, manifest, lease, sync, and proof scaffolding/, 'docs-only fast path should skip lane ceremony explicitly');
});

// UTV2-1454 Codex-review finding: a preflight token stays usable after
// generation, so another lane can lock a docs/status file between preflight
// and this command running. The fast path must recheck activeManifestOverlap
// against *current* manifest state immediately before returning success --
// it must not rely solely on the earlier preflight PL6 result.
test('lane-start rechecks file-scope overlap inside the docs-only fast path before returning success', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');

  const blockStart = source.indexOf('if (docsOnlyFastPath) {');
  assert.notStrictEqual(blockStart, -1, 'expected an `if (docsOnlyFastPath)` block in lane-start.ts');
  const successIndex = source.indexOf("code: 'docs_only_fast_path',", blockStart);
  assert.notStrictEqual(successIndex, -1, 'expected the docs_only_fast_path success emit inside the fast-path block');
  const fastPathBlock = source.slice(blockStart, successIndex);

  // UTV2-1634 updated the signature to take the authoritative active-lane set;
  // this assertion keeps its original intent (the recheck happens here, after
  // preflight, before success) while additionally requiring that the set passed
  // in is the remote-resolved one rather than a local-only read.
  const overlapCallIndex = fastPathBlock.indexOf(
    'activeManifestOverlap(issueId, normalizedFiles, activeManifests)',
  );
  assert.notStrictEqual(
    overlapCallIndex,
    -1,
    'the docs-only fast path must call activeManifestOverlap on the authoritative active-lane set before emitting ' +
      'success -- trusting the preflight token alone allows a concurrent lane to lock the same file after preflight ' +
      'ran, and trusting a local-only manifest read misses lanes that exist only on their own PR branch',
  );

  const preflightCallIndex = fastPathBlock.indexOf('validatePreflightToken(issueId, branch, currentHead)');
  assert.notStrictEqual(preflightCallIndex, -1, 'expected the preflight token recheck inside the fast-path block');
  assert.ok(
    overlapCallIndex > preflightCallIndex,
    'the overlap recheck must happen after preflight validation and before the success response, ' +
      'not be skipped in favor of the earlier preflight-time PL6 result',
  );

  assert.match(
    fastPathBlock,
    /code: 'file_scope_conflict'/,
    'an overlap detected during the fast-path recheck must fail closed with file_scope_conflict, ' +
      'the same code the normal lane-start path uses -- not silently emit docs_only_fast_path success',
  );
  assert.match(
    fastPathBlock,
    /ok: false,\s*\n\s*code: 'file_scope_conflict'/,
    'the fast-path overlap conflict response must be ok:false',
  );
});

// UTV2-1526 PM review finding #1: a `pnpm ops:lane:resume` re-invocation of
// ops:lane-start for an existing, blocked Codex lane must reuse the manifest's
// existing model_routing untouched -- it must never be required to (re)specify
// --model-profile, and must never reconstruct/overwrite model_routing.
test('lane-start resume branch never requires or reconstructs model_routing', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');

  const resumeBlockStart = source.indexOf('if (branchAlreadyExists && worktreeAlreadyExists) {');
  assert.notStrictEqual(resumeBlockStart, -1, 'expected the branch+worktree-already-exist resume branch');
  const resumeBlockEnd = source.indexOf("code: 'lane_resumed',", resumeBlockStart);
  assert.notStrictEqual(resumeBlockEnd, -1, 'expected a lane_resumed success emit inside the resume branch');
  const resumeBlock = source.slice(resumeBlockStart, resumeBlockEnd);

  assert.doesNotMatch(
    resumeBlock,
    /model_profile_required|resolveModelProfile|model_routing:/,
    'the resume branch must not require --model-profile or reconstruct model_routing -- ' +
      'it only mutates heartbeat_at/status/execution_location and preserves everything else on the existing manifest object',
  );
  assert.doesNotMatch(
    resumeBlock,
    /createManifest\(/,
    'the resume branch must not call createManifest -- that would require re-deriving model_routing for a lane that already has it',
  );

  const modelProfileRequiredIndex = source.indexOf("code: 'model_profile_required'");
  assert.notStrictEqual(modelProfileRequiredIndex, -1, 'expected the model_profile_required precondition to exist');
  assert.ok(
    modelProfileRequiredIndex > resumeBlockEnd,
    'the --model-profile requirement must be enforced strictly after the resume branch, on the create-new-lane path only -- ' +
      'enforcing it earlier (unconditionally) would break every Codex lane resume',
  );
});

// PM review finding #4: the model-routing evidence sidecar's path must be declared in
// the Codex lane's own expected_proof_paths at creation time, not left implicit.
test('lane-start declares the model-routing evidence path in expected_proof_paths for Codex lanes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(
    source,
    /if \(isCodexExecutor\) \{\s*\n\s*expectedProofPaths\.push\(`docs\/06_status\/proof\/\$\{issueId\}\/model-routing\.json`\)/,
    'a Codex lane must declare docs/06_status/proof/<issue>/model-routing.json in expected_proof_paths at lane-start time',
  );
});

// PR #1213 Codex review fix: ops:lane:resume re-invokes ops:lane-start for a blocked
// verification lane without re-supplying --verification-target (same as it doesn't
// re-supply --model-profile) -- the concurrency check must backfill from the existing
// manifest, not treat every resume as a "missing target" violation.
test('lane-start backfills verification_target from the existing manifest on resume, before the concurrency check', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');

  const backfillIndex = source.indexOf('const effectiveVerificationTarget = verificationTargetFlag ?? existingManifestForResume?.verification_target;');
  assert.notStrictEqual(backfillIndex, -1, 'expected the resume-backfill assignment for effectiveVerificationTarget');

  const concurrencyCallIndex = source.indexOf('const concurrencyViolations = checkConcurrencyLimits(');
  assert.notStrictEqual(concurrencyCallIndex, -1, 'expected the checkConcurrencyLimits call site');
  assert.ok(
    backfillIndex < concurrencyCallIndex,
    'effectiveVerificationTarget must be computed before checkConcurrencyLimits runs, not after -- ' +
      'otherwise every verification-lane resume spuriously fails the per-target cap\'s missing-target check',
  );

  const concurrencyCallBlockEnd = source.indexOf(');', concurrencyCallIndex);
  const concurrencyCallBlock = source.slice(concurrencyCallIndex, concurrencyCallBlockEnd);
  assert.match(
    concurrencyCallBlock,
    /verificationTarget: effectiveVerificationTarget/,
    'checkConcurrencyLimits must receive the backfilled effectiveVerificationTarget, not the raw CLI flag',
  );
  assert.match(
    concurrencyCallBlock,
    /activeManifests/,
    'checkConcurrencyLimits must receive the authoritative active-lane set (UTV2-1634), ' +
      'not a local-only readAllManifests() read',
  );
});

// PR #1213 Codex review fix: a malformed --verification-target must fail before
// createBranchAndWorktree/reserveLease run, not deep inside createManifest -- otherwise a
// typo leaves an orphaned branch/worktree/lease behind it.
test('UTV2-1634: lane-start resolves the active-lane set from authoritative remote state and fails closed', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');

  assert.match(
    source,
    /resolveActiveLaneManifests\(\)/,
    'lane-start must resolve active lanes via resolveActiveLaneManifests(), not a local-only manifest read',
  );
  assert.match(
    source,
    /code: 'active_lane_discovery_failed'/,
    'lane-start must fail closed with active_lane_discovery_failed when the board cannot be enumerated',
  );

  const discoveryIndex = source.indexOf("code: 'active_lane_discovery_failed'");
  // Anchor on the real call site, not the doc comment above the import that
  // also mentions `checkConcurrencyLimits()`.
  const concurrencyIndex = source.indexOf('const concurrencyViolations = checkConcurrencyLimits(');
  assert.ok(
    discoveryIndex !== -1 && discoveryIndex < concurrencyIndex,
    'the discovery failure guard must run BEFORE checkConcurrencyLimits, so an unknown board never reaches admission',
  );

  assert.match(
    source,
    /activeManifests = activeLaneDiscovery\.manifests\.filter\(\(m\) => m\.issue_id !== issueId\)/,
    'the incoming issue must still be excluded from its own conflict-search set on resume',
  );
  assert.match(
    source,
    /activeManifestOverlap\(issueId, normalizedFiles, activeManifests\)/,
    'the file-scope overlap check must use the authoritative set too, not fall back to local-only',
  );
  assert.match(
    source,
    /active_lanes: activeLaneDiscovery\.lanes\.map/,
    'the refusal receipt must emit the resolved active-lane set for after-the-fact diagnosis',
  );
});

test('lane-start validates verification_target format before creating branch/worktree/lease state', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');

  const formatCheckIndex = source.indexOf("code: 'verification_target_malformed'");
  assert.notStrictEqual(formatCheckIndex, -1, 'expected an early verification_target_malformed precondition');

  const createBranchIndex = source.indexOf('createBranchAndWorktree(branch, worktreePath);');
  assert.notStrictEqual(createBranchIndex, -1, 'expected the createBranchAndWorktree call site');
  const reserveLeaseIndex = source.indexOf('const lease = reserveLease({', createBranchIndex);
  assert.notStrictEqual(reserveLeaseIndex, -1, 'expected a reserveLease call site after createBranchAndWorktree');

  assert.ok(
    formatCheckIndex < createBranchIndex && formatCheckIndex < reserveLeaseIndex,
    'verification_target_malformed must be checked before createBranchAndWorktree and reserveLease run -- ' +
      'validating it only inside createManifest happens too late, after real branch/worktree/lease side effects',
  );
});

// PR #1215 Codex review fix (round 5): requireVerificationTarget() normalizes (uppercases)
// internally, but a discarded return value means a lower-case --verification-target passes
// this early check yet still reaches createManifest's case-sensitive pattern check as the
// original lower-case string, failing after branch/worktree/lease side effects had already
// run -- the exact orphaned-state case this early check exists to prevent.
// verificationTargetFlag must be declared with `let` and reassigned to the normalized return
// value, not left as a `const` alias to the raw flag.
//
// PR #1215 Codex review fix (round 6): the normalization call must use
// requireVerificationTarget(), not the general requireIssueId() -- the latter also accepts
// UNI-### (ISSUE_PATTERN), but verification_target is documented UTV2-### only in the
// manifest schema and LANE_MANIFEST_SPEC.md §16.
test('lane-start normalizes verification_target via requireVerificationTarget (UTV2-### only) before any downstream use', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');

  assert.match(
    source,
    /let verificationTargetFlag = flags\.get\('verification-target'\)\?\.at\(-1\);/,
    'verificationTargetFlag must be declared with `let` (it is reassigned after normalization), not `const`',
  );

  const malformedCheckIndex = source.indexOf("code: 'verification_target_malformed'");
  assert.notStrictEqual(malformedCheckIndex, -1, 'expected the verification_target_malformed precondition block');
  const tryBlockStart = source.lastIndexOf('try {', malformedCheckIndex);
  const normalizeCallIndex = source.indexOf('requireVerificationTarget(verificationTargetFlag)', tryBlockStart);
  assert.notStrictEqual(normalizeCallIndex, -1, 'expected a requireVerificationTarget(verificationTargetFlag) call inside the try block');
  assert.strictEqual(
    source.indexOf('requireIssueId(verificationTargetFlag)', tryBlockStart) === -1 ||
      source.indexOf('requireIssueId(verificationTargetFlag)', tryBlockStart) > malformedCheckIndex + 500,
    true,
    'the general requireIssueId() must not be used to validate verification_target -- it also accepts UNI-###',
  );

  const reassignmentLine = source.slice(
    source.lastIndexOf('\n', normalizeCallIndex) + 1,
    source.indexOf('\n', normalizeCallIndex),
  ).trim();
  assert.strictEqual(
    reassignmentLine,
    'verificationTargetFlag = requireVerificationTarget(verificationTargetFlag);',
    `requireVerificationTarget's normalized return value must be reassigned back to verificationTargetFlag, not discarded -- found: "${reassignmentLine}"`,
  );
});

// UTV2-1546: delegation kill switch must be the very first thing main() does --
// before argument validation, before the substrate guard, before any lease
// reservation, worktree creation, or manifest write. See delegation-state.ts's
// full behavioral coverage (delegation-state.test.ts) for missing/malformed/
// suspended/active state handling.
test('lane-start checks delegation before argument validation and before any lease/worktree/manifest side effect', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const tryIndex = source.indexOf('try {');
  const delegationCallIndex = source.indexOf("requireDelegationActive('lane-start')");
  const missingArgsIndex = source.indexOf('const missing: string[] = [];');
  const reserveLeaseIndex = source.indexOf('reserveLease(');
  const createManifestIndex = source.indexOf('createManifest(');

  assert.ok(delegationCallIndex >= 0, 'lane-start.ts must call requireDelegationActive');
  assert.ok(tryIndex >= 0 && tryIndex < delegationCallIndex, 'delegation check must be inside the try block');
  assert.ok(
    delegationCallIndex < missingArgsIndex,
    'delegation kill switch must run before argument validation',
  );
  assert.ok(
    delegationCallIndex < reserveLeaseIndex,
    'delegation kill switch must run before any lease reservation',
  );
  assert.ok(
    delegationCallIndex < createManifestIndex,
    'delegation kill switch must run before any manifest is created',
  );
});

test('lane-start exits non-zero (refuses) when delegation is suspended', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const delegationBlock = source.slice(
    source.indexOf("requireDelegationActive('lane-start')"),
    source.indexOf("requireDelegationActive('lane-start')") + 300,
  );
  assert.match(delegationBlock, /delegation_suspended/);
  assert.match(delegationBlock, /process\.exit\(1\)/);
});

test('readmission 25: the PR base-ref revalidation only exists inside the readmission branch, never on fresh admission or ordinary resume', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const mainHeadIndex = source.indexOf('const mainHead = assertCleanMainControlCheckout();');
  const readmissionBlockStart = source.lastIndexOf('if (readmitExistingBranch) {', mainHeadIndex);
  assert.notStrictEqual(readmissionBlockStart, -1, 'expected the main control checkout assertion to live inside a readmitExistingBranch-gated block');
  const callSite = source.indexOf('exactOpenPullRequest(repository, branch)');
  assert.ok(callSite > readmissionBlockStart && callSite > mainHeadIndex, 'exactOpenPullRequest (and its base-ref check) must only run inside the readmission branch');
  assert.equal(
    (source.match(/exactOpenPullRequest\(/g) ?? []).length,
    2,
    'exactOpenPullRequest should have exactly one definition and one call site -- it must not be reachable from fresh admission or resume',
  );
});

test('readmission 11: ordinary resume remains a separate lane_resumed path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(
    source,
    /if \(branchAlreadyExists && worktreeAlreadyExists\) \{[\s\S]*if \(readmitExistingBranch\)/,
  );
  assert.match(source, /code: 'lane_resumed'/);
});

test('readmission 12: existing branch plus missing worktree still fails without the flag', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(
    source,
    /if \(!readmitExistingBranch && branchAlreadyExists && !worktreeAlreadyExists\) \{\s*throw new Error\('Branch exists but worktree does not exist; Phase 1 fails closed'\)/,
  );
});

test('readmission 13: changed branch head invalidates the token', () => {
  const token = readmissionToken();
  const errors = validateReadmissionTokenRequest(token, {
    issueId: token.issue_id,
    branch: token.branch,
    tier: token.tier,
    laneType: token.requested_lane_type,
    executor: token.executor,
    fileScope: token.file_scope,
    currentMainSha: token.origin_main_sha,
    currentBranchSha: 'c'.repeat(40),
    openPrNumber: token.open_pr_number,
    openPrBaseRef: token.open_pr_base_ref,
  });
  assert.deepEqual(errors, ['branch head changed after preflight']);
});

test('readmission 14: changed main head invalidates both token head bindings', () => {
  const token = readmissionToken();
  const errors = validateReadmissionTokenRequest(token, {
    issueId: token.issue_id,
    branch: token.branch,
    tier: token.tier,
    laneType: token.requested_lane_type,
    executor: token.executor,
    fileScope: token.file_scope,
    currentMainSha: 'd'.repeat(40),
    currentBranchSha: token.branch_head_sha,
    openPrNumber: token.open_pr_number,
    openPrBaseRef: token.open_pr_base_ref,
  });
  assert.deepEqual(errors, ['main head changed after preflight']);

  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const readmissionStart = source.indexOf('if (readmitExistingBranch) {', source.indexOf('let modelRouting'));
  const refreshMain = source.indexOf("git(['fetch', 'origin', 'main'])", readmissionStart);
  const readOriginMain = source.indexOf("git(['rev-parse', 'origin/main'])", readmissionStart);
  assert.ok(
    refreshMain !== -1 && refreshMain < readOriginMain,
    'lane-start must refresh origin/main before comparing it with the token-bound main SHA',
  );
});

test('readmission 15: reconstructed worktree uses the existing branch without a new-branch flag', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const start = source.indexOf('function createWorktreeFromExistingBranch(');
  const end = source.indexOf('function removeReadmissionWorktree(', start);
  const block = source.slice(start, end);
  assert.match(block, /git\(\['worktree', 'add', worktreePath, branch\]\)/);
  assert.doesNotMatch(block, /'worktree', 'add'[\s\S]*'-b'/);
  assert.match(block, /reconstructedHead !== branchState\.sha/);
});

test('readmission 16: fresh manifest records requested governance and prior hygiene only as history', () => {
  const token = readmissionToken();
  const valid = validateReadmissionTokenRequest(token, {
    issueId: token.issue_id,
    branch: token.branch,
    tier: token.tier,
    laneType: 'governance',
    executor: token.executor,
    fileScope: token.file_scope,
    currentMainSha: token.origin_main_sha,
    currentBranchSha: token.branch_head_sha,
    openPrNumber: token.open_pr_number,
    openPrBaseRef: token.open_pr_base_ref,
  });
  assert.deepEqual(valid, []);

  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(source, /lane_type: canonicalLaneType/);
  assert.match(source, /previous_lane_type=\$\{token\.previous_lane_type \?\? 'unknown'\}/);
  assert.doesNotMatch(source, /^\s*lane_type:\s*token\.previous_lane_type/m);
});

test('readmission 17: mismatched scope, executor, lane type, tier, or PR cannot reuse a token', () => {
  const token = readmissionToken();
  const errors = validateReadmissionTokenRequest(token, {
    issueId: token.issue_id,
    branch: token.branch,
    tier: 'T2',
    laneType: 'hygiene',
    executor: 'claude',
    fileScope: ['scripts/ops/preflight.ts'],
    currentMainSha: token.origin_main_sha,
    currentBranchSha: token.branch_head_sha,
    openPrNumber: 999,
    openPrBaseRef: 'main',
  });
  assert.deepEqual(errors, [
    'token tier does not match request',
    'token lane type does not match request',
    'token executor does not match request',
    'token file scope does not match request',
    'open PR identity changed after preflight',
  ]);
});

test('readmission 21: a request that matches the token exactly, including base ref main, produces no errors', () => {
  const token = readmissionToken();
  const errors = validateReadmissionTokenRequest(token, {
    issueId: token.issue_id,
    branch: token.branch,
    tier: token.tier,
    laneType: token.requested_lane_type,
    executor: token.executor,
    fileScope: token.file_scope,
    currentMainSha: token.origin_main_sha,
    currentBranchSha: token.branch_head_sha,
    openPrNumber: token.open_pr_number,
    openPrBaseRef: token.open_pr_base_ref,
  });
  assert.deepEqual(errors, []);
});

test('readmission 22: a PR retargeted away from main after preflight invalidates the token', () => {
  const token = readmissionToken();
  assert.equal(token.open_pr_base_ref, 'main');
  const errors = validateReadmissionTokenRequest(token, {
    issueId: token.issue_id,
    branch: token.branch,
    tier: token.tier,
    laneType: token.requested_lane_type,
    executor: token.executor,
    fileScope: token.file_scope,
    currentMainSha: token.origin_main_sha,
    currentBranchSha: token.branch_head_sha,
    openPrNumber: token.open_pr_number,
    openPrBaseRef: 'release',
  });
  assert.deepEqual(errors, ['open PR base ref changed after preflight']);
});

test('readmission 23: a malformed or tampered token that itself claims a non-main base ref cannot be reused, even if the live re-fetch happens to match it', () => {
  const token = { ...readmissionToken(), open_pr_base_ref: 'staging' };
  const errors = validateReadmissionTokenRequest(token, {
    issueId: token.issue_id,
    branch: token.branch,
    tier: token.tier,
    laneType: token.requested_lane_type,
    executor: token.executor,
    fileScope: token.file_scope,
    currentMainSha: token.origin_main_sha,
    currentBranchSha: token.branch_head_sha,
    openPrNumber: token.open_pr_number,
    openPrBaseRef: 'staging',
  });
  assert.deepEqual(errors, ['open PR base ref changed after preflight']);
});

test('readmission 24: lane-start independently re-fetches and rejects a non-main PR before it ever consults the token', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const fnStart = source.indexOf('function exactOpenPullRequest(');
  const fnEnd = source.indexOf('\n}\n', fnStart);
  const fnBody = source.slice(fnStart, fnEnd);
  assert.match(
    fnBody,
    /if \(pullRequest\.base\.ref !== 'main'\)/,
    'exactOpenPullRequest must independently reject a non-main base ref -- it never receives or reads the token',
  );
  assert.match(fnBody, /open PR base ref changed after preflight/);

  const callSite = source.indexOf('const pullRequest = exactOpenPullRequest(repository, branch);');
  const tokenReadSite = source.indexOf('const token = preflight.token as ExistingBranchReadmissionToken;');
  assert.ok(
    callSite >= 0 && tokenReadSite > callSite,
    'the live PR re-fetch and its own base-ref rejection must happen before the token is even read',
  );
});

test('readmission 18: post-worktree failures release lease, remove worktree, and restore root metadata', () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'readmission-token-'));
  const sourceToken = path.join(testRoot, 'source.json');
  const worktree = path.join(testRoot, 'worktree');
  fs.writeFileSync(sourceToken, '{"status":"pass"}\n', 'utf8');
  const mirrored = mirrorPreflightTokenToWorktree(
    sourceToken,
    '.out/ops/preflight/codex/utv2-1584.json',
    worktree,
  );
  assert.equal(
    mirrored,
    path.join(worktree, '.out/ops/preflight/codex/utv2-1584.json'),
  );
  assert.equal(fs.readFileSync(mirrored, 'utf8'), '{"status":"pass"}\n');
  assert.throws(
    () => mirrorPreflightTokenToWorktree(sourceToken, '../outside.json', worktree),
    /Parent traversal is not allowed/,
  );
  fs.rmSync(testRoot, { recursive: true, force: true });

  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const transactionStart = source.indexOf('const manifestSnapshot = snapshotFile(manifestPath);');
  const transactionEnd = source.indexOf("if (!branchAlreadyExists && !worktreeAlreadyExists) {", transactionStart);
  const block = source.slice(transactionStart, transactionEnd);
  assert.match(block, /mirrorPreflightTokenToWorktree\(/);
  assert.match(block, /releaseLease\(\{/);
  assert.match(block, /removeReadmissionWorktree\(branch, worktreePath, localBranchCreated\)/);
  assert.match(block, /restoreFile\(manifestSnapshot\)/);
  assert.match(block, /restoreFile\(syncSnapshot\)/);
});

test('readmission 19: root checkout is checked as clean main and never switched to the lane branch', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(source, /function assertCleanMainControlCheckout\(\)/);
  assert.match(source, /currentBranch\.stdout !== 'main'/);
  assert.doesNotMatch(source, /git\(\['checkout', branch\]/);
  assert.doesNotMatch(source, /git\(\['switch', branch\]/);

  assert.equal(isPermittedControlRegistryPath('.ops/sync/UTV2-1584.yml'), true);
  assert.equal(isPermittedControlRegistryPath('docs/06_status/lanes/UTV2-1584.json'), true);
  assert.equal(isPermittedControlRegistryPath('.ops/sync/arbitrary.txt'), false);
  assert.equal(isPermittedControlRegistryPath('docs/06_status/lanes/UTV2-1584.json.bak'), false);
});

test('readmission 20: generic unsafe force cannot substitute for explicit readmission mode', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const legacyFailure = source.indexOf(
    "throw new Error('Branch exists but worktree does not exist; Phase 1 fails closed')",
  );
  assert.notEqual(legacyFailure, -1);
  const nearby = source.slice(Math.max(0, legacyFailure - 160), legacyFailure + 160);
  assert.match(nearby, /!readmitExistingBranch/);
  assert.doesNotMatch(nearby, /forceUnsafeSubstrate/);
  assert.match(source, /code: 'lane_readmitted_existing_branch'/);
});

test('readmission validates branch-only file scope against the target branch, not main', () => {
  const branchOnlyScope = [
    'scripts/autonomy/kernel.ts',
    'scripts/autonomy/**',
    'docs/06_status/proof/UTV2-1578/evidence.json',
  ];
  const existingTargetObjects = new Map<string, 'file' | 'directory'>([
    ['scripts/autonomy/kernel.ts', 'file'],
    ['scripts/autonomy', 'directory'],
  ]);

  assert.deepEqual(
    findMissingReadmissionScopePaths(
      branchOnlyScope,
      (repoRelativePath, kind) => existingTargetObjects.get(repoRelativePath) === kind,
    ),
    [],
    'new implementation paths and proof intent paths should be valid when present only on the target branch',
  );
  assert.deepEqual(
    findMissingReadmissionScopePaths(
      ['scripts/autonomy/missing.ts'],
      (repoRelativePath, kind) => existingTargetObjects.get(repoRelativePath) === kind,
    ),
    ['scripts/autonomy/missing.ts'],
    'a path absent from the target branch must still fail closed',
  );

  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(
    source,
    /readmitExistingBranch\s*\?\s*normalizeRepoRelativePaths\(fileArgs\)\s*:\s*normalizeFileScope\(fileArgs\)/,
    'readmission must not require branch-only paths to exist on the main control checkout',
  );
  assert.match(
    source,
    /assertReadmissionScopeExistsAtRef\(branchState\.sourceRef, normalizedFiles\)/,
    'branch-only scope must be checked against the exact existing branch before side effects',
  );
});

// UTV2-1634 correction round: no lane-start mode may bypass authoritative
// active-lane discovery. --docs-only-fast-path still reserves real files
// against real concurrent lanes, so a local-only view there is the same
// fail-open as on the normal path.
test('UTV2-1634: authoritative discovery runs BEFORE the docs-only fast path, and that path uses the resolved set', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');

  const discoveryIndex = source.indexOf('activeLaneDiscovery = resolveActiveLaneManifests()');
  const fastPathIndex = source.indexOf('if (docsOnlyFastPath) {');
  assert.notStrictEqual(discoveryIndex, -1, 'expected authoritative discovery in lane-start');
  assert.notStrictEqual(fastPathIndex, -1, 'expected a docs-only fast path branch');
  assert.ok(
    discoveryIndex < fastPathIndex,
    'discovery must run before the docs-only fast path so that path cannot bypass remote scope enforcement',
  );

  // Exactly one discovery site -- a second copy would be a re-introduction risk.
  assert.strictEqual(
    source.split('resolveActiveLaneManifests()').length - 1,
    1,
    'there must be exactly one authoritative discovery call site in lane-start',
  );

  // Both overlap checks (fast path and normal) must take the authoritative set.
  const overlapCalls = source.match(/activeManifestOverlap\([^)]*\)/g) ?? [];
  assert.strictEqual(overlapCalls.length, 2, 'expected exactly two overlap call sites');
  for (const call of overlapCalls) {
    assert.match(
      call,
      /activeManifests/,
      `every activeManifestOverlap call must receive the authoritative set, got: ${call}`,
    );
  }
});

test('UTV2-1634: discovery failure blocks the docs-only fast path as well as normal admission', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');

  const guardIndex = source.indexOf("code: 'active_lane_discovery_failed'");
  const fastPathIndex = source.indexOf('if (docsOnlyFastPath) {');
  assert.ok(
    guardIndex !== -1 && guardIndex < fastPathIndex,
    'the fail-closed discovery guard must precede the docs-only fast path, so an unknown board refuses both routes',
  );
});

// ---------------------------------------------------------------------------
// Executing coverage for lane-start main() (UTV2-1747)
//
// Nothing in this repository executed lane-start's main(), so reverting either
// real capture call site left the whole suite green -- the defect class this
// lane exists to remove, sitting in the lane's own dependency. These tests run
// the real entrypoint as a child process against a fixture repository.
//
// Isolation: getRepoRoot() shells out to `git rev-parse --show-toplevel`
// inheriting process.cwd(), so a git-initialised fixture directory rebinds ROOT
// to itself. Offline: a stub `gh` on PATH returns an empty board, and the
// LINEAR_* variables are stripped from the child environment, so a capture
// cannot silently succeed against the real Linear.
// ---------------------------------------------------------------------------

const LANE_TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');

interface LaneFixture {
  root: string;
  worktree: string;
  bin: string;
  issueId: string;
  branch: string;
}

function seedLaneFixture(issueId: string, opts: { withWorktree: boolean }): LaneFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1747-lanestart-'));
  const root = path.join(dir, 'repo');
  const slug = issueId.toLowerCase();
  const branch = `claude/${slug}-fixture`;
  const worktree = path.join(root, '.out', 'worktrees', branch.replaceAll('/', '__'));

  fs.mkdirSync(path.join(root, 'docs', '06_status', 'lanes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', '05_operations', 'policies'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', '05_operations', 'schemas'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'governance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'ops'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ops', 'sync'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ops', 'leases'), { recursive: true });

  // Real control data, copied rather than invented: a hand-authored policy or
  // schema can assert against a field the production reader never consults.
  for (const rel of [
    ['docs', '05_operations', 'policies', 'codex-model-routing.json'],
    ['docs', '05_operations', 'db-writer-classification.json'],
    ['docs', '05_operations', 'DELEGATION_STATE.json'],
    ['docs', '05_operations', 'schemas', 'lane_manifest_v1.schema.json'],
    ['docs', 'governance', 'CONCURRENCY_CONFIG.json'],
  ]) {
    fs.copyFileSync(path.join(ROOT, ...rel), path.join(root, ...rel));
  }
  fs.writeFileSync(path.join(root, 'scripts', 'ops', 'fixture.ts'), 'export const fixture = 1;\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'seed\n');

  const git = (args: string[], cwd = root): void => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  };
  git(['init', '-q', '-b', 'main', '.']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['add', '-A']);
  git(['commit', '-qm', 'seed']);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();

  if (opts.withWorktree) {
    git(['worktree', 'add', '-q', '-b', branch, worktree]);
    // A worktree that already has node_modules skips the isolated install, so
    // the resume path completes without a package manager or a network.
    fs.mkdirSync(path.join(worktree, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(worktree, '.ops', 'sync'), { recursive: true });

    const manifest = {
      schema_version: 2, issue_id: issueId, lane_type: 'governance', executor: 'claude',
      tier: 'T2', worktree_path: worktree, branch, base_branch: 'main', commit_sha: null,
      pr_url: null, files_changed: [], file_scope_lock: ['scripts/ops/fixture.ts'],
      expected_proof_paths: [], status: 'started',
      started_at: '2026-08-24T00:00:00.000Z', heartbeat_at: '2026-08-24T00:00:00.000Z',
      closed_at: null, blocked_by: [], preflight_token: `.out/ops/preflight/${branch}.json`,
      created_by: 'claude', truth_check_history: [], reopen_history: [],
      execution_location: {
        mode: 'worktree', cwd: worktree, package_install: 'verified',
        setup_command: null, main_checkout_control_only: true,
      },
    };
    fs.writeFileSync(
      path.join(root, 'docs', '06_status', 'lanes', `${issueId}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  const tokenPath = path.join(root, '.out', 'ops', 'preflight', `${branch}.json`);
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 1, status: 'pass', issue_id: issueId, branch, head_sha: head,
    expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  }, null, 2)}\n`);

  // Stub board. Kept outside the repository so it is not untracked content.
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "[]"\nexit 0\n', { mode: 0o755 });

  return { root, worktree, bin, issueId, branch };
}

/** Write a contract into one root, optionally carrying accumulated entities. */
function seedContractAt(
  destRoot: string,
  issueId: string,
  description: string,
  extraFinding?: string,
): TaskContract {
  const contract = buildTaskContract({
    identifier: issueId, title: 'Fixture lane',
    url: `https://linear.app/unit-talk/issue/${issueId}`,
    description,
  }, '2026-08-24T00:00:00.000Z');
  let yml = buildSyncYmlWithTaskContract(issueId, contract);
  if (extraFinding) yml = yml.replace('  findings: []', `  findings:\n    - ${extraFinding}`);
  const p = path.join(destRoot, '.ops', 'sync', `${issueId}.yml`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, yml);
  return contract;
}

function runLaneStart(fixture: LaneFixture, extra: string[] = []): {
  status: number | null; stdout: string; stderr: string;
} {
  const env = { ...process.env, PATH: `${fixture.bin}${path.delimiter}${process.env['PATH'] ?? ''}` };
  // A capture must not be able to reach the real Linear from a test.
  delete env['LINEAR_API_TOKEN'];
  delete env['LINEAR_API_KEY'];
  const r = spawnSync(LANE_TSX_BIN, [
    path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), fixture.issueId,
    '--tier', 'T2', '--branch', fixture.branch, '--lane-type', 'governance',
    '--executor', 'claude', '--files', 'scripts/ops/fixture.ts', ...extra,
  ], { cwd: fixture.root, encoding: 'utf8', timeout: 180_000, env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function laneJson(out: string): Record<string, unknown> {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  assert.ok(start >= 0 && end > start, `expected JSON in lane-start output:\n${out}`);
  return JSON.parse(out.slice(start, end + 1)) as Record<string, unknown>;
}

test('lane-start main() completes an offline resume without corrupting the lane contract', () => {
  const f = seedLaneFixture('UTV2-999801', { withWorktree: true });
  const seeded = seedContractAt(f.worktree, f.issueId,
    '## Objective\nResume must reuse this contract.\n\n## Acceptance criteria\n- no refetch');

  const run = runLaneStart(f);
  assert.equal(run.status, 0, `resume must succeed offline; stderr: ${run.stderr}\n${run.stdout}`);
  const out = laneJson(run.stdout);
  assert.equal(out['code'], 'lane_resumed');

  // Named for what it actually observes: the resume completes offline and leaves
  // the contract intact. It does NOT by itself prove the capture wiring is
  // present -- it survives that mutation, because the lane's own copy is still
  // readable. The wiring is proved by the conflict and capture-failure tests
  // below, which is where M9a is detected.
  const readBack = readTaskContract(f.issueId, f.worktree);
  assert.equal(readBack.contract_hash, seeded.contract_hash,
    'resume must keep the lane contract hash stable');
});

test('lane-start main() persists one contract to both roots, merging each against its own record', () => {
  const f = seedLaneFixture('UTV2-999802', { withWorktree: true });
  const seeded = seedContractAt(f.worktree, f.issueId,
    '## Objective\nPersist to both roots.\n\n## Acceptance criteria\n- merged per destination',
    'BRANCH-FINDING-1');

  const run = runLaneStart(f);
  assert.equal(run.status, 0, `resume must succeed; stderr: ${run.stderr}\n${run.stdout}`);

  // The branch's accumulated entities survive: merging the worktree write
  // against the CONTROL checkout's record replaced them with the control copy's.
  const worktreeYml = fs.readFileSync(path.join(f.worktree, '.ops', 'sync', `${f.issueId}.yml`), 'utf8');
  assert.match(worktreeYml, /BRANCH-FINDING-1/u,
    'the branch sync record must keep entities accumulated on the branch');

  assert.equal(readTaskContract(f.issueId, f.worktree).contract_hash, seeded.contract_hash);
  assert.equal(readTaskContract(f.issueId, f.root).contract_hash, seeded.contract_hash,
    'both roots must carry the same contract');
});

test('lane-start main() refuses two different valid contracts instead of choosing one', () => {
  const f = seedLaneFixture('UTV2-999803', { withWorktree: true });
  seedContractAt(f.worktree, f.issueId,
    '## Objective\nThe lane is working from this one.\n\n## Acceptance criteria\n- a');
  seedContractAt(f.root, f.issueId,
    '## Objective\nA DIFFERENT work order.\n\n## Acceptance criteria\n- b');

  const run = runLaneStart(f);
  assert.equal(run.status, 1, `divergent contracts must fail closed; ${run.stdout}`);
  const out = laneJson(run.stdout);
  assert.equal(out['code'], 'lane_contract_conflict');
  assert.notEqual(out['control_contract_hash'], out['worktree_contract_hash']);
});

test('lane-start main() resume capture failure creates no lane state at all', () => {
  // No contract anywhere and no token: the one bounded capture fails. Nothing
  // may be reserved, written or mutated -- a half-started lane is worse than a
  // refused one.
  const f = seedLaneFixture('UTV2-999804', { withWorktree: true });
  const manifestPath = path.join(f.root, 'docs', '06_status', 'lanes', `${f.issueId}.json`);
  const before = fs.readFileSync(manifestPath, 'utf8');

  const run = runLaneStart(f);
  assert.equal(run.status, 1, `capture failure must refuse; ${run.stdout}`);
  assert.match(String(laneJson(run.stdout)['message']), /LINEAR_API_TOKEN or LINEAR_API_KEY is required/u);

  assert.deepEqual(fs.readdirSync(path.join(f.root, '.ops', 'leases')), [],
    'a failed capture must reserve no lease');
  assert.deepEqual(fs.readdirSync(path.join(f.root, '.ops', 'sync')), [],
    'a failed capture must write no control sync record');
  assert.deepEqual(fs.readdirSync(path.join(f.worktree, '.ops', 'sync')), [],
    'a failed capture must write no lane sync record');
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), before,
    'a failed capture must not touch the manifest');
});

test('lane-start main() fresh-lane capture failure refuses before creating any lane substrate', () => {
  // Exercises the OTHER real capture call site. Without it, a fresh lane with no
  // contract and no token would proceed past this point instead of refusing here.
  const f = seedLaneFixture('UTV2-999805', { withWorktree: false });

  const run = runLaneStart(f);
  assert.equal(run.status, 1, `fresh capture failure must refuse; ${run.stdout}`);
  assert.match(String(laneJson(run.stdout)['message']), /LINEAR_API_TOKEN or LINEAR_API_KEY is required/u,
    'the fresh path must refuse AT capture, before branch, worktree, lease or manifest creation');

  assert.equal(fs.existsSync(path.join(f.root, 'docs', '06_status', 'lanes', `${f.issueId}.json`)), false,
    'no manifest may be created when the capture fails');
  assert.equal(fs.existsSync(f.worktree), false, 'no worktree may be created when the capture fails');
  assert.deepEqual(fs.readdirSync(path.join(f.root, '.ops', 'leases')), [],
    'no lease may be reserved when the capture fails');
});

test('F5: readmission resolves the branch contract instead of overwriting it with the control copy', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const blockStart = source.indexOf('if (readmitExistingBranch) {');
  assert.notStrictEqual(blockStart, -1, 'expected a readmitExistingBranch block to exist');
  const blockEnd = source.indexOf('\n    } else if', blockStart);
  const block = blockEnd === -1 ? source.slice(blockStart) : source.slice(blockStart, blockEnd);

  // Precondition: the block really is the readmission path and really does
  // place metadata into the lane worktree. Without this the assertions below
  // could pass against an empty or mis-located slice.
  assert.match(block, /worktreeManifestDir/u, 'slice must be the readmission metadata path');

  // The defect: the control checkout's sync file was copied wholesale over the
  // branch's, discarding a divergent authoritative contract unread.
  assert.doesNotMatch(
    block,
    /copyFileSync\(\s*syncPath/u,
    'readmission must not copy the control sync file over the branch copy',
  );
  // The fix: resolve across BOTH roots once the branch worktree exists, then
  // persist per-destination so each is merged against its own record.
  assert.match(
    block,
    /resolveLaneTaskContract\(\s*issueId,\s*worktreePath,/u,
    'readmission must resolve the contract against the checked-out branch worktree',
  );
  assert.match(
    block,
    /persistLaneTaskContract\(\s*issueId,\s*readmittedContract,\s*\[ROOT,\s*worktreePath\]\s*\)/u,
    'the resolved contract must be persisted to both roots, not copied',
  );
});

test('F5b: persisting a contract merges against each destination record rather than overwriting it', () => {
  const issueId = 'UTV2-999908';
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1747-f5b-'));
  const rootA = path.join(base, 'control');
  const rootB = path.join(base, 'worktree');
  for (const dir of [rootA, rootB]) {
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
  }

  const contract = buildTaskContract({
    identifier: issueId,
    title: 'Merge not clobber',
    url: 'https://linear.app/unit-talk/issue/x',
    description: '## Objective\nmerge\n\n## Acceptance criteria\n- merged',
  });

  // rootA already holds a record carrying a distinguishing proof path; rootB
  // holds none. If persistence overwrote wholesale instead of merging against
  // each destination, rootA's proof entry would disappear.
  const existingA = [
    'version: 1',
    'approval:',
    '  allow_multiple_issues: false',
    '  skip_sync_required: false',
    'entities:',
    '  issues:',
    `    - ${issueId}`,
    '  findings: []',
    '  controls: []',
    '  proofs:',
    `    - docs/06_status/proof/${issueId}/control-only.md`,
    '',
  ].join('\n');
  const syncA = path.join(rootA, '.ops', 'sync', `${issueId}.yml`);
  const syncB = path.join(rootB, '.ops', 'sync', `${issueId}.yml`);
  fs.writeFileSync(syncA, existingA, 'utf8');

  // Preconditions: rootA's marker is present and rootB has no record at all.
  assert.match(existingA, /control-only\.md/u, 'fixture must carry a distinguishing entry');
  assert.equal(fs.existsSync(syncB), false, 'rootB must start with no record');

  persistLaneTaskContract(issueId, contract, [rootA, rootB]);

  const afterA = fs.readFileSync(syncA, 'utf8');
  const afterB = fs.readFileSync(syncB, 'utf8');
  assert.equal(
    readTaskContract(issueId, rootA).contract_hash,
    contract.contract_hash,
    'the contract must be written into the control record',
  );
  assert.equal(
    readTaskContract(issueId, rootB).contract_hash,
    contract.contract_hash,
    'the contract must be written into the worktree record',
  );
  assert.match(
    afterA,
    /control-only\.md/u,
    'the pre-existing entry must survive: persistence merges, it does not clobber',
  );
  assert.doesNotMatch(
    afterB,
    /control-only\.md/u,
    "the other destination's record must not be copied across",
  );
});
