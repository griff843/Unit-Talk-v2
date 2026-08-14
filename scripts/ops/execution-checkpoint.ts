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
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, emitJson, getFlag, parseArgs, requireIssueId, type LaneTier } from './shared.js';
import { reapVerifySlots, type ReapRecord } from './verify-semaphore.js';

export const EXECUTION_CHECKPOINT_SCHEMA_VERSION = 2 as const;
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
  epoch_id: string;
  source_epoch_id: string | null;
  phase: ExecutionPhase;
  summary: string;
  recorded_at: string;
  attempt: number;
}

export interface CompletedPhase {
  epoch_id: string;
  phase: ExecutionPhase;
  completed_at: string;
  attempt: number;
  summary: string;
}

export interface ExecutionAttempt {
  epoch_id: string;
  attempt: number;
  started_at: string;
  ended_at: string | null;
  outcome: AttemptOutcome | null;
  reason: string | null;
  phase_at_start: ExecutionPhase;
  phase_at_end: ExecutionPhase | null;
  timeout_ms: number;
  attempt_start_sha: string;
  released_resources: string[];
}

export type ExecutionEpochMode = 'fresh' | 'rework';

export interface ExecutionEpoch {
  epoch_id: string;
  mode: ExecutionEpochMode;
  implementation_baseline_sha: string;
  objective_identity: string;
  findings_identity: string;
  created_at: string;
  authority: string;
}

export interface ArchivedExecutionEpoch {
  epoch: ExecutionEpoch;
  archived_at: string;
  completed_phases: CompletedPhase[];
  findings: ExecutionFinding[];
  pending_actions: string[];
  attempts: ExecutionAttempt[];
}

export interface CheckpointIntegrity {
  algorithm: 'sha256';
  checksum: string;
}

export interface ExecutionCheckpoint {
  schema_version: typeof EXECUTION_CHECKPOINT_SCHEMA_VERSION;
  issue_id: string;
  branch: string | null;
  worktree: string | null;
  state_revision: number;
  epoch: ExecutionEpoch;
  prior_epochs: ArchivedExecutionEpoch[];
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
  integrity: CheckpointIntegrity;
}

export const DEFAULT_CHECKPOINT_HEARTBEAT_INTERVAL_MS = 60_000;
/** No heartbeat for this long while an attempt is open ⇒ the executor is silent. */
export const DEFAULT_SILENCE_WINDOW_MS = 10 * 60 * 1000;

export function checkpointPath(issueId: string, dir: string = EXECUTION_CHECKPOINT_DIR): string {
  return path.join(dir, `${issueId}.json`);
}

export function checkpointRecoveryPath(issueId: string, dir: string = EXECUTION_CHECKPOINT_DIR): string {
  return `${checkpointPath(issueId, dir)}.bak`;
}

export function checkpointMutationLockPath(issueId: string, dir: string = EXECUTION_CHECKPOINT_DIR): string {
  return `${checkpointPath(issueId, dir)}.lock`;
}

class CheckpointMutationLockedError extends Error {
  constructor(issueId: string) {
    super(`EXECUTION_STATE_LOCKED: another checkpoint transition is active for ${issueId}`);
    this.name = 'CheckpointMutationLockedError';
  }
}

interface CheckpointMutationLockOwner {
  pid: number;
  host: string;
  token: string;
}

function isLocalProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readCheckpointLockOwner(lockPath: string): CheckpointMutationLockOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<CheckpointMutationLockOwner>;
    return Number.isSafeInteger(value.pid) && typeof value.host === 'string' && typeof value.token === 'string'
      ? (value as CheckpointMutationLockOwner)
      : null;
  } catch {
    return null;
  }
}

/**
 * Serialize checkpoint read-modify-write transitions. Clear and beginAttempt
 * share this lock, so clear can never delete an attempt created between its
 * active-state check and file removal.
 */
