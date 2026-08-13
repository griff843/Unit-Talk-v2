import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCodexModelArgs, loadModelRoutingPolicy } from './model-routing.js';
import {
  buildCodexPrompt,
  buildModelRoutingEvidence,
  commitAndPushEvidence,
  countSourceFilesChanged,
  evaluateExecutionTruth,
  resolveExecModelRouting,
} from './codex-exec.js';
import { ROOT } from './shared.js';

// codex-exec.ts is an executable entry point — its `main()` process/spawn flow is
// exercised via integration (pnpm ops:codex-exec --dry-run, which requires a live Codex
// CLI). The pure resolution/evidence/arg-building helpers below are fully unit-testable
// without spawning Codex or making any paid model call.

const REAL_POLICY_VERSION = loadModelRoutingPolicy().policy_version;

test('codex-exec module imports without error', async () => {
  assert.ok(true, 'module structure valid');
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
  const readIndex = source.indexOf('readCheckpoint(issueId)');
  const briefIndex = source.indexOf('buildResumeBrief(existingCheckpoint)');
  const promptIndex = source.indexOf('buildCodexPrompt(packet, resumeBrief)');
  assert.ok(readIndex >= 0 && briefIndex > readIndex, 'the prior checkpoint must be read and turned into a brief');
  assert.ok(briefIndex < promptIndex, 'the resume brief must exist before the prompt is assembled');
});

test('buildCodexPrompt places the resume brief ahead of the repo brief', () => {
  const packet = {
    issue_id: 'UTV2-1594',
    tier: 'T1',
    branch: 'codex/utv2-1594',
    cwd: '/tmp/worktree',
    allowed_file_scope: ['scripts/ops/verify-semaphore.ts'],
    required_verification: ['pnpm verify'],
    closeout_instructions: ['open a PR'],
    repo_brief: 'REPO BRIEF BODY',
  } as unknown as Parameters<typeof buildCodexPrompt>[0];

  const withoutResume = buildCodexPrompt(packet);
  assert.doesNotMatch(withoutResume, /RESUMED RUN/);
  assert.match(withoutResume, /REPO BRIEF BODY/);

  const withResume = buildCodexPrompt(packet, '## Execution checkpoint — RESUMED RUN\n\nprior findings here');
  assert.ok(
    withResume.indexOf('RESUMED RUN') < withResume.indexOf('REPO BRIEF BODY'),
    'a resumed run must read what is already settled before it reads the full repo brief',
  );
  assert.match(withResume, /prior findings here/);
});

test('codex-exec opens a durable attempt immediately before the spawn', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const beginIndex = source.indexOf('beginAttempt({');
  const spawnIndex = source.indexOf("spawnSync('codex', codexArgs");
  assert.ok(beginIndex >= 0, 'codex-exec must open a checkpoint attempt');
  assert.ok(beginIndex < spawnIndex, 'the attempt must exist before the process that could die');
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

test('a rework with carried findings and no source diff exits non-success instead of reporting SUCCESS', () => {
  const verdict = evaluateExecutionTruth({ carriedFindings: 2, sourceFilesChanged: 0 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'REWORK_NO_SOURCE_CHANGE');
  assert.equal(verdict.exit_code, 1);
});

test('the --rework dispatch path invalidates implementation before it calculates its resume plan', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const reworkIndex = source.indexOf("if (rework) {");
  const invalidateIndex = source.indexOf("invalidatePhasesFrom(issueId, 'implement')", reworkIndex);
  const readIndex = source.indexOf('const existingCheckpoint = readCheckpoint(issueId)', reworkIndex);
  assert.ok(reworkIndex >= 0 && invalidateIndex > reworkIndex);
  assert.ok(invalidateIndex < readIndex, 'rework must invalidate before resume state is read');
});

test('source-diff counting excludes proof and operational metadata but includes implementation files', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-source-diff-'));
  try {
    spawnSync('git', ['init'], { cwd: tmpRoot, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot, stdio: 'pipe' });
    fs.mkdirSync(path.join(tmpRoot, 'scripts', 'ops'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'docs', '06_status', 'proof', 'UTV2-1698'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'scripts', 'ops', 'control.ts'), 'before\n');
    fs.writeFileSync(path.join(tmpRoot, 'docs', '06_status', 'proof', 'UTV2-1698', 'verification.md'), 'before\n');
    spawnSync('git', ['add', '.'], { cwd: tmpRoot, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'seed'], { cwd: tmpRoot, stdio: 'pipe' });
    const base = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8', stdio: 'pipe' }).stdout.trim();
    fs.writeFileSync(path.join(tmpRoot, 'scripts', 'ops', 'control.ts'), 'after\n');
    fs.writeFileSync(path.join(tmpRoot, 'docs', '06_status', 'proof', 'UTV2-1698', 'verification.md'), 'after\n');
    spawnSync('git', ['add', '.'], { cwd: tmpRoot, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'change'], { cwd: tmpRoot, stdio: 'pipe' });

    assert.equal(countSourceFilesChanged(tmpRoot, base), 1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// UTV2-1698, second rule. The rework guard keys on carried findings, so a FRESH
// lane carries none and slips past it. Observed live on UTV2-1701: attempt 1,
// resumed false, skipped_phases [], phase "plan", zero source files changed,
// outcome "completed". Deciding what to do is not doing it.
test('a run that terminates before the implementation boundary is not a completed execution', () => {
  for (const phase of ['orient', 'plan'] as const) {
    const verdict = evaluateExecutionTruth({ carriedFindings: 0, sourceFilesChanged: 0, phase });
    assert.equal(verdict.ok, false, `phase ${phase} must not report success`);
    assert.equal(verdict.code, 'INCOMPLETE_PHASE_PROGRESSION');
    assert.equal(verdict.exit_code, 1);
    assert.match(verdict.message, new RegExp(phase));
  }
});

test('a run that reached implementation or beyond is allowed to report success', () => {
  // The guard must not become "always fail": a genuine run that reached the
  // implementation boundary with no carried findings still succeeds.
  for (const phase of ['implement', 'verify', 'closeout'] as const) {
    const verdict = evaluateExecutionTruth({ carriedFindings: 0, sourceFilesChanged: 3, phase });
    assert.equal(verdict.ok, true, `phase ${phase} should be allowed`);
    assert.equal(verdict.code, 'SUCCESS');
  }
});

test('the rework guard still fires independently of phase', () => {
  // Both rules are live: a rework that reached closeout but changed nothing is
  // still a false success, and must be caught by the FIRST rule not the second.
  const verdict = evaluateExecutionTruth({ carriedFindings: 2, sourceFilesChanged: 0, phase: 'closeout' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'REWORK_NO_SOURCE_CHANGE');
});
