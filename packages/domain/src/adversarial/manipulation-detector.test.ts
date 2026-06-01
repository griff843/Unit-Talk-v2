import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createIndependentAdversarialRecord } from './independent-data-path.js';
import { detectManipulation } from './manipulation-detector.js';

const capturedAt = '2026-06-01T12:00:00.000Z';
const detectedAt = '2026-06-01T12:01:00.000Z';

test('detects fabricated lines against independent consensus evidence', () => {
  const record = createIndependentAdversarialRecord({
    id: 'record-line-fabrication',
    rawSnapshot: {
      source: 'provider-a',
      capturedAt,
      payload: {
        eventId: 'event-1',
        offer: { market: 'points', selection: 'player-a', line: 18.5 },
        marketConsensus: { line: 21.5 },
      },
    },
  });

  const finding = detectManipulation({ record, detectedAt });

  assert.equal(finding.classification, 'line_fabrication');
  assert.equal(finding.quarantineSignal, true);
  assert.equal(finding.recordId, record.id);
  assert.equal(finding.payloadHash, record.payloadHash);
  assert.equal(finding.replayKey, record.replayKey);
  assert.equal(Object.isFrozen(finding), true);
  assert.match(finding.id, /^advfind_[a-f0-9]{16}$/);
});

test('detects volume spoofing from explicit spike ratios', () => {
  const record = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-b',
      capturedAt,
      payload: {
        eventId: 'event-2',
        offer: { market: 'rebounds', selection: 'player-b', line: 8.5 },
        volumeSpikeRatio: 7.25,
      },
    },
  });

  const finding = detectManipulation({ record, detectedAt });

  assert.equal(finding.classification, 'volume_spoofing');
  assert.equal(finding.quarantineSignal, true);
  assert.ok(finding.confidence >= 0.72);
});

test('detects timestamp forgery when provider time is outside capture tolerance', () => {
  const record = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-c',
      capturedAt,
      payload: {
        eventId: 'event-3',
        offer: {
          market: 'assists',
          selection: 'player-c',
          line: 5.5,
          timestamp: '2026-06-01T12:03:00.000Z',
        },
      },
    },
  });

  const finding = detectManipulation({ record, detectedAt });

  assert.equal(finding.classification, 'timestamp_forgery');
  assert.equal(finding.quarantineSignal, true);
  assert.equal(finding.confidence, 0.9);
});

test('returns a replayable non-quarantine finding when no manipulation signals trip', () => {
  const record = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-d',
      capturedAt,
      payload: {
        eventId: 'event-4',
        offer: { market: 'points', selection: 'player-d', line: 20.5, timestamp: capturedAt },
        marketConsensus: { line: 20 },
        volume: 120,
        baselineVolume: 100,
      },
    },
  });

  const finding = detectManipulation({ record, detectedAt });

  assert.equal(finding.classification, 'none');
  assert.equal(finding.quarantineSignal, false);
  assert.equal(finding.recordId, record.id);
  assert.equal(finding.replayableFromPath, 'independent-adversarial');
});
