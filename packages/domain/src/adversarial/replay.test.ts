import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createIndependentAdversarialRecord,
  createReplayableAdversarialFinding,
} from './independent-data-path.js';
import { replayAdversarialFindings } from './replay.js';

const capturedAt = '2026-06-01T12:00:00.000Z';
const detectedAt = '2026-06-01T12:01:00.000Z';
const replayedAt = '2026-06-01T12:02:00.000Z';

test('replays findings only when the independent record identity still matches', () => {
  const record = createIndependentAdversarialRecord({
    id: 'record-1',
    rawSnapshot: {
      source: 'sgo',
      capturedAt,
      payload: { eventId: 'event-1', offer: { market: 'points', line: 22.5 } },
    },
  });
  const finding = createReplayableAdversarialFinding({
    record,
    detectedAt,
    finding: { code: 'edge_divergence', observed: 0.08, expected: 0.02 },
  });

  const result = replayAdversarialFindings({
    records: [record],
    findings: [finding],
    replayedAt,
  });

  assert.equal(result.replayedAt, replayedAt);
  assert.equal(result.verified.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.verified[0]?.record, record);
  assert.equal(result.verified[0]?.finding, finding);
  assert.equal(result.verified[0]?.verified, true);
});

test('rejects findings when only transformed or changed payloads are available', () => {
  const original = createIndependentAdversarialRecord({
    id: 'record-1',
    rawSnapshot: {
      source: 'sgo',
      capturedAt,
      payload: { eventId: 'event-1', offer: { market: 'points', line: 22.5 } },
    },
  });
  const changed = createIndependentAdversarialRecord({
    id: 'record-1',
    rawSnapshot: {
      source: 'sgo',
      capturedAt,
      payload: { eventId: 'event-1', offer: { market: 'points', line: 21.5 } },
    },
  });
  const finding = createReplayableAdversarialFinding({
    record: original,
    detectedAt,
    finding: { code: 'line_mismatch' },
  });

  const result = replayAdversarialFindings({
    records: [changed],
    findings: [finding],
    replayedAt,
  });

  assert.equal(result.verified.length, 0);
  assert.deepEqual(result.rejected, [finding]);
});

test('does not replay findings without their raw independent snapshot', () => {
  const record = createIndependentAdversarialRecord({
    id: 'record-1',
    rawSnapshot: {
      source: 'provider-x',
      capturedAt,
      payload: { eventId: 'event-1', price: -110 },
    },
  });
  const finding = createReplayableAdversarialFinding({
    record,
    detectedAt,
    finding: { code: 'missing_provider_field' },
  });

  const result = replayAdversarialFindings({
    records: [],
    findings: [finding],
    replayedAt,
  });

  assert.equal(result.verified.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0], finding);
});
