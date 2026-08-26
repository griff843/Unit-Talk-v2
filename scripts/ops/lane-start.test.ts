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
  resolveTaskContractAcrossRoots,
  TaskContractConflictError,
  type TaskContract,
} from './execution-packet.js';
import { ROOT, type LaneManifest } from './shared.js';
import {
  captureOrReadTaskContract,
  type ExistingBranchReadmissionToken,
  fetchLinearTaskSource,
  findMissingReadmissionScopePaths,
  isPermittedControlRegistryPath,
  laneContractRoots,
  linearTaskToken,
  mirrorPreflightTokenToWorktree,
  persistLaneTaskContract,
  resolveLaneTaskContract,
  resolveReadmissionContract,
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
  // Fresh admission creates the worktree under .out/ and installs into it;
  // both must be ignored or the clean-control-checkout assertion refuses first.
  fs.writeFileSync(path.join(root, '.gitignore'), '.out/\nnode_modules/\n');

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
  // Fresh admission runs the isolated install in the new worktree. The stub
  // only fakes that install; nothing under test depends on its behaviour.
  fs.writeFileSync(path.join(bin, 'pnpm'), '#!/bin/sh\nmkdir -p node_modules\nexit 0\n', { mode: 0o755 });

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

function runLaneStart(
  fixture: LaneFixture,
  extra: string[] = [],
  envOverride: Record<string, string> = {},
): {
  status: number | null; stdout: string; stderr: string;
} {
  const env = { ...process.env, PATH: `${fixture.bin}${path.delimiter}${process.env['PATH'] ?? ''}` };
  // A capture must not be able to reach the real Linear from a test. A test
  // that needs the capture path supplies a fixture token AND a `curl` stub on
  // the fixture PATH, so the request is still served locally.
  delete env['LINEAR_API_TOKEN'];
  delete env['LINEAR_API_KEY'];
  Object.assign(env, envOverride);
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

  // This slice used to be anchored on the FIRST `if (readmitExistingBranch) {`,
  // which is the RESUME path's throw-guard, and its end anchor never matched --
  // so the "block" was the remaining 26KB of the file and every assertion below
  // was satisfied by the resume path instead. An independent review found it.
  // The slice is now anchored on the readmission METADATA write, and the
  // anchors are asserted rather than silently falling back to the whole file.
  const blockStart = source.indexOf('const worktreeManifestDir = path.join(worktreePath');
  assert.notStrictEqual(blockStart, -1, 'expected the readmission metadata write to exist');
  const blockEnd = source.indexOf('const metadataPaths = [', blockStart);
  assert.notStrictEqual(
    blockEnd,
    -1,
    'end anchor must match -- an unmatched end anchor silently widens this ' +
      'slice to the rest of the file, which is how this test came to assert ' +
      'against the wrong code path',
  );
  const block = source.slice(blockStart, blockEnd);
  assert.ok(
    block.length < 3000,
    `slice must be a block, not most of the file (got ${block.length} chars)`,
  );

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

  // DISCLOSED: this remains a SOURCE-TEXT control and is evadable by
  // reformatting -- a third independent review reintroduced the exact clobber
  // with `fs.writeFileSync(dest, fs.readFileSync(syncPath))`, satisfying every
  // regex above while the whole suite stayed green. It was, at that point, the
  // ONLY control for finding 1.
  //
  // It no longer is. G19/G20/G21 drive `lane-start` main() through the real
  // `--readmit-existing-branch` path and kill that reintroduction, and G21
  // kills the root-ordering mutations too. This test is now redundant
  // belt-and-braces on an already-covered property rather than the thing
  // standing between the defect and production.
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

/**
 * UTV2-1752 finding 1 (P1): readmission timing.
 *
 * The predecessor resolved the contract BEFORE the branch worktree existed.
 * At that point only the control checkout is visible, so a branch carrying its
 * own authoritative contract could not be seen: the early pass fetched a newer
 * one from Linear, persisted it to ROOT, and the post-checkout pass then saw a
 * contract at both roots -- failing closed as lane_contract_conflict against
 * the branch's own valid record. It also made readmission require the network
 * for a branch that already carries everything it needs.
 */
function seedContractRoots(issueId: string): {
  control: string;
  worktree: string;
  branchContract: TaskContract;
} {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1752-readmit-'));
  const control = path.join(base, 'control');
  const worktree = path.join(base, 'worktree');
  for (const dir of [control, worktree]) {
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
  }
  const branchContract = buildTaskContract({
    identifier: issueId,
    title: 'Preserved branch work order',
    url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
    description: '## Objective\npreserved branch objective\n\n## Acceptance criteria\n- preserved criterion',
  });
  fs.writeFileSync(
    path.join(worktree, '.ops', 'sync', `${issueId}.yml`),
    buildSyncYmlWithTaskContract(issueId, branchContract),
    'utf8',
  );
  return { control, worktree, branchContract };
}

/**
 * As above, but BOTH roots carry a contract and they DIFFER. Seeding only the
 * worktree made `rootIndex === 0` a restatement of the fixture: with one root
 * carrying anything, that root wins under any precedence. An independent
 * review reversed the precedence and the suite stayed green.
 */
function seedBothRoots(issueId: string): {
  control: string;
  worktree: string;
  branchContract: TaskContract;
  controlContract: TaskContract;
} {
  const f = seedContractRoots(issueId);
  const controlContract = buildTaskContract({
    identifier: issueId,
    title: 'STALE control-checkout work order',
    url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
    description:
      '## Objective\nstale control objective\n\n## Acceptance criteria\n- stale criterion',
  });
  fs.writeFileSync(
    path.join(f.control, '.ops', 'sync', `${issueId}.yml`),
    buildSyncYmlWithTaskContract(issueId, controlContract),
    'utf8',
  );
  return { ...f, controlContract };
}

test('G2: a readmitted branch reuses its OWN contract offline, after checkout', () => {
  const issueId = 'UTV2-999953';
  const f = seedContractRoots(issueId);

  // Preconditions: only the branch carries a contract.
  assert.equal(
    fs.existsSync(path.join(f.control, '.ops', 'sync', `${issueId}.yml`)),
    false,
    'control checkout must start with no record for this issue',
  );
  // NOTE: with only ONE root carrying a contract, `rootIndex === 0` below is a
  // restatement of this fixture and holds under ANY precedence. G2b is the
  // control that can actually fail on precedence; this test covers the offline
  // (no-network) property, which is what its name claims.

  // Post-checkout ordering: worktree root ahead of control, and an EMPTY token,
  // which is what linearTaskToken() returns under containment.
  const resolved = resolveTaskContractAcrossRoots(issueId, [f.worktree, f.control], '');

  assert.equal(resolved.fetched, false, 'a branch-carried contract must touch no network');
  assert.equal(resolved.rootIndex, 0, 'the branch copy must win over the control checkout');
  assert.equal(
    resolved.contract.contract_hash,
    f.branchContract.contract_hash,
    'the preserved branch contract must be reused verbatim',
  );
});

test('G2b: with BOTH roots carrying the SAME contract, the BRANCH root is the source', () => {
  // The control G2 could not be. An independent review reversed root precedence
  // in `resolveTaskContractAcrossRoots` and the whole lane-start suite stayed
  // green, because every fixture seeded exactly one root -- with one root
  // carrying anything, that root wins under any precedence.
  //
  // What precedence actually decides is narrower than it first appears: when
  // the two roots DISAGREE the resolver fails closed (G2c), so order cannot
  // serve the wrong contract. Order decides which root is REPORTED as the
  // source when they agree, and that is what must not silently flip to the
  // control checkout.
  const issueId = 'UTV2-999956';
  const f = seedContractRoots(issueId);
  // Same contract in both roots: agreement, not conflict.
  fs.writeFileSync(
    path.join(f.control, '.ops', 'sync', `${issueId}.yml`),
    buildSyncYmlWithTaskContract(issueId, f.branchContract),
    'utf8',
  );

  const resolved = resolveTaskContractAcrossRoots(
    issueId,
    [f.worktree, f.control],
    '',
  );

  assert.equal(resolved.fetched, false, 'a branch-carried contract must touch no network');
  assert.equal(
    resolved.rootIndex,
    0,
    'the lane worktree must be the reported source, not the control checkout',
  );
  assert.equal(
    resolved.contract.contract_hash,
    f.branchContract.contract_hash,
    'the preserved branch contract must be reused verbatim',
  );
});

test('G2c: two DIFFERENT valid contracts fail closed rather than picking one', () => {
  // Fail closed (core invariant 10). This is the reason root precedence cannot
  // serve a stale control-checkout contract to a lane: on disagreement the
  // resolver refuses outright instead of preferring either root.
  const issueId = 'UTV2-999957';
  const f = seedBothRoots(issueId);

  assert.notEqual(
    f.branchContract.contract_hash,
    f.controlContract.contract_hash,
    'the fixture is only meaningful if the two roots genuinely differ',
  );

  assert.throws(
    () => resolveTaskContractAcrossRoots(issueId, [f.worktree, f.control], ''),
    (error: unknown) =>
      error instanceof TaskContractConflictError &&
      /Refusing to choose/u.test((error as Error).message),
    'disagreeing contracts must refuse to resolve, never silently pick a root',
  );

  // And the refusal is symmetric -- it is not an artefact of the search order.
  assert.throws(
    () => resolveTaskContractAcrossRoots(issueId, [f.control, f.worktree], ''),
    TaskContractConflictError,
    'the refusal must not depend on which root is searched first',
  );
});

test('G15: lane contract roots put the lane worktree AHEAD of the control checkout', () => {
  // The ordering itself, asserted directly. Reversing it in the source is the
  // defect; an inline ternary had no witness because the only fixtures that
  // exercised it seeded a single root.
  const roots = laneContractRoots('/tmp/some-lane-worktree');
  assert.deepEqual(
    roots,
    ['/tmp/some-lane-worktree', ROOT],
    'the lane worktree must be searched BEFORE the control checkout',
  );
  assert.equal(roots[0], '/tmp/some-lane-worktree', 'the lane copy must be first');

  // No worktree (fresh lane, or the control checkout itself) -> control only.
  assert.deepEqual(laneContractRoots(null), [ROOT]);
  assert.deepEqual(laneContractRoots(ROOT), [ROOT]);
});

test('G3 (inversion): resolving BEFORE checkout cannot serve that branch and fails closed', () => {
  const issueId = 'UTV2-999954';
  const f = seedContractRoots(issueId);

  // This is the defect's shape: the pre-checkout pass sees only the control
  // checkout, because the worktree does not exist yet. With no token it cannot
  // invent one either, so the early capture is provably unable to serve a
  // readmission that the post-checkout resolution above handles offline.
  assert.throws(
    () => resolveTaskContractAcrossRoots(issueId, [f.control], ''),
    /LINEAR_API_TOKEN or LINEAR_API_KEY is required/u,
    'pre-checkout resolution must not silently succeed for a readmitted branch',
  );

  // And the branch copy that it could not see is genuinely valid, so the
  // failure is one of TIMING, not of a missing contract.
  const afterCheckout = resolveTaskContractAcrossRoots(issueId, [f.worktree, f.control], '');
  assert.equal(afterCheckout.fetched, false);
  assert.equal(
    afterCheckout.contract.contract_hash,
    f.branchContract.contract_hash,
    'the same lookup succeeds once the worktree exists — the defect is ordering',
  );
});

test('G4: the readmission path performs no contract capture before the worktree exists', () => {
  // This test used to be a grep of lane-start.ts for the shape of a ternary.
  // An independent review showed that class of assertion is theatre elsewhere
  // in this lane -- it survives any reformatting and proves nothing about what
  // the code DOES -- and G2/G3 were measured NOT to catch a reintroduction of
  // this defect. So assert the behaviour: on readmission the capture must not
  // merely return null, it must never run at all.
  let calls = 0;
  const spy = (): never => {
    calls += 1;
    throw new Error(
      'pre-checkout capture ran on a readmitted branch: the worktree does not ' +
        'exist yet, so this can only reach the control checkout or the network',
    );
  };

  const readmitted = resolveReadmissionContract(true, 'UTV2-999955', '', spy);
  assert.equal(calls, 0, 'readmission must perform NO capture before checkout');
  assert.equal(readmitted, null, 'readmission must carry no pre-checkout contract');

  // The inverse: a fresh lane still captures early, so the guard is scoped to
  // readmission and has not simply disabled capture everywhere.
  assert.throws(
    () => resolveReadmissionContract(false, 'UTV2-999955', '', spy),
    /pre-checkout capture ran/u,
    'a FRESH lane must still capture before checkout',
  );
  assert.equal(calls, 1, 'the fresh-lane path must call the resolver exactly once');
});

// ---------------------------------------------------------------------------
// End-to-end readmission (G19/G20).
//
// The third independent review established that finding 1 -- the control
// checkout's sync record clobbering a readmitted branch's own authoritative
// contract -- was guarded ONLY by F5, a source-text grep. It demonstrated the
// defect could be reintroduced with `fs.writeFileSync(worktreeSync,
// fs.readFileSync(syncPath))` in place of the removed `copyFileSync`, leaving
// every one of F5's regexes satisfied and all 47 tests green. G2/G2b/G2c/G4/G15
// all operate on extracted helpers or on `resolveTaskContractAcrossRoots`
// directly, so none of them execute the readmission call site.
//
// These two tests run `lane-start.ts` main() through the actual
// `--readmit-existing-branch` path in a throwaway git repository with a local
// bare origin, a stub `gh` and a stub `pnpm`. No test below this comment
// asserts on source text.
// ---------------------------------------------------------------------------

interface ReadmissionFixture {
  root: string;
  worktree: string;
  bin: string;
  issueId: string;
  branch: string;
  branchSha: string;
  controlContract: TaskContract | null;
  branchContract: TaskContract | null;
}

function seedReadmissionFixture(
  issueId: string,
  opts: {
    controlDescription: string | null;
    /**
     * `null` means the branch carries NO work order. Both roots being empty is
     * the only shape in which readmission reaches a capture, and neither shape
     * had a test until a fifth review found the readmission emit site
     * reporting a hardcoded source and fetched flag.
     */
    branchDescription: string | null;
  },
): ReadmissionFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1752-readmit-e2e-'));
  const root = path.join(dir, 'repo');
  const originPath = path.join(dir, 'origin.git');
  const slug = issueId.toLowerCase();
  const branch = `claude/${slug}-fixture`;
  const worktree = path.join(root, '.out', 'worktrees', branch.replaceAll('/', '__'));

  for (const rel of [
    ['docs', '06_status', 'lanes'],
    ['docs', '05_operations', 'policies'],
    ['docs', '05_operations', 'schemas'],
    ['docs', 'governance'],
    ['scripts', 'ops'],
    ['.ops', 'sync'],
    ['.ops', 'leases'],
  ]) {
    fs.mkdirSync(path.join(root, ...rel), { recursive: true });
  }
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
  // `assertCleanMainControlCheckout` runs with --untracked-files=all, so the
  // lane worktree and the pnpm stub's node_modules must be ignored or
  // readmission refuses before it reaches any contract logic.
  fs.writeFileSync(path.join(root, '.gitignore'), '.out/\nnode_modules/\n');

  const git = (args: string[], cwd = root): string => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return (r.stdout ?? '').trim();
  };
  git(['init', '-q', '-b', 'main', '.']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  // Each root's record carries a DISTINGUISHABLE entity. Without this the two
  // records are byte-identical apart from the work order, so a mutation that
  // copies one over the other is invisible -- which is exactly how R2b survived
  // the round-4 battery with all 50 tests green.
  const controlContract = opts.controlDescription === null
    ? null
    : seedContractAt(root, issueId, opts.controlDescription, 'CONTROL-ONLY-FINDING');
  git(['add', '-A']);
  git(['commit', '-qm', 'seed']);

  spawnSync('git', ['init', '-q', '--bare', originPath], { encoding: 'utf8' });
  git(['remote', 'add', 'origin', originPath]);
  git(['push', '-q', '-u', 'origin', 'main']);

  // The branch carries its OWN authoritative work order, committed on the
  // branch -- exactly the state finding 1 said readmission destroyed.
  git(['checkout', '-q', '-b', branch]);
  // The branch is cut FROM main, so it inherits whatever record main committed.
  // A branch that is supposed to carry no work order must therefore DELETE the
  // inherited one and commit that deletion -- otherwise the fixture silently
  // seeds the state it claims to exclude, and the test asserts nothing. The
  // first draft of this fixture did exactly that.
  const branchSyncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  const branchContract = opts.branchDescription === null
    ? null
    : seedContractAt(root, issueId, opts.branchDescription, 'BRANCH-ONLY-FINDING');
  const removedInheritedRecord =
    opts.branchDescription === null && fs.existsSync(branchSyncPath);
  if (removedInheritedRecord) git(['rm', '-q', '--', `.ops/sync/${issueId}.yml`]);
  // The branch also carries real work, so its commit is non-empty even when the
  // two roots hold an identical contract (G21). A fixture that commits nothing
  // is not a readmittable branch.
  fs.writeFileSync(
    path.join(root, 'scripts', 'ops', 'fixture.ts'),
    'export const fixture = 2;\n',
  );
  git(['add', '--', ...(branchContract ? [`.ops/sync/${issueId}.yml`] : []), 'scripts/ops/fixture.ts']);
  git(['commit', '-qm', `feat(ops): ${issueId} branch-carried work order`]);
  git(['push', '-q', 'origin', branch]);
  const branchSha = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', 'main']);
  const mainSha = git(['rev-parse', 'HEAD']);

  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const repository = 'unit-talk/fixture';
  const pullRequest = {
    number: 4242,
    head: { ref: branch, sha: branchSha, repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } },
    html_url: `https://github.com/${repository}/pull/4242`,
  };
  fs.writeFileSync(path.join(bin, 'pr.json'), `${JSON.stringify([pullRequest])}\n`);
  // The board enumeration uses `gh api --paginate --slurp`, which returns an
  // array of PAGES; the exact-PR revalidation uses a plain `gh api`, which
  // returns a flat array. The stub answers both truthfully with the same single
  // open PR rather than showing readmission an empty board it would not see in
  // production.
  fs.writeFileSync(path.join(bin, 'board.json'), `${JSON.stringify([[pullRequest]])}\n`);
  fs.writeFileSync(
    path.join(bin, 'gh'),
    [
      '#!/bin/sh',
      `if [ "$1" = "repo" ]; then echo "${repository}"; exit 0; fi`,
      'for arg in "$@"; do',
      `  if [ "$arg" = "--slurp" ]; then cat "${path.join(bin, 'board.json')}"; exit 0; fi`,
      'done',
      // The branch carries no lane manifest, and active-lane discovery treats a
      // CONFIRMED 404 as genuine absence while treating anything else as an
      // unknown board. Answering the contents probe with gh's real 404
      // signature is what makes the fixture an honest empty-manifest branch
      // rather than a broken one.
      'case "$*" in',
      '  *contents*) echo "gh: Not Found (HTTP 404)" >&2; exit 1;;',
      'esac',
      `if [ "$1" = "api" ]; then cat "${path.join(bin, 'pr.json')}"; exit 0; fi`,
      'echo "[]"',
      'exit 0',
    ].join('\n') + '\n',
    { mode: 0o755 },
  );
  // A readmitted worktree is created empty by `git worktree add`, so the
  // isolated-install step runs for real. The stub satisfies it without a
  // network or a package manager.
  fs.writeFileSync(
    path.join(bin, 'pnpm'),
    '#!/bin/sh\nmkdir -p node_modules\nexit 0\n',
    { mode: 0o755 },
  );

  const tokenPath = path.join(root, '.out', 'ops', 'preflight', `${branch}.json`);
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 1,
    status: 'pass',
    issue_id: issueId,
    branch,
    head_sha: mainSha,
    expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    mode: 'existing-branch-readmission',
    tier: 'T2',
    requested_lane_type: 'governance',
    previous_lane_type: 'governance',
    executor: 'claude',
    file_scope: ['scripts/ops/fixture.ts'],
    origin_main_sha: mainSha,
    branch_head_sha: branchSha,
    open_pr_number: 4242,
    open_pr_base_ref: 'main',
    ahead_count: 1,
    behind_count: 0,
    no_worktree: true,
    no_active_lease: true,
    no_active_merge_mutex: true,
  }, null, 2)}\n`);

  return { root, worktree, bin, issueId, branch, branchSha, controlContract, branchContract };
}

function runReadmission(
  fixture: ReadmissionFixture,
  envOverride: Record<string, string> = {},
): {
  status: number | null; stdout: string; stderr: string;
} {
  const env = { ...process.env, PATH: `${fixture.bin}${path.delimiter}${process.env['PATH'] ?? ''}` };
  delete env['LINEAR_API_TOKEN'];
  delete env['LINEAR_API_KEY'];
  Object.assign(env, envOverride);
  const r = spawnSync(LANE_TSX_BIN, [
    path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), fixture.issueId,
    '--tier', 'T2', '--branch', fixture.branch, '--lane-type', 'governance',
    '--executor', 'claude', '--files', 'scripts/ops/fixture.ts',
    '--readmit-existing-branch',
  ], { cwd: fixture.root, encoding: 'utf8', timeout: 180_000, env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Read a path out of a branch's committed tree, not the working copy. */
function showAtRef(root: string, ref: string, repoRelativePath: string): string {
  const r = spawnSync('git', ['show', `${ref}:${repoRelativePath}`], {
    cwd: root, encoding: 'utf8', stdio: 'pipe',
  });
  assert.equal(r.status, 0, `git show ${ref}:${repoRelativePath} failed: ${r.stderr}`);
  return r.stdout ?? '';
}

/**
 * Materialise a ref's COMMITTED sync record into a throwaway root so the
 * production reader parses it. Asserting on the working copy alone would miss a
 * defect that writes the right file and commits the wrong content.
 */
function contractRootFromRef(root: string, ref: string, issueId: string): string {
  const content = showAtRef(root, ref, `.ops/sync/${issueId}.yml`);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1752-atref-'));
  fs.mkdirSync(path.join(dest, '.ops', 'sync'), { recursive: true });
  fs.writeFileSync(path.join(dest, '.ops', 'sync', `${issueId}.yml`), content);
  return dest;
}

/** The branch's work order, for the fixtures that seed one. */
function branchContractOf(f: ReadmissionFixture): TaskContract {
  assert.ok(f.branchContract, 'this fixture must seed a branch work order');
  return f.branchContract;
}

test('G19: readmission refuses when control and the branch carry different work orders, and never overwrites the branch copy', () => {
  const f = seedReadmissionFixture('UTV2-999960', {
    controlDescription:
      '## Objective\nCONTROL ORDER: do the stale thing.\n\n## Acceptance criteria\n- stale',
    branchDescription:
      '## Objective\nBRANCH ORDER: do the authoritative thing.\n\n## Acceptance criteria\n- authoritative',
  });

  const run = runReadmission(f);

  // Finding 1's defect made this run SUCCEED, silently replacing the branch's
  // work order with control's. Failing closed is the fix.
  assert.notEqual(run.status, 0, `readmission must fail closed on divergent contracts:\n${run.stdout}\n${run.stderr}`);
  const out = laneJson(run.stdout);
  assert.equal(out['ok'], false);
  assert.equal(
    out['code'],
    'lane_contract_conflict',
    'a divergent work order must be its own machine-identifiable refusal',
  );
  assert.notEqual(
    out['control_contract_hash'],
    out['worktree_contract_hash'],
    'the refusal must report two genuinely different contract hashes',
  );
  // Asserting only that the two differ leaves the LABELS free to be swapped,
  // and an operator reconciling a conflict acts on the labels. Pin each hash to
  // the root it actually came from.
  assert.equal(
    out['control_contract_hash'],
    f.controlContract?.contract_hash,
    'control_contract_hash must be the CONTROL checkout hash, not the branch one',
  );
  assert.equal(
    out['worktree_contract_hash'],
    branchContractOf(f).contract_hash,
    'worktree_contract_hash must be the BRANCH hash, not the control one',
  );

  // The generic `contracts` payload is what a caller that is NOT limited to two
  // roots reads; the named pair above cannot cover it, so emptying it survived
  // the whole battery. Pin every entry to the root it came from.
  const contracts = out['contracts'] as Array<{ root?: string; contract_hash?: string }> | undefined;
  assert.ok(Array.isArray(contracts), 'the refusal must carry a generic contracts payload');
  assert.equal(contracts.length, 2, 'both roots must appear in the generic payload');
  const byRoot = new Map(contracts.map((entry) => [entry.root, entry.contract_hash]));
  assert.equal(
    byRoot.get(f.root),
    f.controlContract?.contract_hash,
    'the control root entry must carry the control hash',
  );
  assert.equal(
    byRoot.get(f.worktree),
    branchContractOf(f).contract_hash,
    'the worktree root entry must carry the branch hash',
  );

  // The branch's committed record is the thing finding 1 destroyed. It must
  // still be byte-identical to what the branch carried.
  const committed = showAtRef(f.root, f.branch, `.ops/sync/${f.issueId}.yml`);
  assert.match(committed, /BRANCH ORDER/u, 'the branch work order must survive a refused readmission');
  assert.doesNotMatch(committed, /CONTROL ORDER/u, "control's work order must not have been written onto the branch");

  // The rollback must also leave the control checkout as it found it.
  const control = fs.readFileSync(path.join(f.root, '.ops', 'sync', `${f.issueId}.yml`), 'utf8');
  assert.match(control, /CONTROL ORDER/u, 'the control record must be restored by the rollback');
});

test('G20: readmission reuses a branch-carried work order offline and propagates it to the control checkout', () => {
  const f = seedReadmissionFixture('UTV2-999961', {
    controlDescription: null,
    branchDescription:
      '## Objective\nBRANCH ORDER: the branch is the only source.\n\n## Acceptance criteria\n- reuse me',
  });

  const run = runReadmission(f);
  assert.equal(run.status, 0, `readmission must succeed:\n${run.stdout}\n${run.stderr}`);
  const out = laneJson(run.stdout);
  assert.equal(out['code'], 'lane_readmitted_existing_branch');
  assert.equal(out['open_pr_number'], 4242);
  assert.equal(out['contract_fetched'], false, 'readmission must reuse the branch copy without a capture');
  assert.equal(out['contract_source'], 'lane-worktree');

  // LINEAR_API_TOKEN/KEY are stripped from the child environment, so any
  // capture would have refused as tokenless. Reaching a started lane at all
  // proves the branch's own contract was reused without a network round-trip.
  assert.equal(
    readTaskContract(f.issueId, f.worktree).contract_hash,
    branchContractOf(f).contract_hash,
    'the readmitted contract hash must be the branch copy, unmodified',
  );

  // The metadata commit is made on the branch: the committed tree, not just the
  // working copy, must carry the branch's own order.
  assert.equal(
    readTaskContract(f.issueId, contractRootFromRef(f.worktree, 'HEAD', f.issueId)).contract_hash,
    branchContractOf(f).contract_hash,
    'the readmission metadata commit must not rewrite the branch work order',
  );

  // Both roots are persisted, so the control checkout inherits the branch's
  // order rather than the reverse.
  assert.equal(
    readTaskContract(f.issueId, f.root).contract_hash,
    branchContractOf(f).contract_hash,
    'the control checkout must inherit the branch contract, not impose its own',
  );

  // The contract half of finding 1 is closed by the conflict gate, but the
  // RECORD around it is not: a post-persist copy of control's whole sync file
  // over the branch's destroys the entities accumulated on the branch, and
  // `metadataPaths` commits that loss onto the branch. Asserting the contract
  // hash cannot see it -- both records carry the same contract by then.
  const worktreeYml = fs.readFileSync(
    path.join(f.worktree, '.ops', 'sync', `${f.issueId}.yml`), 'utf8');
  assert.match(worktreeYml, /BRANCH-ONLY-FINDING/u,
    'entities accumulated on the branch must survive readmission');
  assert.match(
    showAtRef(f.worktree, 'HEAD', `.ops/sync/${f.issueId}.yml`),
    /BRANCH-ONLY-FINDING/u,
    'and must survive in the COMMITTED tree, which is what the loss would ship',
  );
});

test('G21: when both roots agree, readmission runs on -- and reports -- the lane worktree copy', () => {
  // The ordering half of finding 1. With two DIFFERENT valid contracts the
  // resolver fails closed (G19), so precedence can never serve a stale contract
  // to a lane; what it decides is which root the lane reports as the source of
  // the copy it is running on. That was unobservable until `contract_source`
  // was emitted, which is why reversing the root order (M10) and taking the
  // last match instead of the first (M12) each killed exactly one unit test and
  // changed nothing an operator could see.
  const identical =
    '## Objective\nSHARED ORDER: both roots hold this.\n\n## Acceptance criteria\n- agree';
  const f = seedReadmissionFixture('UTV2-999962', {
    controlDescription: identical,
    branchDescription: identical,
  });
  assert.equal(
    f.controlContract?.contract_hash,
    branchContractOf(f).contract_hash,
    'fixture precondition: the two roots must genuinely agree, or this asserts nothing',
  );

  const run = runReadmission(f);
  assert.equal(run.status, 0, `readmission must succeed when the roots agree:\n${run.stdout}\n${run.stderr}`);
  const out = laneJson(run.stdout);
  assert.equal(
    out['contract_source'],
    'lane-worktree',
    'the lane worktree must be searched before the control checkout, and reported as the source',
  );
  assert.equal(out['contract_fetched'], false);
  assert.equal(out['contract_hash'], branchContractOf(f).contract_hash);
});

test('G23: a capture reports linear-capture and fetched:true -- the two other values of contract_source', () => {
  // G20/G21 only ever observe `lane-worktree`/`false`, so hardcoding either
  // field to that constant survived the round-4 battery (R9, R10). A control
  // that can only ever see one value of a field does not pin the field.
  const emptyWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1752-capture-'));
  const issueId = 'UTV2-999963';
  let called = 0;
  const runner = ((_command, _args, options) => {
    called += 1;
    assert.match(String(options?.input), /Authorization: capture-token/u,
      'the configured token must reach the request, not the argv');
    return {
      status: 0,
      stdout: JSON.stringify({ data: { issue: {
        identifier: issueId,
        title: 'Captured lane',
        url: `https://linear.app/unit-talk/issue/${issueId}`,
        description: '## Objective\nCaptured from Linear.\n\n## Acceptance criteria\n- captured',
      } } }),
      stderr: '',
      error: undefined,
    };
  }) as typeof spawnSync;

  const resolved = resolveLaneTaskContract(issueId, emptyWorktree, 'capture-token', runner);

  assert.equal(called, 1, 'a lane with no contract at either root must capture exactly once');
  assert.equal(resolved.fetched, true,
    'contract_fetched must be TRUE on a capture -- hardcoding false survives every offline test');
  assert.equal(resolved.source, 'linear-capture',
    'contract_source must name the capture -- hardcoding lane-worktree survives every offline test');
  assert.equal(resolved.contract.issue_id, issueId);
  assert.equal(resolved.contract.source.kind, 'linear-issue-snapshot',
    'the captured contract must be a Linear snapshot, not a locally reconstructed one');
});

