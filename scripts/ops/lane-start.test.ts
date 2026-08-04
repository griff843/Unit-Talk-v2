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
