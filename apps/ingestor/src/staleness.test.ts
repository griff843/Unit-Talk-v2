import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateIngestorOutageHealth,
  evaluateProviderOfferStaleness,
} from './staleness.js';

test('evaluateProviderOfferStaleness reports stale and healthy provider-offer timestamps', () => {
  const now = new Date('2026-05-17T18:00:00.000Z');

  const stale = evaluateProviderOfferStaleness({
    latestOfferUpdatedAt: '2026-05-17T15:30:00.000Z',
    staleThresholdMinutes: 120,
    now,
  });

  assert.equal(stale.status, 'STALE');
  assert.equal(stale.dataStale, true);
  assert.equal(stale.ageMinutes, 150);
  assert.equal(stale.staleSince, '2026-05-17T15:30:00.000Z');

  const healthy = evaluateProviderOfferStaleness({
    latestOfferUpdatedAt: '2026-05-17T16:30:00.000Z',
    staleThresholdMinutes: 120,
    now,
  });

  assert.equal(healthy.status, 'HEALTHY');
  assert.equal(healthy.dataStale, false);
  assert.equal(healthy.ageMinutes, 90);
  assert.equal(healthy.staleSince, undefined);
});

test('evaluateIngestorOutageHealth distinguishes outage, stale data, and recovery', () => {
  const now = new Date('2026-05-17T18:00:00.000Z');

  const outage = evaluateIngestorOutageHealth({
    runtimeRunning: false,
    latestRunStartedAt: null,
    latestOfferUpdatedAt: null,
    staleThresholdMinutes: 120,
    now,
  });

  assert.equal(outage.status, 'FAILED');
  assert.equal(outage.outage, true);
  assert.equal(outage.dataStale, true);

  const degraded = evaluateIngestorOutageHealth({
    runtimeRunning: true,
    latestRunStartedAt: '2026-05-17T17:58:00.000Z',
    latestOfferUpdatedAt: '2026-05-17T15:30:00.000Z',
    staleThresholdMinutes: 120,
    now,
  });

  assert.equal(degraded.status, 'DEGRADED');
  assert.equal(degraded.outage, false);
  assert.equal(degraded.dataStale, true);

  const recovered = evaluateIngestorOutageHealth({
    runtimeRunning: true,
    latestRunStartedAt: '2026-05-17T17:59:00.000Z',
    latestOfferUpdatedAt: '2026-05-17T17:55:00.000Z',
    staleThresholdMinutes: 120,
    now,
  });

  assert.equal(recovered.status, 'HEALTHY');
  assert.equal(recovered.outage, false);
  assert.equal(recovered.dataStale, false);
});
