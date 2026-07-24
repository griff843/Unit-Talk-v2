import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

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

// UTV2-1569: Fable pilot planning-model routing wiring, mirrors the --model-profile
// pattern above but Claude-only and always optional (the ordinary case supplies
// neither flag and planning_model_routing simply never appears in the manifest).

test('lane-start rejects --fable-trigger-class/--fable-rationale on a non-Claude executor', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(source, /fable_routing_not_applicable/);
  assert.match(
    source,
    /supplied but executor "\$\{executor\}" is not claude\. planning_model_routing is Claude-only/,
  );
});

test('lane-start requires --fable-rationale whenever --fable-trigger-class is supplied', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(source, /fable_rationale_required/);
  assert.match(source, /--fable-trigger-class requires --fable-rationale <text> as well/);
});

test('lane-start resolves planning_model_routing via resolveAndRecordPlanningModel, never hardcoding a model literal', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(source, /import \{ resolveAndRecordPlanningModel, type PlanningModelRoutingBlock \} from '\.\/planning-model-routing\.js'/);
  assert.match(source, /resolveAndRecordPlanningModel\(\{\s*\n\s*tier,\s*\n\s*triggerClass: fableTriggerClassFlag,/);
});

test('lane-start uses resolveAndRecordPlanningModel (not the bare read-only resolvePlanningModel) so a real Fable selection atomically records the qualifying task against pilot state (UTV2-1569 PR #1292 P1 fix)', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.doesNotMatch(
    source,
    /resolvePlanningModel\(/,
    'lane-start.ts must not call the bare resolvePlanningModel directly -- it must go through resolveAndRecordPlanningModel so Fable selections are recorded, not just read',
  );
  assert.match(source, /taskId: issueId/);
});

test('lane-start fails closed (non-zero exit) if resolveAndRecordPlanningModel itself reports not-ok (e.g. policy load failure)', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const resolveIndex = source.indexOf('const resolution = resolveAndRecordPlanningModel({');
  assert.ok(resolveIndex >= 0, 'expected a planning-model resolution call site');
  const block = source.slice(resolveIndex, resolveIndex + 500);
  assert.match(block, /if \(!resolution\.ok\)/);
  assert.match(block, /process\.exit\(1\)/);
});

test('lane-start never passes planning_model_routing on a Codex lane (createManifest itself also rejects this, defense in depth)', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  assert.match(source, /isClaudeExecutorForFable = executor === 'claude'/);
});
