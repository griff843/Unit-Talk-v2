/**
 * Durable execution checkpoints + bounded timeout policy (UTV2-1594, section A).
 *
 * `codex-exec.ts` used a single hard-coded 30-minute `spawnSync` timeout for
 * every lane. Legitimate long-running T1 work hit it repeatedly, and because
 * nothing survived the killed process, each retry replayed the same analysis
 * from zero. Four consecutive attempts produced four independent runs and no
 * accumulated progress.
 *
 * This module supplies the two missing pieces:
 *
 *  1. A deterministic, bounded timeout derived from (tier, reasoning effort,
 *     phase) instead of one global constant. Every input maps to exactly one
 *     output, and every output is clamped into [floor, hard cap] — long work
 *     gets more room, but execution is never unbounded.
 *
 *  2. A checkpoint file per issue that outlives the process: which phases are
 *     already complete, what was found, what is still pending, when the
 *     executor last showed a sign of life. A resume reads it and skips
 *     completed phases rather than redoing them.
 *
 * Silence is not success: an attempt that ends with no heartbeat inside the
 * silence window is recorded as `silent_no_heartbeat`, a failing outcome, and
 * the resources the attempt owned are released. It never reads as completion.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, emitJson, getFlag, parseArgs, requireIssueId, type LaneTier } from './shared.js';
import { reapVerifySlots, type ReapRecord } from './verify-semaphore.js';

export const EXECUTION_CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const EXECUTION_CHECKPOINT_DIR = path.join(ROOT, '.out', 'ops', 'execution-checkpoints');

export const EXECUTION_PHASES = ['orient', 'plan', 'implement', 'verify', 'closeout'] as const;
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export type AttemptOutcome =
  | 'completed'
  | 'timed_out'
  | 'failed'
  | 'cancelled'
  | 'silent_no_heartbeat';

export type CheckpointStatus = 'in_progress' | 'completed' | 'failed' | 'timed_out' | 'cancelled';

// ── timeout policy ──────────────────────────────────────────────────────────

export const EXECUTION_TIMEOUT_POLICY_ID = 'utv2-1594-exec-timeout-v1';
/** Absolute ceiling. No combination of inputs may exceed this. */
export const EXECUTION_TIMEOUT_HARD_CAP_MS = 4 * 60 * 60 * 1000;
/** Absolute floor, so a pathological multiplier cannot starve an attempt. */
export const EXECUTION_TIMEOUT_FLOOR_MS = 5 * 60 * 1000;

const TIER_BASE_MS: Record<LaneTier, number> = {
  T1: 90 * 60 * 1000,
  T2: 60 * 60 * 1000,
  T3: 30 * 60 * 1000,
};

/**
 * Keyed on reasoning effort rather than the profile name so the policy does
 * not drift when `docs/05_operations/policies/codex-model-routing.json` adds
 * or renames a profile. Effort is the property that actually predicts wall
 * clock.
 */
const EFFORT_MULTIPLIER: Record<string, number> = {
  low: 0.75,
  medium: 1,
  high: 1.5,
  xhigh: 2,
  max: 2.5,
  ultra: 3,
};

const PHASE_MULTIPLIER: Record<ExecutionPhase, number> = {
  orient: 0.5,
  plan: 0.6,
  implement: 1,
  verify: 0.8,
  closeout: 0.5,
};

export interface TimeoutPolicyDecision {
  policy_id: string;
  tier: LaneTier;
  reasoning_effort: string;
  phase: ExecutionPhase;
  base_ms: number;
  effort_multiplier: number;
  phase_multiplier: number;
  raw_ms: number;
  timeout_ms: number;
  hard_cap_ms: number;
  floor_ms: number;
  clamped: 'none' | 'floor' | 'hard_cap';
  fallbacks: string[];
}

/**
 * Deterministic: identical inputs always yield an identical decision, and the
 * result is always inside [floor, hard cap].
 */
