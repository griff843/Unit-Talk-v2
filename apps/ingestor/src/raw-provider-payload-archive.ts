import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { RawPayloadRepository } from '@unit-talk/db';

import type { ProviderPayloadArchiveMode } from './provider-ingestion-policy.js';
import {
  buildOversizedArchiveMetadata,
  isPayloadOversized,
  resolveArchiveWriteTimeoutMs,
  resolveMaxArchivePayloadBytes,
  serializedPayloadBytes,
  withArchiveWriteTimeout,
} from './archive-payload-guard.js';

export interface ArchiveLogger {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface RawProviderPayloadArchiveInput {
  providerKey: string;
  league: string;
  runId: string;
  snapshotAt: string;
  kind: 'odds' | 'results';
  payload: unknown;
  spoolDir: string;
  rawPayloadsRepository: RawPayloadRepository;
  /** Raw HTTP response text captured before JSON.parse — used as the hash source. */
  rawBody?: string;
  /** Provider event IDs for this snapshot, recorded in compact metadata when oversized. */
  eventIds?: string[];
  /** Override the oversize cap (defaults to env / 1 MB). */
  maxPayloadBytes?: number;
  /** Override the per-write timeout (defaults to env / 5 s). */
  writeTimeoutMs?: number;
  logger?: ArchiveLogger;
}

export interface RawProviderPayloadArchiveResult {
  archivePath: string | null;
  archivedAt: string;
  payloadHash: string;
  /** True when the payload exceeded the cap and only compact metadata was written. */
  oversized: boolean;
  payloadBytes: number;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function archiveRawProviderPayload(
  input: RawProviderPayloadArchiveInput,
): Promise<RawProviderPayloadArchiveResult> {
  // Hash the raw provider response bytes before any transformation.
  // rawBody is the unparsed HTTP response text; fall back to JSON.stringify only
  // when rawBody is unavailable (e.g. in tests that don't go through the HTTP layer).
  const serialized = input.rawBody ?? JSON.stringify(input.payload);
  const payloadHash = sha256Hex(serialized);
  const payloadBytes = serializedPayloadBytes(serialized);

  const maxPayloadBytes = input.maxPayloadBytes ?? resolveMaxArchivePayloadBytes();
  const writeTimeoutMs = input.writeTimeoutMs ?? resolveArchiveWriteTimeoutMs();
  const oversized = isPayloadOversized(payloadBytes, maxPayloadBytes);

  // UTV2-1294: never insert an oversized blob as one giant JSON value through PostgREST —
  // it exceeds the 120 s statement_timeout and starves the settlement path. Write compact
  // "payload_too_large" metadata instead (jsonb column, no migration). The full body is
  // still spooled to disk best-effort below for forensics.
  const payloadToWrite: unknown = oversized
    ? buildOversizedArchiveMetadata({
        provider: input.providerKey,
        league: input.league,
        kind: input.kind,
        payloadBytes,
        maxPayloadBytes,
        payloadHash,
        snapshotAt: input.snapshotAt,
        ...(input.eventIds ? { eventIds: input.eventIds } : {}),
      })
    : input.payload;

  if (oversized) {
    input.logger?.warn?.(
      `[ingestor] archive payload_too_large for ${input.providerKey}/${input.league}/${input.kind}: ` +
        `${payloadBytes}B > ${maxPayloadBytes}B cap — wrote compact metadata instead of the giant blob`,
      {
        healthCode: 'ARCHIVE_PAYLOAD_TOO_LARGE',
        provider: input.providerKey,
        league: input.league,
        kind: input.kind,
        payloadBytes,
        maxPayloadBytes,
        payloadHash,
      },
    );
  }

  // DB write (primary) is bounded by a short timeout so a slow/hung write can never
  // consume the statement-timeout window. The caller wraps this in fail-open handling
  // (archive/telemetry is never allowed to block the settlement-critical path).
  await withArchiveWriteTimeout(
    () =>
      input.rawPayloadsRepository.insert({
        providerKey: input.providerKey,
        league: input.league,
        runId: input.runId,
        kind: input.kind,
        payloadHash,
        payload: payloadToWrite,
        snapshotAt: input.snapshotAt,
      }),
    writeTimeoutMs,
    `raw_payloads:${input.league}:${input.kind}`,
  );

  // Disk spool is secondary / best-effort — never blocks ingestion. The full body is
  // spooled even when oversized so forensics are not lost when the DB holds only metadata.
  let archivePath: string | null = null;
  try {
    const stamp = input.snapshotAt.replace(/[:.]/g, '-');
    const dir = path.join(input.spoolDir, input.providerKey, input.league);
    await fs.promises.mkdir(dir, { recursive: true });
    archivePath = path.join(dir, `${input.runId}-${input.kind}-${stamp}.json`);
    await fs.promises.writeFile(archivePath, `${serialized}\n`, 'utf8');
  } catch {
    archivePath = null;
  }

  return {
    archivePath,
    archivedAt: new Date().toISOString(),
    payloadHash,
    oversized,
    payloadBytes,
  };
}

export function shouldBlockOnArchiveFailure(mode: ProviderPayloadArchiveMode) {
  return mode === 'fail_closed';
}
