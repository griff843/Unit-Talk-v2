/**
 * Crash-safe full-verify semaphore (UTV2-1594, section C).
 *
 * Replaces the bare `slot-N/owner.json` marker written by preflight's original
 * throttle (UTV2-1516) with a durable ownership record that can be reasoned
 * about after the owning process is gone.
 *
 * The failure this exists to prevent: a preflight process died holding a slot,
 * and because the only reclaim signal was a 6-hour wall-clock threshold, every
 * other lane's full verify queued behind a corpse for 3+ hours while the host
 * sat idle. The inverse failure is worse: reaping a slot held by a legitimately
 * slow verifier corrupts a real run. So reclaim here is *proof-based*, not
 * timeout-based:
 *
 *   reapable   = owner process is provably gone
 *                (dead PID on this machine / PID recycled into a different
 *                process / machine rebooted since acquisition / hard deadline
 *                exceeded / record never completed and is past the write grace)
 *   NOT reapable = anything we cannot prove is dead
 *                (live PID, foreign host we cannot probe, a live owner whose
 *                heartbeat merely lapsed, a record written seconds ago)
 *
 * Every ambiguous case resolves to "leave it alone". The hard deadline is the
 * single bound that can retire a still-live owner, and it exists so a wedged
 * process cannot hold a slot forever.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { PREFLIGHT_DIR, ROOT, emitJson, getFlag, parseArgs } from './shared.js';
import { isProcessAlive } from './merge-mutex.js';

export const VERIFY_SEMAPHORE_SCHEMA_VERSION = 2 as const;

export const VERIFY_SEMAPHORE_DIR_ENV = 'UNIT_TALK_FULL_VERIFY_SEMAPHORE_DIR';
export const VERIFY_SEMAPHORE_CONCURRENCY_ENV = 'UNIT_TALK_FULL_VERIFY_CONCURRENCY';

/**
 * Default location is unchanged from UTV2-1516 and remains scoped to the
 * checkout that runs preflight -- `docs/governance/LANE_CONCURRENCY_POLICY.md`
 * §10a ratifies "1 concurrent full-verification slot **per worktree
 * checkout**". Pointing several worktrees at one host-wide semaphore is a
 * policy change, not a bug fix, so it is exposed as an operator opt-in
 * (`UNIT_TALK_FULL_VERIFY_SEMAPHORE_DIR=/shared/path`) rather than changed
 * here.
 */
export const DEFAULT_VERIFY_SEMAPHORE_DIR = path.join(PREFLIGHT_DIR, 'full-verify-semaphore');
export const DEFAULT_VERIFY_CONCURRENCY = 1;

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
/** Lease window, refreshed by every heartbeat. */
export const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;
/** Absolute upper bound from acquisition; the only bound that retires a live owner. */
export const DEFAULT_HARD_DEADLINE_MS = 6 * 60 * 60 * 1000;
/** Window in which a slot directory may exist without a complete owner record. */
export const DEFAULT_ACQUIRE_GRACE_MS = 60_000;
export const DEFAULT_WAIT_POLL_MS = 5_000;
export const DEFAULT_WAIT_PROGRESS_MS = 30_000;
export const DEFAULT_MAX_WAIT_MS = 4 * 60 * 60 * 1000;
/** Reclaim threshold for pre-UTV2-1594 records that carry no liveness identity. */
export const LEGACY_STALE_MS = 6 * 60 * 60 * 1000;

const REAP_LOG_NAME = 'reap-log.jsonl';
const REAP_LOG_MAX_LINES = 200;
const WAITING_DIR_NAME = 'waiting';
const OWNER_FILE_NAME = 'owner.json';

export interface MachineIdentity {
  hostname: string;
  /**
   * Linux boot UUID when readable. A `uptime:` prefixed value is a portable
   * approximation and is deliberately never used to conclude "rebooted" --
   * see `bootIdsProveReboot`.
   */
  boot_id: string | null;
}

export interface VerifySlotOwner {
  schema_version: typeof VERIFY_SEMAPHORE_SCHEMA_VERSION;
  operation_id: string;
  slot: number;
  pid: number;
  ppid: number;
  process_start_token: string | null;
  machine: MachineIdentity;
  user: string;
  issue_id: string | null;
  branch: string | null;
  worktree: string;
  command: string;
  reason: string;
  acquired_at: string;
  heartbeat_at: string;
  heartbeat_interval_ms: number;
  expires_at: string;
  hard_deadline_at: string;
}

export interface VerifyWaiter {
  schema_version: typeof VERIFY_SEMAPHORE_SCHEMA_VERSION;
  operation_id: string;
  pid: number;
  process_start_token: string | null;
  machine: MachineIdentity;
  user: string;
  issue_id: string | null;
  branch: string | null;
  worktree: string;
  command: string;
  reason: string;
  waiting_since: string;
  heartbeat_at: string;
  waited_ms: number;
  polls: number;
}

export type SlotState =
  | 'free'
  | 'live'
  | 'live_heartbeat_stale'
  | 'live_foreign_host'
  | 'expired_live_owner'
  | 'dead_owner'
  | 'pid_reused'
  | 'machine_reboot'
  | 'expired_unverifiable'
  | 'hard_deadline_exceeded'
  | 'corrupt_recent'
  | 'corrupt_orphan'
  | 'legacy_live'
  | 'legacy_stale';