export function resolveExecutionTimeout(input: {
  tier: LaneTier;
  reasoningEffort: string;
  phase: ExecutionPhase;
}): TimeoutPolicyDecision {
  const fallbacks: string[] = [];
  const base = TIER_BASE_MS[input.tier];
  const baseMs = base ?? TIER_BASE_MS.T3;
  if (base === undefined) {
    fallbacks.push(`unknown tier '${input.tier}' → T3 base`);
  }
  const effortKey = (input.reasoningEffort ?? '').toLowerCase();
  const effortMultiplier = EFFORT_MULTIPLIER[effortKey];
  if (effortMultiplier === undefined) {
    fallbacks.push(`unknown reasoning effort '${input.reasoningEffort}' → 1x`);
  }
  const phaseMultiplier = PHASE_MULTIPLIER[input.phase];
  if (phaseMultiplier === undefined) {
    fallbacks.push(`unknown phase '${input.phase}' → implement multiplier`);
  }

  const rawMs = Math.round(baseMs * (effortMultiplier ?? 1) * (phaseMultiplier ?? PHASE_MULTIPLIER.implement));
  let timeoutMs = rawMs;
  let clamped: TimeoutPolicyDecision['clamped'] = 'none';
  if (timeoutMs > EXECUTION_TIMEOUT_HARD_CAP_MS) {
    timeoutMs = EXECUTION_TIMEOUT_HARD_CAP_MS;
    clamped = 'hard_cap';
  } else if (timeoutMs < EXECUTION_TIMEOUT_FLOOR_MS) {
    timeoutMs = EXECUTION_TIMEOUT_FLOOR_MS;
    clamped = 'floor';
  }

  return {
    policy_id: EXECUTION_TIMEOUT_POLICY_ID,
    tier: input.tier,
    reasoning_effort: input.reasoningEffort,
    phase: input.phase,
    base_ms: baseMs,
    effort_multiplier: effortMultiplier ?? 1,
    phase_multiplier: phaseMultiplier ?? PHASE_MULTIPLIER.implement,
    raw_ms: rawMs,
    timeout_ms: timeoutMs,
    hard_cap_ms: EXECUTION_TIMEOUT_HARD_CAP_MS,
    floor_ms: EXECUTION_TIMEOUT_FLOOR_MS,
    clamped,
    fallbacks,
  };
}

// ── checkpoint model ────────────────────────────────────────────────────────

export interface ExecutionFinding {
  id: string;
  phase: ExecutionPhase;
  summary: string;
  recorded_at: string;
  attempt: number;
}

export interface CompletedPhase {
  phase: ExecutionPhase;
  completed_at: string;
  attempt: number;
  summary: string;
}

export interface ExecutionAttempt {
  attempt: number;
  started_at: string;
  ended_at: string | null;
  outcome: AttemptOutcome | null;
  reason: string | null;
  phase_at_start: ExecutionPhase;
  phase_at_end: ExecutionPhase | null;
  timeout_ms: number;
  head_sha: string | null;
  released_resources: string[];
}

export interface ExecutionCheckpoint {
  schema_version: typeof EXECUTION_CHECKPOINT_SCHEMA_VERSION;
  issue_id: string;
  branch: string | null;
  worktree: string | null;
  head_sha: string | null;
  status: CheckpointStatus;
  phase: ExecutionPhase;
  attempt: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  heartbeat_at: string;
  heartbeat_interval_ms: number;
  timeout_policy: TimeoutPolicyDecision | null;
  completed_phases: CompletedPhase[];
  findings: ExecutionFinding[];
  pending_actions: string[];
  attempts: ExecutionAttempt[];
  cancel_requested: boolean;
  cancel_reason: string | null;
  owner: { pid: number; host: string } | null;
}

export const DEFAULT_CHECKPOINT_HEARTBEAT_INTERVAL_MS = 60_000;
/** No heartbeat for this long while an attempt is open ⇒ the executor is silent. */
export const DEFAULT_SILENCE_WINDOW_MS = 10 * 60 * 1000;

