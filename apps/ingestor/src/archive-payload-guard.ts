/**
 * UTV2-1294 — archive-write isolation guard.
 *
 * The `raw_payloads` / `odds_snapshots` archive writes are telemetry: they must be
 * best-effort and bounded so they can never starve the settlement-critical path.
 *
 * Proven incident: the MLB game-line odds payload is 2–3.5 MB/row (league-wide blob);
 * inserting it as one giant JSON value through PostgREST exceeds the 120 s
 * `statement_timeout`, consumes the cycle's window, and starves the MLB settlement
 * reads — so `finalized_results_in` / `game_results` stay 0. Every other (out-of-season)
 * league is ~45 bytes and writes in single-digit ms.
 *
 * This module provides pure, side-effect-free helpers: a payload size guard, a compact
 * "payload_too_large" metadata builder (written instead of the giant blob — the
 * `payload`/`priceBlob` columns are jsonb, so no migration), and a short write timeout
 * so an archive write can never consume the full statement-timeout window.
 */

import crypto from 'node:crypto';

/** Default cap on the serialized archive payload before we refuse the giant DB write. */
export const DEFAULT_MAX_ARCHIVE_PAYLOAD_BYTES = 1_000_000; // 1 MB serialized

/** Default per-archive-write timeout — far below the 120 s statement_timeout. */
export const DEFAULT_ARCHIVE_WRITE_TIMEOUT_MS = 5_000;

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Env-overridable cap (kept here so callers and tests resolve it the same way). */
export function resolveMaxArchivePayloadBytes(
  env: Record<string, string | undefined> = process.env,
): number {
  return positiveIntFromEnv(
    env.UNIT_TALK_INGESTOR_MAX_ARCHIVE_PAYLOAD_BYTES,
    DEFAULT_MAX_ARCHIVE_PAYLOAD_BYTES,
  );
}

/** Env-overridable per-write timeout. */
export function resolveArchiveWriteTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  return positiveIntFromEnv(
    env.UNIT_TALK_INGESTOR_ARCHIVE_WRITE_TIMEOUT_MS,
    DEFAULT_ARCHIVE_WRITE_TIMEOUT_MS,
  );
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function serializedPayloadBytes(serialized: string): number {
  return Buffer.byteLength(serialized, 'utf8');
}

export function isPayloadOversized(
  bytes: number,
  maxBytes: number = DEFAULT_MAX_ARCHIVE_PAYLOAD_BYTES,
): boolean {
  return bytes > maxBytes;
}

export interface OversizedArchiveMetadata {
  reason: 'payload_too_large';
  provider: string;
  league: string;
  kind: string;
  payloadBytes: number;
  maxPayloadBytes: number;
  payloadHash: string;
  snapshotAt: string;
  archivedAt: string;
  eventIds?: string[];
}

/**
 * Compact stand-in written to the jsonb archive column instead of the oversized blob.
 * Preserves provenance (the real payload hash + byte size + reason) so the row is still
 * an auditable record that this snapshot existed and why the full body was not stored.
 */
export function buildOversizedArchiveMetadata(params: {
  provider: string;
  league: string;
  kind: string;
  payloadBytes: number;
  maxPayloadBytes: number;
  payloadHash: string;
  snapshotAt: string;
  eventIds?: string[];
  now?: string;
}): OversizedArchiveMetadata {
  const metadata: OversizedArchiveMetadata = {
    reason: 'payload_too_large',
    provider: params.provider,
    league: params.league,
    kind: params.kind,
    payloadBytes: params.payloadBytes,
    maxPayloadBytes: params.maxPayloadBytes,
    payloadHash: params.payloadHash,
    snapshotAt: params.snapshotAt,
    archivedAt: params.now ?? new Date().toISOString(),
  };
  const eventIds = (params.eventIds ?? []).filter((id) => id.length > 0);
  if (eventIds.length > 0) {
    metadata.eventIds = eventIds;
  }
  return metadata;
}

export class ArchiveWriteTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`archive write '${label}' exceeded ${timeoutMs}ms timeout`);
    this.name = 'ArchiveWriteTimeoutError';
  }
}

/**
 * Race an archive write against a short timeout so a slow/hung write can never consume
 * the 120 s statement-timeout window. The losing DB write keeps running server-side
 * until its own statement_timeout fires, but the caller is freed immediately and treats
 * the timeout as a (fail-open) archive failure.
 */
export async function withArchiveWriteTimeout<T>(
  op: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ArchiveWriteTimeoutError(label, timeoutMs)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