export interface SlotClassification {
  state: SlotState;
  reapable: boolean;
  reason: string;
}

export interface ClassifyContext {
  now: number;
  machine: MachineIdentity;
  isProcessAlive: (pid: number) => boolean;
  processStartToken: (pid: number) => string | null;
  graceMs: number;
  legacyStaleMs: number;
  /** mtime of the slot directory, used for records that carry no timestamp. */
  slotMtimeMs: number | null;
}

export interface SemaphoreSlotView {
  slot: number;
  slot_path: string;
  occupied: boolean;
  classification: SlotClassification;
  owner: VerifySlotOwner | null;
  raw_owner: Record<string, unknown> | null;
  inode: number | null;
  age_ms: number | null;
  heartbeat_age_ms: number | null;
}

export interface ReapRecord {
  slot: number;
  slot_path: string;
  state: SlotState;
  reason: string;
  reaped_at: string;
  reaped_by: { pid: number; operation_id: string | null };
  previous_owner: Record<string, unknown> | null;
}

export interface SemaphoreStatus {
  dir: string;
  max_concurrent: number;
  occupied: number;
  free: number;
  reapable: number;
  slots: SemaphoreSlotView[];
  waiters: Array<VerifyWaiter & { waiting_ms: number; alive: boolean }>;
  generated_at: string;
}

export class VerifySemaphoreWaitTimeoutError extends Error {
  readonly code = 'verify_semaphore_wait_timeout';
  readonly status: SemaphoreStatus;

  constructor(message: string, status: SemaphoreStatus) {
    super(message);
    this.name = 'VerifySemaphoreWaitTimeoutError';
    this.status = status;
  }
}

// ── identity ────────────────────────────────────────────────────────────────

export function verifySemaphoreDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[VERIFY_SEMAPHORE_DIR_ENV]?.trim();
  return override ? path.resolve(override) : DEFAULT_VERIFY_SEMAPHORE_DIR;
}

export function configuredVerifyConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt(env[VERIFY_SEMAPHORE_CONCURRENCY_ENV] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VERIFY_CONCURRENCY;
}

export function readBootId(): string | null {
  try {
    const raw = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (raw) {
      return raw;
    }
  } catch {
    // Not Linux, or /proc unreadable -- fall through to the approximation.
  }
  const bootMs = Date.now() - os.uptime() * 1000;
  if (!Number.isFinite(bootMs)) {
    return null;
  }
  return `uptime:${Math.round(bootMs / 60_000)}`;
}

export function readMachineIdentity(): MachineIdentity {
  return { hostname: os.hostname() || 'unknown', boot_id: readBootId() };
}

/**
 * A boot-id difference only proves a reboot when BOTH sides are real kernel
 * boot UUIDs. The `uptime:` approximation can drift by a minute across two
 * readings on the same boot, and treating that drift as a reboot would reap a
 * live owner -- exactly the failure this module exists to prevent.
 */
export function bootIdsProveReboot(recorded: string | null | undefined, current: string | null): boolean {
  if (!recorded || !current) {
    return false;
  }
  if (recorded.startsWith('uptime:') || current.startsWith('uptime:')) {
    return false;
  }
  return recorded !== current;
}

/**
 * Process-start identity for PID-reuse detection. `/proc/<pid>/stat` field 22
 * (`starttime`, in clock ticks since boot) is fixed for the life of a process,
 * so a PID that has been recycled reports a different value than the one the
 * slot recorded. The `comm` field may itself contain spaces and parentheses,
 * so parsing starts after its closing paren rather than splitting the line.
 */
export function readProcessStartToken(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  let stat: string;
  try {
    stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
  const commEnd = stat.lastIndexOf(')');
  if (commEnd < 0) {
    return null;
  }
  const fields = stat.slice(commEnd + 2).trim().split(/\s+/);
  // fields[0] is stat field 3 (state), so stat field 22 is index 19.
  const startTime = fields[19];
  return startTime && /^\d+$/.test(startTime) ? `linux:starttime:${startTime}` : null;
}

// ── classification ──────────────────────────────────────────────────────────

export function defaultClassifyContext(overrides: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    now: Date.now(),
    machine: readMachineIdentity(),
    isProcessAlive,
    processStartToken: readProcessStartToken,
    graceMs: DEFAULT_ACQUIRE_GRACE_MS,
    legacyStaleMs: LEGACY_STALE_MS,
    slotMtimeMs: null,
    ...overrides,
  };
}

function parseMs(value: unknown): number {
  if (typeof value !== 'string') {
    return Number.NaN;
  }
  return Date.parse(value);
}

function classifyCorrupt(ctx: ClassifyContext, detail: string): SlotClassification {
  const age = ctx.slotMtimeMs === null ? Number.NaN : ctx.now - ctx.slotMtimeMs;
  if (!Number.isFinite(age) || age <= ctx.graceMs) {
    return {
      state: 'corrupt_recent',
      reapable: false,
      reason:
        `${detail}; slot was created within the ${ctx.graceMs}ms write grace, so another process ` +
        `is presumed mid-acquire. Not reapable.`,
    };
  }
  return {
    state: 'corrupt_orphan',
    reapable: true,
    reason: `${detail}; slot has been incomplete for ${Math.round(age / 1000)}s, past the write grace.`,
  };
}