export function checkpointPath(issueId: string, dir: string = EXECUTION_CHECKPOINT_DIR): string {
  return path.join(dir, `${issueId}.json`);
}

function backupPath(filePath: string): string {
  return `${filePath}.bak`;
}

function isCheckpoint(value: unknown): value is ExecutionCheckpoint {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as ExecutionCheckpoint).schema_version === EXECUTION_CHECKPOINT_SCHEMA_VERSION &&
    typeof (value as ExecutionCheckpoint).issue_id === 'string' &&
    Array.isArray((value as ExecutionCheckpoint).attempts)
  );
}

function readCheckpointFile(filePath: string): ExecutionCheckpoint | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isCheckpoint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * "Resume from the latest *valid* checkpoint": a truncated or corrupt primary
 * file falls back to the previous good write rather than silently discarding
 * accumulated progress and replaying analysis.
 */
export function readCheckpoint(issueId: string, dir: string = EXECUTION_CHECKPOINT_DIR): ExecutionCheckpoint | null {
  const filePath = checkpointPath(issueId, dir);
  return readCheckpointFile(filePath) ?? readCheckpointFile(backupPath(filePath));
}

export function writeCheckpoint(checkpoint: ExecutionCheckpoint, dir: string = EXECUTION_CHECKPOINT_DIR): string {
  const filePath = checkpointPath(checkpoint.issue_id, dir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, backupPath(filePath));
    } catch {
      // best effort
    }
  }
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
  return filePath;
}

function touch(checkpoint: ExecutionCheckpoint, now: string): ExecutionCheckpoint {
  return { ...checkpoint, updated_at: now, last_activity_at: now };
}

// ── resume ──────────────────────────────────────────────────────────────────

export interface ResumePlan {
  resumed: boolean;
  resume_from_phase: ExecutionPhase;
  completed_phases: ExecutionPhase[];
  skipped_phases: ExecutionPhase[];
  carried_findings: ExecutionFinding[];
  pending_actions: string[];
  prior_attempts: ExecutionAttempt[];
}

export function nextPhaseAfter(completed: ExecutionPhase[]): ExecutionPhase {
  for (const phase of EXECUTION_PHASES) {
    if (!completed.includes(phase)) {
      return phase;
    }
  }
  return EXECUTION_PHASES[EXECUTION_PHASES.length - 1];
}

export function buildResumePlan(checkpoint: ExecutionCheckpoint | null): ResumePlan {
  if (!checkpoint) {
    return {
      resumed: false,
      resume_from_phase: EXECUTION_PHASES[0],
      completed_phases: [],
      skipped_phases: [],
      carried_findings: [],
      pending_actions: [],
      prior_attempts: [],
    };
  }
  const completed = checkpoint.completed_phases.map((entry) => entry.phase);
  return {
    resumed: checkpoint.attempts.length > 0,
    resume_from_phase: nextPhaseAfter(completed),
    completed_phases: completed,
    skipped_phases: completed,
    carried_findings: checkpoint.findings,
    pending_actions: checkpoint.pending_actions,
    prior_attempts: checkpoint.attempts,
  };
}

/**
 * The resume contract, rendered for the executor prompt. This is what makes a
 * resume cheaper than a restart: completed phases and prior findings are
 * stated as already-established facts that must not be re-derived.
 */
