/**
 * Ops Bot Restart Guard
 *
 * Enforces safety controls on bot-driven service restarts:
 *   1. Restartable service allowlist — DB/Postgres/firewall/migration restarts
 *      require a human operator and are NEVER allowed via bot command.
 *   2. Per-service cooldown — minimum 5 minutes between restarts of the same service.
 *   3. Global rate limit — maximum 3 restarts per rolling 60-minute window.
 *   4. Audit log — every attempt (allowed or denied) appended to
 *      .out/ops/restart-audit.jsonl as one JSON object per line.
 *
 * HUMAN-APPROVAL BOUNDARY
 * ========================
 * The following actions are NEVER permitted via bot command and require a human
 * operator acting directly on the host or cloud console:
 *   - postgres / supabase / redis restarts
 *   - migration runs (up / down / rollback)
 *   - firewall rule changes
 *   - SSL certificate rotation
 *   - infra-level deploys (Terraform, Pulumi, etc.)
 *
 * Bot-restartable services: api, worker, ingestor, discord-bot
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/**
 * Explicit set of services that the ops bot is permitted to restart.
 * Anything not in this set is denied with HUMAN_REQUIRED.
 */
export const RESTARTABLE_SERVICES = new Set(['api', 'worker', 'ingestor', 'discord-bot']);

/**
 * Services that require direct human action — listed explicitly for clear
 * denial messages. Not exhaustive; anything outside RESTARTABLE_SERVICES is
 * also denied, but these names produce a specific "human required" message.
 */
export const HUMAN_ONLY_SERVICES = new Set([
  'postgres',
  'supabase',
  'redis',
  'migrations',
  'firewall',
  'ssl',
]);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum milliseconds between restarts of the same service. */
export const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum number of restarts allowed in the rolling window. */
export const RATE_LIMIT_MAX = 3;

/** Rolling window for the global rate limit in milliseconds. */
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DenyReason =
  | 'COOLDOWN'
  | 'RATE_LIMITED'
  | 'NOT_RESTARTABLE'
  | 'HUMAN_REQUIRED';

export interface RestartDecision {
  action: 'allowed' | 'denied';
  reason?: DenyReason;
  /** Human-readable denial message, present when action === 'denied'. */
  message?: string;
  /** Seconds remaining on cooldown, present when reason === 'COOLDOWN'. */
  cooldownRemainingSeconds?: number;
}

export interface AuditEntry {
  timestamp: string;
  service: string;
  requestedBy: string;
  action: 'allowed' | 'denied';
  reason?: DenyReason;
}

// ---------------------------------------------------------------------------
// In-memory state (per-process, no persistence required)
// ---------------------------------------------------------------------------

/** Last allowed restart time per service name (in ms epoch). */
const perServiceLastRestart = new Map<string, number>();

/** Timestamps (ms epoch) of restarts within the rolling window. */
const globalRestartHistory: number[] = [];

// ---------------------------------------------------------------------------
// Guard logic
// ---------------------------------------------------------------------------

/**
 * Decides whether a restart request should be allowed.
 * This function is pure with respect to wall-clock time:
 * pass `nowMs` explicitly so tests can control the clock.
 */
export function evaluateRestartRequest(
  service: string,
  nowMs: number = Date.now(),
): RestartDecision {
  // 1. Allowlist check
  if (!RESTARTABLE_SERVICES.has(service)) {
    if (HUMAN_ONLY_SERVICES.has(service)) {
      return {
        action: 'denied',
        reason: 'HUMAN_REQUIRED',
        message:
          `\`${service}\` cannot be restarted via bot. ` +
          'DB, Postgres, Redis, firewall, and migration operations require a human operator.',
      };
    }

    return {
      action: 'denied',
      reason: 'NOT_RESTARTABLE',
      message:
        `\`${service}\` is not in the restartable service allowlist. ` +
        `Restartable services: ${[...RESTARTABLE_SERVICES].join(', ')}.`,
    };
  }

  // 2. Per-service cooldown check
  const lastRestart = perServiceLastRestart.get(service);
  if (lastRestart !== undefined) {
    const elapsed = nowMs - lastRestart;
    if (elapsed < COOLDOWN_MS) {
      const remainingMs = COOLDOWN_MS - elapsed;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const remainingMinutes = Math.ceil(remainingMs / 60_000);
      return {
        action: 'denied',
        reason: 'COOLDOWN',
        cooldownRemainingSeconds: remainingSeconds,
        message:
          `\`${service}\` is on cooldown. ` +
          `Next restart allowed in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} ` +
          `(${remainingSeconds}s).`,
      };
    }
  }

  // 3. Global rate limit check (rolling window)
  const windowStart = nowMs - RATE_LIMIT_WINDOW_MS;
  const recentRestarts = globalRestartHistory.filter((t) => t > windowStart);
  if (recentRestarts.length >= RATE_LIMIT_MAX) {
    return {
      action: 'denied',
      reason: 'RATE_LIMITED',
      message:
        `Global restart rate limit reached (${RATE_LIMIT_MAX} restarts per hour). ` +
        'Wait until earlier restarts age out of the 60-minute window.',
    };
  }

  return { action: 'allowed' };
}

/**
 * Records an allowed restart in the in-memory state.
 * Must be called after `evaluateRestartRequest` returns `allowed`.
 */
export function recordAllowedRestart(service: string, nowMs: number = Date.now()): void {
  perServiceLastRestart.set(service, nowMs);

  // Prune entries outside the window before pushing new one
  const windowStart = nowMs - RATE_LIMIT_WINDOW_MS;
  const keep = globalRestartHistory.filter((t) => t > windowStart);
  globalRestartHistory.length = 0;
  globalRestartHistory.push(...keep, nowMs);
}

/**
 * Resets all in-memory state. Used in tests to isolate state between cases.
 */
export function resetGuardState(): void {
  perServiceLastRestart.clear();
  globalRestartHistory.length = 0;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Appends one JSON audit entry to `.out/ops/restart-audit.jsonl`.
 * Creates the directory if it does not exist.
 * Failures are logged to stderr but do NOT propagate — the command
 * response must not fail because of audit-write I/O.
 *
 * @param auditDir - Override for the directory (tests inject a temp path).
 */
export async function writeAuditEntry(
  entry: AuditEntry,
  auditDir?: string,
): Promise<void> {
  const dir = auditDir ?? join(process.cwd(), '.out', 'ops');
  const filePath = join(dir, 'restart-audit.jsonl');

  try {
    await mkdir(dir, { recursive: true });
    await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    console.error('[ops-restart-guard] Failed to write audit entry:', err);
  }
}

/**
 * High-level: evaluate + record (if allowed) + audit-log.
 *
 * Returns the decision so the caller can respond to the Discord user.
 */
export async function processRestartRequest(
  service: string,
  requestedBy: string,
  opts?: { nowMs?: number; auditDir?: string },
): Promise<RestartDecision> {
  const nowMs = opts?.nowMs ?? Date.now();
  const decision = evaluateRestartRequest(service, nowMs);

  if (decision.action === 'allowed') {
    recordAllowedRestart(service, nowMs);
  }

  const entry: AuditEntry = {
    timestamp: new Date(nowMs).toISOString(),
    service,
    requestedBy,
    action: decision.action,
    ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
  };

  await writeAuditEntry(entry, opts?.auditDir);

  return decision;
}
