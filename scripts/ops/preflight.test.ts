import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { CheckResult } from './shared.js';
import {
  ROOT,
  PREFLIGHT_RESULT_SCHEMA_PATH,
  PREFLIGHT_TOKEN_SCHEMA_PATH,
  preflightResultPathForBranch,
  preflightTokenPathForBranch,
  validatePreflightSchemaDependencies,
} from './shared.js';
import {
  branchContainsExactIssue,
  FULL_VERIFY_THROTTLE_DIR,
  FULL_VERIFY_THROTTLE_STALE_MS,
  configuredFullVerifyConcurrency,
  isContinuationEligibleLinearState,
  isTerminalLinearState,
  parseAheadBehind,
  resolveVerdict,
  runLinearChecks,
} from './preflight.js';
import { DEFAULT_HARD_DEADLINE_MS, DEFAULT_VERIFY_SEMAPHORE_DIR } from './verify-semaphore.js';

test('preflight schema dependencies exist', () => {
  assert.doesNotThrow(() => validatePreflightSchemaDependencies());
  assert.ok(fs.existsSync(PREFLIGHT_RESULT_SCHEMA_PATH));
  assert.ok(fs.existsSync(PREFLIGHT_TOKEN_SCHEMA_PATH));
});

test('preflight token and result paths share the canonical branch path', () => {
  const branch = 'codex/utv2-999-preflight';
  assert.strictEqual(
    preflightTokenPathForBranch(branch).endsWith(path.join('.out', 'ops', 'preflight', 'codex', 'utv2-999-preflight.json')),
    true,
  );
  assert.strictEqual(
    preflightResultPathForBranch(branch).endsWith(path.join('.out', 'ops', 'preflight', 'codex', 'utv2-999-preflight.result.json')),
    true,
  );
});

test('preflight fast path allows T2 safe-class baseline reuse', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /fastBaselineAllowed/, 'preflight should centralize fast baseline eligibility');
  assert.match(source, /tier === 'T2'/, 'fast baseline eligibility must explicitly include T2');
  assert.match(source, /governance/, 'T2 governance lanes should be fast-baseline eligible');
  assert.match(source, /tooling/, 'T2 tooling lanes should be fast-baseline eligible');
});

test('preflight supports a fail-closed T3 docs-only fast path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /docs-only-fast-path/, 'preflight should expose an explicit docs-only fast-path flag');
  assert.match(source, /validateDocsOnlyFastPath/, 'preflight should validate docs-only fast-path eligibility centrally');
  assert.match(source, /tier !== 'T3'/, 'docs-only fast path must be restricted to T3 lanes');
  assert.match(source, /isDocsOnlyFastPathFile/, 'docs-only fast path must mechanically check file scope');
  assert.match(source, /normalized\.startsWith\('docs\/06_status\/'\)/, 'docs-only fast path should allow status docs');
  assert.match(source, /normalized\.startsWith\('\.claude\/commands\/'\)/, 'docs-only fast path should allow command docs');
  assert.match(source, /PB1 skipped via T3 docs-only fast path/, 'docs-only fast path should skip preflight type-check baseline');
  assert.match(source, /PB2 skipped via T3 docs-only fast path/, 'docs-only fast path should skip preflight test baseline');
});

test('preflight treats lane registry dirt as control-plane safe', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /isLaneRegistryPath/, 'preflight should classify lane registry paths');
  assert.match(source, /\.ops\\\/sync\\\/UTV2-\\d\+\\\.yml/, 'sync files should be allowed lane registry dirt');
  assert.match(source, /docs\\\/06_status\\\/lanes\\\/UTV2-\\d\+\\\.json/, 'lane manifests should be allowed lane registry dirt');
});

test('preflight reads GitHub token from repo env files', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /readConfiguredEnvValue\('GITHUB_TOKEN'\)/, 'PE3 should honor repo env files, not just process.env');
});