function classifyLegacy(record: Record<string, unknown>, ctx: ClassifyContext): SlotClassification {
  const pid = typeof record.pid === 'number' ? record.pid : Number.NaN;
  const hasPid = Number.isInteger(pid) && pid > 0;
  if (hasPid && ctx.isProcessAlive(pid)) {
    return {
      state: 'legacy_live',
      reapable: false,
      reason: `pre-UTV2-1594 slot record; owner pid ${pid} is still running on this host.`,
    };
  }
  if (hasPid) {
    return {
      state: 'legacy_stale',
      reapable: true,
      reason: `pre-UTV2-1594 slot record; owner pid ${pid} is not running.`,
    };
  }
  const acquiredAt = Number.isFinite(parseMs(record.acquired_at)) ? parseMs(record.acquired_at) : ctx.slotMtimeMs;
  if (acquiredAt === null || !Number.isFinite(acquiredAt)) {
    return classifyCorrupt(ctx, 'legacy slot record carries neither a usable pid nor a timestamp');
  }
  const age = ctx.now - acquiredAt;
  if (age > ctx.legacyStaleMs) {
    return {
      state: 'legacy_stale',
      reapable: true,
      reason: `pre-UTV2-1594 slot record with no usable pid, held for ${Math.round(age / 1000)}s (past ${ctx.legacyStaleMs}ms).`,
    };
  }
  return {
    state: 'legacy_live',
    reapable: false,
    reason: 'pre-UTV2-1594 slot record with no usable pid and within the legacy stale window.',
  };
}

export function classifySlotRecord(raw: unknown, ctx: ClassifyContext): SlotClassification {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return classifyCorrupt(ctx, 'slot has no readable owner record');
  }
  const record = raw as Record<string, unknown>;
  if (record.schema_version !== VERIFY_SEMAPHORE_SCHEMA_VERSION) {
    return classifyLegacy(record, ctx);
  }

  const owner = raw as unknown as VerifySlotOwner;
  const hardDeadline = parseMs(owner.hard_deadline_at);
  if (Number.isFinite(hardDeadline) && ctx.now > hardDeadline) {
    return {
      state: 'hard_deadline_exceeded',
      reapable: true,
      reason:
        `owner ${owner.operation_id} passed its absolute hard deadline (${owner.hard_deadline_at}); ` +
        `a full verify may not hold a slot beyond this bound even while running.`,
    };
  }

  const expiresAt = parseMs(owner.expires_at);
  const sameHost = owner.machine?.hostname === ctx.machine.hostname;
  if (!sameHost) {
    if (Number.isFinite(expiresAt) && ctx.now > expiresAt) {
      return {
        state: 'expired_unverifiable',
        reapable: true,
        reason:
          `owner ran on host '${owner.machine?.hostname ?? 'unknown'}' (this host is '${ctx.machine.hostname}'), ` +
          `so liveness cannot be probed, and its lease expired at ${owner.expires_at}.`,
      };
    }
    return {
      state: 'live_foreign_host',
      reapable: false,
      reason:
        `owner ran on host '${owner.machine?.hostname ?? 'unknown'}' and its lease has not expired; ` +
        `liveness is unprovable from here, so the slot is left alone.`,
    };
  }

  if (bootIdsProveReboot(owner.machine?.boot_id, ctx.machine.boot_id)) {
    return {
      state: 'machine_reboot',
      reapable: true,
      reason:
        `slot was acquired under boot ${owner.machine?.boot_id}, this host is now on boot ${ctx.machine.boot_id}; ` +
        `no process from the previous boot survives.`,
    };
  }

  const pid = typeof owner.pid === 'number' ? owner.pid : Number.NaN;
  if (!Number.isInteger(pid) || pid <= 0) {
    return classifyCorrupt(ctx, 'owner record carries no usable pid');
  }
  if (!ctx.isProcessAlive(pid)) {
    return {
      state: 'dead_owner',
      reapable: true,
      reason: `owner pid ${pid} is not running on this host.`,
    };
  }

  const currentToken = ctx.processStartToken(pid);
  if (owner.process_start_token && currentToken && currentToken !== owner.process_start_token) {
    return {
      state: 'pid_reused',
      reapable: true,
      reason:
        `pid ${pid} is running but is a different process than the slot owner ` +
        `(recorded start ${owner.process_start_token}, current start ${currentToken}); the pid was recycled.`,
    };
  }

  if (Number.isFinite(expiresAt) && ctx.now > expiresAt) {
    return {
      state: 'expired_live_owner',
      reapable: false,
      reason:
        `owner pid ${pid} is still running but stopped heartbeating before ${owner.expires_at}. ` +
        `A running process is never provably dead, so this is reported, not reaped; ` +
        `the hard deadline (${owner.hard_deadline_at}) is the bound that retires it.`,
    };
  }

  const heartbeatAt = parseMs(owner.heartbeat_at);
  const interval =
    typeof owner.heartbeat_interval_ms === 'number' && owner.heartbeat_interval_ms > 0
      ? owner.heartbeat_interval_ms
      : DEFAULT_HEARTBEAT_INTERVAL_MS;
  if (Number.isFinite(heartbeatAt) && ctx.now - heartbeatAt > interval * 3) {
    return {
      state: 'live_heartbeat_stale',
      reapable: false,
      reason:
        `owner pid ${pid} is running but its last heartbeat was ${Math.round((ctx.now - heartbeatAt) / 1000)}s ago ` +
        `(interval ${interval}ms). Reported for operator attention; a live owner is never reaped.`,
    };
  }

  return {
    state: 'live',
    reapable: false,
    reason: `owner pid ${pid} is running and heartbeating (lease until ${owner.expires_at}).`,
  };
}

