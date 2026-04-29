export interface ProviderIngestionDbWritePolicy {
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  maxBatchSize: number;
  mergeChunkSize: number;
  retryMaxAttempts: number;
  retryBackoffMs: number;
}

export type ProviderPayloadArchiveMode = 'fail_open' | 'fail_closed';

export interface ProviderPayloadArchivePolicy {
  mode: ProviderPayloadArchiveMode;
  spoolDir: string;
}

export interface ProviderIngestionPolicyEnv {
  UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS?: string | undefined;
  UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS?: string | undefined;
  UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE?: string | undefined;
  UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE?: string | undefined;
  UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS?: string | undefined;
  UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS?: string | undefined;
  UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE?: string | undefined;
  UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR?: string | undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveProviderIngestionDbWritePolicy(
  env: ProviderIngestionPolicyEnv,
): ProviderIngestionDbWritePolicy {
  return {
    statementTimeoutMs: parsePositiveInt(
      env.UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS,
      15_000,
    ),
    lockTimeoutMs: parsePositiveInt(
      env.UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS,
      5_000,
    ),
    maxBatchSize: parsePositiveInt(
      env.UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE,
      500,
    ),
    mergeChunkSize: parsePositiveInt(
      env.UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE,
      250,
    ),
    retryMaxAttempts: parsePositiveInt(
      env.UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS,
      2,
    ),
    retryBackoffMs: parsePositiveInt(
      env.UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS,
      1_000,
    ),
  };
}

export function resolveProviderPayloadArchivePolicy(
  env: ProviderIngestionPolicyEnv,
): ProviderPayloadArchivePolicy {
  return {
    mode:
      env.UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE?.trim().toLowerCase() ===
      'fail_closed'
        ? 'fail_closed'
        : 'fail_open',
    spoolDir:
      env.UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR?.trim() ||
      'out/provider-payload-archive',
  };
}