// UTV2-1492: preflight must never require implementation evidence. PX3
// (proof-auditor-gate) and PX4 (runtime-verifier-gate) duplicated content
// validation that already belongs to proof-gate.yml (CI on pull_request)
// and truth-check-lib.ts (ops:lane-close, post-merge). PX5 required a T1
// proof directory to exist on disk before any lane/implementation existed,
// which made PX5 (must exist) and PX3/PX4 (must be populated once it
// exists) mutually unsatisfiable for a brand-new T1 lane. All three were
// removed from preflight; declared-proof-path validation for T1 moved to
// lane-start.ts, where a manifest actually exists to validate against.
test('preflight no longer runs proof-content gates (PX3/PX4/PX5 removed)', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.doesNotMatch(
    source,
    /'PX3'/,
    'PX3 must not exist in preflight — proof-auditor-gate validation belongs to proof-gate.yml/lane-close, not pre-lane-start preflight',
  );
  assert.doesNotMatch(
    source,
    /'PX4'/,
    'PX4 must not exist in preflight — runtime-verifier-gate validation belongs to proof-gate.yml/lane-close, not pre-lane-start preflight',
  );
  assert.doesNotMatch(
    source,
    /'PX5'/,
    'PX5 must not exist in preflight — T1 proof-path validation moved to lane-start.ts',
  );
  assert.doesNotMatch(
    source,
    /proof-auditor-gate\.ts/,
    'preflight must not shell out to proof-auditor-gate.ts',
  );
  assert.doesNotMatch(
    source,
    /runtime-verifier-gate\.ts/,
    'preflight must not shell out to runtime-verifier-gate.ts',
  );
});

test('preflight WAIVABLE_CHECKS no longer references removed PX3/PX4/PX5 checks', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  const waivableBlock = source.match(/const WAIVABLE_CHECKS[\s\S]*?\n};/);
  assert.ok(waivableBlock, 'WAIVABLE_CHECKS block should exist');
  assert.doesNotMatch(waivableBlock[0], /PX3|PX4|PX5/, 'removed checks must not linger in WAIVABLE_CHECKS');
});

// ── Full-verify semaphore delegation (UTV2-1516 policy, UTV2-1594 mechanism) ─

test('preflight delegates full-verify slot ownership to verify-semaphore.ts', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /from '\.\/verify-semaphore\.js'/, 'preflight must consume the shared semaphore module');
  assert.match(source, /acquireVerifySlot\(/, 'preflight must acquire through the durable-ownership API');
  assert.match(source, /slot\.release\(\)/, 'preflight must release the slot');
  assert.doesNotMatch(
    source,
    /function acquireFullVerifyThrottle/,
    'the inline 6h-wall-clock throttle must not survive alongside the durable semaphore',
  );
  assert.doesNotMatch(
    source,
    /function releaseStaleThrottleSlot/,
    'stale-by-clock reclaim is replaced by proof-of-death reclaim in verify-semaphore.ts',
  );
});

test('preflight releases its full-verify slot in a finally block, not only on the happy path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  const finallyBlock = source.match(/\} finally \{\s*[\s\S]{0,400}?slot\.release\(\);/);
  assert.ok(finallyBlock, 'the baseline runner must release the slot from a finally block');
});

test('preflight reports queue waits and reclaims instead of blocking silently', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /onWait:/, 'a waiting preflight must emit progress');
  assert.match(source, /onReap:/, 'a reclaim must never be silent');
});

test('the full-verify throttle re-exports still resolve for existing importers', () => {
  assert.equal(typeof configuredFullVerifyConcurrency, 'function');
  assert.equal(FULL_VERIFY_THROTTLE_DIR, DEFAULT_VERIFY_SEMAPHORE_DIR);
  assert.equal(FULL_VERIFY_THROTTLE_STALE_MS, DEFAULT_HARD_DEADLINE_MS);
});