// ── slot I/O ────────────────────────────────────────────────────────────────

function ownerPathFor(slotPath: string): string {
  return path.join(slotPath, OWNER_FILE_NAME);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readJsonIfPresent(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function inspectSlot(dir: string, slot: number, ctx?: Partial<ClassifyContext>): SemaphoreSlotView {
  const slotPath = path.join(dir, `slot-${slot}`);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(slotPath);
  } catch {
    stat = null;
  }
  if (!stat) {
    return {
      slot,
      slot_path: slotPath,
      occupied: false,
      classification: { state: 'free', reapable: false, reason: 'slot is free' },
      owner: null,
      raw_owner: null,
      inode: null,
      age_ms: null,
      heartbeat_age_ms: null,
    };
  }

  const raw = readJsonIfPresent(ownerPathFor(slotPath));
  const context = defaultClassifyContext({ slotMtimeMs: stat.mtimeMs, ...ctx });
  const classification = classifySlotRecord(raw, context);
  const owner =
    raw && raw.schema_version === VERIFY_SEMAPHORE_SCHEMA_VERSION ? (raw as unknown as VerifySlotOwner) : null;
  const acquiredAt = raw ? parseMs(raw.acquired_at) : Number.NaN;
  const heartbeatAt = raw ? parseMs(raw.heartbeat_at) : Number.NaN;
  return {
    slot,
    slot_path: slotPath,
    occupied: true,
    classification,
    owner,
    raw_owner: raw,
    inode: stat.ino,
    age_ms: Number.isFinite(acquiredAt) ? context.now - acquiredAt : context.now - stat.mtimeMs,
    heartbeat_age_ms: Number.isFinite(heartbeatAt) ? context.now - heartbeatAt : null,
  };
}

function appendReapLog(dir: string, record: ReapRecord): void {
  const logPath = path.join(dir, REAP_LOG_NAME);
  try {
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    if (lines.length > REAP_LOG_MAX_LINES) {
      fs.writeFileSync(logPath, `${lines.slice(-REAP_LOG_MAX_LINES).join('\n')}\n`, 'utf8');
    }
  } catch {
    // The audit trail is best-effort; never fail an acquire because of it.
  }
}

/**
 * Remove a slot the caller has already classified as reapable, re-verifying
 * ownership immediately before the removal. Two contenders can classify the
 * same corpse concurrently; without this re-check the slower one would delete
 * the *winner's* freshly written record.
 */
export function reapSlot(dir: string, view: SemaphoreSlotView, reapedBy: { pid: number; operation_id: string | null }): ReapRecord | null {
  if (!view.occupied || !view.classification.reapable) {
    return null;
  }
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(view.slot_path);
  } catch {
    return null;
  }
  if (view.inode !== null && stat.ino !== view.inode) {
    return null;
  }
  const fresh = readJsonIfPresent(ownerPathFor(view.slot_path));
  const previousId = view.raw_owner?.operation_id ?? null;
  const freshId = fresh?.operation_id ?? null;
  if (previousId !== freshId) {
    return null;
  }
  fs.rmSync(view.slot_path, { recursive: true, force: true });
  const record: ReapRecord = {
    slot: view.slot,
    slot_path: view.slot_path,
    state: view.classification.state,
    reason: view.classification.reason,
    reaped_at: new Date().toISOString(),
    reaped_by: reapedBy,
    previous_owner: view.raw_owner,
  };
  appendReapLog(dir, record);
  return record;
}

/**
 * Every slot number that must be considered: the configured range, plus any
 * higher-numbered slot directory still on disk.
 *
 * Without the second half, lowering `UNIT_TALK_FULL_VERIFY_CONCURRENCY` from 2
 * to 1 would make a corpse in `slot-1` permanently invisible — never listed by
 * the operator command and never reclaimed, because nothing would ever look at
 * it again. That is the same "a dead owner holds something forever" failure
 * this module exists to remove, just relocated.
 */
function slotNumbers(dir: string, maxConcurrent: number): number[] {
  const numbers = new Set<number>();
  for (let slot = 0; slot < maxConcurrent; slot += 1) {
    numbers.add(slot);
  }
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const match = entry.isDirectory() ? /^slot-(\d+)$/.exec(entry.name) : null;
      if (match) {
        numbers.add(Number.parseInt(match[1]!, 10));
      }
    }
  } catch {
    // Directory does not exist yet; the configured range is the whole story.
  }
  return [...numbers].sort((left, right) => left - right);
}