test('G24: linearTaskToken reads a configured token, and LINEAR_API_TOKEN wins', () => {
  // Every E2E test strips both variables on purpose, so without this the whole
  // token path is unproven: returning '' unconditionally kept all 50 green.
  //
  // Deliberately asserts ONLY the process-environment branch. The file-fallback
  // branch reads local.env/.env, so on a configured machine an assertion about
  // the LINEAR_API_KEY alias resolves against a REAL token -- which a failing
  // assertion would then print into test output. The alias branch is therefore
  // left unpinned and disclosed rather than covered by a test that can leak a
  // live credential.
  const saved = {
    token: process.env['LINEAR_API_TOKEN'],
    key: process.env['LINEAR_API_KEY'],
  };
  try {
    process.env['LINEAR_API_TOKEN'] = 'primary-token-fixture';
    process.env['LINEAR_API_KEY'] = 'secondary-key-fixture';
    assert.equal(linearTaskToken(), 'primary-token-fixture',
      'a configured token must be returned, and LINEAR_API_TOKEN takes precedence');
  } finally {
    if (saved.token === undefined) delete process.env['LINEAR_API_TOKEN'];
    else process.env['LINEAR_API_TOKEN'] = saved.token;
    if (saved.key === undefined) delete process.env['LINEAR_API_KEY'];
    else process.env['LINEAR_API_KEY'] = saved.key;
  }
});

