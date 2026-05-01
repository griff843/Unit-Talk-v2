import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOverviewDashboardModel } from './overview-model';
import type { DashboardData, DashboardRuntimeData } from './types';

const dashboardData: DashboardData = {
  observedAt: '2026-05-01T12:00:00.000Z',
  signals: [
    { signal: 'submission', status: 'WORKING', detail: '2 recent pick(s)' },
    { signal: 'scoring', status: 'DEGRADED', detail: 'Only 1/2 picks scored' },
    { signal: 'promotion', status: 'WORKING', detail: '1 qualified' },
    { signal: 'discord_delivery', status: 'BROKEN', detail: 'No receipts recorded' },
    { signal: 'settlement', status: 'WORKING', detail: 'No settled picks yet' },
    { signal: 'stats_propagation', status: 'WORKING', detail: 'Recap: 2 picks' },
  ],
  picks: [
    {
      id: 'pick-1',
      submittedAt: '2026-05-01T11:45:00.000Z',
      submitter: 'Alpha',
      source: 'smart-form',
      sport: 'NBA',
      pickDetails: { market: 'Spread', selection: 'Knicks -4.5', line: -4.5, odds: -110 },
      unitSize: 1,
      score: 88,
      lifecycleStatus: 'posted',
      promotionStatus: 'qualified',
      promotionReason: null,
      promotionTarget: 'discord:best-bets',
      deliveryStatus: 'delivered',
      receiptStatus: 'sent',
      receiptChannel: 'discord:best-bets',
      settlementStatus: 'pending',
      result: null,
      intelligence: {
        domainAnalysis: true,
        deviggingResult: true,
        kellySizing: true,
        realEdge: true,
        edgeSource: 'realEdge',
        clv: false,
      },
    },
    {
      id: 'pick-2',
      submittedAt: '2026-04-30T20:15:00.000Z',
      submitter: 'Beta',
      source: 'manual',
      sport: 'MLB',
      pickDetails: { market: 'Total', selection: 'Over 8.5', line: 8.5, odds: -105 },
      unitSize: 0.5,
      score: null,
      lifecycleStatus: 'validated',
      promotionStatus: 'pending',
      promotionReason: 'awaiting review',
      promotionTarget: null,
      deliveryStatus: 'queued',
      receiptStatus: null,
      receiptChannel: null,
      settlementStatus: 'pending',
      result: null,
      intelligence: {
        domainAnalysis: false,
        deviggingResult: false,
        kellySizing: false,
        realEdge: false,
        edgeSource: null,
        clv: false,
      },
    },
  ],
  stats: { total: 2, wins: 1, losses: 1, pushes: 0, roiPct: 4.2 },
  exceptions: [
    {
      id: 'exc-1',
      severity: 'critical',
      category: 'delivery',
      title: 'Dead-letter delivery',
      detail: 'Delivery exhausted retries',
      pickId: 'pick-2',
    },
  ],
};

const runtimeData: DashboardRuntimeData = {
  outbox: {
    pending: 1,
    processing: 0,
    sent: 1,
    failed: 1,
    deadLetter: 1,
    simulated: 0,
  },
  worker: {
    drainState: 'running',
    detail: 'Healthy',
    latestRunAt: '2026-05-01T11:59:20.000Z',
    latestReceiptAt: '2026-05-01T11:58:55.000Z',
  },
  aging: {
    staleValidated: 1,
    stalePosted: 0,
    staleProcessing: 0,
  },
  deliveryTargets: [
    {
      target: 'discord:canary',
      recentSentCount: 1,
      recentFailureCount: 0,
      latestSentAt: '2026-05-01T11:58:40.000Z',
      healthy: true,
    },
    {
      target: 'discord:best-bets',
      recentSentCount: 1,
      recentFailureCount: 1,
      latestSentAt: '2026-05-01T11:57:40.000Z',
      healthy: false,
    },
    {
      target: 'discord:trader-insights',
      recentSentCount: 0,
      recentFailureCount: 0,
      latestSentAt: null,
      healthy: false,
    },
  ],
  providerSummary: {
    active: 4,
    stale: 1,
    absent: 0,
    distinctEventsLast24h: 12,
    ingestorStatus: 'healthy',
    latestLiveSnapshotAt: '2026-05-01T11:57:00.000Z',
  },
  providerCycleSummary: {
    overallStatus: 'warning',
    trackedLanes: 5,
    mergedLanes: 3,
    blockedLanes: 1,
    failedLanes: 0,
    staleLanes: 1,
    proofRequiredLanes: 0,
    latestCycleSnapshotAt: '2026-05-01T11:56:00.000Z',
    latestUpdatedAt: '2026-05-01T11:58:00.000Z',
  },
};

test('buildOverviewDashboardModel derives stat cards and operator surfaces from dashboard data', () => {
  const model = buildOverviewDashboardModel(dashboardData, runtimeData);

  assert.equal(model.statCards.length, 4);
  assert.equal(model.statCards[0]?.label, "Today's Picks");
  assert.equal(model.statCards[1]?.secondaryValue, 6);
  assert.equal(model.pipelineStages.length, 5);
  assert.equal(model.pipelineStages[4]?.label, 'Publish');
  assert.equal(model.pipelineStages[4]?.status, 'critical');
  assert.equal(model.picksFeed.length, 2);
  assert.equal(model.picksFeed[0]?.badge, 'Prime');
  assert.equal(model.alerts[0]?.severity, 'critical');
});
