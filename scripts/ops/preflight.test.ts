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
  acquireFullVerifyThrottle,
  releaseFullVerifyThrottle,
  configuredFullVerifyConcurrency,
} from './preflight.js';
import os from 'node:os';

function makeTmpThrottleDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'full-verify-throttle-test-'));
}

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

// ── Full-verify concurrency throttle (UTV2-1516) ────────────────────────────

test('configuredFullVerifyConcurrency defaults to 1 when env var is unset or invalid', () => {
  const original = process.env.UNIT_TALK_FULL_VERIFY_CONCURRENCY;
  try {
    delete process.env.UNIT_TALK_FULL_VERIFY_CONCURRENCY;
    assert.equal(configuredFullVerifyConcurrency(), 1);

    process.env.UNIT_TALK_FULL_VERIFY_CONCURRENCY = 'not-a-number';
    assert.equal(configuredFullVerifyConcurrency(), 1);

    process.env.UNIT_TALK_FULL_VERIFY_CONCURRENCY = '0';
    assert.equal(configuredFullVerifyConcurrency(), 1);

    process.env.UNIT_TALK_FULL_VERIFY_CONCURRENCY = '3';
    assert.equal(configuredFullVerifyConcurrency(), 3);
  } finally {
    if (original === undefined) delete process.env.UNIT_TALK_FULL_VERIFY_CONCURRENCY;
    else process.env.UNIT_TALK_FULL_VERIFY_CONCURRENCY = original;
  }
});

test('acquireFullVerifyThrottle reserves a slot directory with an owner record', () => {
  const dir = makeTmpThrottleDir();
  try {
    const throttle = acquireFullVerifyThrottle(dir, 1);
    assert.equal(throttle.slot, 0);
    assert.equal(throttle.maxConcurrent, 1);
    assert.ok(fs.existsSync(throttle.slotPath));
    const owner = JSON.parse(fs.readFileSync(path.join(throttle.slotPath, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid);
    assert.ok(owner.acquired_at);
    releaseFullVerifyThrottle(throttle);
    assert.equal(fs.existsSync(throttle.slotPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireFullVerifyThrottle takes the second slot when the first is already held', () => {
  const dir = makeTmpThrottleDir();
  try {
    const first = acquireFullVerifyThrottle(dir, 2);
    const second = acquireFullVerifyThrottle(dir, 2);
    assert.equal(first.slot, 0);
    assert.equal(second.slot, 1);
    releaseFullVerifyThrottle(first);
    releaseFullVerifyThrottle(second);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireFullVerifyThrottle reclaims a stale slot whose owner never released it', () => {
  const dir = makeTmpThrottleDir();
  try {
    // Simulate a crashed/killed process that acquired slot-0 well past the
    // stale threshold and never released it.
    const staleSlotPath = path.join(dir, 'slot-0');
    fs.mkdirSync(staleSlotPath, { recursive: true });
    fs.writeFileSync(
      path.join(staleSlotPath, 'owner.json'),
      JSON.stringify({ pid: 999999, acquired_at: new Date(0).toISOString() }),
      'utf8',
    );

    // staleMs=0 means "anything already acquired counts as stale" — avoids a
    // real multi-hour wait in the test while exercising the same reclaim path.
    const reclaimed = acquireFullVerifyThrottle(dir, 1, 0);
    assert.equal(reclaimed.slot, 0);
    const owner = JSON.parse(fs.readFileSync(path.join(reclaimed.slotPath, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid, 'the reclaiming process should now own the slot');
    releaseFullVerifyThrottle(reclaimed);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireFullVerifyThrottle does not reclaim a slot that is not yet stale', () => {
  const dir = makeTmpThrottleDir();
  try {
    const staleSlotPath = path.join(dir, 'slot-0');
    fs.mkdirSync(staleSlotPath, { recursive: true });
    fs.writeFileSync(
      path.join(staleSlotPath, 'owner.json'),
      JSON.stringify({ pid: 999999, acquired_at: new Date().toISOString() }),
      'utf8',
    );

    // With maxConcurrent=1 and a fresh (non-stale) slot-0, the only free slot
    // is slot-1 once we raise maxConcurrent to 2 -- confirms slot-0 was left alone.
    const result = acquireFullVerifyThrottle(dir, 2, 6 * 60 * 60 * 1000);
    assert.equal(result.slot, 1, 'a fresh slot must not be reclaimed regardless of scan order');
    releaseFullVerifyThrottle(result);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('releaseFullVerifyThrottle is idempotent (safe to call when the slot is already gone)', () => {
  const dir = makeTmpThrottleDir();
  try {
    const throttle = acquireFullVerifyThrottle(dir, 1);
    releaseFullVerifyThrottle(throttle);
    assert.doesNotThrow(() => releaseFullVerifyThrottle(throttle));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