/** Safe reap pass over every slot: removes only provably dead/expired owners. */
export function reapVerifySlots(
  options: { dir?: string; maxConcurrent?: number; ctx?: Partial<ClassifyContext> } = {},
): ReapRecord[] {
  const dir = options.dir ?? verifySemaphoreDir();
  const maxConcurrent = options.maxConcurrent ?? configuredVerifyConcurrency();
  if (!fs.existsSync(dir)) {
    return [];
  }
  const reaped: ReapRecord[] = [];
  for (const slot of slotNumbers(dir, maxConcurrent)) {
    const view = inspectSlot(dir, slot, options.ctx);
    const record = reapSlot(dir, view, { pid: process.pid, operation_id: null });
    if (record) {
      reaped.push(record);
    }
  }
  return reaped;
}

// ── heartbeat ───────────────────────────────────────────────────────────────

/**
 * Advance an owner record's heartbeat and slide its lease forward. Exported so
 * the in-process path, the worker-thread path, and the tests all use one
 * implementation of the rule "heartbeat renews the lease but never the hard
 * deadline".
 */
export function beatVerifySlot(
  ownerPath: string,
  options: { now?: number; ttlMs?: number } = {},
): VerifySlotOwner | null {
  const raw = readJsonIfPresent(ownerPath);
  if (!raw || raw.schema_version !== VERIFY_SEMAPHORE_SCHEMA_VERSION) {
    return null;
  }
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const next = {
    ...raw,
    heartbeat_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  } as unknown as VerifySlotOwner;
  writeJsonAtomic(ownerPath, next);
  return next;
}

/**
 * `pnpm type-check` and `pnpm test` run through blocking `spawnSync` calls, so
 * the main thread cannot heartbeat while a verify is in flight. A worker
 * thread has its own event loop and keeps beating through the block. It is
 * unref'd so it can never hold the process open, and heartbeat failure is
 * non-fatal: PID liveness still protects the slot.
 */
const HEARTBEAT_WORKER_SOURCE = `
const { workerData } = require('node:worker_threads');
const fs = require('node:fs');
const timer = setInterval(() => {
  try {
    const raw = JSON.parse(fs.readFileSync(workerData.ownerPath, 'utf8'));
    if (!raw || raw.schema_version !== workerData.schemaVersion) { clearInterval(timer); return; }
    const now = Date.now();
    raw.heartbeat_at = new Date(now).toISOString();
    raw.expires_at = new Date(now + workerData.ttlMs).toISOString();
    const tmp = workerData.ownerPath + '.hb-tmp';
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\\n', 'utf8');
    fs.renameSync(tmp, workerData.ownerPath);
  } catch (err) {
    // Slot released (file gone) or transiently unreadable; stop on ENOENT only.
    if (err && err.code === 'ENOENT') { clearInterval(timer); }
  }
}, workerData.intervalMs);
`;

export interface HeartbeatController {
  stop(): void;
}

export function startVerifySlotHeartbeat(
  ownerPath: string,
  options: { intervalMs?: number; ttlMs?: number } = {},
): HeartbeatController | null {
  try {
    const worker = new Worker(HEARTBEAT_WORKER_SOURCE, {
      eval: true,
      workerData: {
        ownerPath,
        intervalMs: options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
        ttlMs: options.ttlMs ?? DEFAULT_LEASE_TTL_MS,
        schemaVersion: VERIFY_SEMAPHORE_SCHEMA_VERSION,
      },
    });
    worker.unref();
    let stopped = false;
    return {
      stop() {
        if (stopped) {
          return;
        }
        stopped = true;
        void worker.terminate();
      },
    };
  } catch {
    return null;
  }
}

// ── waiters ─────────────────────────────────────────────────────────────────

function waitingDir(dir: string): string {
  return path.join(dir, WAITING_DIR_NAME);
}

export function readWaiters(dir: string, ctx?: Partial<ClassifyContext>): Array<VerifyWaiter & { waiting_ms: number; alive: boolean }> {
  const wDir = waitingDir(dir);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(wDir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const context = defaultClassifyContext(ctx);
  const waiters: Array<VerifyWaiter & { waiting_ms: number; alive: boolean }> = [];
  for (const name of entries) {
    const filePath = path.join(wDir, name);
    const raw = readJsonIfPresent(filePath);
    if (!raw || raw.schema_version !== VERIFY_SEMAPHORE_SCHEMA_VERSION) {
      continue;
    }
    const waiter = raw as unknown as VerifyWaiter;
    const sameHost = waiter.machine?.hostname === context.machine.hostname;
    const alive = sameHost ? context.isProcessAlive(waiter.pid) : true;
    if (!alive) {
      // A waiter that died in the queue is removed; it can never be admitted.
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // best effort
      }
      continue;
    }
    const since = parseMs(waiter.waiting_since);
    waiters.push({
      ...waiter,
      waiting_ms: Number.isFinite(since) ? context.now - since : waiter.waited_ms,
      alive,
    });
  }
  return waiters.sort((a, b) => b.waiting_ms - a.waiting_ms);
}

// ── status ──────────────────────────────────────────────────────────────────

