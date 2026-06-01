import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createIndependentAdversarialRecord } from './independent-data-path.js';
import { detectProviderAnomalies } from './provider-anomaly.js';

const detectedAt = '2026-06-01T12:05:30.000Z';

test('detects stale provider snapshots from independent capture time', () => {
  const record = createIndependentAdversarialRecord({
    id: 'stale-record',
    rawSnapshot: {
      source: 'provider-a',
      capturedAt: '2026-06-01T12:00:00.000Z',
      payload: {
        eventId: 'event-1',
        offer: { market: 'points', selection: 'player-a', line: 21.5, odds: -110 },
      },
    },
  });

  const reports = detectProviderAnomalies({ records: [record], detectedAt });

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.classification, 'stale_data');
  assert.equal(reports[0]?.quarantineSignal, true);
  assert.deepEqual(reports[0]?.affectedSources, ['provider-a']);
  assert.equal(reports[0]?.payloadHash, record.payloadHash);
});

test('detects missing markets for providers that omit a consensus market', () => {
  const present = createIndependentAdversarialRecord({
    id: 'present-record',
    rawSnapshot: {
      source: 'provider-a',
      capturedAt: '2026-06-01T12:05:00.000Z',
      payload: {
        eventId: 'event-2',
        offer: { market: 'rebounds', selection: 'player-b', line: 8.5, odds: -105 },
      },
    },
  });
  const missing = createIndependentAdversarialRecord({
    id: 'missing-record',
    rawSnapshot: {
      source: 'provider-b',
      capturedAt: '2026-06-01T12:05:00.000Z',
      payload: {
        eventId: 'event-2',
        offers: [],
      },
    },
  });

  const reports = detectProviderAnomalies({ records: [present, missing], detectedAt });
  const missingMarket = reports.find((report) => report.classification === 'missing_market');

  assert.ok(missingMarket);
  assert.equal(missingMarket.recordId, missing.id);
  assert.equal(missingMarket.quarantineSignal, true);
  assert.deepEqual(missingMarket.affectedSources, ['provider-b']);
});

test('detects cross-provider line divergence on the same event market and selection', () => {
  const first = createIndependentAdversarialRecord({
    id: 'provider-a-record',
    rawSnapshot: {
      source: 'provider-a',
      capturedAt: '2026-06-01T12:05:00.000Z',
      payload: {
        eventId: 'event-3',
        offer: { market: 'assists', selection: 'player-c', line: 5.5, odds: -110 },
      },
    },
  });
  const second = createIndependentAdversarialRecord({
    id: 'provider-b-record',
    rawSnapshot: {
      source: 'provider-b',
      capturedAt: '2026-06-01T12:05:00.000Z',
      payload: {
        eventId: 'event-3',
        offer: { market: 'assists', selection: 'player-c', line: 7, odds: -108 },
      },
    },
  });

  const reports = detectProviderAnomalies({ records: [first, second], detectedAt });
  const divergence = reports.find((report) => report.classification === 'cross_provider_divergence');

  assert.ok(divergence);
  assert.equal(divergence.quarantineSignal, true);
  assert.deepEqual(divergence.affectedSources, ['provider-a', 'provider-b']);
  assert.equal(divergence.recordId, first.id);
  assert.equal(divergence.payloadHash, first.payloadHash);
  assert.ok(divergence.confidence >= 0.7);
});

test('does not emit provider anomalies when records are fresh and aligned', () => {
  const first = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-a',
      capturedAt: '2026-06-01T12:05:00.000Z',
      payload: {
        eventId: 'event-4',
        offer: { market: 'points', selection: 'player-d', line: 20.5, odds: -110 },
      },
    },
  });
  const second = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-b',
      capturedAt: '2026-06-01T12:05:00.000Z',
      payload: {
        eventId: 'event-4',
        offer: { market: 'points', selection: 'player-d', line: 21, odds: -112 },
      },
    },
  });

  const reports = detectProviderAnomalies({ records: [first, second], detectedAt });

  assert.deepEqual(reports, []);
});
