import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';
import {
  type ExistingBranchReadmissionToken,
  validateReadmissionTokenRequest,
} from './lane-start.js';

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

  const overlapCallIndex = fastPathBlock.indexOf('activeManifestOverlap(issueId, normalizedFiles)');
  assert.notStrictEqual(
    overlapCallIndex,
    -1,
    'the docs-only fast path must call activeManifestOverlap on current manifest state before emitting success -- ' +
      'trusting the preflight token alone allows a concurrent lane to lock the same file after preflight ran',
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
    /readAllManifests\(\)\.filter\(\(m\) => m\.issue_id !== issueId\)/,
    'checkConcurrencyLimits must exclude the incoming issue\'s own active manifest from the conflict-search set -- ' +
      'a lane must never be treated as conflicting with itself on resume',
  );
});

// PR #1213 Codex review fix: a malformed --verification-target must fail before
// createBranchAndWorktree/reserveLease run, not deep inside createManifest -- otherwise a
// typo leaves an orphaned branch/worktree/lease behind it.
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
  });
  assert.deepEqual(errors, ['main head changed after preflight']);
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
  });
  assert.deepEqual(errors, [
    'token tier does not match request',
    'token lane type does not match request',
    'token executor does not match request',
    'token file scope does not match request',
    'open PR identity changed after preflight',
  ]);
});

test('readmission 18: post-worktree failures release lease, remove worktree, and restore root metadata', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const transactionStart = source.indexOf('const manifestSnapshot = snapshotFile(manifestPath);');
  const transactionEnd = source.indexOf("if (!branchAlreadyExists && !worktreeAlreadyExists) {", transactionStart);
  const block = source.slice(transactionStart, transactionEnd);
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