export function buildResumeBrief(checkpoint: ExecutionCheckpoint | null): string {
  const plan = buildResumePlan(checkpoint);
  if (!plan.resumed || !checkpoint) {
    return [
      '## Execution checkpoint',
      '',
      'No prior attempt exists — this is attempt 1. Record progress as you go:',
      '',
      '- `pnpm ops:exec-checkpoint phase-complete --issue <ID> --phase <phase> --summary "<what is now settled>"`',
      '- `pnpm ops:exec-checkpoint finding --issue <ID> --phase <phase> --summary "<durable conclusion>"`',
      '- `pnpm ops:exec-checkpoint heartbeat --issue <ID>` at least every few minutes of long work',
      '',
      'If this attempt is cut short, the next one resumes from what you recorded — anything not recorded is lost and will be redone.',
    ].join('\n');
  }

  const lines: string[] = [
    '## Execution checkpoint — RESUMED RUN',
    '',
    `This is attempt ${checkpoint.attempt + 1} for ${checkpoint.issue_id}. Prior attempts: ${plan.prior_attempts.length}.`,
    '',
    '**Do not repeat completed analysis.** The following phases are already finished and their conclusions are authoritative:',
    '',
  ];
  if (plan.completed_phases.length === 0) {
    lines.push('- (no phase completed yet)');
  } else {
    for (const entry of checkpoint.completed_phases) {
      lines.push(`- \`${entry.phase}\` (attempt ${entry.attempt}, ${entry.completed_at}): ${entry.summary}`);
    }
  }
  lines.push('', `Resume at phase: \`${plan.resume_from_phase}\`.`, '', '### Established findings (do not re-derive)', '');
  if (plan.carried_findings.length === 0) {
    lines.push('- (none recorded)');
  } else {
    for (const finding of plan.carried_findings) {
      lines.push(`- [${finding.phase}] ${finding.summary}`);
    }
  }
  lines.push('', '### Pending actions carried forward', '');
  if (plan.pending_actions.length === 0) {
    lines.push('- (none recorded)');
  } else {
    for (const action of plan.pending_actions) {
      lines.push(`- ${action}`);
    }
  }
  lines.push(
    '',
    '### Prior attempt outcomes',
    '',
    ...plan.prior_attempts.map(
      (attempt) =>
        `- attempt ${attempt.attempt}: ${attempt.outcome ?? 'unknown'} at phase ` +
        `${attempt.phase_at_end ?? attempt.phase_at_start} — ${attempt.reason ?? 'no reason recorded'}`,
    ),
    '',
    'Keep recording progress with `pnpm ops:exec-checkpoint phase-complete|finding|heartbeat` so the next attempt can resume too.',
  );
  return lines.join('\n');
}

// ── mutations ───────────────────────────────────────────────────────────────

export interface BeginAttemptInput {
  issueId: string;
  branch?: string | null;
  worktree?: string | null;
  headSha?: string | null;
  timeoutPolicy: TimeoutPolicyDecision;
  heartbeatIntervalMs?: number;
  dir?: string;
  now?: Date;
}

export interface BeginAttemptResult {
  checkpoint: ExecutionCheckpoint;
  resume: ResumePlan;
  path: string;
}

export function beginAttempt(input: BeginAttemptInput): BeginAttemptResult {
  const dir = input.dir ?? EXECUTION_CHECKPOINT_DIR;
  const now = (input.now ?? new Date()).toISOString();
  const existing = readCheckpoint(input.issueId, dir);
  const resume = buildResumePlan(existing);
  const attempt = (existing?.attempt ?? 0) + 1;

  const attemptRecord: ExecutionAttempt = {
    attempt,
    started_at: now,
    ended_at: null,
    outcome: null,
    reason: null,
    phase_at_start: resume.resume_from_phase,
    phase_at_end: null,
    timeout_ms: input.timeoutPolicy.timeout_ms,
    head_sha: input.headSha ?? null,
    released_resources: [],
  };

  const checkpoint: ExecutionCheckpoint = {
    schema_version: EXECUTION_CHECKPOINT_SCHEMA_VERSION,
    issue_id: input.issueId,
    branch: input.branch ?? existing?.branch ?? null,
    worktree: input.worktree ?? existing?.worktree ?? null,
    head_sha: input.headSha ?? existing?.head_sha ?? null,
    status: 'in_progress',
    phase: resume.resume_from_phase,
    attempt,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    last_activity_at: now,
    heartbeat_at: now,
    heartbeat_interval_ms: input.heartbeatIntervalMs ?? DEFAULT_CHECKPOINT_HEARTBEAT_INTERVAL_MS,
    timeout_policy: input.timeoutPolicy,
    completed_phases: existing?.completed_phases ?? [],
    findings: existing?.findings ?? [],
    pending_actions: existing?.pending_actions ?? [],
    attempts: [...(existing?.attempts ?? []), attemptRecord],
    cancel_requested: false,
    cancel_reason: null,
    owner: { pid: process.pid, host: os.hostname() || 'unknown' },
  };

  const filePath = writeCheckpoint(checkpoint, dir);
  return { checkpoint, resume, path: filePath };
}