function withCheckpointMutationLock<T>(issueId: string, dir: string, action: () => T): T {
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = checkpointMutationLockPath(issueId, dir);
  const owner: CheckpointMutationLockOwner = {
    pid: process.pid,
    host: os.hostname() || 'unknown',
    token: randomUUID(),
  };

  const acquire = (): number => {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${JSON.stringify(owner)}\n`, 'utf8');
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = readCheckpointLockOwner(lockPath);
      if (existing && existing.host === owner.host && !isLocalProcessAlive(existing.pid)) {
        fs.rmSync(lockPath, { force: true });
        try {
          const fd = fs.openSync(lockPath, 'wx');
          fs.writeFileSync(fd, `${JSON.stringify(owner)}\n`, 'utf8');
          return fd;
        } catch (retryError) {
          if ((retryError as NodeJS.ErrnoException).code !== 'EEXIST') throw retryError;
        }
      }
      throw new CheckpointMutationLockedError(issueId);
    }
  };

  const fd = acquire();
  try {
    return action();
  } finally {
    fs.closeSync(fd);
    const current = readCheckpointLockOwner(lockPath);
    if (current?.token === owner.token) {
      fs.rmSync(lockPath, { force: true });
    }
  }
}

function checkpointChecksum(checkpoint: ExecutionCheckpoint): string {
  const payload = {
    ...checkpoint,
    integrity: { algorithm: 'sha256' as const, checksum: '' },
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function sealCheckpoint(checkpoint: ExecutionCheckpoint): ExecutionCheckpoint {
  const unsealed: ExecutionCheckpoint = {
    ...checkpoint,
    integrity: { algorithm: 'sha256', checksum: '' },
  };
  return {
    ...unsealed,
    integrity: { algorithm: 'sha256', checksum: checkpointChecksum(unsealed) },
  };
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

function isCheckpoint(value: unknown, issueId: string): value is ExecutionCheckpoint {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as ExecutionCheckpoint).schema_version !== EXECUTION_CHECKPOINT_SCHEMA_VERSION
  ) {
    return false;
  }
  const checkpoint = value as ExecutionCheckpoint;
  const currentEpochId = checkpoint.epoch?.epoch_id;
  return (
    checkpoint.issue_id === issueId &&
    Number.isSafeInteger(checkpoint.state_revision) &&
    checkpoint.state_revision > 0 &&
    typeof currentEpochId === 'string' &&
    (checkpoint.epoch.mode === 'fresh' || checkpoint.epoch.mode === 'rework') &&
    isSha(checkpoint.epoch.implementation_baseline_sha) &&
    typeof checkpoint.epoch.objective_identity === 'string' &&
    typeof checkpoint.epoch.findings_identity === 'string' &&
    typeof checkpoint.epoch.authority === 'string' &&
    Array.isArray(checkpoint.prior_epochs) &&
    Array.isArray(checkpoint.attempts) &&
    checkpoint.attempts.length > 0 &&
    checkpoint.attempts.every(
      (attempt) =>
        attempt.epoch_id === currentEpochId &&
        Number.isSafeInteger(attempt.attempt) &&
        attempt.attempt > 0 &&
        isSha(attempt.attempt_start_sha),
    ) &&
    checkpoint.attempts.at(-1)?.attempt === checkpoint.attempt &&
    checkpoint.completed_phases.every((phase) => phase.epoch_id === currentEpochId) &&
    checkpoint.findings.every((finding) => finding.epoch_id === currentEpochId) &&
    checkpoint.integrity?.algorithm === 'sha256' &&
    /^[0-9a-f]{64}$/i.test(checkpoint.integrity.checksum) &&
    checkpoint.integrity.checksum === checkpointChecksum(checkpoint)
  );
}

function readCheckpointFile(filePath: string, issueId: string): ExecutionCheckpoint | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isCheckpoint(parsed, issueId) ? parsed : null;
  } catch {
    return null;
  }
}

export interface CheckpointReadResult {
  ok: boolean;
  code: 'execution_checkpoint_primary' | 'execution_checkpoint_recovered' | 'execution_checkpoint_unavailable';
  checkpoint: ExecutionCheckpoint | null;
  provenance: {
    source: 'primary' | 'sidecar' | 'none';
    recovered: boolean;
    path: string | null;
    state_revision: number | null;
    epoch_id: string | null;
    attempt: number | null;
  };
  reason: string;
}

export interface ExecutionStateIdentity {
  epoch_id: string;
  attempt: number;
  minimum_revision: number;
}

export function readCheckpointState(
  issueId: string,
  dir: string = EXECUTION_CHECKPOINT_DIR,
  expected?: ExecutionStateIdentity,
): CheckpointReadResult {
  const primaryPath = checkpointPath(issueId, dir);
  const sidecarPath = checkpointRecoveryPath(issueId, dir);
  const primary = readCheckpointFile(primaryPath, issueId);
  const sidecar = readCheckpointFile(sidecarPath, issueId);
  let checkpoint: ExecutionCheckpoint | null = null;
  let source: 'primary' | 'sidecar' | 'none' = 'none';

  if (primary && sidecar && primary.state_revision === sidecar.state_revision) {
    if (primary.integrity.checksum !== sidecar.integrity.checksum) {
      return {
        ok: false,
        code: 'execution_checkpoint_unavailable',
        checkpoint: null,
        provenance: {
          source: 'none',
          recovered: false,
          path: null,
          state_revision: null,
          epoch_id: null,
          attempt: null,
        },
        reason: 'primary and sidecar have the same revision but conflicting checksums',
      };
    }
    checkpoint = primary;
    source = 'primary';
  } else if (primary && (!sidecar || primary.state_revision > sidecar.state_revision)) {
    checkpoint = primary;
    source = 'primary';
  } else if (sidecar) {
    checkpoint = sidecar;
    source = 'sidecar';
  }

  if (!checkpoint) {
    const primaryExists = fs.existsSync(primaryPath);
    const sidecarExists = fs.existsSync(sidecarPath);
    return {
      ok: false,
      code: 'execution_checkpoint_unavailable',
      checkpoint: null,
      provenance: {
        source: 'none',
        recovered: false,
        path: null,
        state_revision: null,
        epoch_id: null,
        attempt: null,
      },
      reason:
        !primaryExists && !sidecarExists
          ? 'primary and sidecar are both missing'
          : 'primary and sidecar are invalid for the requested issue/schema/checksum/epoch/attempt/revision',
    };
  }

  const identityMatches =
    !expected ||
    (checkpoint.epoch.epoch_id === expected.epoch_id &&
      checkpoint.attempt === expected.attempt &&
      checkpoint.state_revision >= expected.minimum_revision);
  const originatingAttemptIsOpen =
    !expected ||
    (checkpoint.status === 'in_progress' &&
      checkpoint.attempts.some(
        (attempt) =>
          attempt.epoch_id === expected.epoch_id &&
          attempt.attempt === expected.attempt &&
          attempt.ended_at === null,
      ));

  if (expected && (!identityMatches || !originatingAttemptIsOpen)) {
    return {
      ok: false,
      code: 'execution_checkpoint_unavailable',
      checkpoint: null,
      provenance: {
        source: 'none',
        recovered: false,
        path: null,
        state_revision: null,
        epoch_id: null,
        attempt: null,
      },
      reason: !identityMatches
        ? `validated ${source} state does not match expected epoch/attempt/revision ` +
          `${expected.epoch_id}/${expected.attempt}/${expected.minimum_revision}`
        : `validated ${source} state matches ${expected.epoch_id}/${expected.attempt} but that attempt is not open and in progress`,
    };
  }

  return {
    ok: true,
    code: source === 'primary' ? 'execution_checkpoint_primary' : 'execution_checkpoint_recovered',
    checkpoint,
    provenance: {
      source,
      recovered: source === 'sidecar',
      path: source === 'primary' ? primaryPath : sidecarPath,
      state_revision: checkpoint.state_revision,
      epoch_id: checkpoint.epoch.epoch_id,
      attempt: checkpoint.attempt,
    },
    reason:
      source === 'primary'
        ? 'validated primary checkpoint'
        : 'primary unavailable or stale; recovered validated sidecar checkpoint',
  };
}

/**
 * "Resume from the latest *valid* checkpoint": a truncated or corrupt primary
 * file falls back to the previous good write rather than silently discarding
 * accumulated progress and replaying analysis.
 */
export function readCheckpoint(issueId: string, dir: string = EXECUTION_CHECKPOINT_DIR): ExecutionCheckpoint | null {
  return readCheckpointState(issueId, dir).checkpoint;
}

export function writeCheckpoint(checkpoint: ExecutionCheckpoint, dir: string = EXECUTION_CHECKPOINT_DIR): string {
  const filePath = checkpointPath(checkpoint.issue_id, dir);
  const sidecarPath = checkpointRecoveryPath(checkpoint.issue_id, dir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sealed = sealCheckpoint(checkpoint);
  const body = `${JSON.stringify(sealed, null, 2)}\n`;
  for (const target of [sidecarPath, filePath]) {
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, target);
  }
  return filePath;
}

function touch(checkpoint: ExecutionCheckpoint, now: string): ExecutionCheckpoint {
  return sealCheckpoint({
    ...checkpoint,
    state_revision: checkpoint.state_revision + 1,
    updated_at: now,
    last_activity_at: now,
  });
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

interface BeginAttemptCommon {
  issueId: string;
  branch?: string | null;
  worktree?: string | null;
  timeoutPolicy: TimeoutPolicyDecision;
  heartbeatIntervalMs?: number;
  dir?: string;
  now?: Date;
}

export type BeginAttemptInput = BeginAttemptCommon &
  (
    | {
        kind: 'fresh';
        currentHeadSha: string;
        objectiveIdentity: string;
        authority: string;
      }
    | {
        kind: 'resume';
        attemptStartSha: string;
      }
    | {
        kind: 'rework';
        rejectedHeadSha: string;
        objectiveIdentity: string;
        findingsIdentity: string;
        authority: string;
      }
  );

export interface BeginAttemptResult {
  checkpoint: ExecutionCheckpoint;
  resume: ResumePlan;
  identity: ExecutionStateIdentity;
  path: string;
}

function closeDanglingAttempts(
  attempts: ExecutionAttempt[],
  phase: ExecutionPhase,
  now: string,
  nextAttempt: number,
): ExecutionAttempt[] {
  return attempts.map((prior) =>
    prior.ended_at === null
      ? {
          ...prior,
          ended_at: now,
          outcome: 'silent_no_heartbeat' as AttemptOutcome,
          reason: `attempt ${prior.attempt} never reported an outcome; closed when attempt ${nextAttempt} started`,
          phase_at_end: prior.phase_at_end ?? phase ?? prior.phase_at_start,
        }
      : prior,
  );
}

export function beginAttempt(input: BeginAttemptInput): BeginAttemptResult {
  const dir = input.dir ?? EXECUTION_CHECKPOINT_DIR;
  return withCheckpointMutationLock(input.issueId, dir, () => {
    const now = (input.now ?? new Date()).toISOString();
    const existingState = readCheckpointState(input.issueId, dir);
    const existing = existingState.checkpoint;

  if (input.kind === 'fresh' && existing) {
    throw new Error(
      `execution state already exists for ${input.issueId}; use resume or an explicit rework epoch instead of replacing it`,
    );
  }
  if ((input.kind === 'resume' || input.kind === 'rework') && !existing) {
    throw new Error(`EXECUTION_STATE_UNAVAILABLE: cannot ${input.kind} ${input.issueId}: ${existingState.reason}`);
  }

  const epoch: ExecutionEpoch =
    input.kind === 'resume'
      ? existing!.epoch
      : {
          epoch_id: randomUUID(),
          mode: input.kind,
          implementation_baseline_sha: input.kind === 'fresh' ? input.currentHeadSha : input.rejectedHeadSha,
          objective_identity: input.objectiveIdentity,
          findings_identity: input.kind === 'fresh' ? 'none' : input.findingsIdentity,
          created_at: now,
          authority: input.authority,
        };
  if (!isSha(epoch.implementation_baseline_sha)) {
    throw new Error(`${input.kind} execution requires a full 40-character Git SHA`);
  }

  const reworkFindings: ExecutionFinding[] =
    input.kind === 'rework'
      ? existing!.findings.map((finding) => ({
          ...finding,
          epoch_id: epoch.epoch_id,
          source_epoch_id: finding.epoch_id,
          recorded_at: now,
          attempt: 1,
        }))
      : [];
  const priorEpochs: ArchivedExecutionEpoch[] =
    input.kind === 'rework'
      ? [
          ...existing!.prior_epochs,
          {
            epoch: existing!.epoch,
            archived_at: now,
            completed_phases: existing!.completed_phases,
            findings: existing!.findings,
            pending_actions: existing!.pending_actions,
            attempts: closeDanglingAttempts(existing!.attempts, existing!.phase, now, existing!.attempt + 1),
          },
        ]
      : (existing?.prior_epochs ?? []);
  const completedPhases = input.kind === 'resume' ? existing!.completed_phases : [];
  const findings = input.kind === 'resume' ? existing!.findings : reworkFindings;
  const pendingActions = input.kind === 'fresh' ? [] : existing!.pending_actions;
  const phase = nextPhaseAfter(completedPhases.map((entry) => entry.phase));
  const attempt = input.kind === 'resume' ? existing!.attempt + 1 : 1;
  const priorAttempts =
    input.kind === 'resume' ? closeDanglingAttempts(existing!.attempts, existing!.phase, now, attempt) : [];
  const attemptStartSha =
    input.kind === 'fresh'
      ? input.currentHeadSha
      : input.kind === 'rework'
        ? input.rejectedHeadSha
        : input.attemptStartSha;
  if (!isSha(attemptStartSha)) {
    throw new Error(`${input.kind} attempt requires a full 40-character Git SHA`);
  }

  const resume: ResumePlan = {
    resumed: input.kind === 'resume',
    resume_from_phase: phase,
    completed_phases: completedPhases.map((entry) => entry.phase),
    skipped_phases: completedPhases.map((entry) => entry.phase),
    carried_findings: findings,
    pending_actions: pendingActions,
    prior_attempts: priorAttempts,
  };

  const attemptRecord: ExecutionAttempt = {
    epoch_id: epoch.epoch_id,
    attempt,
    started_at: now,
    ended_at: null,
    outcome: null,
    reason: null,
    phase_at_start: phase,
    phase_at_end: null,
    timeout_ms: input.timeoutPolicy.timeout_ms,
    attempt_start_sha: attemptStartSha,
    released_resources: [],
  };

  const checkpoint = sealCheckpoint({
    schema_version: EXECUTION_CHECKPOINT_SCHEMA_VERSION,
    issue_id: input.issueId,
    branch: input.branch ?? existing?.branch ?? null,
    worktree: input.worktree ?? existing?.worktree ?? null,
    state_revision: (existing?.state_revision ?? 0) + 1,
    epoch,
    prior_epochs: priorEpochs,
    status: 'in_progress',
    phase,
    attempt,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    last_activity_at: now,
    heartbeat_at: now,
    heartbeat_interval_ms: input.heartbeatIntervalMs ?? DEFAULT_CHECKPOINT_HEARTBEAT_INTERVAL_MS,
    timeout_policy: input.timeoutPolicy,
    completed_phases: completedPhases,
    findings,
    pending_actions: pendingActions,
    attempts: [...priorAttempts, attemptRecord],
    cancel_requested: false,
    cancel_reason: null,
    owner: { pid: process.pid, host: os.hostname() || 'unknown' },
    integrity: { algorithm: 'sha256', checksum: '' },
  });

    const filePath = writeCheckpoint(checkpoint, dir);
    return {
      checkpoint,
      resume,
      identity: {
        epoch_id: checkpoint.epoch.epoch_id,
        attempt: checkpoint.attempt,
        minimum_revision: checkpoint.state_revision,
      },
      path: filePath,
    };
  });
}

function mutate(
  issueId: string,
  dir: string,
  now: Date,
  expected: ExecutionStateIdentity | undefined,
  fn: (checkpoint: ExecutionCheckpoint, nowIso: string) => ExecutionCheckpoint,
): ExecutionCheckpoint | null {
  return withCheckpointMutationLock(issueId, dir, () => {
    const state = readCheckpointState(issueId, dir, expected);
    if (!state.ok || !state.checkpoint) return null;
    const nowIso = now.toISOString();
    const next = touch(fn(state.checkpoint, nowIso), nowIso);
    writeCheckpoint(next, dir);
    return next;
  });
}

interface ExecutorMutationOptions {
  dir?: string;
  now?: Date;
  identity: ExecutionStateIdentity;
}

export function recordHeartbeat(
  issueId: string,
  options: ExecutorMutationOptions,
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), options.identity, (checkpoint, nowIso) => ({
    ...checkpoint,
    heartbeat_at: nowIso,
  }));
}

export function recordPhaseComplete(
  issueId: string,
  phase: ExecutionPhase,
  summary: string,
  options: ExecutorMutationOptions,
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), options.identity, (checkpoint, nowIso) => {
    if (checkpoint.completed_phases.some((entry) => entry.phase === phase)) {
      return checkpoint;
    }
    const completed = [
      ...checkpoint.completed_phases,
      { epoch_id: checkpoint.epoch.epoch_id, phase, completed_at: nowIso, attempt: checkpoint.attempt, summary },
    ];
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
  options: ExecutorMutationOptions,
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), options.identity, (checkpoint, nowIso) => {
    const id = finding.id ?? `${finding.phase}-${checkpoint.findings.length + 1}`;
    if (checkpoint.findings.some((entry) => entry.id === id)) {
      return checkpoint;
    }
    return {
      ...checkpoint,
      findings: [
        ...checkpoint.findings,
        {
          id,
          epoch_id: checkpoint.epoch.epoch_id,
          source_epoch_id: null,
          phase: finding.phase,
          summary: finding.summary,
          recorded_at: nowIso,
          attempt: checkpoint.attempt,
        },
      ],
      heartbeat_at: nowIso,
    };
  });
}

export function recordPendingActions(
  issueId: string,
  actions: string[],
  options: ExecutorMutationOptions,
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), options.identity, (checkpoint, nowIso) => ({
    ...checkpoint,
    pending_actions: actions,
    heartbeat_at: nowIso,
  }));
}

export interface ClearCheckpointResult {
  ok: boolean;
  code: 'execution_checkpoint_cleared' | 'execution_checkpoint_active' | 'execution_checkpoint_busy';
  removed: string[];
  reason: string;
}

/**
 * Clearing state is an operator transition, not an unlink shortcut. An active
 * attempt owns the epoch, so a concurrent clear is refused. If an external
 * actor deletes the files anyway, post-spawn evaluation observes unavailable
 * state and cannot report success.
 */
export function clearCheckpoint(
  issueId: string,
  options: { dir?: string } = {},
): ClearCheckpointResult {
  const dir = options.dir ?? EXECUTION_CHECKPOINT_DIR;
  try {
    return withCheckpointMutationLock(issueId, dir, () => {
      const state = readCheckpointState(issueId, dir);
      const openAttempt = state.checkpoint?.attempts.some((attempt) => attempt.ended_at === null) ?? false;
      if (openAttempt) {
        return {
          ok: false,
          code: 'execution_checkpoint_active',
          removed: [],
          reason: `refused to clear active epoch ${state.checkpoint!.epoch.epoch_id} attempt ${state.checkpoint!.attempt}`,
        };
      }
      const removed: string[] = [];
      for (const candidate of [checkpointPath(issueId, dir), checkpointRecoveryPath(issueId, dir)]) {
        if (fs.existsSync(candidate)) {
          fs.rmSync(candidate, { force: true });
          removed.push(candidate);
        }
      }
      return {
        ok: true,
        code: 'execution_checkpoint_cleared',
        removed,
        reason: removed.length > 0 ? 'cleared closed execution state' : 'no execution state existed',
      };
    });
  } catch (error) {
    if (!(error instanceof CheckpointMutationLockedError)) throw error;
    return {
      ok: false,
      code: 'execution_checkpoint_busy',
      removed: [],
      reason: error.message,
    };
  }
}

export function requestCancel(
  issueId: string,
  reason: string,
  options: { dir?: string; now?: Date } = {},
): ExecutionCheckpoint | null {
  return mutate(issueId, options.dir ?? EXECUTION_CHECKPOINT_DIR, options.now ?? new Date(), undefined, (checkpoint) => ({
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
  identity: ExecutionStateIdentity;
  dir?: string;
  now?: Date;
  releasedResources?: string[];
}

export function finishAttempt(input: FinishAttemptInput): ExecutionCheckpoint | null {
  return mutate(input.issueId, input.dir ?? EXECUTION_CHECKPOINT_DIR, input.now ?? new Date(), input.identity, (checkpoint, nowIso) => {
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
  // The LAST open attempt, not the first. If a runner was killed before it
  // could close its attempt, an older dangling record would otherwise shadow
  // the attempt actually in flight and liveness would describe the wrong run.
  const open = [...checkpoint.attempts].reverse().find((attempt) => attempt.ended_at === null);
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
  identity: ExecutionStateIdentity;
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
    identity: input.identity,
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

function requireMutationIdentity(flags: Map<string, string[]>): ExecutionStateIdentity {
  const epochId = getFlag(flags, 'epoch-id') ?? process.env.UNIT_TALK_EXECUTION_EPOCH_ID;
  const attempt = Number(getFlag(flags, 'attempt') ?? process.env.UNIT_TALK_EXECUTION_ATTEMPT);
  const minimumRevision = Number(
    getFlag(flags, 'minimum-revision') ?? process.env.UNIT_TALK_EXECUTION_MINIMUM_REVISION,
  );
  if (!epochId || !Number.isSafeInteger(attempt) || attempt <= 0 || !Number.isSafeInteger(minimumRevision) || minimumRevision <= 0) {
    throw new Error('checkpoint mutation requires the originating --epoch-id, --attempt, and --minimum-revision identity');
  }
  return { epoch_id: epochId, attempt, minimum_revision: minimumRevision };
}

function runCli(): void {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? 'status';
  const dir = getFlag(flags, 'dir') ?? EXECUTION_CHECKPOINT_DIR;

  try {
    const issueId = requireIssueId(getFlag(flags, 'issue') ?? '');
    switch (command) {
      case 'status': {
        const state = readCheckpointState(issueId, dir);
        const checkpoint = state.checkpoint;
        emitJson({
          ok: true,
          code: 'execution_checkpoint_status',
          issue_id: issueId,
          checkpoint,
          checkpoint_read: state,
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
        const checkpoint = recordHeartbeat(issueId, { dir, identity: requireMutationIdentity(flags) });
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
          { dir, identity: requireMutationIdentity(flags) },
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
          { dir, identity: requireMutationIdentity(flags) },
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
        const checkpoint = recordPendingActions(issueId, flags.get('action') ?? [], {
          dir,
          identity: requireMutationIdentity(flags),
        });
        emitJson({
          ok: Boolean(checkpoint),
          code: checkpoint ? 'execution_checkpoint_pending' : 'execution_checkpoint_missing',
          issue_id: issueId,
          pending_actions: checkpoint?.pending_actions ?? [],
        });
        process.exitCode = checkpoint ? 0 : 1;
        return;
      }
      case 'clear': {
        const result = clearCheckpoint(issueId, { dir });
        emitJson({
          ok: result.ok,
          code: result.code,
          issue_id: issueId,
          removed: result.removed,
          message: result.reason,
        });
        process.exitCode = result.ok ? 0 : 1;
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
          'Usage: pnpm ops:exec-checkpoint <status|resume-brief|heartbeat|phase-complete|finding|pending|clear|cancel> --issue UTV2-### [--phase <phase>] [--summary <text>] [--reason <text>] [--action <text>] [--epoch-id <id> --attempt <n> --minimum-revision <n>]',
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
