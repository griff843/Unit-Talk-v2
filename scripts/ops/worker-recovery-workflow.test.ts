import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT } from './shared.js';

// UTV2-1560: static/regression coverage for ops-worker-recovery.yml's
// post-restart verification logic. The workflow runs entirely as a remote
// bash script over SSH -- it cannot be imported and unit-tested as a
// TypeScript module. These tests instead assert, against the actual
// checked-in script text, that each of the six PM-required decision cases
// has a corresponding, correctly-ordered code path. A change that removes
// or reorders one of these checks fails this suite.

function readWorkerRecoveryYaml(): string {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ops-worker-recovery.yml'), 'utf8');
}

function readWorkerRecoveryScript(): string {
  const raw = readWorkerRecoveryYaml();
  const parsed = parseYaml(raw) as {
    jobs?: { recover?: { steps?: Array<{ name?: string; run?: string }> } };
  };
  const steps = parsed.jobs?.recover?.steps ?? [];
  const step = steps.find((s) => s.name === 'Capture pre-state, conditionally restart, capture post-state');
  assert.ok(step && typeof step.run === 'string', 'expected the capture/restart/verify step to exist with a run script');
  return step!.run!;
}

test('worker recovery: workflow is workflow_dispatch-only with a typed confirmation input', () => {
  const parsed = parseYaml(readWorkerRecoveryYaml()) as { on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } } };
  assert.ok(parsed.on?.workflow_dispatch, 'must be workflow_dispatch-triggered');
  assert.ok(parsed.on?.workflow_dispatch?.inputs?.confirm, 'must require a confirmation input');
  assert.ok(!('push' in (parsed.on ?? {})), 'must never trigger on push');
  assert.ok(!('pull_request' in (parsed.on ?? {})), 'must never trigger on pull_request');
  assert.ok(!('schedule' in (parsed.on ?? {})), 'must never trigger on a schedule');
});

test('worker recovery: restart predicate requires an actual 502/Bad-Gateway signature, not any claim failure, within a bounded window', () => {
  const script = readWorkerRecoveryScript();
  assert.match(
    script,
    /docker logs \\"\\\$TARGET\\" --since 15m/,
    'the abort-check must read only a bounded recent window (15m), not an unbounded tail',
  );
  assert.match(
    script,
    /claim_next_outbox failed:\.\*\(502\[\^0-9\]\|bad gateway\)/,
    'the restart predicate must require an actual 502/Bad-Gateway signature co-located with the claim failure on the same line',
  );
});

test('worker recovery: running + unhealthy fails closed', () => {
  const script = readWorkerRecoveryScript();
  const unhealthyIdx = script.indexOf(`elif [ \\"\\\$HEALTH\\" = 'unhealthy' ]`);
  assert.ok(unhealthyIdx >= 0, 'must have an explicit branch for Health=unhealthy');
  const branch = script.slice(unhealthyIdx, unhealthyIdx + 400);
  assert.match(branch, /FAILED=1/, 'running+unhealthy must set FAILED=1');
  assert.match(branch, /::error::/, 'running+unhealthy must emit an explicit error annotation');
});

test('worker recovery: running + starting past the wait window fails closed, is not treated as success', () => {
  const script = readWorkerRecoveryScript();
  const startingIdx = script.indexOf(`elif [ \\"\\\$HEALTH\\" = 'starting' ]`);
  assert.ok(startingIdx >= 0, 'must have an explicit branch for Health=starting after the wait loop');
  const branch = script.slice(startingIdx, startingIdx + 400);
  assert.match(branch, /FAILED=1/, 'running+starting-past-timeout must set FAILED=1');
  assert.match(branch, /cannot verify recovery succeeded/i, 'must explain that an unresolved starting state is not verifiable success');
});

test('worker recovery: running + healthy (or no healthcheck configured) is the only passing health branch', () => {
  const script = readWorkerRecoveryScript();
  const passIdx = script.indexOf('PASS: container status is running and health is');
  assert.ok(passIdx >= 0, 'must have an explicit PASS branch for running+healthy/none');
  // The PASS branch must be the final `else` in the health if/elif chain, meaning every
  // other branch (not running / unhealthy / starting / any other value) is handled first.
  const chainStart = script.indexOf(`if [ \\"\\\$STATUS\\" != 'running' ]`);
  const chainSlice = script.slice(chainStart, passIdx);
  assert.match(chainSlice, /elif \[ \\"\\\$HEALTH\\" = 'unhealthy' \]/);
  assert.match(chainSlice, /elif \[ \\"\\\$HEALTH\\" = 'starting' \]/);
  assert.match(chainSlice, /elif \[ \\"\\\$HEALTH\\" != 'healthy' \] && \[ \\"\\\$HEALTH\\" != 'none' \]/);
  // "none" (no healthcheck configured) is explicitly accepted as a passing state,
  // never mislabeled as "healthy" in the script's own logic or messages.
  assert.doesNotMatch(script, /Status=running is (treated as|labeled) healthy/i);
});