function mutate(
  issueId: string,
  dir: string,
  now: Date,
  fn: (checkpoint: ExecutionCheckpoint, nowIso: string) => ExecutionCheckpoint,
): ExecutionCheckpoint | null {
  const existing = readCheckpoint(issueId, dir);
  if (!existing) {
    return null;
  }
  const nowIso = now.toISOString();
  const next = touch(fn(existing, nowIso), nowIso);
  writeCheckpoint(next, dir);
  return next;
}

export function recordHeartbeat(
  issueId: string,
  options: { dir?: string; now?: Date } = {},
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), (checkpoint, nowIso) => ({
    ...checkpoint,
    heartbeat_at: nowIso,
  }));
}

export function recordPhaseComplete(
  issueId: string,
  phase: ExecutionPhase,
  summary: string,
  options: { dir?: string; now?: Date } = {},
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), (checkpoint, nowIso) => {
    if (checkpoint.completed_phases.some((entry) => entry.phase === phase)) {
      return checkpoint;
    }
    const completed = [...checkpoint.completed_phases, { phase, completed_at: nowIso, attempt: checkpoint.attempt, summary }];
    return {
      ...checkpoint,
      completed_phases: completed,
      phase: nextPhaseAfter(completed.map((entry) => entry.phase)),
      heartbeat_at: nowIso,
    };
  });
}

export function recordFinding(
  issueId: string,
  finding: { phase: ExecutionPhase; summary: string; id?: string },
  options: { dir?: string; now?: Date } = {},
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), (checkpoint, nowIso) => {
    const id = finding.id ?? `${finding.phase}-${checkpoint.findings.length + 1}`;
    if (checkpoint.findings.some((entry) => entry.id === id)) {
      return checkpoint;
    }
    return {
      ...checkpoint,
      findings: [
        ...checkpoint.findings,
        { id, phase: finding.phase, summary: finding.summary, recorded_at: nowIso, attempt: checkpoint.attempt },
      ],
      heartbeat_at: nowIso,
    };
  });
}

export function recordPendingActions(
  issueId: string,
  actions: string[],
  options: { dir?: string; now?: Date } = {},
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), (checkpoint, nowIso) => ({
    ...checkpoint,
    pending_actions: actions,
    heartbeat_at: nowIso,
  }));
}

export function requestCancel(
  issueId: string,
  reason: string,
  options: { dir?: string; now?: Date } = {},
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), (checkpoint) => ({
    ...checkpoint,
    cancel_requested: true,
    cancel_reason: reason,
  }));
}

const OUTCOME_TO_STATUS: Record<AttemptOutcome, CheckpointStatus> = {
  completed: 'completed',
  timed_out: 'timed_out',
  failed: 'failed',
  cancelled: 'cancelled',
  silent_no_heartbeat: 'timed_out',
};

export interface FinishAttemptInput {
  issueId: string;
  outcome: AttemptOutcome;
  reason: string;
  dir?: string;
  now?: Date;
  releasedResources?: string[];
}

export function finishAttempt(input: FinishAttemptInput): ExecutionCheckpoint | null {
  return mutate(input.issueId, input.dir ?? EXECUTION_CHECKPOINT_DIR, input.now ?? new Date(), (checkpoint, nowIso) => {
    const attempts = checkpoint.attempts.map((attempt) =>
      attempt.attempt === checkpoint.attempt && attempt.ended_at === null
        ? {
            ...attempt,
            ended_at: nowIso,
            outcome: input.outcome,
            reason: input.reason,
            phase_at_end: checkpoint.phase,
            released_resources: input.releasedResources ?? [],
          }
        : attempt,
    );
    return { ...checkpoint, attempts, status: OUTCOME_TO_STATUS[input.outcome] };
  });
}

