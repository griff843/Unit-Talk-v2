import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCodexModelArgs, loadModelRoutingPolicy } from './model-routing.js';
import {
  buildCodexChildEnv,
  buildCodexPrompt,
  buildModelRoutingEvidence,
  commitAndPushEvidence,
  evaluateExecutionTruth,
  resolveCodexExecutionPacket,
  resolveExecModelRouting,
} from './codex-exec.js';
import {
  beginAttempt,
  checkpointPath,
  checkpointRecoveryPath,
  finishAttempt,
  recordPhaseComplete,
  resolveExecutionTimeout,
  type ExecutionStateIdentity,
} from './execution-checkpoint.js';
import { ROOT, type LaneManifest } from './shared.js';
import {
  buildSyncYmlWithTaskContract,
  buildTaskContract,
  readTaskContract,
  renderTaskContract,
} from './execution-packet.js';

// codex-exec.ts is an executable entry point. Its `main()` flow is executed for
// real at the bottom of this file, against an isolated fixture lane root with a
// stubbed CLI on PATH -- no live Codex, no network, no paid model call. The pure
// resolution/evidence/arg-building helpers below are unit-tested directly.

const REAL_POLICY_VERSION = loadModelRoutingPolicy().policy_version;

function initTruthRepo(): { dir: string; checkpointDir: string; baseline: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1711-truth-'));
  const checkpointDir = path.join(dir, 'checkpoints');
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: dir, stdio: 'pipe' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  spawnSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  spawnSync('git', ['commit', '-m', 'seed'], { cwd: dir, stdio: 'pipe' });
  const baseline = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).stdout.trim();
  return { dir, checkpointDir, baseline };
}

function commitTruthFile(repo: string, relativePath: string, content: string): string {
  const filePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  spawnSync('git', ['add', relativePath], { cwd: repo, stdio: 'pipe' });
  spawnSync('git', ['commit', '-m', `change ${relativePath}`], { cwd: repo, stdio: 'pipe' });
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).stdout.trim();
}

function completeSuccessPhases(issueId: string, checkpointDir: string, identity: ExecutionStateIdentity): void {
  recordPhaseComplete(issueId, 'implement', 'implementation complete', { dir: checkpointDir, identity });
  recordPhaseComplete(issueId, 'verify', 'verification complete', { dir: checkpointDir, identity });
  recordPhaseComplete(issueId, 'closeout', 'closeout complete', { dir: checkpointDir, identity });
}

test('codex-exec module imports without error', async () => {
  assert.ok(true, 'module structure valid');
});

