import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { CheckResult, PreflightToken } from './shared.js';
import {
  ROOT,
  PREFLIGHT_RESULT_SCHEMA_PATH,
  PREFLIGHT_TOKEN_SCHEMA_PATH,
  T1_LIVE_DB_PRECONDITION_DEFERRED,
  preflightResultPathForBranch,
  preflightTokenPathForBranch,
  validatePreflightSchemaDependencies,
} from './shared.js';
import {
  branchContainsExactIssue,
  isLaneRegistryPath,
  createToken,
  isDocsOnlyFastPathFile,
  validateDocsOnlyFastPath,
  FULL_VERIFY_THROTTLE_DIR,
  FULL_VERIFY_THROTTLE_STALE_MS,
  configuredFullVerifyConcurrency,
  isContinuationEligibleLinearState,
  isTerminalLinearState,
  isContainmentPlaceholderSupabaseUrl,
  parseAheadBehind,
  resolveVerdict,
  runLinearChecks,
  runT1Checks,
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

test('preflight admits only registry records and the current local work contract as preparation dirt', () => {
  for (const id of ['WORK-123', 'UTV2-123', 'UNI-123']) {
    assert.equal(isLaneRegistryPath(`.ops/sync/${id}.yml`), true);
    assert.equal(isLaneRegistryPath(`docs/06_status/lanes/${id}.json`), true);
    assert.equal(isLaneRegistryPath(`.ops/work/${id}.md`, id), true);
  }
  assert.equal(isLaneRegistryPath('.ops/work/WORK-123.md', 'WORK-123'), true);
  assert.equal(isLaneRegistryPath('.ops/work/WORK-456.md', 'WORK-123'), false);
  assert.equal(isLaneRegistryPath('scripts/ops/preflight.ts', 'WORK-123'), false);
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

  for (const id of ['PL1', 'PL2', 'PL3', 'PL4']) {
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

test('ordinary admission ignores stale credentials for local and legacy identities without network', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('blocked network'); };
  try {
    for (const identity of ['WORK-999931', 'UTV2-999931', 'UNI-999931']) {
      const sink = collectChecks();
      await runLinearChecks(identity, 'T2', { LINEAR_API_TOKEN: 'invalid' } as never,
        ['README.md'], false, sink.addCheck);
      assert.equal(sink.byId('PL1')?.status, 'skip');
      assert.equal(resolveVerdict(sink.checks), 'PASS');
      const unsafe = collectChecks();
      await runLinearChecks(identity, 'T3', { LINEAR_API_TOKEN: 'invalid' } as never,
        ['packages/domain/src/scoring.ts'], false, unsafe.addCheck);
      assert.equal(resolveVerdict(unsafe.checks), 'FAIL');
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

// UTV2-1845: PT1 pinged live Supabase and could only answer `pass` or `infra_error`. Under
// containment the ping is *designed* to fail -- `local.env` declares itself a containment
// placeholder and points SUPABASE_URL at an unroutable address -- so a deliberate policy state was
// reported as a broken database. resolveVerdict maps infra_error to INFRA, which writes no token,
// which makes ops:lane-start refuse. PT1 runs only at T1 and is waivable at no tier, so every T1
// lane was unopenable on a contained workstation. These tests lock the classification. They do NOT
// lock any admission change: `blocked_by_containment` still resolves to INFRA.

test('UTV2-1845: the containment placeholder is recognised exactly, not heuristically', () => {
  for (const url of [
    'http://127.0.0.1:1',
    'http://127.0.0.1:54321',
    'http://127.1.2.3:1',
    'http://localhost:54321',
    'http://[::1]:1',
    'http://0.0.0.0:1',
  ]) {
    assert.equal(isContainmentPlaceholderSupabaseUrl(url), true, url);
  }
});

test('UTV2-1845 inversion: a real host is never mistaken for the containment placeholder', () => {
  // If any of these returned true, a genuinely broken production or staging database would be
  // reported as containment -- the exact false negative this predicate must not introduce.
  for (const url of [
    'https://zfzdnfwdarxucxtaojxm.supabase.co',
    'https://xskgrzbteyqdufktjrjx.supabase.co',
    'https://db.example.com',
    'https://127.0.0.1.example.com',
    'not-a-url',
    '',
  ]) {
    assert.equal(isContainmentPlaceholderSupabaseUrl(url), false, url);
  }
});

test("UTV2-1845: the predicate agrees with an independent reading of the repo's own SUPABASE_URL", () => {
  // Binds the predicate to the actual value this repository runs with rather than to a value
  // invented here. It asserts agreement, not a fixed verdict: under local containment that value is
  // the loopback placeholder and the expected answer is true, while in CI `local.env` is written
  // from the staging-ci environment and the expected answer is false. An earlier version of this
  // test asserted `true` unconditionally and was red in CI for exactly that reason -- it had
  // encoded one environment's value as if it were the contract.
  const localEnvPath = path.join(ROOT, 'local.env');
  if (!fs.existsSync(localEnvPath)) {
    return;
  }
  const line = fs
    .readFileSync(localEnvPath, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('SUPABASE_URL='));
  if (!line) {
    return;
  }
  const value = line.slice('SUPABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '');

  // Computed here without calling the function under test, so the two can disagree.
  let expected = false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    expected =
      bare === 'localhost' ||
      bare === '::1' ||
      bare === '::' ||
      bare === '0.0.0.0' ||
      /^127(?:\.\d{1,3}){3}$/.test(bare);
  } catch {
    expected = false;
  }

  assert.equal(
    isContainmentPlaceholderSupabaseUrl(value),
    expected,
    `predicate disagrees with an independent loopback reading of local.env SUPABASE_URL (${value})`,
  );
});

test('UTV2-1845: PT1 reports blocked_by_containment for the placeholder host', async () => {
  const sink = collectChecks();
  await runT1Checks(
    { SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY: 'placeholder-key' } as never,
    sink.addCheck,
  );
  assert.equal(sink.byId('PT1')?.status, 'blocked_by_containment');
});

test('UTV2-1845 inversion: a real but unreachable host still reports infra_error', async () => {
  // This is the control. The .invalid TLD never resolves, so the ping fails for the same reason
  // the placeholder ping fails -- and the outcome must still be infra_error, because the cause is
  // an unreachable database and not containment.
  const sink = collectChecks();
  await runT1Checks(
    {
      SUPABASE_URL: 'https://unreachable-host.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'placeholder-key',
    } as never,
    sink.addCheck,
  );
  assert.equal(sink.byId('PT1')?.status, 'infra_error');
});

test('UTV2-1845 inversion: an absent credential still fails, and is not containment', async () => {
  const sink = collectChecks();
  await runT1Checks({ SUPABASE_URL: 'http://127.0.0.1:1' } as never, sink.addCheck);
  assert.equal(sink.byId('PT1')?.status, 'fail');
});

// UTV2-1851 (route B, ratified by PM 2026-09-06). This test previously asserted the OPPOSITE --
// that PT1's `blocked_by_containment` still resolved to INFRA, admitting nothing. That was the
// correct assertion for UTV2-1845, which deliberately landed the classification without the
// admission. The admission is now ratified, so the assertion inverts; the surrounding controls do
// not, and they are what keep the change bounded.
test('UTV2-1851: PT1 containment is admitted, and nothing else is relaxed', () => {
  // The ratified change: PT1 containment alone no longer blocks a verdict.
  assert.equal(
    resolveVerdict([
      { id: 'PE1', status: 'pass', detail: '' },
      { id: 'PT1', status: 'blocked_by_containment', detail: '' },
    ]),
    'PASS',
  );

  // BINDING CONDITION -- "all other applicable preflight checks must still pass". A containment
  // admission does not carry an unrelated failure through with it.
  assert.equal(
    resolveVerdict([
      { id: 'PE1', status: 'fail', detail: '' },
      { id: 'PT1', status: 'blocked_by_containment', detail: '' },
    ]),
    'FAIL',
  );
  assert.equal(
    resolveVerdict([
      { id: 'PL2', status: 'fail', detail: '' },
      { id: 'PT1', status: 'blocked_by_containment', detail: '' },
    ]),
    'NOT_APPLICABLE',
  );

  // A genuine infrastructure fault is untouched: it still returns INFRA and writes no token.
  assert.equal(
    resolveVerdict([
      { id: 'PE1', status: 'pass', detail: '' },
      { id: 'PT1', status: 'infra_error', detail: '' },
    ]),
    'INFRA',
  );
  assert.equal(
    resolveVerdict([
      { id: 'PT1', status: 'blocked_by_containment', detail: '' },
      { id: 'PE2', status: 'infra_error', detail: '' },
    ]),
    'INFRA',
  );

  // SCOPE CONTROL: the admission is PT1's alone. `blocked_by_containment` from any other check
  // still returns INFRA, so a future emitter cannot inherit this admission without its own review.
  assert.equal(
    resolveVerdict([
      { id: 'PE1', status: 'blocked_by_containment', detail: '' },
      { id: 'PT1', status: 'pass', detail: '' },
    ]),
    'INFRA',
  );
});

test('UTV2-1851: the admitted token records the deferral, and an ordinary token does not', () => {
  const generatedAt = new Date().toISOString();
  const admitted = createToken(
    'UTV2-1851',
    'T1',
    'claude/utv2-1851-example',
    'a'.repeat(40),
    generatedAt,
    [],
    false,
    [],
    null,
    true,
  ) as PreflightToken;
  assert.equal(admitted.t1_live_db_precondition, T1_LIVE_DB_PRECONDITION_DEFERRED);

  // Control: the field is not written unconditionally. Every lane that did not hit containment
  // produces a token with no deferral at all, which is what keeps `validateManifest`'s bridge
  // silent for ordinary lanes.
  const ordinary = createToken(
    'UTV2-1851',
    'T1',
    'claude/utv2-1851-example',
    'a'.repeat(40),
    generatedAt,
    [],
    false,
    [],
    null,
    false,
  ) as PreflightToken;
  assert.equal('t1_live_db_precondition' in ordinary, false);
});


// --- UTV2-1884: the docs-only fast path admits product intent, not policy ---

function collectFastPathChecks(
  tier: 'T1' | 'T2' | 'T3',
  docsOnlyFastPath: boolean,
  candidateFiles: string[],
): CheckResult[] {
  const checks: CheckResult[] = [];
  validateDocsOnlyFastPath(tier, docsOnlyFastPath, candidateFiles, (id, status, detail) => {
    checks.push({ id, status, detail } as CheckResult);
  });
  return checks;
}

test('UTV2-1884: the docs-only fast path admits docs/03_product paths', () => {
  assert.strictEqual(isDocsOnlyFastPathFile('docs/03_product/brand/README.md'), true);
  assert.strictEqual(isDocsOnlyFastPathFile('docs/03_product/smart-form/intent.md'), true);
  // The paths it already admitted are unchanged.
  assert.strictEqual(isDocsOnlyFastPathFile('docs/06_status/CURRENT_STATE.md'), true);
  assert.strictEqual(isDocsOnlyFastPathFile('.claude/commands/dispatch.md'), true);
});

test('UTV2-1884: the docs-only fast path still excludes policy and code paths', () => {
  // intent.md: "A document that changes security or approval policy still
  // requires substantive review." These must stay out, or the fast path becomes
  // a way to land an approval-policy change without the local suite.
  assert.strictEqual(isDocsOnlyFastPathFile('docs/05_operations/STANDING_GUARDRAILS.md'), false);
  assert.strictEqual(isDocsOnlyFastPathFile('docs/mission/intent.md'), false);
  assert.strictEqual(isDocsOnlyFastPathFile('docs/governance/LANE_CONCURRENCY_POLICY.md'), false);
  assert.strictEqual(isDocsOnlyFastPathFile('.github/workflows/merge-gate.yml'), false);
  assert.strictEqual(isDocsOnlyFastPathFile('scripts/ops/shared.ts'), false);
  assert.strictEqual(isDocsOnlyFastPathFile('apps/api/src/grading-service.ts'), false);
  // A path that merely starts with the admitted prefix as a substring is not
  // admitted -- the separator is load-bearing.
  assert.strictEqual(isDocsOnlyFastPathFile('docs/03_product_policy/secret.md'), false);
});

test('UTV2-1884: the docs-only fast path remains opt-in', () => {
  const checks = collectFastPathChecks('T3', false, ['docs/03_product/brand/README.md']);
  assert.deepStrictEqual(
    checks.map((check) => [check.id, check.status]),
    [['PF1', 'skip']],
    'PF1 must skip when the flag is not passed, leaving PB1/PB2 to run',
  );
});

test('UTV2-1884: the docs-only fast path remains T3-only', () => {
  for (const tier of ['T1', 'T2'] as const) {
    const checks = collectFastPathChecks(tier, true, ['docs/03_product/brand/README.md']);
    assert.deepStrictEqual(checks.map((check) => [check.id, check.status]), [['PF1', 'fail']]);
    assert.match(checks[0]!.detail, /restricted to T3 lanes/);
  }
  const t3 = collectFastPathChecks('T3', true, ['docs/03_product/brand/README.md']);
  assert.deepStrictEqual(t3.map((check) => [check.id, check.status]), [['PF1', 'pass']]);
});

test('UTV2-1884: one non-admitted path fails the whole fast-path scope', () => {
  const checks = collectFastPathChecks('T3', true, [
    'docs/03_product/brand/README.md',
    'docs/mission/intent.md',
  ]);
  assert.deepStrictEqual(checks.map((check) => [check.id, check.status]), [['PF1', 'fail']]);
  assert.match(checks[0]!.detail, /docs\/mission\/intent\.md/);
});

test('UTV2-1884: the fast path only skips the local duplicate, never a CI obligation', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/ops/preflight.ts'), 'utf8');
  assert.match(source, /PB1 skipped via T3 docs-only fast path; CI\/pnpm verify remains required before PR/);
  assert.match(source, /PB2 skipped via T3 docs-only fast path; CI\/pnpm verify remains required before PR/);
});