// ── liveness ────────────────────────────────────────────────────────────────

export type CheckpointLiveness = 'no_attempt' | 'active' | 'silent' | 'closed';

export interface CheckpointLivenessVerdict {
  state: CheckpointLiveness;
  silent: boolean;
  heartbeat_age_ms: number | null;
  silence_window_ms: number;
  reason: string;
}

/**
 * A process that stopped heartbeating is not "probably fine" — it is silent,
 * and silence must surface as a failure rather than be mistaken for progress
 * or for success.
 */
export function classifyCheckpointLiveness(
  checkpoint: ExecutionCheckpoint | null,
  options: { now?: Date; silenceWindowMs?: number } = {},
): CheckpointLivenessVerdict {
  const silenceWindowMs = options.silenceWindowMs ?? DEFAULT_SILENCE_WINDOW_MS;
  const now = (options.now ?? new Date()).getTime();
  if (!checkpoint || checkpoint.attempts.length === 0) {
    return {
      state: 'no_attempt',
      silent: false,
      heartbeat_age_ms: null,
      silence_window_ms: silenceWindowMs,
      reason: 'no execution attempt has been opened for this issue',
    };
  }
  const open = checkpoint.attempts.find((attempt) => attempt.ended_at === null);
  if (!open) {
    return {
      state: 'closed',
      silent: false,
      heartbeat_age_ms: null,
      silence_window_ms: silenceWindowMs,
      reason: `latest attempt closed with outcome '${checkpoint.attempts[checkpoint.attempts.length - 1]?.outcome ?? 'unknown'}'`,
    };
  }
  const heartbeatAt = Date.parse(checkpoint.heartbeat_at);
  const age = Number.isFinite(heartbeatAt) ? now - heartbeatAt : null;
  if (age === null || age > silenceWindowMs) {
    return {
      state: 'silent',
      silent: true,
      heartbeat_age_ms: age,
      silence_window_ms: silenceWindowMs,
      reason:
        age === null
          ? `attempt ${open.attempt} is open but its heartbeat timestamp is unreadable — treated as silent`
          : `attempt ${open.attempt} has not heartbeat for ${Math.round(age / 1000)}s (window ${Math.round(silenceWindowMs / 1000)}s)`,
    };
  }
  return {
    state: 'active',
    silent: false,
    heartbeat_age_ms: age,
    silence_window_ms: silenceWindowMs,
    reason: `attempt ${open.attempt} heartbeat is ${Math.round(age / 1000)}s old`,
  };
}

/**
 * Close out a silent or timed-out attempt: record the failing outcome AND
 * release the shared resources it may still be holding. Only provably dead
 * verify-slot owners are reclaimed — a live verify is never touched.
 */
