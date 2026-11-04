/**
 * UTV2-1594 section A fixtures: bounded timeout policy + resumable execution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_SILENCE_WINDOW_MS,
  EXECUTION_CHECKPOINT_SCHEMA_VERSION,
  EXECUTION_PHASES,
  EXECUTION_TIMEOUT_FLOOR_MS,
  EXECUTION_TIMEOUT_HARD_CAP_MS,
  EXECUTION_TIMEOUT_POLICY_ID,
  beginAttempt,
  buildResumeBrief,
  buildResumePlan,
  buildReworkBrief,
  checkpointMutationLockPath,
  checkpointRecoveryPath,
  checkpointPath,
  classifyCheckpointLiveness,
  clearCheckpoint,
  failVisiblyAndRelease as failVisiblyAndReleaseWithIdentity,
  finishAttempt as finishAttemptWithIdentity,
  nextPhaseAfter,
  readCheckpoint,
  readCheckpointState,
  recordFinding as recordFindingWithIdentity,
  recordHeartbeat as recordHeartbeatWithIdentity,
  recordPendingActions as recordPendingActionsWithIdentity,
  recordPhaseComplete as recordPhaseCompleteWithIdentity,
  recordRuling,
  requestCancel,
  resolveExecutionTimeout,
  writeCheckpoint,
  type ExecutionPhase,
  type ExecutionStateIdentity,
  type FinishAttemptInput,
} from './execution-checkpoint.js';
import { ROOT } from './shared.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1594-checkpoint-'));
}

const T1_SOL_HIGH = { tier: 'T1' as const, reasoningEffort: 'high', phase: 'implement' as ExecutionPhase };
const TEST_HEAD = '1'.repeat(40);
const MISSING_IDENTITY: ExecutionStateIdentity = { epoch_id: 'missing-epoch', attempt: 1, minimum_revision: 1 };

function activeIdentity(issueId: string, dir?: string): ExecutionStateIdentity {
  const checkpoint = readCheckpoint(issueId, dir);
  return checkpoint
    ? { epoch_id: checkpoint.epoch.epoch_id, attempt: checkpoint.attempt, minimum_revision: checkpoint.state_revision }
    : MISSING_IDENTITY;
}

type MutationOptions = { dir?: string; now?: Date; identity?: ExecutionStateIdentity };

function recordHeartbeat(issueId: string, options: MutationOptions = {}) {
  return recordHeartbeatWithIdentity(issueId, { ...options, identity: options.identity ?? activeIdentity(issueId, options.dir) });
}

function recordPhaseComplete(issueId: string, phase: ExecutionPhase, summary: string, options: MutationOptions = {}) {
  return recordPhaseCompleteWithIdentity(issueId, phase, summary, {
    ...options,
    identity: options.identity ?? activeIdentity(issueId, options.dir),
  });
}

function recordFinding(
  issueId: string,
  finding: { phase: ExecutionPhase; summary: string; id?: string },
  options: MutationOptions = {},
) {
  return recordFindingWithIdentity(issueId, finding, {
    ...options,
    identity: options.identity ?? activeIdentity(issueId, options.dir),
  });
}

function recordPendingActions(issueId: string, actions: string[], options: MutationOptions = {}) {
  return recordPendingActionsWithIdentity(issueId, actions, {
    ...options,
    identity: options.identity ?? activeIdentity(issueId, options.dir),
  });
}

function finishAttempt(input: Omit<FinishAttemptInput, 'identity'> & { identity?: ExecutionStateIdentity }) {
  return finishAttemptWithIdentity({ ...input, identity: input.identity ?? activeIdentity(input.issueId, input.dir) });
}

type FailInput = Parameters<typeof failVisiblyAndReleaseWithIdentity>[0];
function failVisiblyAndRelease(input: Omit<FailInput, 'identity'> & { identity?: ExecutionStateIdentity }) {
  return failVisiblyAndReleaseWithIdentity({
    ...input,
    identity: input.identity ?? activeIdentity(input.issueId, input.dir),
  });
}

function beginNext(input: {
  issueId: string;
  timeoutPolicy: ReturnType<typeof resolveExecutionTimeout>;
  dir: string;
  branch?: string;
  headSha?: string;
}) {
  const common = {
    issueId: input.issueId,
    timeoutPolicy: input.timeoutPolicy,
    dir: input.dir,
    branch: input.branch,
  };
  return readCheckpoint(input.issueId, input.dir)
    ? beginAttempt({ ...common, kind: 'resume', attemptStartSha: input.headSha ?? TEST_HEAD })
    : beginAttempt({
        ...common,
        kind: 'fresh',
        currentHeadSha: input.headSha ?? TEST_HEAD,
        objectiveIdentity: `issue:${input.issueId}`,
        authority: 'test',
      });
}

function runCheckpointCli(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync(path.join(ROOT, 'node_modules', '.bin', 'tsx'), [
    path.join(ROOT, 'scripts', 'ops', 'execution-checkpoint.ts'), ...args,
  ], { cwd, env, encoding: 'utf8', timeout: 60_000 });
}

test('execution-checkpoint CLI uses environment directory when --dir is absent', () => {
  const root = tmpDir();
  try {
    assert.equal(spawnSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'pipe' }).status, 0);
    const envDir = path.join(root, 'env-checkpoints');
    const started = beginNext({ issueId: 'UTV2-20991', timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir: envDir });
    const result = runCheckpointCli([
      'phase-complete', '--issue', 'UTV2-20991', '--phase', 'orient', '--summary', 'from environment',
    ], root, {
      ...process.env,
      UNIT_TALK_EXECUTION_CHECKPOINT_DIR: envDir,
      UNIT_TALK_EXECUTION_EPOCH_ID: started.identity.epoch_id,
      UNIT_TALK_EXECUTION_ATTEMPT: String(started.identity.attempt),
      UNIT_TALK_EXECUTION_MINIMUM_REVISION: String(started.identity.minimum_revision),
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readCheckpoint('UTV2-20991', envDir)?.completed_phases.map((phase) => phase.phase), ['orient']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('execution-checkpoint CLI gives --dir precedence over its environment directory', () => {
  const root = tmpDir();
  try {
    assert.equal(spawnSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'pipe' }).status, 0);
    const envDir = path.join(root, 'env-checkpoints');
    const flagDir = path.join(root, 'flag-checkpoints');
    beginNext({ issueId: 'UTV2-20992', timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir: envDir });
    const flagStarted = beginNext({ issueId: 'UTV2-20992', timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir: flagDir });
    const result = runCheckpointCli([
      'phase-complete', '--issue', 'UTV2-20992', '--phase', 'orient', '--summary', 'from explicit dir', '--dir', flagDir,
    ], root, {
      ...process.env,
      UNIT_TALK_EXECUTION_CHECKPOINT_DIR: envDir,
      UNIT_TALK_EXECUTION_EPOCH_ID: flagStarted.identity.epoch_id,
      UNIT_TALK_EXECUTION_ATTEMPT: String(flagStarted.identity.attempt),
      UNIT_TALK_EXECUTION_MINIMUM_REVISION: String(flagStarted.identity.minimum_revision),
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readCheckpoint('UTV2-20992', flagDir)?.completed_phases.map((phase) => phase.phase), ['orient']);
    assert.deepEqual(readCheckpoint('UTV2-20992', envDir)?.completed_phases, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('execution-checkpoint CLI retains repository default when neither directory override is set', () => {
  const root = tmpDir();
  try {
    assert.equal(spawnSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'pipe' }).status, 0);
    const result = runCheckpointCli(['status', '--issue', 'UTV2-9999'], root, {
      ...process.env,
      UNIT_TALK_EXECUTION_CHECKPOINT_DIR: '',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout) as { checkpoint: unknown };
    assert.equal(output.checkpoint, null);
    assert.equal(fs.existsSync(path.join(root, '.out')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── timeout policy ──────────────────────────────────────────────────────────

test('the timeout policy is deterministic: identical inputs always give an identical decision', () => {
  const a = resolveExecutionTimeout(T1_SOL_HIGH);
  const b = resolveExecutionTimeout(T1_SOL_HIGH);
  assert.deepEqual(a, b);
  assert.equal(a.policy_id, EXECUTION_TIMEOUT_POLICY_ID);
});

test('the timeout policy varies by tier, reasoning effort and phase', () => {
  const t1 = resolveExecutionTimeout({ tier: 'T1', reasoningEffort: 'high', phase: 'implement' }).timeout_ms;
  const t2 = resolveExecutionTimeout({ tier: 'T2', reasoningEffort: 'high', phase: 'implement' }).timeout_ms;
  const t3 = resolveExecutionTimeout({ tier: 'T3', reasoningEffort: 'high', phase: 'implement' }).timeout_ms;
  assert.ok(t1 > t2 && t2 > t3, `expected T1 > T2 > T3, got ${t1}/${t2}/${t3}`);

  const low = resolveExecutionTimeout({ tier: 'T1', reasoningEffort: 'low', phase: 'implement' }).timeout_ms;
  const max = resolveExecutionTimeout({ tier: 'T1', reasoningEffort: 'max', phase: 'implement' }).timeout_ms;
  assert.ok(max > t1 && t1 > low);

  const orient = resolveExecutionTimeout({ tier: 'T1', reasoningEffort: 'high', phase: 'orient' }).timeout_ms;
  assert.ok(orient < t1, 'a scoping phase should not get the implementation budget');
});

test('every reachable timeout is bounded by the hard cap and the floor', () => {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'unknown-effort'];
  for (const tier of ['T1', 'T2', 'T3'] as const) {
    for (const effort of efforts) {
      for (const phase of EXECUTION_PHASES) {
        const decision = resolveExecutionTimeout({ tier, reasoningEffort: effort, phase });
        assert.ok(
          decision.timeout_ms <= EXECUTION_TIMEOUT_HARD_CAP_MS,
          `${tier}/${effort}/${phase} exceeded the hard cap`,
        );
        assert.ok(decision.timeout_ms >= EXECUTION_TIMEOUT_FLOOR_MS, `${tier}/${effort}/${phase} fell below the floor`);
        assert.equal(decision.hard_cap_ms, EXECUTION_TIMEOUT_HARD_CAP_MS);
      }
    }
  }
});

test('an unknown reasoning effort degrades to 1x and says so instead of failing open', () => {
  const decision = resolveExecutionTimeout({ tier: 'T1', reasoningEffort: 'wat', phase: 'implement' });
  assert.equal(decision.effort_multiplier, 1);
  assert.equal(decision.fallbacks.length, 1);
  assert.match(decision.fallbacks[0]!, /unknown reasoning effort/);
});

test('the old fixed 30-minute timeout is no longer what a T1 implementation phase gets', () => {
  const decision = resolveExecutionTimeout(T1_SOL_HIGH);
  assert.notEqual(decision.timeout_ms, 30 * 60 * 1000);
  assert.ok(decision.timeout_ms > 30 * 60 * 1000, 'legitimate long-running T1 work needs more than 30 minutes');
});

// ── resume plan ─────────────────────────────────────────────────────────────

test('nextPhaseAfter walks the phase order and stops at the last phase', () => {
  assert.equal(nextPhaseAfter([]), 'orient');
  assert.equal(nextPhaseAfter(['orient']), 'plan');
  assert.equal(nextPhaseAfter(['orient', 'plan', 'implement']), 'verify');
  assert.equal(nextPhaseAfter([...EXECUTION_PHASES]), EXECUTION_PHASES[EXECUTION_PHASES.length - 1]);
});

test('a fresh lane resumes from the first phase with nothing carried', () => {
  const plan = buildResumePlan(null);
  assert.equal(plan.resumed, false);
  assert.equal(plan.resume_from_phase, 'orient');
  assert.deepEqual(plan.skipped_phases, []);
  assert.deepEqual(plan.carried_findings, []);
});

test('fresh and resume attempts keep one immutable epoch baseline while attempt starts advance', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1711';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    const baseline = 'a'.repeat(40);
    const resumedHead = 'b'.repeat(40);
    const fresh = beginAttempt({
      kind: 'fresh',
      issueId,
      currentHeadSha: baseline,
      objectiveIdentity: `issue:${issueId}`,
      authority: 'test',
      timeoutPolicy,
      dir,
    });
    recordPhaseComplete(issueId, 'orient', 'oriented', { dir });
    recordPhaseComplete(issueId, 'plan', 'planned', { dir });
    recordPhaseComplete(issueId, 'implement', 'source committed', { dir });
    finishAttempt({ issueId, outcome: 'timed_out', reason: 'interrupted in verify', dir });

    const resumed = beginAttempt({
      kind: 'resume',
      issueId,
      attemptStartSha: resumedHead,
      timeoutPolicy,
      dir,
    });
    assert.equal(resumed.checkpoint.epoch.epoch_id, fresh.checkpoint.epoch.epoch_id);
    assert.equal(resumed.checkpoint.epoch.implementation_baseline_sha, baseline);
    assert.equal(resumed.checkpoint.attempts[0]?.attempt_start_sha, baseline);
    assert.equal(resumed.checkpoint.attempts[1]?.attempt_start_sha, resumedHead);
    assert.equal(resumed.resume.resume_from_phase, 'verify');
    assert.deepEqual(resumed.resume.skipped_phases, ['orient', 'plan', 'implement']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rework creates a new epoch at the rejected head and cannot inherit rejected phase validity', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1711';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    const first = beginNext({ issueId, timeoutPolicy, dir, headSha: 'a'.repeat(40) });
    recordFinding(issueId, { phase: 'verify', summary: 'review rejected the old implementation' }, { dir });
    for (const phase of EXECUTION_PHASES) {
      recordPhaseComplete(issueId, phase, `${phase} complete`, { dir });
    }
    finishAttempt({ issueId, outcome: 'failed', reason: 'rejected', dir });

    const rework = beginAttempt({
      kind: 'rework',
      issueId,
      rejectedHeadSha: 'b'.repeat(40),
      objectiveIdentity: `issue:${issueId}`,
      findingsIdentity: 'review-round-1',
      authority: 'pm-review',
      timeoutPolicy,
      dir,
    });
    assert.notEqual(rework.checkpoint.epoch.epoch_id, first.checkpoint.epoch.epoch_id);
    assert.equal(rework.checkpoint.epoch.mode, 'rework');
    assert.equal(rework.checkpoint.epoch.implementation_baseline_sha, 'b'.repeat(40));
    assert.equal(rework.checkpoint.attempt, 1);
    assert.deepEqual(rework.checkpoint.completed_phases, []);
    assert.equal(rework.checkpoint.prior_epochs.length, 1);
    assert.equal(rework.checkpoint.prior_epochs[0]?.epoch.epoch_id, first.checkpoint.epoch.epoch_id);
    assert.equal(rework.checkpoint.findings[0]?.epoch_id, rework.checkpoint.epoch.epoch_id);
    assert.equal(rework.checkpoint.findings[0]?.source_epoch_id, first.checkpoint.epoch.epoch_id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a delayed executor cannot stamp phase completion into a newer rework epoch', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1711';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    const rejected = beginNext({ issueId, timeoutPolicy, dir, headSha: 'a'.repeat(40) });
    finishAttempt({ issueId, outcome: 'failed', reason: 'review rejected the epoch', dir, identity: rejected.identity });
    const rework = beginAttempt({
      kind: 'rework',
      issueId,
      rejectedHeadSha: 'b'.repeat(40),
      objectiveIdentity: `issue:${issueId}`,
      findingsIdentity: 'review-round-2',
      authority: 'pm-review',
      timeoutPolicy,
      dir,
    });

    const stale = recordPhaseComplete(issueId, 'implement', 'late completion from rejected executor', {
      dir,
      identity: rejected.identity,
    });
    assert.equal(stale, null, 'an old epoch/attempt identity must be refused');
    assert.deepEqual(readCheckpoint(issueId, dir)?.completed_phases, []);

    const current = recordPhaseComplete(issueId, 'implement', 'current rework implementation', {
      dir,
      identity: rework.identity,
    });
    assert.equal(current?.completed_phases[0]?.epoch_id, rework.checkpoint.epoch.epoch_id);
    assert.equal(current?.completed_phases[0]?.attempt, rework.checkpoint.attempt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a delayed phase completion cannot mutate a closed originating attempt or leak into its resume', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1711';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    const started = beginNext({ issueId, timeoutPolicy, dir });
    finishAttempt({ issueId, outcome: 'failed', reason: 'executor exited before its delayed write', dir });
    const closedRevision = readCheckpoint(issueId, dir)?.state_revision;

    const delayed = recordPhaseComplete(issueId, 'implement', 'background completion after close', {
      dir,
      identity: started.identity,
    });
    assert.equal(delayed, null, 'a closed attempt must reject executor mutations');

    const rejected = readCheckpointState(issueId, dir, started.identity);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'execution_checkpoint_unavailable');
    assert.match(rejected.reason, /attempt is not open and in progress/);

    const persisted = readCheckpoint(issueId, dir);
    assert.equal(persisted?.state_revision, closedRevision, 'a rejected delayed mutation must not write state');
    assert.deepEqual(persisted?.completed_phases, []);

    const resumed = beginNext({ issueId, timeoutPolicy, dir });
    assert.deepEqual(resumed.resume.skipped_phases, [], 'resume must not inherit validity from the closed attempt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resume and rework fail closed when no validated epoch state exists', () => {
  const dir = tmpDir();
  try {
    const common = { issueId: 'UTV2-1711', timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir };
    assert.throws(
      () => beginAttempt({ ...common, kind: 'resume', attemptStartSha: TEST_HEAD }),
      /EXECUTION_STATE_UNAVAILABLE/,
    );
    assert.throws(
      () =>
        beginAttempt({
          ...common,
          kind: 'rework',
          rejectedHeadSha: TEST_HEAD,
          objectiveIdentity: 'issue:UTV2-1711',
          findingsIdentity: 'review',
          authority: 'test',
        }),
      /EXECUTION_STATE_UNAVAILABLE/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── the headline fixture ────────────────────────────────────────────────────

test('FIXTURE: four consecutive timeout/resume attempts become one resumable history, not four replays', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1590';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    const phasesWorked: ExecutionPhase[] = ['orient', 'plan', 'implement', 'verify'];
    const startPhases: ExecutionPhase[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const started = beginNext({ issueId, branch: 'codex/utv2-1590', timeoutPolicy, dir });
      startPhases.push(started.checkpoint.phase);

      // Each attempt is told exactly what earlier attempts already settled.
      assert.deepEqual(
        started.resume.skipped_phases,
        phasesWorked.slice(0, attempt),
        `attempt ${attempt + 1} must skip everything already completed`,
      );
      assert.equal(started.resume.carried_findings.length, attempt, 'prior findings must survive the timeout');

      const phase = phasesWorked[attempt]!;
      recordFinding(issueId, { phase, summary: `finding from attempt ${attempt + 1}`, id: `f${attempt}` }, { dir });
      recordPhaseComplete(issueId, phase, `${phase} settled in attempt ${attempt + 1}`, { dir });
      finishAttempt({ issueId, outcome: 'timed_out', reason: `attempt ${attempt + 1} hit its bounded timeout`, dir });
    }

    // One history, not four independent runs.
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    assert.deepEqual(files, [`${issueId}.json`], 'all four attempts must land in a single checkpoint');

    const checkpoint = readCheckpoint(issueId, dir);
    assert.ok(checkpoint);
    assert.equal(checkpoint.attempt, 4);
    assert.equal(checkpoint.attempts.length, 4);
    assert.deepEqual(
      checkpoint.attempts.map((a) => a.attempt),
      [1, 2, 3, 4],
    );
    assert.deepEqual(checkpoint.attempts.map((a) => a.outcome), ['timed_out', 'timed_out', 'timed_out', 'timed_out']);
    assert.ok(checkpoint.attempts.every((a) => a.ended_at !== null && a.timeout_ms === timeoutPolicy.timeout_ms));

    // Analysis moved forward instead of repeating: each attempt started where
    // the previous one stopped, and nothing was re-derived.
    assert.deepEqual(startPhases, ['orient', 'plan', 'implement', 'verify']);
    assert.deepEqual(
      checkpoint.completed_phases.map((entry) => entry.phase),
      phasesWorked,
    );
    assert.deepEqual(
      checkpoint.completed_phases.map((entry) => entry.attempt),
      [1, 2, 3, 4],
      'each phase is credited to the attempt that actually finished it',
    );
    assert.equal(checkpoint.findings.length, 4);
    assert.equal(new Set(checkpoint.findings.map((f) => f.summary)).size, 4, 'no finding was recomputed');

    // A fifth attempt would start at the one remaining phase.
    assert.equal(buildResumePlan(checkpoint).resume_from_phase, 'closeout');

    const brief = buildResumeBrief(checkpoint);
    assert.match(brief, /RESUMED RUN/);
    assert.match(brief, /Do not repeat completed analysis/);
    assert.match(brief, /Resume at phase: `closeout`/);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      assert.match(brief, new RegExp(`finding from attempt ${attempt}`), 'prior findings must reach the next attempt');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a completed phase is not double-recorded if an attempt reports it twice', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    recordPhaseComplete(issueId, 'orient', 'first', { dir });
    const after = recordPhaseComplete(issueId, 'orient', 'again', { dir });
    assert.equal(after?.completed_phases.length, 1);
    assert.equal(after?.completed_phases[0]?.summary, 'first');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pending actions and findings survive across attempts', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    beginNext({ issueId, timeoutPolicy, dir });
    recordFinding(issueId, { phase: 'orient', summary: 'the outbox worker owns retries' }, { dir });
    recordPendingActions(issueId, ['wire the reaper into preflight', 'document the operator command'], { dir });
    finishAttempt({ issueId, outcome: 'timed_out', reason: 'bounded timeout', dir });

    const second = beginNext({ issueId, timeoutPolicy, dir });
    assert.deepEqual(second.resume.pending_actions, [
      'wire the reaper into preflight',
      'document the operator command',
    ]);
    assert.equal(second.resume.carried_findings[0]?.summary, 'the outbox worker owns retries');
    assert.match(buildResumeBrief(second.checkpoint), /wire the reaper into preflight/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt checkpoint falls back to the last valid write instead of replaying from zero', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    beginNext({ issueId, timeoutPolicy, dir });
    recordPhaseComplete(issueId, 'orient', 'orientation complete', { dir });
    recordFinding(issueId, { phase: 'orient', summary: 'durable conclusion' }, { dir });

    // Simulate a truncated write (process killed mid-flush).
    fs.writeFileSync(checkpointPath(issueId, dir), '{"schema_version":1,"issue_id":"UTV2-15', 'utf8');

    const recovered = readCheckpoint(issueId, dir);
    assert.ok(recovered, 'the previous good write must still be readable');
    assert.equal(recovered.schema_version, EXECUTION_CHECKPOINT_SCHEMA_VERSION);
    assert.ok(recovered.completed_phases.some((entry) => entry.phase === 'orient'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sidecar recovery reports provenance and enforces the expected epoch and attempt identity', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1711';
    const started = beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    recordPhaseComplete(issueId, 'orient', 'orientation complete', { dir });
    fs.writeFileSync(checkpointPath(issueId, dir), '{corrupt primary', 'utf8');

    const recovered = readCheckpointState(issueId, dir, started.identity);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.code, 'execution_checkpoint_recovered');
    assert.equal(recovered.provenance.source, 'sidecar');
    assert.equal(recovered.provenance.epoch_id, started.identity.epoch_id);
    assert.equal(recovered.provenance.attempt, started.identity.attempt);

    const staleIdentity = { ...started.identity, epoch_id: 'another-epoch' };
    const rejected = readCheckpointState(issueId, dir, staleIdentity);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'execution_checkpoint_unavailable');
    assert.match(rejected.reason, /does not match expected epoch\/attempt\/revision/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a sidecar with a corrupt checksum or another issue identity is never recovered', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1711';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    const sidecar = checkpointRecoveryPath(issueId, dir);
    const parsed = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as { issue_id: string };
    parsed.issue_id = 'UTV2-9999';
    fs.writeFileSync(sidecar, `${JSON.stringify(parsed)}\n`, 'utf8');
    fs.writeFileSync(checkpointPath(issueId, dir), '{corrupt primary', 'utf8');

    const state = readCheckpointState(issueId, dir);
    assert.equal(state.ok, false);
    assert.equal(state.checkpoint, null);
    assert.match(state.reason, /invalid for the requested issue\/schema\/checksum\/epoch\/attempt\/revision/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable checkpoint with no backup is treated as absent, never as progress', () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(checkpointPath('UTV2-1594', dir), 'not json at all', 'utf8');
    assert.equal(readCheckpoint('UTV2-1594', dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clear refuses an active attempt and only removes closed primary plus sidecar state', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1711';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    const refused = clearCheckpoint(issueId, { dir });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'execution_checkpoint_active');
    assert.equal(refused.removed.length, 0);
    assert.equal(fs.existsSync(checkpointPath(issueId, dir)), true);
    assert.equal(fs.existsSync(checkpointRecoveryPath(issueId, dir)), true);

    finishAttempt({ issueId, outcome: 'failed', reason: 'closed before clear', dir });
    const cleared = clearCheckpoint(issueId, { dir });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.removed.length, 2);
    assert.equal(readCheckpointState(issueId, dir).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clear and attempt start share one exclusive mutation lock', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1711';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    const first = beginNext({ issueId, timeoutPolicy, dir });
    finishAttempt({ issueId, outcome: 'failed', reason: 'closed before race test', dir, identity: first.identity });

    const lockPath = checkpointMutationLockPath(issueId, dir);
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: process.pid, host: os.hostname() || 'unknown', token: 'held-by-test' })}\n`,
      'utf8',
    );
    const blockedClear = clearCheckpoint(issueId, { dir });
    assert.equal(blockedClear.code, 'execution_checkpoint_busy');
    assert.throws(
      () => beginAttempt({ kind: 'resume', issueId, attemptStartSha: TEST_HEAD, timeoutPolicy, dir }),
      /EXECUTION_STATE_LOCKED/,
    );
    fs.rmSync(lockPath, { force: true });

    const resumed = beginAttempt({ kind: 'resume', issueId, attemptStartSha: TEST_HEAD, timeoutPolicy, dir });
    assert.equal(clearCheckpoint(issueId, { dir }).code, 'execution_checkpoint_active');
    assert.equal(readCheckpoint(issueId, dir)?.epoch.epoch_id, resumed.checkpoint.epoch.epoch_id);
    assert.equal(readCheckpoint(issueId, dir)?.attempt, resumed.checkpoint.attempt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── liveness / silence ──────────────────────────────────────────────────────

test('a heartbeating attempt is active', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    const checkpoint = recordHeartbeat(issueId, { dir });
    const verdict = classifyCheckpointLiveness(checkpoint);
    assert.equal(verdict.state, 'active');
    assert.equal(verdict.silent, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a silent attempt is reported as silent, never as progress', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    const started = beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    const verdict = classifyCheckpointLiveness(started.checkpoint, {
      now: new Date(Date.parse(started.checkpoint.heartbeat_at) + DEFAULT_SILENCE_WINDOW_MS + 1_000),
    });
    assert.equal(verdict.state, 'silent');
    assert.equal(verdict.silent, true);
    assert.match(verdict.reason, /has not heartbeat/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a closed attempt is not mistaken for a silent one', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    const closed = finishAttempt({ issueId, outcome: 'completed', reason: 'done', dir });
    const verdict = classifyCheckpointLiveness(closed, { now: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    assert.equal(verdict.state, 'closed');
    assert.equal(verdict.silent, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable heartbeat counts as silence rather than as liveness', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    const started = beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    writeCheckpoint({ ...started.checkpoint, heartbeat_at: 'not-a-date' }, dir);
    const verdict = classifyCheckpointLiveness(readCheckpoint(issueId, dir));
    assert.equal(verdict.state, 'silent');
    assert.equal(verdict.silent, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a silent attempt fails visibly and releases the resources it owned', () => {
  const dir = tmpDir();
  const semaphoreDir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });

    const reapCalls: Array<{ dir?: string }> = [];
    const result = failVisiblyAndRelease({
      issueId,
      outcome: 'silent_no_heartbeat',
      reason: 'no heartbeat for 12m; executor is silent',
      dir,
      semaphoreDir,
      reap: (options) => {
        reapCalls.push(options);
        return [
          {
            slot: 0,
            slot_path: path.join(semaphoreDir, 'slot-0'),
            state: 'dead_owner',
            reason: 'owner pid is not running',
            reaped_at: new Date().toISOString(),
            reaped_by: { pid: process.pid, operation_id: null },
            previous_owner: null,
          },
        ];
      },
    });

    assert.deepEqual(reapCalls, [{ dir: semaphoreDir }], 'the owned resources must be swept');
    assert.equal(result.released.length, 1);
    assert.equal(result.checkpoint?.status, 'timed_out');
    assert.notEqual(result.checkpoint?.status, 'completed');
    const attempt = result.checkpoint?.attempts.at(-1);
    assert.equal(attempt?.outcome, 'silent_no_heartbeat');
    assert.deepEqual(attempt?.released_resources, ['verify-slot-0:dead_owner']);
    assert.match(attempt?.reason ?? '', /silent/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(semaphoreDir, { recursive: true, force: true });
  }
});

test('a reaper that itself throws cannot swallow the failing outcome', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    const result = failVisiblyAndRelease({
      issueId,
      outcome: 'timed_out',
      reason: 'bounded timeout reached',
      dir,
      reap: () => {
        throw new Error('semaphore directory unreadable');
      },
    });
    assert.equal(result.released.length, 0);
    assert.equal(result.checkpoint?.attempts.at(-1)?.outcome, 'timed_out');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── operator cancellation ───────────────────────────────────────────────────

test('operator cancellation is recorded on the checkpoint with its reason', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    const cancelled = requestCancel(issueId, 'PM pulled the lane', { dir });
    assert.equal(cancelled?.cancel_requested, true);
    assert.equal(cancelled?.cancel_reason, 'PM pulled the lane');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a new attempt clears a consumed cancellation flag rather than inheriting it forever', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    beginNext({ issueId, timeoutPolicy, dir });
    requestCancel(issueId, 'stop', { dir });
    finishAttempt({ issueId, outcome: 'cancelled', reason: 'operator cancellation', dir });
    const next = beginNext({ issueId, timeoutPolicy, dir });
    assert.equal(next.checkpoint.cancel_requested, false);
    assert.equal(next.checkpoint.attempts.at(-2)?.outcome, 'cancelled');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mutations on a missing checkpoint return null instead of inventing one', () => {
  const dir = tmpDir();
  try {
    assert.equal(recordHeartbeat('UTV2-9999', { dir }), null);
    assert.equal(recordPhaseComplete('UTV2-9999', 'orient', 'x', { dir }), null);
    assert.equal(recordFinding('UTV2-9999', { phase: 'orient', summary: 'x' }, { dir }), null);
    assert.equal(finishAttempt({ issueId: 'UTV2-9999', outcome: 'failed', reason: 'x', dir }), null);
    assert.equal(fs.existsSync(checkpointPath('UTV2-9999', dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── a killed runner must not leave a dangling attempt behind ────────────────

test('an attempt left open by a killed runner is closed as silence when the next attempt starts', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    // Attempt 1 opens and the runner is killed before it can call finishAttempt.
    beginNext({ issueId, timeoutPolicy, dir });
    recordPhaseComplete(issueId, 'orient', 'orientation complete', { dir });

    const second = beginNext({ issueId, timeoutPolicy, dir });
    const first = second.checkpoint.attempts.find((a) => a.attempt === 1);
    assert.ok(first);
    assert.notEqual(first.ended_at, null, 'a dangling attempt must not stay open forever');
    assert.equal(first.outcome, 'silent_no_heartbeat', 'a runner that vanished is silence, not success');
    assert.match(first.reason ?? '', /never reported an outcome/);
    assert.equal(first.phase_at_end, 'plan');

    const openAttempts = second.checkpoint.attempts.filter((a) => a.ended_at === null);
    assert.equal(openAttempts.length, 1, 'exactly one attempt may be in flight');
    assert.equal(openAttempts[0]?.attempt, 2);
    // Progress from the killed attempt is still carried forward.
    assert.deepEqual(second.resume.skipped_phases, ['orient']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('liveness describes the attempt in flight, not an older dangling one', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    const first = beginNext({ issueId, timeoutPolicy, dir });

    // Force a second open attempt alongside the first, the shape a killed
    // runner used to leave behind.
    const forced = {
      ...first.checkpoint,
      attempt: 2,
      attempts: [
        { ...first.checkpoint.attempts[0]!, attempt: 1 },
        { ...first.checkpoint.attempts[0]!, attempt: 2, ended_at: null, outcome: null },
      ],
    };
    writeCheckpoint(forced, dir);

    const verdict = classifyCheckpointLiveness(readCheckpoint(issueId, dir), {
      now: new Date(Date.parse(forced.heartbeat_at) + 1_000),
    });
    assert.equal(verdict.state, 'active');
    assert.match(verdict.reason, /attempt 2/, 'liveness must report the latest open attempt, not the first');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── orchestrator rulings (WORK-2026110303) ──────────────────────────────────

function stoppedOnQuestion(issueId: string, dir: string) {
  const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
  beginNext({ issueId, timeoutPolicy, dir });
  recordPhaseComplete(issueId, 'orient', 'scope understood', { dir });
  recordFinding(issueId, { id: 'plan-q1', phase: 'plan', summary: 'QUESTION: may the reaper touch settled picks?' }, { dir });
  recordPendingActions(issueId, ['wait for the orchestrator'], { dir });
  finishAttempt({ issueId, outcome: 'failed', reason: 'stopped on an open question', dir });
  return timeoutPolicy;
}

test('a ruling recorded between attempts is stated as authoritative in attempt N+1', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-20993';
    const timeoutPolicy = stoppedOnQuestion(issueId, dir);
    const result = recordRuling(issueId, { text: 'No. Settled picks are kept.', answersFindingId: 'plan-q1' }, { dir });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.ruling?.author, 'orchestrator');
    assert.equal(result.ruling?.after_attempt, 1);

    // codex-exec builds the next prompt from the closed checkpoint, before beginAttempt.
    const brief = buildResumeBrief(readCheckpoint(issueId, dir));
    assert.match(brief, /### Orchestrator rulings — authoritative/);
    assert.match(brief, /\[answers finding `plan-q1`\] No\. Settled picks are kept\./);
    assert.ok(brief.indexOf('Orchestrator rulings') < brief.indexOf('Established findings'));

    const second = beginNext({ issueId, timeoutPolicy, dir });
    assert.equal(second.resume.carried_rulings[0]?.text, 'No. Settled picks are kept.');
    assert.equal(second.checkpoint.orchestrator_rulings?.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a ruling is refused while an attempt is in progress and leaves the checkpoint untouched', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-20994';
    beginNext({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
    const before = fs.readFileSync(checkpointPath(issueId, dir), 'utf8');
    const result = recordRuling(issueId, { text: 'answer' }, { dir });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'execution_checkpoint_active');
    assert.equal(fs.readFileSync(checkpointPath(issueId, dir), 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recording a ruling leaves phases, findings, pending actions and attempts intact', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-20995';
    stoppedOnQuestion(issueId, dir);
    const before = readCheckpoint(issueId, dir)!;
    const result = recordRuling(issueId, { text: 'Proceed with option B.' }, { dir });
    assert.equal(result.ok, true, result.reason);
    const after = readCheckpoint(issueId, dir)!;
    assert.deepEqual(after.completed_phases, before.completed_phases);
    assert.deepEqual(after.findings, before.findings);
    assert.deepEqual(after.pending_actions, before.pending_actions);
    assert.deepEqual(after.attempts, before.attempts);
    assert.equal(after.status, before.status);
    assert.equal(after.epoch.epoch_id, before.epoch.epoch_id);
    assert.equal(after.state_revision, before.state_revision + 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a ruling naming an unknown finding, or with empty text, is refused', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-20996';
    stoppedOnQuestion(issueId, dir);
    const unknown = recordRuling(issueId, { text: 'answer', answersFindingId: 'plan-q9' }, { dir });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'execution_checkpoint_ruling_invalid');
    const empty = recordRuling(issueId, { text: '   ' }, { dir });
    assert.equal(empty.ok, false);
    assert.equal(empty.code, 'execution_checkpoint_ruling_invalid');
    assert.equal((readCheckpoint(issueId, dir)?.orchestrator_rulings ?? []).length, 0);
    assert.equal(recordRuling('UTV2-20997', { text: 'answer' }, { dir }).code, 'execution_checkpoint_missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a rework epoch archives rulings with the rejected epoch and carries them rebased', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-20998';
    const timeoutPolicy = stoppedOnQuestion(issueId, dir);
    const recorded = recordRuling(issueId, { text: 'Keep the public API.', answersFindingId: 'plan-q1' }, { dir });
    const oldEpoch = recorded.checkpoint!.epoch.epoch_id;
    const rework = beginAttempt({
      kind: 'rework',
      issueId,
      rejectedHeadSha: 'c'.repeat(40),
      objectiveIdentity: `issue:${issueId}`,
      findingsIdentity: 'review-round-1',
      authority: 'pm-review',
      timeoutPolicy,
      dir,
    });
    const carried = rework.checkpoint.orchestrator_rulings?.[0];
    assert.equal(carried?.epoch_id, rework.checkpoint.epoch.epoch_id);
    assert.equal(carried?.source_epoch_id, oldEpoch);
    assert.equal(rework.checkpoint.prior_epochs[0]?.orchestrator_rulings?.[0]?.epoch_id, oldEpoch);
    assert.match(buildReworkBrief(recorded.checkpoint), /Keep the public API\./);
    assert.ok(readCheckpoint(issueId, dir), 'rebased rulings must pass checkpoint validation');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a checkpoint written before rulings existed still validates and renders no rulings section', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-20999';
    stoppedOnQuestion(issueId, dir);
    const legacy = { ...readCheckpoint(issueId, dir)! };
    delete legacy.orchestrator_rulings;
    writeCheckpoint(legacy, dir);
    const reread = readCheckpoint(issueId, dir);
    assert.ok(reread, 'legacy checkpoint without orchestrator_rulings must validate');
    assert.doesNotMatch(buildResumeBrief(reread), /Orchestrator rulings/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the ruling CLI refuses under an executor attempt identity and records without one', () => {
  const root = tmpDir();
  try {
    assert.equal(spawnSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'pipe' }).status, 0);
    const dir = path.join(root, 'checkpoints');
    const issueId = 'UTV2-21000';
    stoppedOnQuestion(issueId, dir);
    const env: NodeJS.ProcessEnv = { ...process.env, UNIT_TALK_EXECUTION_CHECKPOINT_DIR: dir };
    delete env.UNIT_TALK_EXECUTION_EPOCH_ID;
    const asExecutor = runCheckpointCli(['ruling', '--issue', issueId, '--text', 'self-granted'], root, {
      ...env,
      UNIT_TALK_EXECUTION_EPOCH_ID: readCheckpoint(issueId, dir)!.epoch.epoch_id,
    });
    assert.equal(asExecutor.status, 1, asExecutor.stdout);
    assert.match(asExecutor.stdout, /execution_checkpoint_ruling_refused/);
    assert.equal((readCheckpoint(issueId, dir)?.orchestrator_rulings ?? []).length, 0);

    const asOrchestrator = runCheckpointCli(
      ['ruling', '--issue', issueId, '--answers', 'plan-q1', '--text', 'Settled picks are kept.'],
      root,
      env,
    );
    assert.equal(asOrchestrator.status, 0, `${asOrchestrator.stdout}\n${asOrchestrator.stderr}`);
    assert.equal(readCheckpoint(issueId, dir)?.orchestrator_rulings?.[0]?.answers_finding_id, 'plan-q1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── rulings survive an executor clear (WORK-2026110303 PM review) ────────────

function closedWithRuling(issueId: string, dir: string) {
  const timeoutPolicy = stoppedOnQuestion(issueId, dir);
  const recorded = recordRuling(issueId, { text: 'Settled picks are kept.', answersFindingId: 'plan-q1' }, { dir });
  assert.equal(recorded.ok, true, recorded.reason);
  return { timeoutPolicy, epochId: recorded.checkpoint!.epoch.epoch_id };
}

function assertStateIntact(issueId: string, dir: string, primary: string, sidecar: string) {
  assert.equal(fs.readFileSync(checkpointPath(issueId, dir), 'utf8'), primary);
  assert.equal(fs.readFileSync(checkpointRecoveryPath(issueId, dir), 'utf8'), sidecar);
}

test('an executor identity cannot clear a closed checkpoint that carries a ruling', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-21001';
    const { epochId } = closedWithRuling(issueId, dir);
    const primary = fs.readFileSync(checkpointPath(issueId, dir), 'utf8');
    const sidecar = fs.readFileSync(checkpointRecoveryPath(issueId, dir), 'utf8');

    const current = clearCheckpoint(issueId, { dir, executorEpochId: epochId });
    assert.equal(current.ok, false);
    assert.equal(current.code, 'execution_checkpoint_ruling_protected');
    assert.equal(current.removed.length, 0);

    const stale = clearCheckpoint(issueId, { dir, executorEpochId: 'stale-epoch-from-an-earlier-attempt' });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'execution_checkpoint_ruling_protected');

    assertStateIntact(issueId, dir, primary, sidecar);
    assert.equal(readCheckpoint(issueId, dir)?.orchestrator_rulings?.[0]?.text, 'Settled picks are kept.');

    const orchestrator = clearCheckpoint(issueId, { dir, executorEpochId: null });
    assert.equal(orchestrator.ok, true, orchestrator.reason);
    assert.equal(orchestrator.removed.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an executor clear is refused when only the sidecar or an archived epoch holds a ruling', () => {
  const dir = tmpDir();
  try {
    const sidecarOnly = 'UTV2-21002';
    closedWithRuling(sidecarOnly, dir);
    fs.rmSync(checkpointPath(sidecarOnly, dir));
    const fromSidecar = clearCheckpoint(sidecarOnly, { dir, executorEpochId: 'any-executor' });
    assert.equal(fromSidecar.code, 'execution_checkpoint_ruling_protected');
    assert.equal(fs.existsSync(checkpointRecoveryPath(sidecarOnly, dir)), true);

    const archived = 'UTV2-21003';
    const { timeoutPolicy } = closedWithRuling(archived, dir);
    beginAttempt({
      kind: 'rework',
      issueId: archived,
      rejectedHeadSha: 'c'.repeat(40),
      objectiveIdentity: `issue:${archived}`,
      findingsIdentity: 'review-round-1',
      authority: 'pm-review',
      timeoutPolicy,
      dir,
    });
    finishAttempt({ issueId: archived, outcome: 'failed', reason: 'closed for clear', dir });
    const onlyArchived = { ...readCheckpoint(archived, dir)! };
    delete onlyArchived.orchestrator_rulings;
    writeCheckpoint(onlyArchived, dir);
    assert.equal(readCheckpoint(archived, dir)?.prior_epochs[0]?.orchestrator_rulings?.length, 1);
    const fromArchive = clearCheckpoint(archived, { dir, executorEpochId: 'any-executor' });
    assert.equal(fromArchive.code, 'execution_checkpoint_ruling_protected');
    assert.equal(fs.existsSync(checkpointPath(archived, dir)), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an executor clear fails closed on state it cannot parse, and still clears ruling-free state', () => {
  const dir = tmpDir();
  try {
    const corrupt = 'UTV2-21004';
    closedWithRuling(corrupt, dir);
    fs.writeFileSync(checkpointPath(corrupt, dir), '{"orchestrator_rulings": [', 'utf8');
    fs.writeFileSync(checkpointRecoveryPath(corrupt, dir), 'not json', 'utf8');
    const refused = clearCheckpoint(corrupt, { dir, executorEpochId: 'any-executor' });
    assert.equal(refused.code, 'execution_checkpoint_ruling_protected');
    assert.equal(fs.existsSync(checkpointPath(corrupt, dir)), true);
    assert.equal(fs.existsSync(checkpointRecoveryPath(corrupt, dir)), true);

    const plain = 'UTV2-21005';
    stoppedOnQuestion(plain, dir);
    const cleared = clearCheckpoint(plain, { dir, executorEpochId: 'any-executor' });
    assert.equal(cleared.ok, true, cleared.reason);
    assert.equal(cleared.removed.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the clear CLI refuses under an executor attempt identity when the checkpoint carries a ruling', () => {
  const root = tmpDir();
  try {
    assert.equal(spawnSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'pipe' }).status, 0);
    const dir = path.join(root, 'checkpoints');
    const issueId = 'UTV2-21006';
    const { epochId } = closedWithRuling(issueId, dir);
    const env: NodeJS.ProcessEnv = { ...process.env, UNIT_TALK_EXECUTION_CHECKPOINT_DIR: dir };
    delete env.UNIT_TALK_EXECUTION_EPOCH_ID;

    for (const identity of [epochId, 'stale-epoch-from-an-earlier-attempt']) {
      const asExecutor = runCheckpointCli(['clear', '--issue', issueId], root, {
        ...env,
        UNIT_TALK_EXECUTION_EPOCH_ID: identity,
      });
      assert.equal(asExecutor.status, 1, asExecutor.stdout);
      assert.match(asExecutor.stdout, /execution_checkpoint_ruling_protected/);
      assert.equal(readCheckpoint(issueId, dir)?.orchestrator_rulings?.length, 1);
    }

    const asOrchestrator = runCheckpointCli(['clear', '--issue', issueId], root, env);
    assert.equal(asOrchestrator.status, 0, `${asOrchestrator.stdout}\n${asOrchestrator.stderr}`);
    assert.equal(readCheckpointState(issueId, dir).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
