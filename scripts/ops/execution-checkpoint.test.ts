/**
 * UTV2-1594 section A fixtures: bounded timeout policy + resumable execution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  checkpointPath,
  classifyCheckpointLiveness,
  failVisiblyAndRelease,
  finishAttempt,
  nextPhaseAfter,
  readCheckpoint,
  recordFinding,
  recordHeartbeat,
  recordPendingActions,
  recordPhaseComplete,
  requestCancel,
  resolveExecutionTimeout,
  writeCheckpoint,
  type ExecutionPhase,
} from './execution-checkpoint.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1594-checkpoint-'));
}

const T1_SOL_HIGH = { tier: 'T1' as const, reasoningEffort: 'high', phase: 'implement' as ExecutionPhase };

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

// ── the headline fixture ────────────────────────────────────────────────────

test('FIXTURE: four consecutive timeout/resume attempts become one resumable history, not four replays', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1590';
    const timeoutPolicy = resolveExecutionTimeout(T1_SOL_HIGH);
    const phasesWorked: ExecutionPhase[] = ['orient', 'plan', 'implement', 'verify'];
    const startPhases: ExecutionPhase[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const started = beginAttempt({ issueId, branch: 'codex/utv2-1590', timeoutPolicy, dir });
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
    beginAttempt({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
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
    beginAttempt({ issueId, timeoutPolicy, dir });
    recordFinding(issueId, { phase: 'orient', summary: 'the outbox worker owns retries' }, { dir });
    recordPendingActions(issueId, ['wire the reaper into preflight', 'document the operator command'], { dir });
    finishAttempt({ issueId, outcome: 'timed_out', reason: 'bounded timeout', dir });

    const second = beginAttempt({ issueId, timeoutPolicy, dir });
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
    beginAttempt({ issueId, timeoutPolicy, dir });
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

// ── liveness / silence ──────────────────────────────────────────────────────

test('a heartbeating attempt is active', () => {
  const dir = tmpDir();
  try {
    const issueId = 'UTV2-1594';
    beginAttempt({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
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
    const started = beginAttempt({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
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
    beginAttempt({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
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
    const started = beginAttempt({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
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
    beginAttempt({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });

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
    beginAttempt({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
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
    beginAttempt({ issueId, timeoutPolicy: resolveExecutionTimeout(T1_SOL_HIGH), dir });
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
    beginAttempt({ issueId, timeoutPolicy, dir });
    requestCancel(issueId, 'stop', { dir });
    finishAttempt({ issueId, outcome: 'cancelled', reason: 'operator cancellation', dir });
    const next = beginAttempt({ issueId, timeoutPolicy, dir });
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
    beginAttempt({ issueId, timeoutPolicy, dir });
    recordPhaseComplete(issueId, 'orient', 'orientation complete', { dir });

    const second = beginAttempt({ issueId, timeoutPolicy, dir });
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
    const first = beginAttempt({ issueId, timeoutPolicy, dir });

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
