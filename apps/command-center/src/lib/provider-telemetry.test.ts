import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeProviderRequests, cycleLatency } from './provider-telemetry';

test('request observations sum actual run counts and quota uses a single latest limit/remaining snapshot', () => {
  const result = summarizeProviderRequests([
    { started_at: '2026-09-21T00:00:00Z', details: { quota: { provider: 'sgo', requestCount: 3, creditsUsed: 2, limit: 100, remaining: 5 } } },
    { started_at: '2026-09-20T23:00:00Z', details: { quota: { provider: 'sgo', requestCount: 7, creditsUsed: 500, limit: 100, remaining: 70 } } },
    { started_at: '2026-09-20T22:00:00Z', details: { quota: { provider: 'sgo' } } },
    { started_at: '2026-09-21T01:00:00Z', details: { quota: { provider: 'odds-api', requestCount: 900 } } },
  ], 'sgo');
  assert.equal(result.requests, 10);
  assert.equal(result.recordedRuns, 2);
  assert.equal(result.uncountedRuns, 1);
  assert.equal(result.quotaPct, 95);
  assert.equal(result.quotaObservedAt, '2026-09-21T00:00:00Z');
});
test('quota limits are not invented from per-run credits and absent requests are not zero', () => {
  const result = summarizeProviderRequests([{ started_at: '2026-09-21T00:00:00Z', details: { quota: { provider: 'odds-api', creditsUsed: 88, remaining: 12 } } }], 'odds-api');
  assert.equal(result.quotaPct, null);
  assert.equal(result.requests, null);
  assert.equal(summarizeProviderRequests([], 'sgo').requests, null);
  assert.equal(cycleLatency({ latencyMs: { total: 0 } }), 0);
  assert.equal(cycleLatency({ latencyMs: { total: -1 } }), null);
});
