import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApiHealthCards, buildProviderRunSummaries } from './api-health';
import type { ProviderHealth } from '../types';

test('buildProviderRunSummaries aggregates response time, request counts, and hourly sparkline', () => {
  const observedAt = '2026-04-30T18:45:00.000Z';
  const summaries = buildProviderRunSummaries([
    {
      started_at: '2026-04-30T18:05:00.000Z',
      finished_at: '2026-04-30T18:05:01.500Z',
      details: {
        provider: 'sgo',
        quota: {
          provider: 'sgo',
          requestCount: 3,
          creditsUsed: 12,
          remaining: 88,
          limit: 100,
        },
      },
    },
    {
      started_at: '2026-04-30T18:25:00.000Z',
      finished_at: '2026-04-30T18:25:02.500Z',
      details: {
        provider: 'sgo',
        quota: {
          provider: 'sgo',
          requestCount: 2,
          creditsUsed: 5,
          remaining: 83,
          limit: 100,
        },
      },
    },
  ], observedAt);

  const sgo = summaries.get('sgo');
  assert.ok(sgo);
  assert.equal(sgo.lastCheckedAt, '2026-04-30T18:25:00.000Z');
  assert.equal(sgo.todayCallCount, 5);
  assert.equal(sgo.quotaUsed, 17);
  assert.equal(sgo.quotaRemaining, 83);
  assert.equal(sgo.quotaLimit, 100);
  assert.equal(sgo.avgResponseMs, 2000);
  const latestBucket = sgo.sparkline.find((point) => point.bucketIso.startsWith('2026-04-30T18:'));
  assert.ok(latestBucket);
  assert.equal(latestBucket.requestCount, 5);
  assert.equal(latestBucket.avgResponseMs, 2000);
});

test('buildApiHealthCards maps stale and absent providers into degraded and down card states', () => {
  const providerHealth: ProviderHealth = {
    providers: [
      {
        providerKey: 'odds-api',
        totalRows: 42,
        last24hRows: 10,
        latestSnapshotAt: '2026-04-30T17:00:00.000Z',
        minutesSinceLastSnapshot: 75,
        status: 'stale',
      },
      {
        providerKey: 'sgo',
        totalRows: 0,
        last24hRows: 0,
        latestSnapshotAt: null,
        minutesSinceLastSnapshot: null,
        status: 'absent',
      },
    ],
    ingestorHealth: {
      status: 'degraded',
      lastRunAt: '2026-04-30T17:00:00.000Z',
    },
    quotaSummary: {
      sgo: null,
      oddsApi: null,
    },
    distinctEventsLast24h: 11,
    latestProviderOfferSnapshotAt: '2026-04-30T17:00:00.000Z',
  };

  const runSummaries = buildProviderRunSummaries([
    {
      started_at: '2026-04-30T17:05:00.000Z',
      finished_at: '2026-04-30T17:05:01.000Z',
      details: {
        provider: 'odds-api',
        quota: {
          provider: 'odds-api',
          requestCount: 6,
          creditsUsed: 30,
          remaining: 70,
        },
      },
    },
  ], '2026-04-30T18:45:00.000Z');

  const cards = buildApiHealthCards(providerHealth, runSummaries);
  assert.equal(cards[0]?.providerKey, 'odds-api');
  assert.equal(cards[0]?.status, 'degraded');
  assert.equal(cards[0]?.quotaPct, 30);
  assert.equal(cards[1]?.providerKey, 'sgo');
  assert.equal(cards[1]?.status, 'down');
});