export function readSemaphoreStatus(
  options: { dir?: string; maxConcurrent?: number; ctx?: Partial<ClassifyContext> } = {},
): SemaphoreStatus {
  const dir = options.dir ?? verifySemaphoreDir();
  const maxConcurrent = options.maxConcurrent ?? configuredVerifyConcurrency();
  const slots: SemaphoreSlotView[] = [];
  // Includes any slot above the configured concurrency that still exists on
  // disk, so an operator can always see (and reclaim) what is actually held.
  for (const slot of slotNumbers(dir, maxConcurrent)) {
    slots.push(inspectSlot(dir, slot, options.ctx));
  }
  const occupied = slots.filter((s) => s.occupied).length;
  return {
    dir,
    max_concurrent: maxConcurrent,
    occupied,
    free: maxConcurrent - occupied,
    reapable: slots.filter((s) => s.classification.reapable).length,
    slots,
    waiters: readWaiters(dir, options.ctx),
    generated_at: new Date().toISOString(),
  };
}

// ── acquire / release ───────────────────────────────────────────────────────

export interface WaitProgress {
  operation_id: string;
  waited_ms: number;
  polls: number;
  status: SemaphoreStatus;
  message: string;
}

export interface AcquireVerifySlotOptions {
  dir?: string;
  maxConcurrent?: number;
  issueId?: string | null;
  branch?: string | null;
  worktree?: string;
  command?: string;
  reason?: string;
  ttlMs?: number;
  hardDeadlineMs?: number;
  heartbeatIntervalMs?: number;
  graceMs?: number;
  legacyStaleMs?: number;
  waitPollMs?: number;
  waitProgressMs?: number;
  maxWaitMs?: number;
  onWait?: (progress: WaitProgress) => void;
  onReap?: (record: ReapRecord) => void;
  enableHeartbeat?: boolean;
  installSignalHandlers?: boolean;
  now?: () => number;
  sleep?: (ms: number) => void;
  machine?: MachineIdentity;
  isProcessAlive?: (pid: number) => boolean;
  processStartToken?: (pid: number) => string | null;
}

