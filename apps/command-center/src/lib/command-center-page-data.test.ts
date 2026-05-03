import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildApiHealthPageData,
  buildEventFeedData,
  buildPipelinePageData,
} from './command-center-page-data.js';

test('buildPipelinePageData derives stage rows and queue cards from snapshot truth', () => {
  const model = buildPipelinePageData({
    data: {
      observedAt: '2026-04-30T12:00:00.000Z',
      counts: {
        pendingOutbox: 3,
        processingOutbox: 1,
        failedOutbox: 0,
        deadLetterOutbox: 0,
      },
      workerRuntime: {
        drainState: 'draining',
      },
      aging: {
        staleValidated: 0,
        stalePosted: 1,
      },
      picksPipeline: {
        counts: {
          validated: 2,
          queued: 4,
          posted: 1,
          settled: 6,
        },
        recentPicks: [
          { status: 'queued', createdAt: new Date(Date.now() - 45 * 60_000).toISOString(), promotionStatus: 'qualified' },
          { status: 'validated', createdAt: new Date(Date.now() - 30 * 60_000).toISOString(), promotionStatus: 'qualified' },
          { status: 'posted', createdAt: new Date(Date.now() - 120 * 60_000).toISOString(), promotionStatus: 'qualified' },
          { status: 'settled', createdAt: new Date(Date.now() - 240 * 60_000).toISOString(), promotionStatus: 'not_eligible' },
        ],
      },
    },
  });

  assert.equal(model.stages[0]?.count, 2);
  assert.equal(model.stages[2]?.status, 'error');
  assert.equal(model.backlog.value, 4);
  assert.equal(model.promotionQueue.value, 2);
});

test('buildEventFeedData combines multiple runtime truth sources into a feed', () => {
  const events = buildEventFeedData({
    data: {
      recentRuns: [
        { id: 'run-1', run_type: 'ingestor.cycle', status: 'succeeded', started_at: '2026-04-30T12:00:00.000Z' },
      ],
      recentAudit: [
        { id: 'audit-1', action: 'distribution.enqueued', entity_type: 'distribution_outbox', entity_ref: 'pick-1', created_at: '2026-04-30T11:59:00.000Z' },
      ],
      health: [
        { component: 'worker', status: 'degraded', detail: 'stalled queue' },
      ],
      incidents: [
        { type: 'delivery-stall', severity: 'critical', affectedCount: 2, summary: 'Delivery stalled' },
      ],
    },
  });

  assert.equal(events.length, 4);
  assert.equal(events.some((event) => event.type === 'incident' && event.tone === 'error'), true);
  assert.equal(events.some((event) => event.type === 'health' && event.tone === 'warning'), true);
});

test('buildApiHealthPageData merges provider variants, quota truth, and latency samples', () => {
  const model = buildApiHealthPageData(
    {
      data: {
        providers: [
          {
            providerKey: 'odds-api:pinnacle',
            totalRows: 120,
            last24hRows: 14,
            latestSnapshotAt: '2026-04-30T12:10:00.000Z',
            status: 'active',
          },
          {
            providerKey: 'sgo',
            totalRows: 40,
            last24hRows: 8,
            latestSnapshotAt: '2026-04-30T12:05:00.000Z',
            status: 'stale',
          },
        ],
      },
    },
    {
      data: {
        quotaSummary: {
          providers: [
            {
              provider: 'odds-api',
              requestCount: 22,
              runCount: 5,
              creditsUsed: 88,
              remaining: 12,
              lastSeenAt: '2026-04-30T12:12:00.000Z',
            },
          ],
        },
      },
    },
    [
      { providerKey: 'odds-api:pinnacle', updatedAt: '2026-04-30T12:00:00.000Z', totalLatencyMs: 210 },
      { providerKey: 'odds-api:fanduel', updatedAt: '2026-04-30T12:05:00.000Z', totalLatencyMs: 190 },
    ],
  );

  assert.equal(model[0]?.provider, 'Odds API');
  assert.equal(model[0]?.responseMs, 200);
  assert.equal(model[0]?.quotaPct, 88);
  assert.equal(model[1]?.status, 'degraded');
});