test('preflight raises the baseline spawn buffer so pnpm test output cannot ENOBUFS', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /RUN_COMMAND_MAX_BUFFER_BYTES = 64 \* 1024 \* 1024/);
  const runCommandBody = source.slice(source.indexOf('function runCommand('));
  assert.equal(
    (runCommandBody.match(/maxBuffer: RUN_COMMAND_MAX_BUFFER_BYTES/g) ?? []).length,
    2,
    'both the win32 and posix spawn paths need the raised buffer',
  );
});

// UTV2-1546: delegation kill switch is the very first check preflight performs --
// before validatePreflightSchemaDependencies(), before any Linear call, and before
// any baseline verify/test run or preflight-token write. See delegation-state.ts's
// full behavioral coverage (delegation-state.test.ts) for missing/malformed/
// suspended/active state handling.
test('preflight checks delegation before validatePreflightSchemaDependencies and before any token write', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  const delegationCallIndex = source.indexOf("requireDelegationActive('preflight')");
  const schemaDepsCallIndex = source.indexOf('validatePreflightSchemaDependencies();');
  assert.ok(delegationCallIndex >= 0, 'preflight.ts must call requireDelegationActive');
  assert.ok(schemaDepsCallIndex >= 0, 'preflight.ts must still call validatePreflightSchemaDependencies');
  assert.ok(
    delegationCallIndex < schemaDepsCallIndex,
    'delegation kill switch must run before every other preflight check',
  );
});

test('readmission 01: fresh-branch admission keeps its original PG4 and PG5 paths', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /branch \$\{branch\} does not yet exist locally/);
  assert.match(source, /branch \$\{branch\} does not exist locally yet/);
  assert.match(source, /if \(readmitExistingBranch\)[\s\S]*else if \(!branchExists\(branch\)\)/);
});

test('readmission 02: the explicit flag is parsed and never inferred from branch existence', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(
    source,
    /bools\.has\('readmit-existing-branch'\) \|\| flags\.has\('readmit-existing-branch'\)/,
  );
  assert.doesNotMatch(source, /readmitExistingBranch\s*=\s*branchExists/);
});

test('readmission 03: exact issue matching rejects adjacent or embedded identifiers', () => {
  assert.equal(branchContainsExactIssue('codex/utv2-1584-safe-readmission', 'UTV2-1584'), true);
  assert.equal(branchContainsExactIssue('codex/utv2-15840-safe-readmission', 'UTV2-1584'), false);
  assert.equal(branchContainsExactIssue('codex/xutv2-1584-safe-readmission', 'UTV2-1584'), false);
});

test('readmission 04: behind-main divergence is accepted and recorded without sign inversion', () => {
  assert.deepEqual(parseAheadBehind('7 3'), { behind: 7, ahead: 3 });
  assert.deepEqual(parseAheadBehind('0\t11'), { behind: 0, ahead: 11 });
  assert.equal(parseAheadBehind('unknown'), null);
  assert.equal(parseAheadBehind('-1 2'), null);
});

test('readmission 05: unrelated history and missing merge bases are fail-closed checks', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /git\(\['merge-base', 'origin\/main', targetRef\]\)/);
  assert.match(source, /target branch \$\{branch\} has unrelated or invalid history/);
});

test('readmission 06: missing, duplicate, mismatched, or cross-repository PRs are rejected', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /pullRequests\.length === 1/);
  assert.match(source, /pullRequest\.head\.ref === branch/);
  assert.match(source, /pullRequest\.head\.sha === branchHeadSha/);
  assert.match(source, /pullRequest\?\.head\.repo\?\.full_name === repository/);
  assert.match(source, /pullRequest\?\.base\.repo\?\.full_name === repository/);
});

