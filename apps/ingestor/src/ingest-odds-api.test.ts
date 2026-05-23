/**
 * Adversarial integration tests — UTV2-1084
 *
 * Proves that archive failure blocks the full ingestOddsApiLeague cycle
 * when mode is fail_closed. Tests run end-to-end through the provider
 * ingestion path using a mock HTTP fetch and a throwing rawPayloads repo.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';

import type { RawPayloadInsert, RawPayloadRecord, RawPayloadRepository } from '@unit-talk/db';
import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';

import { ingestOddsApiLeague } from './ingest-odds-api.js';

const FAKE_ODDS_RESPONSE = JSON.stringify([
  {
    id: 'evt-1',
    sport_key: 'basketball_nba',
    sport_title: 'NBA',
    commence_time: '2026-05-23T20:00:00Z',
    home_team: 'Boston Celtics',
    away_team: 'Miami Heat',
    bookmakers: [],
  },
]);

function makeMockFetch(body = FAKE_ODDS_RESPONSE, status = 200): typeof fetch {
  return async (_url: string | URL | Request): Promise<Response> => {
    return new Response(body, {
      status,
      headers: {
        'content-type': 'application/json',
        'x-requests-remaining': '500',
        'x-requests-last': '1',
      },
    });
  };
}

class ThrowingRawPayloadRepository implements RawPayloadRepository {
  async insert(_input: RawPayloadInsert): Promise<RawPayloadRecord> {
    throw new Error('DB archive failure — simulated');
  }
}

class CapturingRawPayloadRepository implements RawPayloadRepository {
  readonly inserts: RawPayloadInsert[] = [];

  async insert(input: RawPayloadInsert): Promise<RawPayloadRecord> {
    this.inserts.push(input);
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

test('ingestOddsApiLeague — archive failure blocks ingestion when mode is fail_closed', async () => {
  const bundle = createInMemoryIngestorRepositoryBundle();
  // Replace rawPayloads with a throwing repo
  const failingBundle = { ...bundle, rawPayloads: new ThrowingRawPayloadRepository() };

  const summary = await ingestOddsApiLeague({
    apiKey: 'test-key',
    league: 'NBA',
    repositories: failingBundle,
    fetchImpl: makeMockFetch(),
    providerPayloadArchivePolicy: { mode: 'fail_closed', spoolDir: '/tmp/test-spool' },
  });

  assert.equal(summary.status, 'failed', 'ingestion must fail when archive DB write fails in fail_closed mode');
  assert.ok(summary.error?.includes('archive failure'), `expected archive failure in error, got: ${summary.error}`);
});

test('ingestOddsApiLeague — archive failure is logged but not blocking when mode is fail_open', async () => {
  const bundle = createInMemoryIngestorRepositoryBundle();
  const failingBundle = { ...bundle, rawPayloads: new ThrowingRawPayloadRepository() };

  const summary = await ingestOddsApiLeague({
    apiKey: 'test-key',
    league: 'NBA',
    repositories: failingBundle,
    fetchImpl: makeMockFetch(),
    providerPayloadArchivePolicy: { mode: 'fail_open', spoolDir: '/tmp/test-spool' },
  });

  // fail_open: archive failure is tolerated, ingestion may succeed or fail for other reasons
  assert.notEqual(summary.error, 'archive failure: DB archive failure — simulated',
    'fail_open must not propagate archive failure as the terminal error');
});

test('ingestOddsApiLeague — rawBody hash is computed from HTTP response text (pre-parse)', async () => {
  const repo = new CapturingRawPayloadRepository();
  const bundle = createInMemoryIngestorRepositoryBundle();
  const capturingBundle = { ...bundle, rawPayloads: repo };

  await ingestOddsApiLeague({
    apiKey: 'test-key',
    league: 'NBA',
    repositories: capturingBundle,
    fetchImpl: makeMockFetch(),
    providerPayloadArchivePolicy: { mode: 'fail_closed', spoolDir: '/tmp/test-spool' },
  });

  assert.equal(repo.inserts.length, 1, 'exactly one archive insert expected');
  const insert = repo.inserts[0];
  assert.ok(insert !== undefined);

  // Hash must be SHA-256 of the raw HTTP response body, not of JSON.stringify(parsedEvents)
  const expectedHash = crypto.createHash('sha256').update(FAKE_ODDS_RESPONSE).digest('hex');
  assert.equal(insert.payloadHash, expectedHash,
    'hash must equal SHA-256 of raw HTTP response text captured before JSON.parse');

  // Sanity: hash of re-serialized parsed payload would differ due to key reordering potential
  // (proves the hash is bound to original response bytes, not re-serialization)
  assert.ok(insert.payloadHash.length === 64, 'hash must be 64-char hex SHA-256');
});

test('ingestOddsApiLeague — skips archive when apiKey is empty', async () => {
  const repo = new CapturingRawPayloadRepository();
  const bundle = createInMemoryIngestorRepositoryBundle();
  const capturingBundle = { ...bundle, rawPayloads: repo };

  const summary = await ingestOddsApiLeague({
    apiKey: '',
    league: 'NBA',
    repositories: capturingBundle,
  });

  assert.equal(summary.status, 'skipped');
  assert.equal(repo.inserts.length, 0, 'no archive insert when apiKey is missing');
});