test('G25: a worktree carrying NO contract inherits the control copy, and the persist reaches the worktree', () => {
  // The remaining readmission case (branch none / control one) was asserted in
  // a source comment and covered by no test. It is also the only shape in which
  // the resume persist's worktree destination is observable: when the worktree
  // already carries the contract, dropping that destination changes nothing a
  // test can see, which is how R14 survived.
  const f = seedLaneFixture('UTV2-999804', { withWorktree: true });
  const seeded = seedContractAt(f.root, f.issueId,
    '## Objective\nControl is the only source.\n\n## Acceptance criteria\n- inherit me',
    'CONTROL-ONLY-FINDING');
  assert.equal(
    fs.existsSync(path.join(f.worktree, '.ops', 'sync', `${f.issueId}.yml`)),
    false,
    'fixture precondition: the worktree must start with NO record, or this asserts nothing',
  );

  const run = runLaneStart(f);
  assert.equal(run.status, 0, `resume must succeed offline from the control copy; stderr: ${run.stderr}\n${run.stdout}`);
  const out = laneJson(run.stdout);
  assert.equal(out['contract_fetched'], false, 'the control copy must be reused without a capture');
  assert.equal(out['contract_source'], 'control-checkout',
    'with no worktree copy the control checkout is the source, and must be reported as such');

  assert.equal(
    readTaskContract(f.issueId, f.worktree).contract_hash,
    seeded.contract_hash,
    'the persist must reach the worktree destination, not only the control root',
  );
  assert.equal(readTaskContract(f.issueId, f.root).contract_hash, seeded.contract_hash);
  assert.match(
    fs.readFileSync(path.join(f.root, '.ops', 'sync', `${f.issueId}.yml`), 'utf8'),
    /CONTROL-ONLY-FINDING/u,
    "the control record's own entities must survive its own merge",
  );
});

