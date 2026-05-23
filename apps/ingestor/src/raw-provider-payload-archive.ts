import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { RawPayloadRepository } from '@unit-talk/db';

import type { ProviderPayloadArchiveMode } from './provider-ingestion-policy.js';

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
}

export interface RawProviderPayloadArchiveResult {
  archivePath: string | null;
  archivedAt: string;
  payloadHash: string;
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
  const hashSource = input.rawBody ?? JSON.stringify(input.payload);
  const payloadHash = sha256Hex(hashSource);
  const serialized = input.rawBody ?? JSON.stringify(input.payload);

  // DB write is primary and fail-closed: throws on failure, callers must not swallow
  await input.rawPayloadsRepository.insert({
    providerKey: input.providerKey,
    league: input.league,
    runId: input.runId,
    kind: input.kind,
    payloadHash,
    payload: input.payload,
    snapshotAt: input.snapshotAt,
  });

  // Disk spool is secondary / best-effort — never blocks ingestion
  let archivePath: string | null = null;
  try {
    const stamp = input.snapshotAt.replace(/[:.]/g, '-');
    const dir = path.join(input.spoolDir, input.providerKey, input.league);
    await fs.promises.mkdir(dir, { recursive: true });
    archivePath = path.join(
      dir,
      `${input.runId}-${input.kind}-${stamp}.json`,
    );
    await fs.promises.writeFile(
      archivePath,
      `${serialized}\n`,
      'utf8',
    );
  } catch {
    archivePath = null;
  }

  return {
    archivePath,
    archivedAt: new Date().toISOString(),
    payloadHash,
  };
}

export function shouldBlockOnArchiveFailure(mode: ProviderPayloadArchiveMode) {
  return mode === 'fail_closed';
}