test('readmission 21: PRA17 requires the open PR to target main and fails closed for any other base ref, including release or staging', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  const checkIndex = source.indexOf("'PRA17'");
  assert.notStrictEqual(checkIndex, -1, 'expected a dedicated PRA17 check for the PR base ref');
  const checkBlock = source.slice(checkIndex - 200, checkIndex + 400);
  assert.match(
    checkBlock,
    /observedBaseRef === 'main'/,
    'PRA17 must compare the live PR base ref exactly against main, not against branch-specific literals like release or staging',
  );
  assert.match(
    checkBlock,
    /PR base ref is \$\{observedBaseRef \?\? 'unknown'\}, expected main/,
    'PRA17 failure detail must explicitly state the observed base ref, e.g. "PR base ref is release, expected main"',
  );
  assert.match(
    source,
    /const observedBaseRef = pullRequest\?\.base\.ref \?\? null;/,
    'the observed base ref must be read directly off the live-fetched PR object, never inferred or hardcoded as main',
  );
});

test('readmission 22: the readmission context binds open_pr_base_ref from the live PR object, not a literal', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(
    source,
    /open_pr_base_ref: pullRequest\.base\.ref,/,
    'the token must bind whatever base ref the live PR actually reports',
  );
  assert.doesNotMatch(
    source,
    /open_pr_base_ref: 'main'/,
    'the token must never hardcode main for open_pr_base_ref -- PRA17 already fails closed before this point if it is not main',
  );
});

test('readmission 07: terminal Linear states are rejected', () => {
  for (const state of ['Done', 'Canceled', 'Cancelled', 'Failed', 'Duplicate']) {
    assert.equal(isTerminalLinearState(state), true, state);
    assert.equal(isContinuationEligibleLinearState(state), false, state);
  }
});

test('readmission 08: only explicit continuation states are eligible', () => {
  for (const state of ['In Claude', 'In Codex', 'In Claude Review', 'In Codex Review', 'In Progress']) {
    assert.equal(isContinuationEligibleLinearState(state), true, state);
  }
  for (const state of ['Backlog', 'Ready for Codex', 'Todo', 'Unknown']) {
    assert.equal(isContinuationEligibleLinearState(state), false, state);
  }
});

test('readmission 09: existing worktrees, active leases, and issue-owned merge locks are all checked', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /git\(\['worktree', 'list', '--porcelain'\]\)/);
  assert.match(source, /lease\.status === 'active' \|\| lease\.status === 'stale_reclaim_required'/);
  assert.match(source, /mergeLock\.lock\.issue_id === issueId && mergeLock\.lock\.status !== 'released'/);
});

test('readmission 10: token captures immutable branch, main, PR, divergence, authority, and absence facts', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  for (const field of [
    'mode',
    'branch_head_sha',
    'origin_main_sha',
    'open_pr_number',
    'open_pr_base_ref',
    'ahead_count',
    'behind_count',
    'requested_lane_type',
    'executor',
    'file_scope',
    'previous_lane_type',
    'no_worktree',
    'no_active_lease',
    'no_active_merge_mutex',
  ]) {
    assert.match(source, new RegExp(`${field}:`), field);
  }
});

test('readmission invalidates a prior token after terminal or infrastructure preflight results', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  const nonPassReadmissionCleanup = source.indexOf(
    'if (readmitExistingBranch && !dryRun) {',
    source.indexOf("if (result.verdict === 'FAIL')"),
  );
  const cleanupCall = source.indexOf('removeFileIfExists(tokenPath);', nonPassReadmissionCleanup);
  const finalReturn = source.indexOf(
    "return result.verdict === 'NOT_APPLICABLE' ? 2 : 3;",
    nonPassReadmissionCleanup,
  );

  assert.ok(nonPassReadmissionCleanup >= 0, 'expected readmission-only non-PASS token cleanup');
  assert.ok(
    cleanupCall > nonPassReadmissionCleanup && cleanupCall < finalReturn,
    'a stale readmission token must be removed before NOT_APPLICABLE or INFRA returns',
  );
});

// ---------------------------------------------------------------------------
// UTV2-1837 — tracker independence. Ratified 2026-09-05, `docs/mission/intent.md`
// "Execution must not depend on the tracker".
//
// The measured cascade these tests pin: no credential -> PL1-PL5 `infra_error`
// -> `resolveVerdict` returns INFRA -> no preflight token is written -> every
// `ops:lane-start` fails with "validated preflight token is unavailable".
// Each step is asserted separately so a future regression names which link
// broke rather than only that the chain broke.
// ---------------------------------------------------------------------------