test('production truth path fails a zero-diff fresh claim and succeeds after real current-epoch source work', () => {
  const repo = initTruthRepo();
  try {
    const issueId = 'UTV2-1711';
    const started = beginAttempt({
      kind: 'fresh',
      issueId,
      currentHeadSha: repo.baseline,
      objectiveIdentity: `issue:${issueId}`,
      authority: 'codex-exec',
      timeoutPolicy: resolveExecutionTimeout({ tier: 'T2', reasoningEffort: 'high', phase: 'implement' }),
      dir: repo.checkpointDir,
    });
    completeSuccessPhases(issueId, repo.checkpointDir, started.identity);

    const noChange = evaluateExecutionTruth({
      issueId,
      cwd: repo.dir,
      checkpointDir: repo.checkpointDir,
      stateIdentity: started.identity,
    });
    assert.equal(noChange.code, 'IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE');
    assert.equal(noChange.ok, false);

    commitTruthFile(repo.dir, 'scripts/source-change.ts', 'export const changed = true;\n');
    const changed = evaluateExecutionTruth({
      issueId,
      cwd: repo.dir,
      checkpointDir: repo.checkpointDir,
      stateIdentity: started.identity,
    });
    assert.equal(changed.code, 'SUCCESS');
    assert.equal(changed.source_files_changed, 1);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('execution truth rejects an epoch baseline that is not an ancestor of HEAD', () => {
  const repo = initTruthRepo();
  try {
    const issueId = 'UTV2-1711';
    const futureBaseline = commitTruthFile(repo.dir, 'scripts/future-baseline.ts', 'export const future = true;\n');
    spawnSync('git', ['checkout', '--detach', repo.baseline], { cwd: repo.dir, stdio: 'pipe' });
    const started = beginAttempt({
      kind: 'fresh',
      issueId,
      currentHeadSha: futureBaseline,
      objectiveIdentity: `issue:${issueId}`,
      authority: 'codex-exec',
      timeoutPolicy: resolveExecutionTimeout({ tier: 'T2', reasoningEffort: 'high', phase: 'implement' }),
      dir: repo.checkpointDir,
    });
    completeSuccessPhases(issueId, repo.checkpointDir, started.identity);
    const verdict = evaluateExecutionTruth({
      issueId,
      cwd: repo.dir,
      checkpointDir: repo.checkpointDir,
      stateIdentity: started.identity,
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, 'EXECUTION_BASELINE_NOT_ANCESTOR');
    assert.match(verdict.message, /not an ancestor of HEAD/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('Codex child environment carries the originating checkpoint identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1711-child-env-'));
  try {
    const env = buildCodexChildEnv(dir, { epoch_id: 'epoch-1', attempt: 2, minimum_revision: 7 });
    assert.equal(env.UNIT_TALK_EXECUTION_EPOCH_ID, 'epoch-1');
    assert.equal(env.UNIT_TALK_EXECUTION_ATTEMPT, '2');
    assert.equal(env.UNIT_TALK_EXECUTION_MINIMUM_REVISION, '7');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verification-only resume succeeds from cumulative epoch diff without overwriting the baseline', () => {
  const repo = initTruthRepo();
  try {
    const issueId = 'UTV2-1711';
    const timeoutPolicy = resolveExecutionTimeout({ tier: 'T2', reasoningEffort: 'high', phase: 'implement' });
    const first = beginAttempt({
      kind: 'fresh',
      issueId,
      currentHeadSha: repo.baseline,
      objectiveIdentity: `issue:${issueId}`,
      authority: 'codex-exec',
      timeoutPolicy,
      dir: repo.checkpointDir,
    });
    recordPhaseComplete(issueId, 'implement', 'source implementation committed', {
      dir: repo.checkpointDir,
      identity: first.identity,
    });
    const implementedHead = commitTruthFile(repo.dir, 'scripts/resumed-source.ts', 'export const resumed = true;\n');
    finishAttempt({ issueId, outcome: 'timed_out', reason: 'interrupted in verify', dir: repo.checkpointDir, identity: first.identity });

    const resumed = beginAttempt({
      kind: 'resume',
      issueId,
      attemptStartSha: implementedHead,
      timeoutPolicy,
      dir: repo.checkpointDir,
    });
    recordPhaseComplete(issueId, 'verify', 'focused tests passed', { dir: repo.checkpointDir, identity: resumed.identity });
    recordPhaseComplete(issueId, 'closeout', 'proof complete', { dir: repo.checkpointDir, identity: resumed.identity });
    const verdict = evaluateExecutionTruth({
      issueId,
      cwd: repo.dir,
      checkpointDir: repo.checkpointDir,
      stateIdentity: resumed.identity,
    });
    assert.equal(verdict.code, 'SUCCESS');
    assert.equal(resumed.checkpoint.epoch.epoch_id, first.checkpoint.epoch.epoch_id);
    assert.equal(resumed.checkpoint.epoch.implementation_baseline_sha, repo.baseline);
    assert.equal(resumed.checkpoint.attempts.at(-1)?.attempt_start_sha, implementedHead);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('rework resets rejected truth: old source and proof-only edits fail, then a new source correction succeeds', () => {
  const repo = initTruthRepo();
  try {
    const issueId = 'UTV2-1711';
    const timeoutPolicy = resolveExecutionTimeout({ tier: 'T2', reasoningEffort: 'high', phase: 'implement' });
    const initial = beginAttempt({
      kind: 'fresh',
      issueId,
      currentHeadSha: repo.baseline,
      objectiveIdentity: `issue:${issueId}`,
      authority: 'codex-exec',
      timeoutPolicy,
      dir: repo.checkpointDir,
    });
    commitTruthFile(repo.dir, 'scripts/rejected-source.ts', 'export const rejected = true;\n');
    completeSuccessPhases(issueId, repo.checkpointDir, initial.identity);
    finishAttempt({ issueId, outcome: 'failed', reason: 'review rejected', dir: repo.checkpointDir, identity: initial.identity });
    const rejectedHead = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo.dir,
      encoding: 'utf8',
      stdio: 'pipe',
    }).stdout.trim();

    const rework = beginAttempt({
      kind: 'rework',
      issueId,
      rejectedHeadSha: rejectedHead,
      objectiveIdentity: `issue:${issueId}`,
      findingsIdentity: 'review-round-1',
      authority: 'codex-exec',
      timeoutPolicy,
      dir: repo.checkpointDir,
    });
    completeSuccessPhases(issueId, repo.checkpointDir, rework.identity);
    commitTruthFile(repo.dir, 'docs/proof-only.md', 'proof changed\n');
    const proofOnly = evaluateExecutionTruth({
      issueId,
      cwd: repo.dir,
      checkpointDir: repo.checkpointDir,
      stateIdentity: rework.identity,
    });
    assert.equal(proofOnly.code, 'REWORK_NO_SOURCE_CHANGE');
    assert.equal(rework.checkpoint.completed_phases.length, 0, 'rejected phase validity must not enter the new epoch');

    commitTruthFile(repo.dir, 'scripts/rework-source.ts', 'export const corrected = true;\n');
    const corrected = evaluateExecutionTruth({
      issueId,
      cwd: repo.dir,
      checkpointDir: repo.checkpointDir,
      stateIdentity: rework.identity,
    });
    assert.equal(corrected.code, 'SUCCESS');
    assert.equal(corrected.source_files_changed, 1);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('missing post-spawn primary and sidecar state returns EXECUTION_STATE_UNAVAILABLE', () => {
  const repo = initTruthRepo();
  try {
    const issueId = 'UTV2-1711';
    const started = beginAttempt({
      kind: 'fresh',
      issueId,
      currentHeadSha: repo.baseline,
      objectiveIdentity: `issue:${issueId}`,
      authority: 'codex-exec',
      timeoutPolicy: resolveExecutionTimeout({ tier: 'T2', reasoningEffort: 'high', phase: 'implement' }),
      dir: repo.checkpointDir,
    });
    fs.rmSync(checkpointPath(issueId, repo.checkpointDir), { force: true });
    fs.rmSync(checkpointRecoveryPath(issueId, repo.checkpointDir), { force: true });
    const verdict = evaluateExecutionTruth({
      issueId,
      cwd: repo.dir,
      checkpointDir: repo.checkpointDir,
      stateIdentity: started.identity,
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, 'EXECUTION_STATE_UNAVAILABLE');
    assert.match(verdict.message, /primary and sidecar are both missing/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('corrupt primary with a valid matching sidecar recovers explicitly and follows normal evaluation', () => {
  const repo = initTruthRepo();
  try {
    const issueId = 'UTV2-1711';
    const started = beginAttempt({
      kind: 'fresh',
      issueId,
      currentHeadSha: repo.baseline,
      objectiveIdentity: `issue:${issueId}`,
      authority: 'codex-exec',
      timeoutPolicy: resolveExecutionTimeout({ tier: 'T2', reasoningEffort: 'high', phase: 'implement' }),
      dir: repo.checkpointDir,
    });
    completeSuccessPhases(issueId, repo.checkpointDir, started.identity);
    commitTruthFile(repo.dir, 'scripts/recovered.ts', 'export const recovered = true;\n');
    fs.writeFileSync(checkpointPath(issueId, repo.checkpointDir), '{corrupt primary', 'utf8');
    const verdict = evaluateExecutionTruth({
      issueId,
      cwd: repo.dir,
      checkpointDir: repo.checkpointDir,
      stateIdentity: started.identity,
    });
    assert.equal(verdict.code, 'SUCCESS');
    assert.equal(verdict.checkpoint_provenance, 'sidecar');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('resolveExecModelRouting validates a manifest that already carries model_routing', () => {
  const result = resolveExecModelRouting({
    tier: 'T2',
    schema_version: 2,
    model_routing: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: REAL_POLICY_VERSION,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.legacy_compatibility_used, false);
  assert.strictEqual(result.model_routing?.model, 'gpt-5.6-terra');
});

test('scenario 13: schema_version-1 legacy manifest (no model_routing) resolves via the documented default and is flagged', () => {
  const result = resolveExecModelRouting({ tier: 'T2', schema_version: 1, model_routing: undefined });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.legacy_compatibility_used, true);
  assert.strictEqual(result.model_routing?.legacy_resolved, true);
  assert.ok(result.model_routing?.model, 'legacy resolution must still produce a concrete model');
});

// PM review finding #2 (deletion attack): a schema_version-2 manifest with
// model_routing missing must fail closed, NEVER silently fall back to the legacy
// default. Presence alone cannot distinguish "predates the field" from "was deleted" --
// schema_version is what makes that distinction real.
test('schema_version-2 manifest with model_routing deleted/missing fails closed, does not fall back to legacy', () => {
  const result = resolveExecModelRouting({ tier: 'T2', schema_version: 2, model_routing: undefined });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.legacy_compatibility_used, false);
  assert.strictEqual(result.code, 'MODEL_ROUTING_REQUIRED_FOR_SCHEMA_VERSION');
});

test('resolveExecModelRouting fails closed on a policy-version mismatch', () => {
  const result = resolveExecModelRouting({
    tier: 'T2',
    schema_version: 2,
    model_routing: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '0.0.1-stale',
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'POLICY_VERSION_MISMATCH');
});

test('resolveExecModelRouting fails closed on a disabled profile', () => {
  const result = resolveExecModelRouting({
    tier: 'T2',
    schema_version: 2,
    model_routing: {
      profile: 'codex-luna-low',
      model: 'gpt-5.6-luna',
      reasoning_effort: 'low',
      selected_by: 'three-brain',
      policy_version: REAL_POLICY_VERSION,
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PROFILE_DISABLED');
});

test('scenario 14, 15 & 17: buildCodexModelArgs never falls back to a Codex CLI default', () => {
  const args = buildCodexModelArgs({ model: 'gpt-5.6-sol', reasoning_effort: 'high' });
  assert.deepStrictEqual(args, ['--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=high']);
  assert.ok(args.includes('--model'));
  assert.ok(args.some((a) => a.startsWith('model_reasoning_effort=')));
});

test('scenario 8: buildModelRoutingEvidence records all required evidence fields', () => {
  const evidence = buildModelRoutingEvidence({
    issueId: 'UTV2-1526',
    manifestSchemaVersion: 1,
    modelRouting: {
      profile: 'codex-sol-high',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
    legacyCompatibilityUsed: false,
    codexCliVersion: 'codex-cli 0.144.1',
    codexExitCode: 0,
    now: '2026-07-13T00:00:00.000Z',
  });
  assert.strictEqual(evidence.issue_id, 'UTV2-1526');
  assert.strictEqual(evidence.model_profile, 'codex-sol-high');
  assert.strictEqual(evidence.model, 'gpt-5.6-sol');
  assert.strictEqual(evidence.reasoning_effort, 'high');
  assert.strictEqual(evidence.policy_version, '1.0.0');
  assert.strictEqual(evidence.codex_cli_version, 'codex-cli 0.144.1');
  assert.strictEqual(evidence.legacy_compatibility_used, false);
  assert.strictEqual(evidence.override_used, false);
  assert.strictEqual(evidence.codex_exit_code, 0);
});

test('buildModelRoutingEvidence records override authority when a manual override was used', () => {
  const evidence = buildModelRoutingEvidence({
    issueId: 'UTV2-1526',
    manifestSchemaVersion: 1,
    modelRouting: {
      profile: 'codex-sol-max',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'max',
      selected_by: 'manual-override',
      policy_version: '1.0.0',
      override: { authorized_by: 'griff', reason: 'stuck lane escalation' },
    },
    legacyCompatibilityUsed: false,
    codexCliVersion: 'codex-cli 0.144.1',
    codexExitCode: 1,
  });
  assert.strictEqual(evidence.override_used, true);
  assert.strictEqual(evidence.override_authorized_by, 'griff');
  assert.strictEqual(evidence.codex_exit_code, 1);
});

test('buildModelRoutingEvidence marks legacy resolutions explicitly', () => {
  const evidence = buildModelRoutingEvidence({
    issueId: 'UTV2-1526',
    manifestSchemaVersion: 1,
    modelRouting: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
      legacy_resolved: true,
    },
    legacyCompatibilityUsed: true,
    codexCliVersion: 'codex-cli 0.144.1',
    codexExitCode: null,
  });
  assert.strictEqual(evidence.legacy_compatibility_used, true);
  assert.strictEqual(evidence.codex_exit_code, null);
});

// PM review finding #4: the evidence sidecar must be committed and pushed by
// codex-exec.ts itself -- Codex's own commit/push already happened before this file
// even exists, so nothing else on the branch would ever pick it up otherwise.
test('commitAndPushEvidence publishes a first-push lane branch and establishes its upstream', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-evidence-'));
  const bareRemote = path.join(tmpRoot, 'origin.git');
  const workingRepo = path.join(tmpRoot, 'work');
  try {
    // --initial-branch and an explicit HEAD symref make this independent of the
    // runner's init.defaultBranch config (CI runners often default to something other
    // than "main", which left the bare repo's HEAD pointing nowhere and the later
    // fresh-clone verification checking out an empty tree).
    spawnSync('git', ['init', '--bare', '--initial-branch=main', bareRemote], { stdio: 'pipe' });
    spawnSync('git', ['-C', bareRemote, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { stdio: 'pipe' });
    spawnSync('git', ['clone', bareRemote, workingRepo], { stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['checkout', '-B', 'main'], { cwd: workingRepo, stdio: 'pipe' });
    fs.writeFileSync(path.join(workingRepo, 'README.md'), 'seed\n');
    spawnSync('git', ['add', 'README.md'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'seed'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['checkout', '-b', 'codex/utv2-9999-first-push'], { cwd: workingRepo, stdio: 'pipe' });

    fs.mkdirSync(path.join(workingRepo, 'docs', '06_status', 'proof', 'UTV2-9999'), { recursive: true });
    const evidenceRelPath = 'docs/06_status/proof/UTV2-9999/model-routing.json';
    fs.writeFileSync(path.join(workingRepo, evidenceRelPath), '{"ok":true}\n');

    const result = commitAndPushEvidence(workingRepo, evidenceRelPath, 'chore(proof): UTV2-9999 model-routing evidence');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.step, 'push');

    // Prove it reached the new remote lane branch and that subsequent bare pushes can
    // rely on the upstream established by the helper.
    const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], {
      cwd: workingRepo,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.strictEqual(upstream.status, 0);
    assert.strictEqual(upstream.stdout.trim(), 'origin/codex/utv2-9999-first-push');
    const freshClone = path.join(tmpRoot, 'verify-clone');
    spawnSync('git', ['clone', '--branch', 'codex/utv2-9999-first-push', bareRemote, freshClone], { stdio: 'pipe' });
    const cloned = fs.readFileSync(path.join(freshClone, evidenceRelPath), 'utf8');
    assert.match(cloned, /"ok":true/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('commitAndPushEvidence is idempotent -- a second call with unchanged content reports "none" rather than failing', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-evidence-idempotent-'));
  const bareRemote = path.join(tmpRoot, 'origin.git');
  const workingRepo = path.join(tmpRoot, 'work');
  try {
    spawnSync('git', ['init', '--bare', bareRemote], { stdio: 'pipe' });
    spawnSync('git', ['clone', bareRemote, workingRepo], { stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: workingRepo, stdio: 'pipe' });
    fs.writeFileSync(path.join(workingRepo, 'README.md'), 'seed\n');
    spawnSync('git', ['add', 'README.md'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'seed'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['checkout', '-b', 'main'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: workingRepo, stdio: 'pipe' });

    fs.mkdirSync(path.join(workingRepo, 'docs', '06_status', 'proof', 'UTV2-9998'), { recursive: true });
    const evidenceRelPath = 'docs/06_status/proof/UTV2-9998/model-routing.json';
    fs.writeFileSync(path.join(workingRepo, evidenceRelPath), '{"ok":true}\n');

    const first = commitAndPushEvidence(workingRepo, evidenceRelPath, 'chore(proof): first');
    assert.strictEqual(first.ok, true);

    const second = commitAndPushEvidence(workingRepo, evidenceRelPath, 'chore(proof): second');
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.step, 'none');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// Ordering (PM review finding #4): a successful execution must never leave dangling
// evidence. Prove structurally that commitAndPushEvidence is called, and its result
// checked, BEFORE either the SUCCESS or EXECUTION_FAILED result is emitted.
test('codex-exec.ts persists evidence before emitting either a SUCCESS or EXECUTION_FAILED result', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');

  const persistCallIndex = source.indexOf('commitAndPushEvidence(');
  assert.notStrictEqual(persistCallIndex, -1, 'expected codex-exec.ts to call commitAndPushEvidence');

  // UTV2-1594 turned the single failure code into a ternary over
  // EXECUTION_SILENT / EXECUTION_TIMED_OUT / EXECUTION_FAILED, so match the
  // code literal rather than the `code:` property form. The invariant under
  // test is unchanged: evidence is persisted before ANY outcome is emitted.
  const executionFailedIndex = source.indexOf("'EXECUTION_FAILED'", persistCallIndex);
  const executionTimedOutIndex = source.indexOf("'EXECUTION_TIMED_OUT'", persistCallIndex);
  const executionSilentIndex = source.indexOf("'EXECUTION_SILENT'", persistCallIndex);
  assert.notStrictEqual(executionTimedOutIndex, -1, 'the timeout outcome must also be emitted after persistence');
  assert.notStrictEqual(executionSilentIndex, -1, 'the silence outcome must also be emitted after persistence');
  const evidencePersistenceFailedIndex = source.indexOf("code: 'EVIDENCE_PERSISTENCE_FAILED'", persistCallIndex);
  const successIndex = source.indexOf("code: 'SUCCESS'", persistCallIndex);

  assert.notStrictEqual(executionFailedIndex, -1);
  assert.notStrictEqual(evidencePersistenceFailedIndex, -1);
  assert.notStrictEqual(successIndex, -1);

  assert.ok(persistCallIndex < executionFailedIndex, 'evidence must be persisted before the EXECUTION_FAILED result is emitted');
  assert.ok(
    persistCallIndex < evidencePersistenceFailedIndex,
    'evidence persistence must be attempted before its own failure is reported',
  );
  assert.ok(
    evidencePersistenceFailedIndex < successIndex,
    'a persistence failure must be checked and reported BEFORE a SUCCESS result could ever be emitted -- ' +
      'this is what prevents a successful Codex run with a dangling, uncommitted evidence file from being reported READY_FOR_REVIEW',
  );
});

// UTV2-1546: delegation kill switch must gate the actual `codex exec` spawn, placed
// as late as possible so every precondition/health/model-routing check above still
// reports its own specific failure first. Full behavioral coverage of the state
// reader itself (missing/malformed/suspended/active) lives in
// delegation-state.test.ts.
test('codex-exec checks delegation immediately before spawning codex, and exits 2 when suspended', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const dryRunExitIndex = source.indexOf("process.exit(0);");
  const delegationCallIndex = source.indexOf("requireDelegationActive('codex-exec')");
  const spawnIndex = source.indexOf("spawnSync('codex', codexArgs");

  assert.ok(delegationCallIndex >= 0, 'codex-exec.ts must call requireDelegationActive');
  assert.ok(
    dryRunExitIndex >= 0 && dryRunExitIndex < delegationCallIndex,
    'delegation check must be placed after the --dry-run early return, so dry-run preview stays available while suspended',
  );
  assert.ok(
    delegationCallIndex < spawnIndex,
    'delegation kill switch must run strictly before the codex spawn',
  );

  const delegationBlock = source.slice(delegationCallIndex, delegationCallIndex + 300);
  assert.match(delegationBlock, /DELEGATION_SUSPENDED/);
  assert.match(delegationBlock, /process\.exit\(2\)/);
});

// ── UTV2-1594: resumable execution wiring ───────────────────────────────────

test('codex-exec no longer hard-codes a 30-minute timeout for every lane', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  assert.doesNotMatch(source, /timeout: 30 \* 60 \* 1000/, 'the one-size-fits-all timeout must be gone');
  assert.match(source, /timeout: timeoutPolicy\.timeout_ms/, 'the spawn timeout must come from the policy');
  assert.match(
    source,
    /resolveExecutionTimeout\(\{[\s\S]{0,200}?tier: manifest\.tier/,
    'the timeout must be derived from the lane tier',
  );
  assert.match(source, /reasoningEffort: modelRouting\.reasoning_effort/, 'reasoning effort must feed the timeout');
  assert.match(source, /phase: resumePlan\.resume_from_phase/, 'the resumed phase must feed the timeout');
});

test('codex-exec resumes from the checkpoint before it builds the prompt', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const readIndex = source.indexOf('readCheckpointState(issueId)');
  const briefIndex = source.indexOf('buildResumeBrief(existingCheckpoint)');
  const promptIndex = source.indexOf('buildCodexPrompt(packet, resumeBrief)');
  assert.ok(readIndex >= 0 && briefIndex > readIndex, 'the prior checkpoint must be read and turned into a brief');
  assert.ok(briefIndex < promptIndex, 'the resume brief must exist before the prompt is assembled');
});

test('buildCodexPrompt places the resume brief ahead of the repo brief', () => {
  const taskContract = buildTaskContract({
    identifier: 'UTV2-1594',
    title: 'Resume the supplied work order',
    url: 'https://linear.app/unit-talk-v2/issue/UTV2-1594',
    description: '## Acceptance criteria\n- Preserve completed work.',
  }, '2026-05-25T00:00:00.000Z');
  const packet = {
    issue_id: 'UTV2-1594',
    tier: 'T1',
    branch: 'codex/utv2-1594',
    cwd: '/tmp/worktree',
    allowed_file_scope: ['scripts/ops/verify-semaphore.ts'],
    required_verification: ['pnpm verify'],
    closeout_instructions: ['open a PR'],
    repo_brief: 'REPO BRIEF BODY',
    task_contract: taskContract,
  } as unknown as Parameters<typeof buildCodexPrompt>[0];

  const withoutResume = buildCodexPrompt(packet);
  assert.doesNotMatch(withoutResume, /RESUMED RUN/);
  assert.match(withoutResume, /REPO BRIEF BODY/);
  assert.ok(withoutResume.includes(renderTaskContract(taskContract)));

  const withResume = buildCodexPrompt(packet, '## Execution checkpoint — RESUMED RUN\n\nprior findings here');
  assert.ok(
    withResume.indexOf('RESUMED RUN') < withResume.indexOf('REPO BRIEF BODY'),
    'a resumed run must read what is already settled before it reads the full repo brief',
  );
  assert.match(withResume, /prior findings here/);
});

test('codex-exec refuses an invalid packet with JSON and never continues to spawn', () => {
  const manifest = { issue_id: 'UTV2-1734', branch: 'codex/utv2-1734' } as LaneManifest;
  const emitted: string[] = [];
  let continuedToSpawn = false;
  const exitCode = resolveCodexExecutionPacket(
    manifest,
    () => { continuedToSpawn = true; },
    value => { emitted.push(JSON.stringify(value)); },
    () => ({
      ok: false,
      code: 'EXECUTION_PACKET_INVALID',
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      message: 'Execution packet refused: task contract is missing',
    }),
  );

  assert.equal(exitCode, 2);
  assert.equal(continuedToSpawn, false);
  assert.equal(emitted.length, 1);
  assert.deepEqual(JSON.parse(emitted[0]!), {
    ok: false,
    code: 'EXECUTION_PACKET_INVALID',
    issue_id: 'UTV2-1734',
    branch: 'codex/utv2-1734',
    message: 'Execution packet refused: task contract is missing',
  });
});

test('codex-exec opens a durable attempt immediately before the spawn', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const beginIndex = source.indexOf('beginAttempt({');
  const spawnIndex = source.indexOf("spawnSync('codex', codexArgs");
  assert.ok(beginIndex >= 0, 'codex-exec must open a checkpoint attempt');
  assert.ok(beginIndex < spawnIndex, 'the attempt must exist before the process that could die');
});

test('production call path evaluates mandatory post-spawn epoch state without caller-supplied phase or baseline', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const spawnIndex = source.indexOf("spawnSync('codex', codexArgs");
  const postSpawnReadIndex = source.indexOf('readCheckpointState(issueId, undefined, attemptStart.identity)', spawnIndex);
  const truthCallIndex = source.indexOf('evaluateExecutionTruth({ issueId, cwd: resolvedCwd, stateIdentity: attemptStart.identity })');
  const successIndex = source.lastIndexOf("code: 'SUCCESS'");
  assert.ok(spawnIndex >= 0 && postSpawnReadIndex > spawnIndex, 'state must be re-read after the executor returns');
  assert.ok(truthCallIndex > postSpawnReadIndex, 'Git corroboration must use the validated post-spawn state identity');
  assert.ok(truthCallIndex < successIndex, 'no SUCCESS emission may precede execution-truth evaluation');
  assert.doesNotMatch(
    source.slice(truthCallIndex, truthCallIndex + 180),
    /phase:|baseline:/,
    'the caller must not be able to inject a stale phase or baseline into truth evaluation',
  );
});

test('a timeout, a silent run and a plain failure are reported as three different outcomes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  assert.match(source, /'EXECUTION_TIMED_OUT'/);
  assert.match(source, /'EXECUTION_SILENT'/);
  assert.match(source, /'EXECUTION_FAILED'/);
  assert.match(source, /ETIMEDOUT/, 'a spawn killed by its own timeout must be recognised as a timeout');
  assert.match(
    source,
    /liveness\.silent \? 'silent_no_heartbeat'/,
    'a run with no heartbeat must be filed as silence, not as an ordinary failure',
  );
});

test('every non-success exit path closes the attempt and releases owned resources', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const releaseCalls = source.match(/failVisiblyAndRelease\(/g) ?? [];
  assert.ok(releaseCalls.length >= 2, 'both the execution-failure and evidence-failure paths must release');
  assert.match(source, /finishAttempt\(\{\s*issueId,\s*outcome: 'completed'/, 'success must close the attempt too');
});

test('operator cancellation is honoured before any codex process is spawned', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const cancelIndex = source.indexOf('existingCheckpoint?.cancel_requested');
  const spawnIndex = source.indexOf("spawnSync('codex', codexArgs");
  assert.ok(cancelIndex >= 0, 'codex-exec must honour a cancellation request');
  assert.ok(cancelIndex < spawnIndex, 'cancellation must be checked before the spawn');
  assert.match(source.slice(cancelIndex, cancelIndex + 600), /EXECUTION_CANCELLED/);
});

// ── UTV2-1737: EXECUTING dry-run regression coverage for the Codex entrypoint ─
// main() calls process.exit on its failure paths, so the executing assertion
// here is that the dry run REACHES its DRY_RUN emit without throwing an
// unstructured error -- which a wrong-module or missing import would cause.

// ---------------------------------------------------------------------------
// Executing dry-run coverage (UTV2-1747)
//
// The test replaced here named an issue with no manifest on disk, so main()
// exited at the manifestExists guard and every assertion below it passed on a
// "no manifest found" refusal. It never reached packet generation: deleting the
// whole dry-run purity branch left the suite green. These run the real
// entrypoint against a complete lane root instead.
//
// Isolation is free: getRepoRoot() shells out to `git rev-parse --show-toplevel`
// inheriting process.cwd(), so running the entrypoint with cwd inside a fixture
// repository rebinds ROOT to it. No fixture is written into the live checkout
// -- a leaked lane manifest there is read by the concurrency governor as a real
// active lane -- and no production code carries a test-only root parameter.
// ---------------------------------------------------------------------------

const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');

interface LaneRoot {
  /** Repo root for the run; also the git repository whose cleanliness is asserted. */
  root: string;
  /** PATH entry holding stub executor CLIs. Kept outside `root` so it is not untracked content. */
  bin: string;
  objective: string;
  syncPath: string;
}

/**
 * Both entrypoints health-check by executing the real CLI. Stubs keep the dry
 * run offline: no paid model call, no network, deterministic version string.
 */
function stubExecutorClis(dir: string): string {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'codex'),
    '#!/bin/sh\ncase "$1" in\n  --version) echo "codex-stub 1.0.0"; exit 0;;\n  exec) echo "usage: codex exec"; exit 0;;\nesac\nexit 0\n',
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, 'claude'),
    '#!/bin/sh\n[ "$1" = "--version" ] && echo "claude-stub 1.0.0" && exit 0\nexit 0\n',
    { mode: 0o755 },
  );
  return bin;
}

function buildLaneRoot(issueId: string, executor: 'claude' | 'codex-cli'): LaneRoot {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1747-lane-'));
  const root = path.join(dir, 'repo');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(path.join(root, 'docs', '06_status', 'lanes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', '05_operations', 'policies'), { recursive: true });
  fs.mkdirSync(wt, { recursive: true });

  // Copied, never invented. A hand-authored fixture can assert against a field
  // the production reader never looks at, which makes the assertion vacuous.
  for (const rel of [
    ['docs', '05_operations', 'policies', 'codex-model-routing.json'],
    ['docs', '05_operations', 'db-writer-classification.json'],
  ]) {
    fs.copyFileSync(path.join(ROOT, ...rel), path.join(root, ...rel));
  }

  const isClaude = executor === 'claude';
  const manifest: Record<string, unknown> = {
    schema_version: 2,
    issue_id: issueId,
    lane_type: 'governance',
    executor,
    tier: isClaude ? 'T1' : 'T2',
    worktree_path: wt,
    branch: `${isClaude ? 'claude' : 'codex'}/${issueId.toLowerCase()}-fixture`,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/fixture.ts'],
    expected_proof_paths: [],
    status: 'started',
    started_at: '2026-08-24T00:00:00.000Z',
    heartbeat_at: '2026-08-24T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/fixture.json',
    created_by: isClaude ? 'claude' : 'codex',
    truth_check_history: [],
    reopen_history: [],
    execution_location: {
      mode: 'worktree',
      cwd: wt,
      package_install: 'verified',
      setup_command: null,
      main_checkout_control_only: true,
    },
  };
  // A schema_version 2 Codex manifest must carry model_routing; a Claude
  // manifest must never carry it. Both rules are enforced at runtime.
  if (!isClaude) {
    manifest['model_routing'] = {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: REAL_POLICY_VERSION,
    };
  }
  fs.writeFileSync(
    path.join(root, 'docs', '06_status', 'lanes', `${issueId}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const objective = 'Prove the captured objective reaches the executor prompt.';
  // Built by production code on purpose: buildTaskContract computes
  // description_sha256 and contract_hash, and assertTaskContract verifies both
  // against the content. A hand-written contract cannot satisfy that, which is
  // what stops this fixture inventing a field the reader never consults.
  const contract = buildTaskContract(
    {
      identifier: issueId,
      title: 'Fixture lane',
      url: `https://linear.app/unit-talk/issue/${issueId}`,
      description: [
        '## Objective',
        objective,
        '',
        '## Acceptance criteria',
        '- The rendered packet carries this contract.',
      ].join('\n'),
    },
    '2026-08-24T00:00:00.000Z',
  );
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  fs.mkdirSync(path.dirname(syncPath), { recursive: true });
  fs.writeFileSync(syncPath, buildSyncYmlWithTaskContract(issueId, contract));

  fs.writeFileSync(path.join(wt, 'README.md'), 'fixture\n');
  for (const args of [
    ['init', '--initial-branch=main'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'Test'],
    ['add', '-A'],
    ['commit', '-m', 'fixture base'],
  ]) {
    spawnSync('git', args, { cwd: root, stdio: 'pipe' });
  }

  return { root, bin: stubExecutorClis(dir), objective, syncPath };
}

function runExecutor(
  script: 'claude-exec.ts' | 'codex-exec.ts',
  lane: LaneRoot,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(TSX_BIN, [path.join(ROOT, 'scripts', 'ops', script), ...args], {
    cwd: lane.root,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, PATH: `${lane.bin}${path.delimiter}${process.env['PATH'] ?? ''}` },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Tracked and untracked changes both count -- a stray write is still a mutation. */
function laneRootChanges(lane: LaneRoot): string {
  return spawnSync('git', ['status', '--porcelain'], {
    cwd: lane.root,
    encoding: 'utf8',
    stdio: 'pipe',
  }).stdout.trim();
}

function parseLeadingJson(out: string): Record<string, unknown> {
  const start = out.indexOf('{');
  const end = out.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `expected a JSON object in output:\n${out}`);
  return JSON.parse(out.slice(start, end + 2)) as Record<string, unknown>;
}

test('codex-exec --dry-run executes to a rendered packet carrying the captured contract', () => {
  const issueId = 'UTV2-999901';
  const lane = buildLaneRoot(issueId, 'codex-cli');
  const run = runExecutor('codex-exec.ts', lane, ['--issue', issueId, '--dry-run']);

  assert.equal(run.status, 0, `dry run must reach DRY_RUN; stderr: ${run.stderr}`);
  const parsed = parseLeadingJson(run.stdout);
  assert.equal(parsed['code'], 'DRY_RUN');
  assert.equal(parsed['ok'], true);
  assert.equal(parsed['dry_run'], true);

  // The decisive assertion. The prompt preview is truncated before the objective
  // renders, so the packet is tied to the on-disk contract by integrity hash
  // instead: the hash appears only if generateExecutionPacket read THIS contract,
  // validated it, and rendered it into the prompt.
  const contract = readTaskContract(issueId, lane.root);
  assert.ok(
    run.stdout.includes(`integrity hash ${contract.contract_hash}`),
    `codex prompt must carry the on-disk contract; got:\n${run.stdout}`,
  );
  assert.ok(
    renderTaskContract(contract).includes(lane.objective),
    'the contract rendered into that prompt must carry the captured objective',
  );
  assert.ok(
    run.stdout.includes('## Authoritative task contract'),
    'the prompt must present the contract as authoritative',
  );
  // The stub would report a launch; a dry run must plan one and stop.
  assert.ok(
    run.stdout.includes('(would run)'),
    'dry run must describe the invocation rather than perform it',
  );
});

test('codex-exec --dry-run leaves the lane root byte-identical', () => {
  const issueId = 'UTV2-999902';
  const lane = buildLaneRoot(issueId, 'codex-cli');
  assert.equal(laneRootChanges(lane), '', 'fixture must start clean');

  const run = runExecutor('codex-exec.ts', lane, ['--issue', issueId, '--dry-run']);
  assert.equal(run.status, 0, `dry run must succeed; stderr: ${run.stderr}`);

  // Resolving a packet normally persists the sync record in both roots and, for
  // a pre-contract lane, makes a live Linear call. Under --dry-run none of that
  // may happen -- a preview that writes is not a preview.
  assert.equal(
    laneRootChanges(lane),
    '',
    'dry run must leave no tracked or untracked change in the lane root',
  );
});

test('codex-exec --dry-run refuses a lane with no captured contract instead of fetching one', () => {
  const issueId = 'UTV2-999903';
  const lane = buildLaneRoot(issueId, 'codex-cli');
  fs.rmSync(lane.syncPath);

  const run = runExecutor('codex-exec.ts', lane, ['--issue', issueId, '--dry-run']);

  assert.equal(run.status, 2, `expected a structured refusal; stderr: ${run.stderr}`);
  const parsed = parseLeadingJson(run.stdout);
  assert.equal(parsed['ok'], false);
  assert.match(String(parsed['message']), /task contract is absent/u);
  // The refusal must not have captured one: a live capture writes the record.
  assert.equal(
    fs.existsSync(lane.syncPath),
    false,
    'a dry run must never capture a contract, which would require a live Linear call',
  );
});

test('executor modules resolve every imported symbol (narrow compile smoke)', () => {
  // Narrow compile control, scoped to the two executor entrypoints only -- it
  // does not pull the scripts tree into project references.
  //
  // Why it exists: `scripts/` is in no tsconfig project, so `pnpm verify:static`
  // exits 0 while a symbol imported from the wrong module, or not imported at
  // all, sits in the file. Both shipped past a green 105-test suite. Executing
  // tests catch it only on code paths they actually reach; this catches it
  // wherever it is.
  //
  // Deliberately asserts ONLY on unresolved-symbol diagnostics (TS2304 "Cannot
  // find name", TS2305 "has no exported member"), so pre-existing module-format
  // noise in the wider tree cannot make it flap.
  const result = spawnSync(
    'npx',
    ['tsc', '--noEmit', '--module', 'nodenext', '--moduleResolution', 'nodenext',
     '--target', 'es2022', '--skipLibCheck',
     path.join(ROOT, 'scripts', 'ops', 'claude-exec.ts'),
     path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'),
     // lane-start.ts is a Tier C path every lane start depends on, and
     // execution-packet.ts is the module both entrypoints resolve through.
     // `scripts/` is in no tsconfig project, so without these two entries an
     // unresolved symbol in either file ships past a fully green suite.
     path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'),
     path.join(ROOT, 'scripts', 'ops', 'execution-packet.ts')],
    { cwd: ROOT, encoding: 'utf8', timeout: 240_000 },
  );
  // A filtered-diagnostics assertion is vacuously true whenever the compiler
  // never ran: with `npx` missing or exiting 127 there is no output to filter,
  // `unresolved` is empty, and this -- the only control that catches a
  // wrong-module or missing import wherever it sits -- passes while proving
  // nothing. Establish that tsc actually executed before trusting its silence.
  assert.equal(result.error, undefined,
    `compile smoke could not spawn tsc: ${String(result.error)}`);
  assert.notEqual(result.status, null,
    'compile smoke was killed or timed out; its silence proves nothing');
  const probe = spawnSync('npx', ['--no-install', 'tsc', '--version'], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(probe.error, undefined,
    `tsc is not reachable, so the compile smoke is vacuous: ${String(probe.error)}`);
  assert.match(`${probe.stdout ?? ''}`, /Version \d+\.\d+/u,
    `tsc did not report a version, so the compile smoke is vacuous: ${probe.stdout}`);

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const unresolved = output
    .split(/\r?\n/u)
    .filter((line) =>
      /scripts[\\/]ops[\\/](?:claude-exec|codex-exec|lane-start|execution-packet)\.ts/u.test(line))
    .filter((line) => /error TS2304|error TS2305/u.test(line));
  assert.deepEqual(unresolved, [],
    `executor entrypoints have unresolved imports:\n${unresolved.join('\n')}`);
});