test('G26: a FRESH lane CAPTURES its work order and writes a sync record naming its own issue', () => {
  // The most common production path had no successful end-to-end test at all:
  // every fresh-lane fixture was driven only to a refusal. Two mutations
  // survived a 21-mutation battery because of it -- a fresh persist that writes
  // to NO root (so the lane gets no .ops/sync/<ID>.yml at all), and an
  // `entities.issues` default of [] (so the record omits its own issue ID).
  // Housekeeping CI requires both, and this lane deleted the writeSyncFile()/
  // buildSyncYml() pair that used to produce them, so it owns the gap.
  //
  // The lane starts with NO contract at any root, which is what makes the
  // persist observable: seeding the control record first would leave the record
  // present whether or not the persist ran, and a first attempt at this test
  // did exactly that -- the fresh-persist mutation survived it. `curl` is
  // stubbed on the fixture PATH, so the capture is served locally and no test
  // ever reaches api.linear.app.
  const f = seedLaneFixture('UTV2-999805', { withWorktree: false });
  assert.equal(
    fs.existsSync(path.join(f.root, '.ops', 'sync', `${f.issueId}.yml`)),
    false,
    'fixture precondition: no contract at any root, or the persist is unobservable',
  );
  // The payload is written as a FILE and catted: `echo` in /bin/sh expands
  // backslash escapes, which turns the \n inside the description into a real
  // newline and produces invalid JSON.
  const payloadPath = path.join(f.bin, 'linear-response.json');
  fs.writeFileSync(payloadPath, JSON.stringify({ data: { issue: {
    identifier: f.issueId,
    title: 'Captured lane',
    url: `https://linear.app/unit-talk/issue/${f.issueId}`,
    description: '## Objective\nCaptured for admission.\n\n## Acceptance criteria\n- captured',
  } } }));
  fs.writeFileSync(
    path.join(f.bin, 'curl'),
    `#!/bin/sh\ncat >/dev/null\ncat ${payloadPath}\nexit 0\n`,
    { mode: 0o755 },
  );

  const run = runLaneStart(f, [], { LINEAR_API_TOKEN: 'capture-token-fixture' });
  assert.equal(run.status, 0, `fresh admission must succeed; stderr: ${run.stderr}\n${run.stdout}`);
  const out = laneJson(run.stdout);
  assert.equal(out['code'], 'lane_started');
  assert.equal(out['contract_fetched'], true,
    'a lane with no contract anywhere must capture, and must report that it did');
  assert.equal(out['contract_source'], 'linear-capture');

  const syncPath = path.join(f.root, '.ops', 'sync', `${f.issueId}.yml`);
  assert.equal(fs.existsSync(syncPath), true,
    'a fresh lane must leave a sync record at the control root -- nothing else creates one');
  const yml = fs.readFileSync(syncPath, 'utf8');
  assert.match(yml, new RegExp(`issues:\\s*\\n\\s*-\\s*${f.issueId}`, 'u'),
    'the sync record must name its own issue -- branch-discipline CI reads exactly this');
  assert.equal(readTaskContract(f.issueId, f.root).source.title, 'Captured lane',
    'the persisted contract must be the CAPTURED one');
});

