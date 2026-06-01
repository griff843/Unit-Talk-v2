import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createIndependentAdversarialRecord,
  createReplayableAdversarialFinding,
  IndependentDataPathError,
  stableHash,
} from './independent-data-path.js';

const capturedAt = '2026-06-01T12:00:00.000Z';
const detectedAt = '2026-06-01T12:01:00.000Z';

test('creates immutable independent records from raw provider payloads', () => {
  const record = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'sgo',
      capturedAt,
      payload: {
        event: { id: 'event-1', teams: ['A', 'B'] },
        offers: [{ market: 'points', line: 22.5 }],
      },
    },
  });

  assert.equal(record.pathId, 'independent-adversarial');
  assert.equal(record.capturedAt, capturedAt);
  assert.equal(record.rawSnapshot.source, 'sgo');
  assert.match(record.id, /^advrec_[a-f0-9]{16}$/);
  assert.match(record.payloadHash, /^[a-f0-9]{16}$/);
  assert.match(record.replayKey, /^[a-f0-9]{16}$/);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.rawSnapshot), true);
  assert.equal(Object.isFrozen(record.rawSnapshot.payload), true);
});

test('canonicalizes payload object order for deterministic replay identity', () => {
  const first = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'sgo',
      capturedAt,
      payload: { b: 2, a: { d: 4, c: 3 } },
    },
  });
  const second = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'sgo',
      capturedAt,
      payload: { a: { c: 3, d: 4 }, b: 2 },
    },
  });

  assert.equal(first.payloadHash, second.payloadHash);
  assert.equal(first.replayKey, second.replayKey);
  assert.equal(first.id, second.id);
});

test('rejects provider snapshots that are not independently replayable JSON evidence', () => {
  assert.throws(
    () => createIndependentAdversarialRecord({
      rawSnapshot: {
        source: 'sgo',
        capturedAt,
        payload: { price: Number.NaN },
      },
    }),
    IndependentDataPathError,
  );

  assert.throws(
    () => createIndependentAdversarialRecord({
      rawSnapshot: {
        source: 'sgo',
        capturedAt: '2026-06-01T12:00:00-04:00',
        payload: { price: 105 },
      },
    }),
    /rawSnapshot\.capturedAt must be an ISO-8601 UTC timestamp/,
  );
});

test('creates replayable findings bound to the independent record hash', () => {
  const record = createIndependentAdversarialRecord({
    id: 'raw-snapshot-1',
    rawSnapshot: {
      source: 'provider-x',
      capturedAt,
      payload: { eventId: 'event-1', offer: { market: 'assists', price: -110 } },
    },
  });

  const finding = createReplayableAdversarialFinding({
    record,
    detectedAt,
    finding: {
      code: 'line_mismatch',
      expectedLine: 5.5,
      observedLine: 4.5,
    },
  });

  assert.equal(finding.recordId, 'raw-snapshot-1');
  assert.equal(finding.replayableFromPath, 'independent-adversarial');
  assert.equal(finding.payloadHash, record.payloadHash);
  assert.equal(finding.replayKey, record.replayKey);
  assert.match(finding.id, /^advfind_[a-f0-9]{16}$/);
  assert.equal(Object.isFrozen(finding), true);
  assert.equal(Object.isFrozen(finding.finding), true);
});

test('stableHash remains deterministic for primitive and nested JSON values', () => {
  assert.equal(stableHash({ source: 'sgo', nested: [1, true, null] }), stableHash({ nested: [1, true, null], source: 'sgo' }));
  assert.notEqual(stableHash({ source: 'sgo', nested: [1, true, null] }), stableHash({ source: 'sgo', nested: [1, false, null] }));
});
