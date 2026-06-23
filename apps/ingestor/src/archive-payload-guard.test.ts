import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ArchiveWriteTimeoutError,
  DEFAULT_ARCHIVE_WRITE_TIMEOUT_MS,
  DEFAULT_MAX_ARCHIVE_PAYLOAD_BYTES,
  buildOversizedArchiveMetadata,
  isPayloadOversized,
  resolveArchiveWriteTimeoutMs,
  resolveMaxArchivePayloadBytes,
  serializedPayloadBytes,
  withArchiveWriteTimeout,
} from './archive-payload-guard.js';

test('serializedPayloadBytes measures utf8 byte length', () => {
  assert.equal(serializedPayloadBytes(''), 0);
  assert.equal(serializedPayloadBytes('abc'), 3);
  // multi-byte char counts as its utf8 width, not its code-unit count
  assert.equal(serializedPayloadBytes('€'), 3);
});

test('isPayloadOversized trips only above the cap', () => {
  assert.equal(isPayloadOversized(10, 100), false);
  assert.equal(isPayloadOversized(100, 100), false); // boundary is inclusive-ok
  assert.equal(isPayloadOversized(101, 100), true);
});

test('UTV2-1294: a small payload is not oversized at the default 1 MB cap', () => {
  assert.equal(isPayloadOversized(45, DEFAULT_MAX_ARCHIVE_PAYLOAD_BYTES), false);
});

test('UTV2-1294: a 3 MB MLB-odds-class payload IS oversized at the default cap', () => {
  assert.equal(isPayloadOversized(3_500_000, DEFAULT_MAX_ARCHIVE_PAYLOAD_BYTES), true);
});

test('buildOversizedArchiveMetadata records compact provenance with reason payload_too_large', () => {
  const meta = buildOversizedArchiveMetadata({
    provider: 'sgo',
    league: 'MLB',
    kind: 'odds',
    payloadBytes: 3_500_000,
    maxPayloadBytes: 1_000_000,
    payloadHash: 'deadbeef',
    snapshotAt: '2026-06-23T18:00:00.000Z',
    eventIds: ['evt-1', 'evt-2'],
    now: '2026-06-23T18:00:01.000Z',
  });
  assert.equal(meta.reason, 'payload_too_large');
  assert.equal(meta.provider, 'sgo');
  assert.equal(meta.league, 'MLB');
  assert.equal(meta.kind, 'odds');
  assert.equal(meta.payloadBytes, 3_500_000);
  assert.equal(meta.maxPayloadBytes, 1_000_000);
  assert.equal(meta.payloadHash, 'deadbeef');
  assert.equal(meta.snapshotAt, '2026-06-23T18:00:00.000Z');
  assert.equal(meta.archivedAt, '2026-06-23T18:00:01.000Z');
  assert.deepEqual(meta.eventIds, ['evt-1', 'evt-2']);

  // The metadata must itself be small — that is the whole point.
  assert.ok(serializedPayloadBytes(JSON.stringify(meta)) < 1_000);
});

test('buildOversizedArchiveMetadata omits eventIds when none are available', () => {
  const meta = buildOversizedArchiveMetadata({
    provider: 'sgo',
    league: 'MLB',
    kind: 'odds',
    payloadBytes: 2_000_000,
    maxPayloadBytes: 1_000_000,
    payloadHash: 'abc',
    snapshotAt: '2026-06-23T18:00:00.000Z',
    eventIds: ['', ''],
    now: '2026-06-23T18:00:01.000Z',
  });
  assert.equal('eventIds' in meta, false);
});

test('resolve* helpers use defaults and honor positive env overrides', () => {
  assert.equal(resolveMaxArchivePayloadBytes({}), DEFAULT_MAX_ARCHIVE_PAYLOAD_BYTES);
  assert.equal(resolveArchiveWriteTimeoutMs({}), DEFAULT_ARCHIVE_WRITE_TIMEOUT_MS);
  assert.equal(
    resolveMaxArchivePayloadBytes({ UNIT_TALK_INGESTOR_MAX_ARCHIVE_PAYLOAD_BYTES: '500000' }),
    500_000,
  );
  assert.equal(
    resolveArchiveWriteTimeoutMs({ UNIT_TALK_INGESTOR_ARCHIVE_WRITE_TIMEOUT_MS: '3000' }),
    3_000,
  );
  // invalid / non-positive values fall back to the default (fail safe)
  assert.equal(
    resolveMaxArchivePayloadBytes({ UNIT_TALK_INGESTOR_MAX_ARCHIVE_PAYLOAD_BYTES: 'nope' }),
    DEFAULT_MAX_ARCHIVE_PAYLOAD_BYTES,
  );
  assert.equal(
    resolveArchiveWriteTimeoutMs({ UNIT_TALK_INGESTOR_ARCHIVE_WRITE_TIMEOUT_MS: '0' }),
    DEFAULT_ARCHIVE_WRITE_TIMEOUT_MS,
  );
});

test('withArchiveWriteTimeout returns the value when the op finishes in time', async () => {
  const result = await withArchiveWriteTimeout(async () => 'ok', 1_000, 'fast');
  assert.equal(result, 'ok');
});

test('UTV2-1294: withArchiveWriteTimeout rejects fast when the write hangs (cannot consume the 120s window)', async () => {
  const start = Date.now();
  // A write that resolves only AFTER the 25ms timeout has fired — models a hung
  // PostgREST insert. It still settles (at 40ms) so the test runner's event loop stays
  // clean; the test awaits that settle below.
  const hung = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 40);
    });

  await assert.rejects(
    () => withArchiveWriteTimeout(hung, 25, 'odds_snapshots:MLB'),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveWriteTimeoutError);
      assert.equal(error.timeoutMs, 25);
      assert.match(error.message, /exceeded 25ms/);
      return true;
    },
  );
  // The caller is freed in ~25ms, nowhere near the 120s statement_timeout.
  assert.ok(Date.now() - start < 5_000);
  await new Promise((resolve) => setTimeout(resolve, 60));
});