test('G27: a readmitted branch carrying NO work order inherits control -- and REPORTS control-checkout', () => {
  // A fifth review found the round-4 fix only half-applied: G23 is a unit test
  // that never reaches main(), and G20/G21 are the only tests that read
  // contract_source/contract_fetched on the READMISSION path -- both asserting
  // exactly 'lane-worktree'/false. Hardcoding either at that emit site survived
  // the whole suite. This is the same "a control that can only see one value
  // does not pin the field" defect, recurring on the very path finding 1 is
  // about.
  const f = seedReadmissionFixture('UTV2-999964', {
    controlDescription:
      '## Objective\nCONTROL ORDER: the branch carries none.\n\n## Acceptance criteria\n- inherit',
    branchDescription: null,
  });
  assert.equal(f.branchContract, null, 'fixture precondition (variable)');
  // And the precondition that actually matters: the branch's COMMITTED tree
  // must hold no sync record. Asserting only the fixture variable is what let
  // the first draft of this test pass against a branch that had inherited
  // control's record from main and therefore reported `lane-worktree` honestly.
  assert.equal(
    spawnSync('git', ['cat-file', '-e', `${f.branch}:.ops/sync/${f.issueId}.yml`],
      { cwd: f.root, encoding: 'utf8' }).status !== 0,
    true,
    'fixture precondition: the branch tree must carry NO sync record',
  );

  const run = runReadmission(f);
  assert.equal(run.status, 0, `readmission must succeed from the control copy:\n${run.stdout}\n${run.stderr}`);
  const out = laneJson(run.stdout);
  assert.equal(out['code'], 'lane_readmitted_existing_branch');
  assert.equal(
    out['contract_source'],
    'control-checkout',
    'a readmitted branch running on the CONTROL copy must say so -- reporting lane-worktree here ' +
      'tells an operator the branch own order won when it did not',
  );
  assert.equal(out['contract_fetched'], false, 'and it must not have touched the network');
  assert.equal(
    readTaskContract(f.issueId, f.worktree).contract_hash,
    f.controlContract?.contract_hash,
    'the branch must actually inherit the control work order',
  );
});