const collectChecks = (): {
  checks: CheckResult[];
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void;
  byId: (id: string) => CheckResult | undefined;
} => {
  const checks: CheckResult[] = [];
  return {
    checks,
    addCheck: (id, status, detail) => {
      checks.push({ id, status, detail });
    },
    byId: (id) => checks.find((check) => check.id === id),
  };
};

test('UTV2-1837 AC1: with no tracker credential, PL1-PL5 skip instead of infra_error', async () => {
  const sink = collectChecks();
  const previous = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    const state = await runLinearChecks(
      'UTV2-1837',
      'T2',
      null,
      ['docs/06_status/CURRENT_STATE.md'],
      false,
      sink.addCheck,
    );
    assert.deepEqual(state, { labels: [], stateName: '' });
  } finally {
    if (previous !== undefined) process.env.LINEAR_API_KEY = previous;
  }

  for (const id of ['PL1', 'PL2', 'PL3', 'PL4', 'PL5', 'PL6']) {
    assert.equal(sink.byId(id)?.status, 'skip', `${id} must skip without a tracker credential`);
  }
  assert.equal(sink.byId('PE2')?.status, 'skip');
  assert.equal(
    sink.checks.some((check) => check.status === 'infra_error'),
    false,
    'an absent optional tracker is not an infrastructure error',
  );
});

test('UTV2-1837 AC1: those skips produce verdict PASS, which is what writes the token', async () => {
  const sink = collectChecks();
  const previous = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    await runLinearChecks('UTV2-1837', 'T2', null, ['README.md'], false, sink.addCheck);
  } finally {
    if (previous !== undefined) process.env.LINEAR_API_KEY = previous;
  }
  assert.equal(resolveVerdict(sink.checks), 'PASS');
});

test('UTV2-1837 AC5: a declared tier BELOW the mechanical floor is refused, not skipped', async () => {
  const sink = collectChecks();
  const previous = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    // packages/domain is a Tier C path: its mechanical minimum is T1, so a
    // declared T3 is below the floor and must fail rather than pass through.
    await runLinearChecks(
      'UTV2-1837',
      'T3',
      null,
      ['packages/domain/src/scoring.ts'],
      false,
      sink.addCheck,
    );
  } finally {
    if (previous !== undefined) process.env.LINEAR_API_KEY = previous;
  }
  const pe2 = sink.byId('PE2');
  assert.equal(pe2?.status, 'fail');
  assert.match(pe2?.detail ?? '', /below the mechanical floor T1/u);
  assert.equal(resolveVerdict(sink.checks), 'FAIL');
});

test('UTV2-1837 AC5: a declared tier AT OR ABOVE the floor is accepted', async () => {
  const sink = collectChecks();
  const previous = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    await runLinearChecks(
      'UTV2-1837',
      'T1',
      null,
      ['packages/domain/src/scoring.ts'],
      false,
      sink.addCheck,
    );
  } finally {
    if (previous !== undefined) process.env.LINEAR_API_KEY = previous;
  }
  assert.equal(sink.byId('PE2')?.status, 'skip');
  assert.equal(resolveVerdict(sink.checks), 'PASS');
});

test('UTV2-1837 AC4 inversion: the skip is conditional on absence, never unconditional', async () => {
  const sink = collectChecks();
  // A present-but-invalid credential must NOT take the skip path. If it did,
  // supplying a token would silently disable every tracker check -- the exact
  // unconditional-skip failure mode acceptance criterion 4 exists to refuse.
  await runLinearChecks(
    'UTV2-1837',
    'T2',
    { LINEAR_API_TOKEN: 'lin_api_not_a_real_token' } as never,
    ['README.md'],
    false,
    sink.addCheck,
  );
  assert.notEqual(
    sink.byId('PL1')?.status,
    'skip',
    'PL1 must not skip when a credential IS present',
  );
});