export interface VerifySlotHandle {
  slot: number;
  slot_path: string;
  owner_path: string;
  operation_id: string;
  max_concurrent: number;
  owner: VerifySlotOwner;
  reaped: ReapRecord[];
  waited_ms: number;
  release(): void;
  heartbeat(): VerifySlotOwner | null;
}

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquireVerifySlot(options: AcquireVerifySlotOptions = {}): VerifySlotHandle {
  const dir = options.dir ?? verifySemaphoreDir();
  const maxConcurrent = options.maxConcurrent ?? configuredVerifyConcurrency();
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? sleepSync;
  const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const hardDeadlineMs = options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const waitPollMs = options.waitPollMs ?? DEFAULT_WAIT_POLL_MS;
  const waitProgressMs = options.waitProgressMs ?? DEFAULT_WAIT_PROGRESS_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const machine = options.machine ?? readMachineIdentity();
  const worktree = options.worktree ?? ROOT;
  const command = options.command ?? 'pnpm type-check && pnpm test';
  const reason = options.reason ?? 'full-verify baseline';
  const operationId = crypto.randomUUID();

  const ctxOverrides = (): Partial<ClassifyContext> => ({
    now: now(),
    machine,
    graceMs: options.graceMs ?? DEFAULT_ACQUIRE_GRACE_MS,
    legacyStaleMs: options.legacyStaleMs ?? LEGACY_STALE_MS,
    ...(options.isProcessAlive ? { isProcessAlive: options.isProcessAlive } : {}),
    ...(options.processStartToken ? { processStartToken: options.processStartToken } : {}),
  });

  fs.mkdirSync(dir, { recursive: true });
  const startedAt = now();
  const reaped: ReapRecord[] = [];
  let waiterPath: string | null = null;
  let polls = 0;
  let lastProgressAt = -Infinity;

  const removeWaiter = (): void => {
    if (waiterPath) {
      try {
        fs.rmSync(waiterPath, { force: true });
      } catch {
        // best effort
      }
      waiterPath = null;
    }
  };

  try {
    for (;;) {
      for (let slot = 0; slot < maxConcurrent; slot += 1) {
        const view = inspectSlot(dir, slot, ctxOverrides());
        if (view.occupied && view.classification.reapable) {
          const record = reapSlot(dir, view, { pid: process.pid, operation_id: operationId });
          if (record) {
            reaped.push(record);
            options.onReap?.(record);
          }
        }
        const slotPath = path.join(dir, `slot-${slot}`);
        try {
          fs.mkdirSync(slotPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
          }
          continue;
        }

        // The slot is claimed the instant that mkdir returns -- the directory
        // IS the claim -- so the signal handlers go on here, before the owner
        // record, the waiter cleanup or the heartbeat. Installing them after
        // the handle was built left a window in which a SIGTERM killed the
        // process with the slot already taken and nothing registered to give
        // it back. That window is short but it is not theoretical: `pnpm
        // verify` is routinely cancelled by CI and by operators, and a slot
        // lost there is a slot no later verify can use until the reaper
        // reclaims it.
        //
        // Until the handle exists there is exactly one thing to undo, and it
        // is unambiguously ours: nobody else can have created this directory,
        // and no record naming another owner can exist yet.
        let releaseSlot = (): void => {
          try {
            fs.rmSync(slotPath, { recursive: true, force: true });
          } catch {
            // best effort
          }
        };
        let uninstallHandlers: (() => void) | null = null;
        if (options.installSignalHandlers !== false) {
          uninstallHandlers = installVerifySlotReleaseHandlers({ release: () => releaseSlot() });
        }

        try {
          const acquiredAt = now();
          const owner: VerifySlotOwner = {
            schema_version: VERIFY_SEMAPHORE_SCHEMA_VERSION,
            operation_id: operationId,
            slot,
            pid: process.pid,
            ppid: process.ppid,
            process_start_token: (options.processStartToken ?? readProcessStartToken)(process.pid),
            machine,
            user: os.userInfo().username || 'unknown',
            issue_id: options.issueId ?? null,
            branch: options.branch ?? null,
            worktree,
            command,
            reason,
            acquired_at: new Date(acquiredAt).toISOString(),
            heartbeat_at: new Date(acquiredAt).toISOString(),
            heartbeat_interval_ms: heartbeatIntervalMs,
            expires_at: new Date(acquiredAt + ttlMs).toISOString(),
            hard_deadline_at: new Date(acquiredAt + hardDeadlineMs).toISOString(),
          };
          const ownerPath = ownerPathFor(slotPath);
          writeJsonAtomic(ownerPath, owner);
          removeWaiter();

          const heartbeat =
            options.enableHeartbeat === false
              ? null
              : startVerifySlotHeartbeat(ownerPath, { intervalMs: heartbeatIntervalMs, ttlMs });

          let released = false;
          const handle: VerifySlotHandle = {
            slot,
            slot_path: slotPath,
            owner_path: ownerPath,
            operation_id: operationId,
            max_concurrent: maxConcurrent,
            owner,
            reaped,
            waited_ms: now() - startedAt,
            heartbeat: () => beatVerifySlot(ownerPath, { ttlMs }),
            release() {
              if (released) {
                return;
              }
              released = true;
              heartbeat?.stop();
              uninstallHandlers?.();
              // Only remove the slot if we still own it: if this slot was already
              // reaped and re-claimed by someone else, deleting it here would
              // destroy a live verify.
              // Positive ownership only. A record that names someone else is
              // obviously not ours, but a *missing* record is not ours either:
              // the one window in which it can be missing is between another
              // process's `mkdirSync(slotPath)` and its own record write, and
              // deleting the directory there would drop a slot out from under a
              // verify that is starting right now. An orphaned directory left by
              // this branch is not a leak -- it classifies as `corrupt_orphan`
              // once past the write grace and is reclaimed normally.
              const current = readJsonIfPresent(ownerPath);
              if (current?.operation_id !== operationId) {
                return;
              }
              try {
                fs.rmSync(slotPath, { recursive: true, force: true });
              } catch {
                // best effort
              }
            },
          };
          releaseSlot = () => handle.release();
          return handle;
        } catch (error) {
          // Acquisition failed after the claim. Hand the slot back rather than
          // leaving a directory behind with a handler still pointed at it.
          uninstallHandlers?.();
          releaseSlot();
          throw error;
        }
      }

      polls += 1;
      waiterPath ??= path.join(waitingDir(dir), `${operationId}.json`);
      const waitedMs = now() - startedAt;
      try {
        fs.mkdirSync(waitingDir(dir), { recursive: true });
        const waiter: VerifyWaiter = {
          schema_version: VERIFY_SEMAPHORE_SCHEMA_VERSION,
          operation_id: operationId,
          pid: process.pid,
          process_start_token: (options.processStartToken ?? readProcessStartToken)(process.pid),
          machine,
          user: os.userInfo().username || 'unknown',
          issue_id: options.issueId ?? null,
          branch: options.branch ?? null,
          worktree,
          command,
          reason,
          waiting_since: new Date(startedAt).toISOString(),
          heartbeat_at: new Date(now()).toISOString(),
          waited_ms: waitedMs,
          polls,
        };
        writeJsonAtomic(waiterPath, waiter);
      } catch {
        // Queue visibility is best-effort; never fail an acquire because of it.
      }

      // Progress is reported before the give-up check so a waiter that runs out
      // of patience still explains what it was waiting behind.
      if (now() - lastProgressAt >= waitProgressMs) {
        lastProgressAt = now();
        const status = readSemaphoreStatus({ dir, maxConcurrent, ctx: ctxOverrides() });
        const holders = status.slots
          .filter((s) => s.occupied)
          .map(
            (s) =>
              `slot ${s.slot}: ${s.classification.state} pid=${s.raw_owner?.pid ?? '?'} ` +
              `issue=${s.raw_owner?.issue_id ?? 'n/a'} age=${Math.round((s.age_ms ?? 0) / 1000)}s`,
          )
          .join('; ');
        options.onWait?.({
          operation_id: operationId,
          waited_ms: waitedMs,
          polls,
          status,
          message:
            `waiting ${Math.round(waitedMs / 1000)}s for a full-verify slot ` +
            `(${status.occupied}/${status.max_concurrent} occupied, ${status.waiters.length} waiting) — ${holders || 'no holders visible'}`,
        });
      }

      if (waitedMs > maxWaitMs) {
        const status = readSemaphoreStatus({ dir, maxConcurrent, ctx: ctxOverrides() });
        removeWaiter();
        throw new VerifySemaphoreWaitTimeoutError(
          `Timed out after ${Math.round(waitedMs / 1000)}s waiting for a full-verify slot in ${dir}. ` +
            `Run \`pnpm ops:verify-slots\` to see who holds the queue.`,
          status,
        );
      }

      sleep(waitPollMs);
    }
  } catch (error) {
    removeWaiter();
    throw error;
  }
}

