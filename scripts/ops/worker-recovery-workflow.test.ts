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

test('worker recovery: UTV2-1560 Codex P2 — confirmation input is never interpolated directly into shell source', () => {
  const raw = readWorkerRecoveryYaml();
  const parsed = parseYaml(raw) as {
    jobs?: { recover?: { steps?: Array<{ name?: string; run?: string; env?: Record<string, unknown> }> } };
  };
  const steps = parsed.jobs?.recover?.steps ?? [];
  const step = steps.find((s) => s.name === 'Validate confirmation input');
  assert.ok(step, 'expected a dedicated confirmation-validation step');

  // The step's *run script* specifically (env: assignments legitimately
  // reference ${{ inputs.confirm }} -- that's the correct, safe path) must
  // never contain the raw expression-interpolation form -- a confirmation
  // value containing a quote and command separator could otherwise break out
  // of the bracket test and execute arbitrary runner commands while deploy
  // secrets are in scope.
  assert.doesNotMatch(
    step!.run ?? '',
    /\$\{\{\s*inputs\.confirm\s*\}\}/,
    'inputs.confirm must never be interpolated directly into the run: script -- pass it through env: instead',
  );
  assert.ok(
    step!.env && Object.values(step!.env).some((v) => typeof v === 'string' && /inputs\.confirm/.test(v)),
    'the confirmation-validation step must receive inputs.confirm via env:, not string interpolation',
  );
  assert.match(
    step!.run ?? '',
    /!=\s*"restart-worker-if-502-present"/,
    'the comparison must test a shell variable (populated from env:), not the raw expression',
  );
});

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
  const unhealthyIdx = script.indexOf(`elif [ \\"\\$HEALTH\\" = 'unhealthy' ]`);
  assert.ok(unhealthyIdx >= 0, 'must have an explicit branch for Health=unhealthy');
  const branch = script.slice(unhealthyIdx, unhealthyIdx + 400);
  assert.match(branch, /FAILED=1/, 'running+unhealthy must set FAILED=1');
  assert.match(branch, /::error::/, 'running+unhealthy must emit an explicit error annotation');
});

test('worker recovery: running + starting past the wait window fails closed, is not treated as success', () => {
  const script = readWorkerRecoveryScript();
  const startingIdx = script.indexOf(`elif [ \\"\\$HEALTH\\" = 'starting' ]`);
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
  const chainStart = script.indexOf(`if [ \\"\\$STATUS\\" != 'running' ]`);
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
    /d=json\.loads\(sys\.stdin\.read\(\)\); print\(json\.dumps\(d\.get\(\\"targets\\"\), sort_keys=True\)\)/,
    'both pre and post target extraction must parse JSON and compare the targets field specifically',
  );
  // UTV2-1560 Codex P2: the inner Python string's quotes around "targets" must
  // be backslash-escaped (matching every other embedded quote in this SSH
  // script) so the local shell's outer double-quoted ssh argument doesn't
  // strip them before the command ever reaches the remote host -- an
  // unescaped d.get("targets") arrives on the remote side as the bare
  // (undefined) identifier `targets`, raising NameError and permanently
  // failing target verification.
  assert.doesNotMatch(
    script,
    /d\.get\("targets"\)/,
    'the inner Python string quotes must be escaped (d.get(\\"targets\\")), not left bare -- bare quotes are stripped by the outer local double-quoted ssh argument before reaching the remote host',
  );
  const compareIdx = script.indexOf('PASS: configured worker target(s) unchanged');
  assert.ok(compareIdx >= 0);
  const surrounding = script.slice(compareIdx - 300, compareIdx + 400);
  assert.match(surrounding, /\\\$PRE_TARGETS.*=.*\\\$POST_TARGETS/, 'must compare the parsed targets field, not PRE_TARGET_LINE/POST_TARGET_LINE raw text');
  assert.match(script.slice(compareIdx, compareIdx + 400), /FAILED=1/);
  // A JSON parse failure on either side must also fail closed, not silently compare empty strings as equal.
  assert.match(script, /PARSE_ERROR\*\).*FAILED=1/s);
});

test('worker recovery: manual-restart verification uses StartedAt, not RestartCount, as the gating signal', () => {
  const script = readWorkerRecoveryScript();

  // Codex P2 (UTV2-1560): Docker's RestartCount only reflects restarts
  // performed by the container's restart policy (on-failure/always) -- it
  // does NOT increment for a manual `docker restart` invocation, which is
  // exactly what this workflow performs. Gating on RestartCount would fail
  // closed on every successful operator-initiated restart. RestartCount may
  // still be captured/logged for audit purposes, but must never set FAILED.
  const restartCountIdx = script.indexOf('RestartCount pre=');
  assert.ok(restartCountIdx >= 0, 'RestartCount should still be logged informationally');
  const restartCountLine = script.slice(restartCountIdx, restartCountIdx + 400);
  assert.doesNotMatch(
    restartCountLine,
    /FAILED=1/,
    'RestartCount must be informational only and must never itself set FAILED=1',
  );
  assert.match(
    restartCountLine,
    /informational only/i,
    'the RestartCount log line must explicitly document that it does not gate success/failure',
  );

  // The actual gating signal: container StartedAt must change across the
  // restart. StartedAt is set by the Docker daemon every time the
  // container's process starts, whether the restart was manual or
  // policy-triggered, making it a reliable signal for both cases.
  const passIdx = script.indexOf('PASS: container StartedAt advanced');
  assert.ok(passIdx >= 0, 'must have an explicit PASS branch keyed on StartedAt changing');
  const gateIdx = script.indexOf('-n \\"\\$PRE_STARTED_AT\\"');
  assert.ok(gateIdx >= 0, 'the gating check must require PRE_STARTED_AT to be non-empty');
  const gateBranch = script.slice(gateIdx, passIdx);
  assert.match(gateBranch, /-n \\"\\\$POST_STARTED_AT\\"/, 'the gating check must also require POST_STARTED_AT to be non-empty');
  assert.match(
    gateBranch,
    /\\"\\\$PRE_STARTED_AT\\"\s*!=\s*\\"\\\$POST_STARTED_AT\\"/,
    'the gating check must require pre != post',
  );
  const failIdx = script.indexOf('container StartedAt did not change across the restart');
  assert.ok(failIdx >= 0, 'must have an explicit failure message when StartedAt does not change');
  const failBranch = script.slice(failIdx, failIdx + 200);
  assert.match(failBranch, /FAILED=1/, 'StartedAt not changing must set FAILED=1');
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
