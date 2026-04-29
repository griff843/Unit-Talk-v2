import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { archiveRawProviderPayload, shouldBlockOnArchiveFailure } from './raw-provider-payload-archive.js';
import { chunkByPolicy, withProviderDbRetry } from './provider-ingestion-db.js';
import {
  classifyProviderIngestionFailure,
  createPartialMarketFailure,
  createStaleAfterCycleFailure,
  createZeroOffersFailure,
} from './provider-ingestion-failures.js';
import {
  resolveProviderIngestionDbWritePolicy,
  resolveProviderPayloadArchivePolicy,
} from './provider-ingestion-policy.js';

test('resolveProviderIngestionDbWritePolicy parses configured limits and retries', () => {
  const policy = resolveProviderIngestionDbWritePolicy({
    UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS: '22000',
    UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS: '7000',
    UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE: '321',
    UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE: '123',
    UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS: '4',
    UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS: '2500',
  });

  assert.deepEqual(policy, {
    statementTimeoutMs: 22000,
    lockTimeoutMs: 7000,
    maxBatchSize: 321,
    mergeChunkSize: 123,
    retryMaxAttempts: 4,
    retryBackoffMs: 2500,
  });
});

test('resolveProviderPayloadArchivePolicy defaults fail-open and respects fail-closed', () => {
  assert.deepEqual(resolveProviderPayloadArchivePolicy({}), {
    mode: 'fail_open',
    spoolDir: 'out/provider-payload-archive',
  });

  assert.deepEqual(
    resolveProviderPayloadArchivePolicy({
      UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE: 'fail_closed',
      UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR: 'tmp/provider-archive',
    }),
    {
      mode: 'fail_closed',
      spoolDir: 'tmp/provider-archive',
    },
  );
});

test('classifyProviderIngestionFailure distinguishes DB, archive, provider, and parse failures', () => {
  const dbFailure = classifyProviderIngestionFailure(
    new Error('canceling statement due to statement timeout'),
    { providerKey: 'sgo', sportKey: 'NBA' },
  );
  assert.equal(dbFailure.category, 'db_statement_timeout');
  assert.equal(dbFailure.scope, 'db');
  assert.equal(dbFailure.retryable, true);

  const providerFailure = classifyProviderIngestionFailure(
    new Error('provider api 503 upstream unavailable'),
    { providerKey: 'sgo', sportKey: 'NBA' },
  );
  assert.equal(providerFailure.category, 'provider_api_failure');
  assert.equal(providerFailure.scope, 'provider');
  assert.equal(providerFailure.retryable, true);

  const parseFailure = classifyProviderIngestionFailure(
    new Error('Unexpected token in JSON payload'),
    { providerKey: 'sgo', sportKey: 'NBA', marketKey: 'player_points' },
  );
  assert.equal(parseFailure.category, 'parse_failure');
  assert.equal(parseFailure.scope, 'market');
  assert.equal(parseFailure.affectedMarketKey, 'player_points');

  const archiveFailure = classifyProviderIngestionFailure(
    new Error('archive write failed'),
    { providerKey: 'sgo', sportKey: 'NBA' },
  );
  assert.equal(archiveFailure.category, 'archive_failure');
  assert.equal(archiveFailure.scope, 'archive');
});

test('explicit provider ingestion failure constructors keep unresolved semantics surfaced', () => {
  assert.deepEqual(createZeroOffersFailure('sgo', 'NBA'), {
    category: 'zero_offers',
    scope: 'sport',
    message: 'Provider returned zero offers for sgo/NBA',
    affectedProviderKey: 'sgo',
    affectedSportKey: 'NBA',
    affectedMarketKey: null,
    retryable: false,
  });

  assert.deepEqual(
    createPartialMarketFailure('sgo', 'NBA', 'player_points', 'normalization dropped some rows'),
    {
      category: 'partial_market_failure',
      scope: 'market',
      message: 'normalization dropped some rows',
      affectedProviderKey: 'sgo',
      affectedSportKey: 'NBA',
      affectedMarketKey: 'player_points',
      retryable: false,
    },
  );

  assert.deepEqual(
    createStaleAfterCycleFailure('sgo', 'NBA', 'freshness gate blocked merge'),
    {
      category: 'stale_after_cycle',
      scope: 'sport',
      message: 'freshness gate blocked merge',
      affectedProviderKey: 'sgo',
      affectedSportKey: 'NBA',
      affectedMarketKey: null,
      retryable: false,
    },
  );
});

test('withProviderDbRetry retries retryable DB failures and chunkByPolicy preserves bounded writes', async () => {
  let attempts = 0;
  const result = await withProviderDbRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error('lock timeout exceeded');
      }
      return 'ok';
    },
    {
      statementTimeoutMs: 15000,
      lockTimeoutMs: 5000,
      maxBatchSize: 500,
      mergeChunkSize: 250,
      retryMaxAttempts: 2,
      retryBackoffMs: 1,
    },
    { providerKey: 'sgo', sportKey: 'NBA' },
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
  assert.deepEqual(chunkByPolicy([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('archiveRawProviderPayload writes spool files and archive mode can block', async () => {
  const spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-payload-archive-'));
  const result = await archiveRawProviderPayload({
    providerKey: 'sgo',
    league: 'NBA',
    runId: 'run-1',
    snapshotAt: '2026-04-29T12:34:56.789Z',
    kind: 'odds',
    payload: [{ market: 'player_points' }],
    spoolDir,
  });

  assert.equal(shouldBlockOnArchiveFailure('fail_open'), false);
  assert.equal(shouldBlockOnArchiveFailure('fail_closed'), true);
  assert.equal(fs.existsSync(result.archivePath), true);
  assert.match(fs.readFileSync(result.archivePath, 'utf8'), /player_points/);

  fs.rmSync(spoolDir, { recursive: true, force: true });
});