test('worker recovery: the wait loop polls Health, not Status alone', () => {
  const script = readWorkerRecoveryScript();
  assert.match(script, /HEALTH=\\\$\(docker inspect.*State\.Health\.Status/, 'the wait loop must poll .State.Health.Status');
  assert.match(script, /Status=\\\$STATUS Health=\\\$HEALTH/, 'the wait loop must log both Status and Health on every check');
});

test('worker recovery: changed image fails closed', () => {
  const script = readWorkerRecoveryScript();
  const idx = script.indexOf('PASS: image unchanged');
  assert.ok(idx >= 0);
  const surrounding = script.slice(idx - 200, idx + 400);
  assert.match(surrounding, /\\\$PRE_IMAGE.*=.*\\\$POST_IMAGE/, 'must compare pre/post image');
  assert.match(surrounding, /Image changed across restart.*FAILED=1|FAILED=1[\s\S]{0,50}$|::error::Image changed/);
  assert.match(script.slice(idx, idx + 400), /FAILED=1/);
});

test('worker recovery: changed target fails closed, compared via the canonical parsed targets field not the raw log line', () => {
  const script = readWorkerRecoveryScript();
  assert.match(
    script,
    /d=json\.loads\(sys\.stdin\.read\(\)\); print\(json\.dumps\(d\.get\("targets"\), sort_keys=True\)\)/,
    'both pre and post target extraction must parse JSON and compare the targets field specifically',
  );
  const compareIdx = script.indexOf('PASS: configured worker target(s) unchanged');
  assert.ok(compareIdx >= 0);
  const surrounding = script.slice(compareIdx - 300, compareIdx + 400);
  assert.match(surrounding, /\\\$PRE_TARGETS.*=.*\\\$POST_TARGETS/, 'must compare the parsed targets field, not PRE_TARGET_LINE/POST_TARGET_LINE raw text');
  assert.match(script.slice(compareIdx, compareIdx + 400), /FAILED=1/);
  // A JSON parse failure on either side must also fail closed, not silently compare empty strings as equal.
  assert.match(script, /PARSE_ERROR\*\).*FAILED=1/s);
});

test('worker recovery: RestartCount not advancing by exactly 1 fails closed', () => {
  const script = readWorkerRecoveryScript();
  assert.match(script, /EXPECTED_RESTART_COUNT=\\\$\(\(PRE_RESTART_COUNT \+ 1\)\)/, 'must compute pre+1 explicitly');
  const idx = script.indexOf('PASS: RestartCount advanced by exactly 1');
  assert.ok(idx >= 0);
  const surrounding = script.slice(idx, idx + 500);
  assert.match(surrounding, /FAILED=1/);
  assert.match(surrounding, /crash loop/i, 'the failure message should distinguish a possible crash loop from a no-op');
});

test('worker recovery: docker restart exit-code failure propagates to FAILED, not just informational logging', () => {
  const script = readWorkerRecoveryScript();
  const idx = script.indexOf('docker restart exit code');
  assert.ok(idx >= 0);
  const surrounding = script.slice(idx, idx + 300);
  assert.match(surrounding, /RESTART_EXIT.*-ne 0/);
  assert.match(surrounding, /FAILED=1/);
});

test('worker recovery: the only mutating command in the entire script is a single docker restart call', () => {
  const script = readWorkerRecoveryScript();
  const restartCalls = script.match(/docker restart \\"\\\$TARGET\\"/g) ?? [];
  assert.strictEqual(restartCalls.length, 1, 'exactly one docker restart invocation, no retry loop');
  assert.doesNotMatch(script, /docker (compose up|pull|rm |stop )/);
  assert.doesNotMatch(script, /\.env\.production/);
});

test('worker recovery: FAILED propagates as the real script exit code, no blanket set +e', () => {
  const script = readWorkerRecoveryScript();
  assert.doesNotMatch(script, /^\s*set \+e/m);
  assert.match(script, /exit \\"\\\$FAILED\\"/);
});