test('G28: readmission with NO work order at either root captures, and reports linear-capture', () => {
  // The only shape in which readmission reaches a capture at all. Untested
  // until now, which is why `contract_fetched` could be hardcoded false at the
  // readmission emit site with every test green.
  const f = seedReadmissionFixture('UTV2-999965', {
    controlDescription: null,
    branchDescription: null,
  });
  const payloadPath = path.join(f.bin, 'linear-response.json');
  fs.writeFileSync(payloadPath, JSON.stringify({ data: { issue: {
    identifier: f.issueId,
    title: 'Captured on readmission',
    url: `https://linear.app/unit-talk/issue/${f.issueId}`,
    description: '## Objective\nCaptured on readmission.\n\n## Acceptance criteria\n- captured',
  } } }));
  fs.writeFileSync(
    path.join(f.bin, 'curl'),
    `#!/bin/sh\ncat >/dev/null\ncat ${payloadPath}\nexit 0\n`,
    { mode: 0o755 },
  );

  const run = runReadmission(f, { LINEAR_API_TOKEN: 'capture-token-fixture' });
  assert.equal(run.status, 0, `readmission must capture when no root holds a contract:\n${run.stdout}\n${run.stderr}`);
  const out = laneJson(run.stdout);
  assert.equal(out['code'], 'lane_readmitted_existing_branch');
  assert.equal(out['contract_fetched'], true,
    'a readmission that touched the network must report that it did');
  assert.equal(out['contract_source'], 'linear-capture');
  assert.equal(
    readTaskContract(f.issueId, f.worktree).source.title,
    'Captured on readmission',
    'the captured work order must be the one persisted to the branch',
  );
});