/**
 * Release on every exit path the process controls: normal exit, the fatal
 * signals a killed lane actually receives, and an uncaught throw. Signals are
 * re-raised with the handler removed so default termination semantics and the
 * caller's exit code are preserved.
 */
export function installVerifySlotReleaseHandlers(handle: { release(): void }): () => void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
  const onExit = (): void => {
    handle.release();
  };
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const handler = (): void => {
      handle.release();
      process.removeListener(signal, handler);
      process.kill(process.pid, signal);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  const onUncaught = (error: unknown): void => {
    handle.release();
    process.removeListener('uncaughtException', onUncaught);
    throw error;
  };
  process.on('exit', onExit);
  process.on('uncaughtException', onUncaught);

  return () => {
    process.removeListener('exit', onExit);
    process.removeListener('uncaughtException', onUncaught);
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
  };
}

export function releaseVerifySlot(handle: { release(): void }): void {
  handle.release();
}

// ── operator CLI ────────────────────────────────────────────────────────────

function humanAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return 'unknown';
  }
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

export function formatSemaphoreStatus(status: SemaphoreStatus): string {
  const lines: string[] = [];
  lines.push(`full-verify semaphore: ${status.dir}`);
  lines.push(`slots: ${status.occupied}/${status.max_concurrent} occupied, ${status.reapable} reapable, ${status.waiters.length} waiting`);
  lines.push('');
  for (const slot of status.slots) {
    if (!slot.occupied) {
      lines.push(`  slot ${slot.slot}: FREE`);
      continue;
    }
    const owner = slot.raw_owner ?? {};
    lines.push(
      `  slot ${slot.slot}: ${slot.classification.state.toUpperCase()}${slot.classification.reapable ? ' (reapable)' : ''}`,
    );
    lines.push(`    owner       pid=${owner.pid ?? '?'} operation=${owner.operation_id ?? 'n/a'} user=${owner.user ?? 'n/a'}`);
    lines.push(`    lane        issue=${owner.issue_id ?? 'n/a'} branch=${owner.branch ?? 'n/a'}`);
    lines.push(`    worktree    ${owner.worktree ?? 'n/a'}`);
    lines.push(`    command     ${owner.command ?? 'n/a'}`);
    lines.push(`    age         ${humanAge(slot.age_ms)}   heartbeat ${humanAge(slot.heartbeat_age_ms)} ago`);
    lines.push(`    expires_at  ${owner.expires_at ?? 'n/a'}   hard_deadline ${owner.hard_deadline_at ?? 'n/a'}`);
    lines.push(`    reason      ${slot.classification.reason}`);
  }
  if (status.waiters.length > 0) {
    lines.push('');
    lines.push('  waiting:');
    for (const waiter of status.waiters) {
      lines.push(
        `    pid=${waiter.pid} issue=${waiter.issue_id ?? 'n/a'} branch=${waiter.branch ?? 'n/a'} ` +
          `waiting=${humanAge(waiter.waiting_ms)} polls=${waiter.polls} heartbeat=${waiter.heartbeat_at} reason=${waiter.reason}`,
      );
    }
  }
  return lines.join('\n');
}

function runCli(): void {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? 'status';
  const json = bools.has('json');
  const dir = getFlag(flags, 'dir') ?? verifySemaphoreDir();
  const maxConcurrent = Number.parseInt(getFlag(flags, 'max') ?? '', 10) || configuredVerifyConcurrency();

  if (command === 'status') {
    const status = readSemaphoreStatus({ dir, maxConcurrent });
    if (json) {
      emitJson({ ok: true, code: 'verify_semaphore_status', ...status });
    } else {
      process.stdout.write(`${formatSemaphoreStatus(status)}\n`);
    }
    process.exitCode = 0;
    return;
  }

  if (command === 'reap') {
    const before = readSemaphoreStatus({ dir, maxConcurrent });
    const reaped = reapVerifySlots({ dir, maxConcurrent });
    const after = readSemaphoreStatus({ dir, maxConcurrent });
    const protectedSlots = before.slots
      .filter((s) => s.occupied && !s.classification.reapable)
      .map((s) => ({ slot: s.slot, state: s.classification.state, reason: s.classification.reason }));
    if (json) {
      emitJson({ ok: true, code: 'verify_semaphore_reaped', reaped, protected: protectedSlots, status: after });
    } else {
      process.stdout.write(
        reaped.length === 0
          ? 'no reapable slots — nothing removed\n'
          : `${reaped.map((r) => `reaped slot ${r.slot}: ${r.state} — ${r.reason}`).join('\n')}\n`,
      );
      for (const slot of protectedSlots) {
        process.stdout.write(`protected slot ${slot.slot}: ${slot.state} — ${slot.reason}\n`);
      }
      process.stdout.write(`\n${formatSemaphoreStatus(after)}\n`);
    }
    process.exitCode = 0;
    return;
  }

  emitJson({
    ok: false,
    code: 'verify_semaphore_usage',
    message: 'Usage: pnpm ops:verify-slots [status|reap] [--json] [--dir <path>] [--max <n>]',
  });
  process.exitCode = 1;
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  runCli();
}
