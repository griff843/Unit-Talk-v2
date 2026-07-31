import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  PREFLIGHT_RESULT_SCHEMA_PATH,
  PREFLIGHT_TOKEN_SCHEMA_PATH,
  preflightResultPathForBranch,
  preflightTokenPathForBranch,
  validatePreflightSchemaDependencies,
} from './shared.js';
import {
  FULL_VERIFY_THROTTLE_DIR,
  FULL_VERIFY_THROTTLE_STALE_MS,
  configuredFullVerifyConcurrency,
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
