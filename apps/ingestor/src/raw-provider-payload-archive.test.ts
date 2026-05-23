import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { RawPayloadInsert, RawPayloadRecord, RawPayloadRepository } from '@unit-talk/db';

import {
  archiveRawProviderPayload,
  shouldBlockOnArchiveFailure,
} from './raw-provider-payload-archive.js';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

class InMemoryRawPayloadRepository implements RawPayloadRepository {
  readonly inserted: RawPayloadInsert[] = [];

  async insert(input: RawPayloadInsert): Promise<RawPayloadRecord> {
    this.inserted.push(input);
    return {
      id: crypto.randomUUID(),
      provider_key: input.providerKey,
      league: input.league,
      run_id: input.runId,
      kind: input.kind,
      payload_hash: input.payloadHash,
      payload: input.payload,
      snapshot_at: input.snapshotAt,
      created_at: new Date().toISOString(),
    };
  }
}

class ThrowingRawPayloadRepository implements RawPayloadRepository {
  async insert(_input: RawPayloadInsert): Promise<RawPayloadRecord> {
    throw new Error('simulated DB failure');
  }
}

test('archiveRawProviderPayload — computes SHA-256 before transformation and writes to DB', async () => {
  const repo = new InMemoryRawPayloadRepository();
  const payload = [{ id: 'evt-1', bookmakers: [] }];
  const snapshotAt = '2026-05-23T12:00:00.000Z';

  const result = await archiveRawProviderPayload({
    providerKey: 'odds-api',
    league: 'NBA',
    runId: 'run-test-1',
    snapshotAt,
    kind: 'odds',
    payload,
    spoolDir: path.join(os.tmpdir(), 'ut-archive-test'),
    rawPayloadsRepository: repo,
  });

  assert.equal(repo.inserted.length, 1, 'should insert exactly one record');

  const inserted = repo.inserted[0];
  assert.ok(inserted !== undefined);
  assert.equal(inserted.providerKey, 'odds-api');
  assert.equal(inserted.league, 'NBA');
  assert.equal(inserted.kind, 'odds');
  assert.equal(inserted.snapshotAt, snapshotAt);

  const expectedHash = sha256Hex(JSON.stringify(payload));
  assert.equal(inserted.payloadHash, expectedHash, 'hash must match SHA-256 of raw JSON serialization');
  assert.equal(result.payloadHash, expectedHash, 'result must expose the hash');
});

test('archiveRawProviderPayload — throws when DB write fails (fail-closed)', async () => {
  const repo = new ThrowingRawPayloadRepository();

  await assert.rejects(
    () =>
      archiveRawProviderPayload({
        providerKey: 'odds-api',
        league: 'NBA',
        runId: 'run-test-2',
        snapshotAt: '2026-05-23T12:00:00.000Z',
        kind: 'odds',
        payload: [],
        spoolDir: path.join(os.tmpdir(), 'ut-archive-test'),
        rawPayloadsRepository: repo,
      }),
    /simulated DB failure/,
    'archive failure must propagate — no silent swallow',
  );
});

test('shouldBlockOnArchiveFailure — fail_closed returns true, fail_open returns false', () => {
  assert.equal(shouldBlockOnArchiveFailure('fail_closed'), true);
  assert.equal(shouldBlockOnArchiveFailure('fail_open'), false);
});

test('archiveRawProviderPayload — hash is computed from raw payload before any mutation', async () => {
  const repo = new InMemoryRawPayloadRepository();
  const originalPayload = { events: [{ id: 'e1', odds: 110 }] };
  const snapshotAt = '2026-05-23T13:00:00.000Z';

  await archiveRawProviderPayload({
    providerKey: 'sgo',
    league: 'NFL',
    runId: 'run-test-3',
    snapshotAt,
    kind: 'odds',
    payload: originalPayload,
    spoolDir: path.join(os.tmpdir(), 'ut-archive-test'),
    rawPayloadsRepository: repo,
  });

  const expectedHash = sha256Hex(JSON.stringify(originalPayload));
  const record = repo.inserted[0];
  assert.ok(record !== undefined);
  assert.equal(record.payloadHash, expectedHash);
  // Verify the hash would change if the payload were mutated (adversarial)
  const mutatedHash = sha256Hex(JSON.stringify({ events: [{ id: 'e1', odds: 999 }] }));
  assert.notEqual(record.payloadHash, mutatedHash, 'hash must be pre-mutation');
});
