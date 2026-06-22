/**
 * Resilient ingestor startup chain (UTV2-1288).
 *
 * Background: UTV2-1284 made the per-cycle body resilient — a transient DB
 * failure inside `runIngestorCycles` fails the iteration closed and continues.
 * But the PRE-loop startup chain in `index.ts` was NOT resilient: the SGO-key
 * resolution and `reapStaleRuns` ran before the cycle loop, and a transient
 * Supabase outage (statement timeouts, "Could not query the database for the
 * schema cache", 521s) made `reapStaleRuns` throw. That rejection escaped to the
 * top-level `.catch`, set `process.exitCode = 1`, the process exited, and
 * `restart: unless-stopped` immediately recreated it — a tight crash-restart
 * loop (observed RestartCount=109 in ~10h, only 3 of them watchdog exits).
 *
 * This module extends UTV2-1284's resilient-loop principle to the startup chain:
 * a transient startup-step failure is logged, marked in telemetry, and the
 * daemon continues into the (already-resilient) cycle loop where the DB call can
 * succeed once Supabase heals — instead of fatal-exiting.
 *
 * Pure functions only; no module-level side effects. `runStartupStepWithRetry`
 * never throws and never exits the process.
 */

/** Outcome of a single resilient startup step. Never represents a thrown error. */
export interface StartupStepResult<T> {
  /** True when `op` resolved within the attempt budget. */
  ok: boolean;
  /** Resolved value when `ok`; undefined otherwise. */
  value?: T;
  /** Total attempts made (>= 1). */
  attempts: number;
  /** Failure reason (last error message) when `!ok`. Never contains secrets. */
  error?: string;
}

export interface StartupRetryOptions {
  /** Diagnostic label for the step (e.g. "reapStaleRuns"). */
  label: string;
  /** Max attempts before giving up and returning `ok: false`. Default 3. */
  maxAttempts?: number;
  /** Base backoff delay in ms (doubled each retry, capped at maxDelayMs). Default 1000. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay in ms. Default 15000. */
  maxDelayMs?: number;
  /** Injectable sleep (tests pass a no-op). Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Invoked after each failed attempt that will be retried (NOT after the final
   * failure). Used by index.ts to stamp a startup heartbeat so a slow-but-retrying
   * startup keeps advancing loop progress and never looks wedged to the watchdog.
   */
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/** Compute the bounded exponential backoff delay for a given (1-based) attempt. */
export function startupBackoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  if (attempt <= 1) {
    return Math.min(baseDelayMs, maxDelayMs);
  }
  const delay = baseDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, maxDelayMs);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run a startup step with bounded retry + exponential backoff. NEVER throws and
 * NEVER exits the process — a transient/exhausted failure is returned as
 * `{ ok: false, error }` so the caller can log, mark telemetry, and continue
 * into the resilient cycle loop. A success returns `{ ok: true, value }`.
 */
export async function runStartupStepWithRetry<T>(
  op: () => Promise<T>,
  options: StartupRetryOptions,
): Promise<StartupStepResult<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await op();
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const isFinal = attempt >= maxAttempts;
      if (isFinal) {
        break;
      }
      const delayMs = startupBackoffDelayMs(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }

  return { ok: false, attempts: maxAttempts, error: errorMessage(lastError) };
}