test('G36: the readmission metadata commit STAGES the sync record, not only the manifest', () => {
  // Without the sync path in metadataPaths an inherited work order is written
  // to the worktree and never committed, so the branch ships without the work
  // order the lane is running on -- and the next readmission re-derives it.
  const f = seedReadmissionFixture('UTV2-999966', {
    controlDescription:
      '## Objective\nCONTROL ORDER: must be committed to the branch.\n\n## Acceptance criteria\n- commit me',
    branchDescription: null,
  });

  const run = runReadmission(f);
  assert.equal(run.status, 0, `readmission must succeed:\n${run.stdout}\n${run.stderr}`);

  // The COMMITTED tree, not the working copy: an uncommitted inheritance is
  // exactly the loss this asserts against.
  assert.equal(
    readTaskContract(f.issueId, contractRootFromRef(f.worktree, 'HEAD', f.issueId)).contract_hash,
    f.controlContract?.contract_hash,
    'the inherited work order must be committed onto the branch by the metadata commit',
  );
});

test('G37: a fresh sync record declares schema version 1 and both approval flags false', () => {
  // The default record's shape is what Housekeeping and branch-discipline CI
  // read. `version` could be omitted and both approval flags flipped to true
  // with every test green -- G26 asserted only the issues key. Defaulting
  // `allow_multiple_issues`/`skip_sync_required` to true is a fail-OPEN default
  // on a governance record.
  const contract = buildTaskContract({
    identifier: 'UTV2-999967', title: 'Fresh sync record',
    url: 'https://linear.app/unit-talk/issue/UTV2-999967',
    description: '## Objective\nfresh\n\n## Acceptance criteria\n- ok',
  }, '2026-08-25T00:00:00.000Z');

  const yml = buildSyncYmlWithTaskContract('UTV2-999967', contract);
  assert.match(yml, /^version: 1$/mu, 'a fresh record must declare schema version 1');
  assert.match(yml, /allow_multiple_issues: false/u,
    'a fresh record must not default to allowing multiple issues');
  assert.match(yml, /skip_sync_required: false/u,
    'a fresh record must not default to skipping the sync requirement');
});