export function failVisiblyAndRelease(input: {
  issueId: string;
  outcome: Extract<AttemptOutcome, 'timed_out' | 'failed' | 'silent_no_heartbeat' | 'cancelled'>;
  reason: string;
  dir?: string;
  now?: Date;
  semaphoreDir?: string;
  reap?: (options: { dir?: string }) => ReapRecord[];
}): { checkpoint: ExecutionCheckpoint | null; released: ReapRecord[] } {
  const reap = input.reap ?? ((options: { dir?: string }) => reapVerifySlots(options));
  let released: ReapRecord[] = [];
  try {
    released = reap({ dir: input.semaphoreDir });
  } catch {
    released = [];
  }
  const checkpoint = finishAttempt({
    issueId: input.issueId,
    outcome: input.outcome,
    reason: input.reason,
    dir: input.dir,
    now: input.now,
    releasedResources: released.map((record) => `verify-slot-${record.slot}:${record.state}`),
  });
  return { checkpoint, released };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parsePhase(value: string | undefined): ExecutionPhase {
  if (value && (EXECUTION_PHASES as readonly string[]).includes(value)) {
    return value as ExecutionPhase;
  }
  throw new Error(`--phase must be one of: ${EXECUTION_PHASES.join(', ')}`);
}

function runCli(): void {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? 'status';
  const dir = getFlag(flags, 'dir') ?? EXECUTION_CHECKPOINT_DIR;

  try {
    const issueId = requireIssueId(getFlag(flags, 'issue') ?? '');
    switch (command) {
      case 'status': {
        const checkpoint = readCheckpoint(issueId, dir);
        emitJson({
          ok: true,
          code: 'execution_checkpoint_status',
          issue_id: issueId,
          checkpoint,
          resume: buildResumePlan(checkpoint),
          liveness: classifyCheckpointLiveness(checkpoint),
        });
        process.exitCode = 0;
        return;
      }
      case 'resume-brief': {
        process.stdout.write(`${buildResumeBrief(readCheckpoint(issueId, dir))}\n`);
        process.exitCode = 0;
        return;
      }
      case 'heartbeat': {
        const checkpoint = recordHeartbeat(issueId, { dir });
        emitJson({
          ok: Boolean(checkpoint),
          code: checkpoint ? 'execution_checkpoint_heartbeat' : 'execution_checkpoint_missing',
          issue_id: issueId,
          heartbeat_at: checkpoint?.heartbeat_at ?? null,
        });
        process.exitCode = checkpoint ? 0 : 1;
        return;
      }
      case 'phase-complete': {
        const checkpoint = recordPhaseComplete(
          issueId,
          parsePhase(getFlag(flags, 'phase')),
          getFlag(flags, 'summary') ?? 'phase completed',
          { dir },
        );
        emitJson({
          ok: Boolean(checkpoint),
          code: checkpoint ? 'execution_checkpoint_phase_complete' : 'execution_checkpoint_missing',
          issue_id: issueId,
          phase: checkpoint?.phase ?? null,
          completed_phases: checkpoint?.completed_phases.map((entry) => entry.phase) ?? [],
        });
        process.exitCode = checkpoint ? 0 : 1;
        return;
      }
      case 'finding': {
        const checkpoint = recordFinding(
          issueId,
          { phase: parsePhase(getFlag(flags, 'phase')), summary: getFlag(flags, 'summary') ?? '' },
          { dir },
        );
        emitJson({
          ok: Boolean(checkpoint),
          code: checkpoint ? 'execution_checkpoint_finding' : 'execution_checkpoint_missing',
          issue_id: issueId,
          findings: checkpoint?.findings.length ?? 0,
        });
        process.exitCode = checkpoint ? 0 : 1;
        return;
      }
      case 'pending': {
        const checkpoint = recordPendingActions(issueId, flags.get('action') ?? [], { dir });
        emitJson({
          ok: Boolean(checkpoint),
          code: checkpoint ? 'execution_checkpoint_pending' : 'execution_checkpoint_missing',
          issue_id: issueId,
          pending_actions: checkpoint?.pending_actions ?? [],
        });
        process.exitCode = checkpoint ? 0 : 1;
        return;
      }
      case 'cancel': {
        const checkpoint = requestCancel(issueId, getFlag(flags, 'reason') ?? 'operator cancellation', { dir });
        emitJson({
          ok: Boolean(checkpoint),
          code: checkpoint ? 'execution_checkpoint_cancel_requested' : 'execution_checkpoint_missing',
          issue_id: issueId,
          cancel_reason: checkpoint?.cancel_reason ?? null,
        });
        process.exitCode = checkpoint ? 0 : 1;
        return;
      }
      default:
        throw new Error(
          'Usage: pnpm ops:exec-checkpoint <status|resume-brief|heartbeat|phase-complete|finding|pending|cancel> --issue UTV2-### [--phase <phase>] [--summary <text>] [--reason <text>] [--action <text>]',
        );
    }
  } catch (error) {
    emitJson({
      ok: false,
      code: 'execution_checkpoint_cli_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  runCli();
}
