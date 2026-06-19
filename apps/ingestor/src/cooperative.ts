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
