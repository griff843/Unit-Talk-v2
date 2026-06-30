/**
 * Cooperative-yield helpers (UTV2-1283).
 *
 * The per-league ingest bound (UTV2-1280) is a `setTimeout` race. A `setTimeout`
 * callback — and an `AbortSignal` abort — can only fire when the Node event loop is
 * free. Heavy *synchronous* phases (parsing/pairing a full-slate SGO payload,
 * normalizing tens of thousands of paired props) block the event loop, so the 240s
 * timer never fires and a single MLB cycle wedges the whole ingestor process.
 *
 * These helpers break long synchronous transforms into chunks that yield to the
 * event loop between chunks, so the timeout can fire (the cycle fails closed and the
 * loop proceeds) and the abort signal is observed promptly mid-transform.
 */

/** Yield control to the event loop so pending timers / abort signals can run. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/** Default items processed per synchronous chunk before yielding. */
export const DEFAULT_COOPERATIVE_CHUNK = 500;

export interface CooperativeOptions {
  /** Items to process per chunk before yielding. Coerced to >= 1. */
  chunkSize?: number | undefined;
  /** When it fires, the transform throws (via throwIfAborted) at the next chunk boundary. */
  signal?: AbortSignal | undefined;
}

function resolveChunkSize(chunkSize: number | undefined): number {
  return Number.isFinite(chunkSize) && (chunkSize as number) >= 1
    ? Math.floor(chunkSize as number)
    : DEFAULT_COOPERATIVE_CHUNK;
}

/**
 * Map over `items` synchronously within each chunk, yielding to the event loop and
 * checking the abort signal between chunks. Returns the mapped array. A no-op fast
 * path (no await) is taken for small inputs so light cycles keep their tight timing.
 */
export async function mapCooperatively<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => R,
  options: CooperativeOptions = {},
): Promise<R[]> {
  const chunkSize = resolveChunkSize(options.chunkSize);
  const out: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += 1) {
    out[i] = fn(items[i] as T, i);
    if ((i + 1) % chunkSize === 0 && i + 1 < items.length) {
      options.signal?.throwIfAborted();
      await yieldToEventLoop();
    }
  }
  options.signal?.throwIfAborted();
  return out;
}

/**
 * Bounded-concurrency async map (UTV2-1298). Runs `fn` over `items` with at most
 * `concurrency` promises in flight at once, preserving result order. `concurrency <= 1`
 * (or non-finite) runs fully sequentially — the safe reversible fallback.
 *
 * Fail-closed + deterministic: the first rejection is captured, no further items are
 * dispatched, in-flight workers drain, and that first error is rethrown. Idempotent
 * (onConflict) writes make the already-dispatched in-flight items safe to have run.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit =
    Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 1;
  const results: R[] = new Array(items.length);
  const errorBox: Array<{ error: unknown }> = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (errorBox.length === 0) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        if (errorBox.length === 0) {
          errorBox.push({ error });
        }
        return;
      }
    }
  }

  const workerCount = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (errorBox.length > 0) {
    throw errorBox[0]!.error;
  }
  return results;
}

/**
 * Options for withRetry (UTV2-1373).
 */
export interface WithRetryOptions {
  /**
   * Total attempt count including the initial try. Must be >= 1.
   * Default: 1 (no retry — pass-through).
   * PM requirement: 3 = 1 initial + 2 retries.
   */
  attempts?: number;
  /** Base delay before the first retry in ms. Default: 100. */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (exponential backoff ceiling). Default: 1500. */
  maxDelayMs?: number;
  /**
   * Return true to allow a retry on this error. Return false to rethrow immediately.
   * Must be narrowly scoped — only genuine transient errors should return true.
   */
  isRetryable: (error: unknown) => boolean;
  /** Fires after each failed attempt that WILL be retried — use for telemetry, not errors. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Retry a fallible async operation with bounded attempts and capped exponential back-off.
 *
 * Fail-closed on two paths:
 *   1. Non-retryable error: rethrows immediately on the first failure.
 *   2. Budget exhausted: rethrows the last error after all attempts are used.
 *
 * `attempts = 1` is a no-retry pass-through (identical to calling `fn()` directly).
 * Jitter: up to 30% of the exponential delay is added to reduce thundering-herd.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const totalAttempts = Math.max(
    1,
    Number.isFinite(options.attempts) ? Math.floor(options.attempts ?? 1) : 1,
  );
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 1500;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt >= totalAttempts;
      if (isLast || !options.isRetryable(error)) {
        throw error;
      }
      // Exponential backoff: 100ms → 200ms → 400ms …, capped at maxDelayMs, plus jitter
      const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const delayMs = Math.round(Math.min(maxDelayMs, exp + Math.random() * 0.3 * exp));
      options.onRetry?.(attempt, error, delayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable — the loop always returns or throws. TypeScript needs a return path.
  throw new Error('withRetry: unexpected exit');
}

/**
 * Like {@link mapCooperatively} but flattens one level — for transforms that expand
 * each item into zero or more outputs (e.g. pairing an event into many paired props).
 */
export async function flatMapCooperatively<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => readonly R[],
  options: CooperativeOptions = {},
): Promise<R[]> {
  const chunkSize = resolveChunkSize(options.chunkSize);
  const out: R[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const produced = fn(items[i] as T, i);
    for (let j = 0; j < produced.length; j += 1) {
      out.push(produced[j] as R);
    }
    if ((i + 1) % chunkSize === 0 && i + 1 < items.length) {
      options.signal?.throwIfAborted();
      await yieldToEventLoop();
    }
  }
  options.signal?.throwIfAborted();
  return out;
}
