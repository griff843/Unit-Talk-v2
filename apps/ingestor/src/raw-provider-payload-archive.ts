import fs from 'node:fs';
import path from 'node:path';

import type { ProviderPayloadArchiveMode } from './provider-ingestion-policy.js';

export interface RawProviderPayloadArchiveInput {
  providerKey: string;
  league: string;
  runId: string;
  snapshotAt: string;
  kind: 'odds' | 'results';
  payload: unknown;
  spoolDir: string;
}

export interface RawProviderPayloadArchiveResult {
  archivePath: string;
  archivedAt: string;
}

export async function archiveRawProviderPayload(
  input: RawProviderPayloadArchiveInput,
): Promise<RawProviderPayloadArchiveResult> {
  const stamp = input.snapshotAt.replace(/[:.]/g, '-');
  const dir = path.join(input.spoolDir, input.providerKey, input.league);
  await fs.promises.mkdir(dir, { recursive: true });
  const archivePath = path.join(
    dir,
    `${input.runId}-${input.kind}-${stamp}.json`,
  );
  await fs.promises.writeFile(
    archivePath,
    `${JSON.stringify(input.payload, null, 2)}\n`,
    'utf8',
  );
  return {
    archivePath,
    archivedAt: new Date().toISOString(),
  };
}

export function shouldBlockOnArchiveFailure(mode: ProviderPayloadArchiveMode) {
  return mode === 'fail_closed';
}