test('G41: readmission REFUSES to commit when the worktree index carries a non-metadata path', () => {
  // The sixth review found this guard (lane-start.ts, the `stagedPaths.some(...)`
  // clause) killed by nothing: replacing the whole condition with `false` left
  // both suites green. Every readmission test asserts a SUCCESS path, so none
  // of them ever presents the guard with a dirty index.
  //
  // The dirt is introduced the way it would arise in production -- from the
  // worktree itself, not by the test reaching into lane-start. A `post-checkout`
  // hook (worktrees share the common `.git/hooks` directory) stages a stray
  // file at `git worktree add` time, so by the time readmission stages its
  // metadata the index already holds a path that is not in `metadataPaths`.
  const f = seedReadmissionFixture('UTV2-999983', {
    controlDescription:
      '## Objective\nSHARED ORDER.\n\n## Acceptance criteria\n- shared',
    branchDescription:
      '## Objective\nSHARED ORDER.\n\n## Acceptance criteria\n- shared',
  });

  const hooks = path.join(f.root, '.git', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(
    path.join(hooks, 'post-checkout'),
    '#!/bin/sh\nprintf stray > stray-not-metadata.txt\ngit add -- stray-not-metadata.txt\nexit 0\n',
    { mode: 0o755 },
  );

  // Fixture precondition, established BEFORE and INDEPENDENTLY of the code under
  // test: prove the hook really does dirty a fresh worktree's index. A throwaway
  // detached worktree is created, inspected and removed. Checking the lane's own
  // worktree after the run cannot serve as this precondition -- lane-start tears
  // that worktree down when it refuses, so the check would read an absent
  // directory and pass for the wrong reason.
  const probe = path.join(f.root, '.out', 'worktrees', 'hook-probe');
  const probeAdd = spawnSync('git', ['worktree', 'add', '-q', '--detach', probe, f.branchSha], {
    cwd: f.root, encoding: 'utf8',
  });
  assert.equal(probeAdd.status, 0, `probe worktree must be creatable: ${probeAdd.stderr}`);
  const probeStaged = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: probe, encoding: 'utf8',
  });
  assert.match(
    probeStaged.stdout ?? '',
    /stray-not-metadata\.txt/u,
    'fixture precondition: the post-checkout hook must stage a non-metadata path in a fresh worktree',
  );
  spawnSync('git', ['worktree', 'remove', '--force', probe], { cwd: f.root, encoding: 'utf8' });

  const run = runReadmission(f);

  assert.notEqual(run.status, 0, `readmission must fail closed on a dirty index:\n${run.stdout}\n${run.stderr}`);
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /readmission attempted to commit non-metadata paths[\s\S]*stray-not-metadata\.txt/u,
    'the refusal must name the offending path, not fail generically',
  );

  // And the stray path must not have been committed onto the branch.
  const committed = spawnSync('git', ['cat-file', '-e', `${f.branch}:stray-not-metadata.txt`], {
    cwd: f.root, encoding: 'utf8',
  });
  assert.notEqual(committed.status, 0, 'the stray path must never reach the branch');
});

/**
 * Install a `git` stub on the fixture's PATH that delegates to the real git for
 * everything except one injected fault. The fixture already prepends its `bin`
 * to PATH for the lane-start child only, so fixture setup itself keeps using the
 * real git.
 *
 * Fault injection is the honest way to reach these guards: they exist for git
 * failures, and no arrangement of repository state makes real git fail on
 * demand. What is asserted is that lane-start REFUSES with the guard's own
 * message -- not merely that something went wrong.
 */
function injectGitFault(fixture: ReadmissionFixture, script: string): void {
  const real = spawnSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' });
  const realGit = (real.stdout ?? '').trim();
  assert.ok(realGit && realGit !== path.join(fixture.bin, 'git'), 'must resolve the REAL git');
  fs.writeFileSync(
    path.join(fixture.bin, 'git'),
    ['#!/bin/sh', `REAL_GIT=${realGit}`, script, 'exec "$REAL_GIT" "$@"', ''].join('\n'),
    { mode: 0o755 },
  );
}

test('G47: readmission refuses when staging the metadata fails', () => {
  const f = seedReadmissionFixture('UTV2-999985', {
    controlDescription: '## Objective\nSHARED.\n\n## Acceptance criteria\n- shared',
    branchDescription: '## Objective\nSHARED.\n\n## Acceptance criteria\n- shared',
  });
  injectGitFault(f, 'if [ "$1" = "add" ]; then echo "injected add failure" >&2; exit 1; fi');
  const run = runReadmission(f);
  assert.notEqual(run.status, 0, `must fail closed:\n${run.stdout}\n${run.stderr}`);
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /failed to stage readmission metadata/u,
    'the stage-failure guard must be the thing that refuses',
  );
});

test('G48: readmission refuses when the staged-path probe itself fails, even with a non-empty result', () => {
  // This guard needs a probe that FAILS while still printing a plausible path.
  // A probe that fails and prints nothing is caught by the empty-index guard
  // instead (G49), so the two clauses would be indistinguishable and a mutation
  // to either would survive.
  const f = seedReadmissionFixture('UTV2-999986', {
    controlDescription: '## Objective\nSHARED.\n\n## Acceptance criteria\n- shared',
    branchDescription: '## Objective\nSHARED.\n\n## Acceptance criteria\n- shared',
  });
  injectGitFault(
    f,
    [
      'if [ "$1" = "diff" ] && [ "$2" = "--cached" ]; then',
      `  echo "docs/06_status/lanes/${'UTV2-999986'}.json"`,
      '  exit 1',
      'fi',
    ].join('\n'),
  );
  const run = runReadmission(f);
  assert.notEqual(run.status, 0, `must fail closed:\n${run.stdout}\n${run.stderr}`);
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /readmission attempted to commit non-metadata paths/u,
    'a failed probe must refuse even though the path it printed IS a metadata path',
  );
});

test('G49: readmission refuses when the metadata commit would stage nothing at all', () => {
  const f = seedReadmissionFixture('UTV2-999987', {
    controlDescription: '## Objective\nSHARED.\n\n## Acceptance criteria\n- shared',
    branchDescription: '## Objective\nSHARED.\n\n## Acceptance criteria\n- shared',
  });
  injectGitFault(
    f,
    'if [ "$1" = "diff" ] && [ "$2" = "--cached" ]; then exit 0; fi',
  );
  const run = runReadmission(f);
  assert.notEqual(run.status, 0, `must fail closed:\n${run.stdout}\n${run.stderr}`);
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /readmission attempted to commit non-metadata paths: \(none\)/u,
    'an empty index must refuse, and the refusal must say the set was empty',
  );
});

test('G50: readmission refuses when the metadata commit fails', () => {
  const f = seedReadmissionFixture('UTV2-999988', {
    controlDescription: '## Objective\nSHARED.\n\n## Acceptance criteria\n- shared',
    branchDescription: '## Objective\nSHARED.\n\n## Acceptance criteria\n- shared',
  });
  injectGitFault(f, 'if [ "$1" = "commit" ]; then echo "injected commit failure" >&2; exit 1; fi');
  const run = runReadmission(f);
  assert.notEqual(run.status, 0, `must fail closed:\n${run.stdout}\n${run.stderr}`);
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /failed to commit regenerated readmission metadata/u,
    'the commit-failure guard must be the thing that refuses',
  );
});
