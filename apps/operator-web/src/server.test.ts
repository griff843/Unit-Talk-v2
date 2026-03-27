import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import type { SystemRunRecord } from '@unit-talk/db';
import {
  buildCapperStatsResponse,
  createOperatorServer,
  createSnapshotFromRows,
  createStatsRows,
  type OperatorStatsProvider,
  type OperatorSnapshotProvider,
  type OutboxFilter,
} from './server.js';

test('GET /health returns operator health payload', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/health');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    service: string;
    health: Array<{ component: string }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.service, 'operator-web');
  assert.equal(body.health[0]?.component, 'api');
});

test('GET /api/operator/snapshot returns recent operational rows', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/snapshot');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      counts: { sentOutbox: number };
      recentReceipts: Array<{ external_id: string | null }>;
      recentSettlements: Array<{
        id: string;
        pick_id: string;
        status: string;
        result: string | null;
        corrects_id: string | null;
      }>;
      canary: { target: string; latestMessageId: string | null };
      bestBets: { target: string; latestMessageId: string | null; activationHealthy: boolean };
      traderInsights: { target: string; latestMessageId: string | null; activationHealthy: boolean };
      picksPipeline: {
        counts: { posted: number; settled: number; total: number };
        recentPicks: Array<{ id: string; promotionTarget: string | null; settlementResult: string | null }>;
      };
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.counts.sentOutbox, 3);
  assert.equal(body.data.recentReceipts[0]?.external_id, 'discord-message-1');
  assert.equal(body.data.recentSettlements[0]?.id, 'settlement-1');
  assert.equal(body.data.recentSettlements[0]?.status, 'settled');
  assert.equal(body.data.recentSettlements[0]?.corrects_id, null);
  assert.equal(body.data.canary.target, 'discord:canary');
  assert.equal(body.data.canary.latestMessageId, 'discord-message-1');
  assert.equal(body.data.bestBets.target, 'discord:best-bets');
  assert.equal(body.data.bestBets.latestMessageId, 'discord-message-best-bets');
  assert.equal(body.data.bestBets.activationHealthy, true);
  assert.equal(body.data.traderInsights.target, 'discord:trader-insights');
  assert.equal(body.data.traderInsights.latestMessageId, 'discord-message-trader-insights');
  assert.equal(body.data.traderInsights.activationHealthy, true);
  assert.equal(body.data.picksPipeline.counts.posted, 2);
  assert.equal(body.data.picksPipeline.counts.settled, 1);
  assert.equal(body.data.picksPipeline.counts.total, 3);
  assert.equal(
    body.data.picksPipeline.recentPicks.some((row) => row.promotionTarget === 'best-bets'),
    true,
  );
  assert.equal(
    body.data.picksPipeline.recentPicks.some((row) => row.settlementResult === 'win'),
    true,
  );
});

test('createSnapshotFromRows uses effective corrected settlement result in picks pipeline', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'demo',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [
      {
        id: 'settlement-2',
        pick_id: 'pick-corrected',
        status: 'settled',
        result: 'win',
        source: 'operator',
        confidence: 'confirmed',
        evidence_ref: 'proof://corrected',
        notes: null,
        review_reason: null,
        settled_by: 'operator',
        settled_at: '2026-03-21T12:05:00.000Z',
        corrects_id: 'settlement-1',
        payload: {},
        created_at: '2026-03-21T12:05:00.000Z',
      },
      {
        id: 'settlement-1',
        pick_id: 'pick-corrected',
        status: 'settled',
        result: 'loss',
        source: 'operator',
        confidence: 'confirmed',
        evidence_ref: 'proof://initial',
        notes: null,
        review_reason: null,
        settled_by: 'operator',
        settled_at: '2026-03-21T12:00:00.000Z',
        corrects_id: null,
        payload: {},
        created_at: '2026-03-21T12:00:00.000Z',
      },
    ],
    recentRuns: [],
    recentPicks: [
      {
        id: 'pick-corrected',
        submission_id: 'submission-corrected',
        participant_id: null,
        market: 'NBA points',
        selection: 'Over 20.5',
        line: 20.5,
        odds: -110,
        stake_units: 1,
        confidence: 0.8,
        source: 'api',
        approval_status: 'approved',
        promotion_status: 'qualified',
        promotion_target: 'best-bets',
        promotion_score: 90,
        promotion_reason: 'proof candidate',
        promotion_version: 'v1',
        promotion_decided_at: '2026-03-21T11:50:00.000Z',
        promotion_decided_by: 'api',
        status: 'settled',
        posted_at: '2026-03-21T11:55:00.000Z',
        settled_at: '2026-03-21T12:05:00.000Z',
        metadata: {},
        created_at: '2026-03-21T11:45:00.000Z',
        updated_at: '2026-03-21T12:05:00.000Z',
      },
    ],
    recentAudit: [],
  });

  assert.equal(
    snapshot.picksPipeline.recentPicks[0]?.settlementResult,
    'win',
  );
});

test('GET / returns an html dashboard', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Unit Talk V2 Operator/);
  assert.match(response.body, /Recent Outbox/);
  assert.match(response.body, /Recent Settlements/);
  assert.match(response.body, /discord:canary/);
  assert.match(response.body, /Canary Readiness/);
  assert.match(response.body, /Best Bets Health/);
  assert.match(response.body, /discord:best-bets/);
  assert.match(response.body, /Trader Insights Health/);
  assert.match(response.body, /discord:trader-insights/);
  assert.match(response.body, /Picks Pipeline/);
  assert.match(response.body, /pick-2/);
});

test('GET / renders Trader Insights Health section', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Trader Insights Health/);
  assert.match(response.body, /discord:trader-insights/);
  assert.match(response.body, /discord-message-trader-insights/);
});

test('createSnapshotFromRows marks trader-insights healthy when sent rows exist with no failures', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-ti-sent',
        pick_id: 'pick-ti-1',
        target: 'discord:trader-insights',
        status: 'sent',
        attempt_count: 1,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: '2026-03-21T12:00:00.000Z',
        claimed_by: 'worker-trader-insights',
        idempotency_key: 'pick-ti-1:discord:trader-insights:distribution',
        created_at: '2026-03-21T12:00:00.000Z',
        updated_at: '2026-03-21T12:01:00.000Z',
      },
    ],
    recentReceipts: [
      {
        id: 'receipt-ti-1',
        outbox_id: 'outbox-ti-sent',
        external_id: 'discord-message-trader-insights-1',
        idempotency_key: 'receipt-key-ti-1',
        receipt_type: 'discord.message',
        status: 'sent',
        channel: 'discord:1356613995175481405',
        payload: {},
        recorded_at: '2026-03-21T12:01:01.000Z',
      },
    ],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.traderInsights.target, 'discord:trader-insights');
  assert.equal(snapshot.traderInsights.activationHealthy, true);
  assert.equal(snapshot.traderInsights.recentSentCount, 1);
  assert.equal(snapshot.traderInsights.latestMessageId, 'discord-message-trader-insights-1');
});

test('createSnapshotFromRows marks trader-insights unhealthy when failure rows exist', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-ti-fail',
        pick_id: 'pick-ti-2',
        target: 'discord:trader-insights',
        status: 'failed',
        attempt_count: 1,
        next_attempt_at: null,
        last_error: 'delivery failed',
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: 'pick-ti-2:discord:trader-insights:distribution',
        created_at: '2026-03-21T12:00:00.000Z',
        updated_at: '2026-03-21T12:00:30.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.traderInsights.activationHealthy, false);
  assert.equal(snapshot.traderInsights.recentFailureCount, 1);
  assert.equal(
    snapshot.traderInsights.blockers.some((blocker) =>
      /failed discord:trader-insights outbox/i.test(blocker),
    ),
    true,
  );
});

test('GET /api/operator/snapshot includes traderInsights health section', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/snapshot');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      traderInsights: { target: string; activationHealthy: boolean; recentSentCount: number };
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.traderInsights.target, 'discord:trader-insights');
  assert.equal(body.data.traderInsights.activationHealthy, true);
  assert.equal(body.data.traderInsights.recentSentCount, 1);
});

test('operator snapshot includes settlement status and corrects_id for manual review and correction records', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [
          {
            id: 'settlement-manual',
            pick_id: 'pick-3',
            status: 'manual_review',
            result: null,
            source: 'operator',
            confidence: 'pending',
            evidence_ref: 'proof://manual',
            notes: null,
            review_reason: 'ambiguous',
            settled_by: 'operator',
            settled_at: '2026-03-20T12:05:00.000Z',
            corrects_id: null,
            payload: {},
            created_at: '2026-03-20T12:05:00.000Z',
          },
          {
            id: 'settlement-correction',
            pick_id: 'pick-3',
            status: 'settled',
            result: 'win',
            source: 'operator',
            confidence: 'confirmed',
            evidence_ref: 'proof://correction',
            notes: 'correction',
            review_reason: null,
            settled_by: 'operator',
            settled_at: '2026-03-20T12:10:00.000Z',
            corrects_id: 'settlement-original',
            payload: {},
            created_at: '2026-03-20T12:10:00.000Z',
          },
        ],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/snapshot');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      recentSettlements: Array<{
        id: string;
        status: string;
        corrects_id: string | null;
      }>;
    };
  };

  assert.equal(body.ok, true);
  assert.deepEqual(
    body.data.recentSettlements.map((row) => ({
      id: row.id,
      status: row.status,
      corrects_id: row.corrects_id,
    })),
    [
      { id: 'settlement-manual', status: 'manual_review', corrects_id: null },
      { id: 'settlement-correction', status: 'settled', corrects_id: 'settlement-original' },
    ],
  );
});

test('operator snapshot returns both settlement records for a pick with manual review then settlement', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [
          {
            id: 'settlement-manual',
            pick_id: 'pick-4',
            status: 'manual_review',
            result: null,
            source: 'operator',
            confidence: 'pending',
            evidence_ref: 'proof://manual',
            notes: null,
            review_reason: 'needs review',
            settled_by: 'operator',
            settled_at: '2026-03-20T12:05:00.000Z',
            corrects_id: null,
            payload: {},
            created_at: '2026-03-20T12:05:00.000Z',
          },
          {
            id: 'settlement-final',
            pick_id: 'pick-4',
            status: 'settled',
            result: 'win',
            source: 'operator',
            confidence: 'confirmed',
            evidence_ref: 'proof://final',
            notes: null,
            review_reason: null,
            settled_by: 'operator',
            settled_at: '2026-03-20T12:08:00.000Z',
            corrects_id: null,
            payload: {},
            created_at: '2026-03-20T12:08:00.000Z',
          },
        ],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/snapshot');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      recentSettlements: Array<{ id: string; pick_id: string; status: string }>;
    };
  };

  assert.equal(body.ok, true);
  const pickRows = body.data.recentSettlements.filter((row) => row.pick_id === 'pick-4');
  assert.equal(pickRows.length, 2);
  assert.deepEqual(
    pickRows.map((row) => row.status),
    ['manual_review', 'settled'],
  );
});

test('GET / renders manual review and correction labels in recent settlements', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [
          {
            id: 'settlement-manual',
            pick_id: 'pick-5',
            status: 'manual_review',
            result: null,
            source: 'operator',
            confidence: 'pending',
            evidence_ref: 'proof://manual',
            notes: null,
            review_reason: 'ambiguous',
            settled_by: 'operator',
            settled_at: '2026-03-20T12:05:00.000Z',
            corrects_id: null,
            payload: {},
            created_at: '2026-03-20T12:05:00.000Z',
          },
          {
            id: 'settlement-correction',
            pick_id: 'pick-5',
            status: 'settled',
            result: 'win',
            source: 'operator',
            confidence: 'confirmed',
            evidence_ref: 'proof://correction',
            notes: null,
            review_reason: null,
            settled_by: 'operator',
            settled_at: '2026-03-20T12:10:00.000Z',
            corrects_id: 'settlement-original',
            payload: {},
            created_at: '2026-03-20T12:10:00.000Z',
          },
        ],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /\[MANUAL REVIEW\] manual_review/);
  assert.match(response.body, /\[CORRECTION\] settled/);
  assert.match(response.body, /settlement-original/);
});

test('createSnapshotFromRows marks worker degraded when most recent run is cancelled', () => {
  const run: SystemRunRecord = {
    id: 'run-1',
    run_type: 'distribution.process',
    status: 'cancelled',
    started_at: '2026-03-20T12:00:00.000Z',
    finished_at: null,
    actor: null,
    details: {},
    created_at: '2026-03-20T12:00:00.000Z',
    idempotency_key: null,
  };
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [run],
        recentPicks: [],
        recentAudit: [],
  });
  const workerSignal = snapshot.health.find((s) => s.component === 'worker');
  assert.equal(workerSignal?.status, 'degraded');
  assert.match(workerSignal?.detail ?? '', /cancelled/);
});

test('GET /api/operator/snapshot?outboxStatus filters recentOutbox by status', async () => {
  const allOutbox = [
    {
      id: 'outbox-fail',
      pick_id: 'pick-1',
      target: 'discord:canary',
      status: 'failed',
      attempt_count: 1,
      next_attempt_at: null,
      last_error: 'network timeout',
      payload: {},
      claimed_at: null,
      claimed_by: null,
      idempotency_key: null,
      created_at: '2026-03-20T12:00:00.000Z',
      updated_at: '2026-03-20T12:00:30.000Z',
    },
    {
      id: 'outbox-sent',
      pick_id: 'pick-2',
      target: 'discord:canary',
      status: 'sent',
      attempt_count: 1,
      next_attempt_at: null,
      last_error: null,
      payload: {},
      claimed_at: '2026-03-20T12:01:00.000Z',
      claimed_by: 'worker-canary',
      idempotency_key: 'pick-2:discord:canary:distribution',
      created_at: '2026-03-20T12:00:45.000Z',
      updated_at: '2026-03-20T12:01:10.000Z',
    },
  ];
  const provider: OperatorSnapshotProvider = {
    async getSnapshot(filter?: OutboxFilter) {
      const rows = filter?.status
        ? allOutbox.filter((r) => r.status === filter.status)
        : allOutbox;
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: rows,
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const [filteredResponse, unfilteredResponse] = await Promise.all([
    makeRequest(address.port, '/api/operator/snapshot?outboxStatus=failed'),
    makeRequest(address.port, '/api/operator/snapshot'),
  ]);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  const filtered = JSON.parse(filteredResponse.body) as {
    ok: boolean;
    data: { recentOutbox: Array<{ id: string; status: string }> };
  };
  assert.equal(filtered.ok, true);
  assert.equal(filtered.data.recentOutbox.length, 1);
  assert.equal(filtered.data.recentOutbox[0]?.id, 'outbox-fail');

  const unfiltered = JSON.parse(unfilteredResponse.body) as {
    ok: boolean;
    data: { recentOutbox: Array<{ id: string }> };
  };
  assert.equal(unfiltered.data.recentOutbox.length, 2);
});

test('GET / includes incident banner when health is degraded', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [
          {
            id: 'outbox-fail',
            pick_id: 'pick-1',
            target: 'discord:canary',
            status: 'failed',
            attempt_count: 1,
            next_attempt_at: null,
            last_error: 'delivery failed',
            payload: {},
            claimed_at: null,
            claimed_by: null,
            idempotency_key: null,
            created_at: '2026-03-20T12:00:00.000Z',
            updated_at: '2026-03-20T12:00:30.000Z',
          },
        ],
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /incident-banner/);
  assert.match(response.body, /Incident detected/);
  assert.match(response.body, /distribution/);
});

test('GET /api/operator/snapshot?since passes since filter to provider', async () => {
  let capturedFilter: OutboxFilter | undefined;

  const provider: OperatorSnapshotProvider = {
    async getSnapshot(filter?: OutboxFilter) {
      capturedFilter = filter;
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  await makeRequest(address.port, '/api/operator/snapshot?since=2026-03-20T00:00:00.000Z');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(capturedFilter?.since, '2026-03-20T00:00:00.000Z');
});

test('GET /api/operator/snapshot?lifecycleState passes lifecycle filter to provider', async () => {
  let capturedFilter: OutboxFilter | undefined;

  const provider: OperatorSnapshotProvider = {
    async getSnapshot(filter?: OutboxFilter) {
      capturedFilter = filter;
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  await makeRequest(address.port, '/api/operator/snapshot?lifecycleState=posted');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(capturedFilter?.lifecycleState, 'posted');
});

test('GET /api/operator/picks-pipeline returns standalone picks pipeline payload', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/picks-pipeline?lifecycleState=settled');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      observedAt: string;
      counts: { validated: number; queued: number; posted: number; settled: number; total: number };
      recentPicks: Array<{ id: string; status: string; promotionTarget: string | null }>;
    };
  };
  assert.equal(body.ok, true);
  assert.match(body.data.observedAt, /^20/);
  assert.equal(body.data.counts.total, 3);
  assert.equal(body.data.counts.settled, 1);
  assert.equal(body.data.recentPicks.length, 3);
  assert.equal(body.data.recentPicks.some((row) => row.status === 'settled'), true);
  assert.equal(body.data.recentPicks.some((row) => row.promotionTarget === 'best-bets'), true);
});

test('GET / includes incident triage section when failed outbox rows exist', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [
          {
            id: 'outbox-fail',
            pick_id: 'pick-1',
            target: 'discord:canary',
            status: 'failed',
            attempt_count: 2,
            next_attempt_at: null,
            last_error: 'timeout',
            payload: {},
            claimed_at: null,
            claimed_by: null,
            idempotency_key: null,
            created_at: '2026-03-20T12:00:00.000Z',
            updated_at: '2026-03-20T12:00:30.000Z',
          },
        ],
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /class="incident-triage"/);
  assert.match(response.body, /Incident Triage/);
  assert.match(response.body, /Failed \/ Dead-letter Outbox/);
  assert.match(response.body, /outbox-fail/);
});

test('GET / omits incident triage section when no failed rows exist', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [
          {
            id: 'outbox-sent',
            pick_id: 'pick-1',
            target: 'discord:canary',
            status: 'sent',
            attempt_count: 1,
            next_attempt_at: null,
            last_error: null,
            payload: {},
            claimed_at: '2026-03-20T12:00:00.000Z',
            claimed_by: 'worker-canary',
            idempotency_key: 'key-1',
            created_at: '2026-03-20T12:00:00.000Z',
            updated_at: '2026-03-20T12:01:00.000Z',
          },
        ],
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.body, /class="incident-triage"/);
  assert.doesNotMatch(response.body, /Incident Triage/);
});

test('createSnapshotFromRows marks canary not ready when fewer than 3 sent rows are visible', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-1',
        pick_id: 'pick-1',
        target: 'discord:canary',
        status: 'sent',
        attempt_count: 1,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: '2026-03-20T12:00:00.000Z',
        claimed_by: 'worker-canary',
        idempotency_key: 'key-1',
        created_at: '2026-03-20T12:00:00.000Z',
        updated_at: '2026-03-20T12:01:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.canary.graduationReady, false);
  assert.match(snapshot.canary.blockers[0] ?? '', /fewer than 3 recent sent canary deliveries/i);
});

test('createSnapshotFromRows marks canary ready when 3 sent rows are visible and no failures exist', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      createCanaryOutbox('outbox-1', 'sent', '2026-03-20T12:01:00.000Z'),
      createCanaryOutbox('outbox-2', 'sent', '2026-03-20T12:02:00.000Z'),
      createCanaryOutbox('outbox-3', 'sent', '2026-03-20T12:03:00.000Z'),
    ],
    recentReceipts: [
      {
        id: 'receipt-3',
        outbox_id: 'outbox-3',
        external_id: 'discord-message-3',
        idempotency_key: 'receipt-key-3',
        receipt_type: 'discord.message',
        status: 'sent',
        channel: 'discord:1296531122234327100',
        payload: {},
        recorded_at: '2026-03-20T12:03:01.000Z',
      },
    ],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.canary.graduationReady, true);
  assert.equal(snapshot.canary.recentSentCount, 3);
  assert.equal(snapshot.canary.latestMessageId, 'discord-message-3');
});

test('createSnapshotFromRows computes recap summary from settled records', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [
      {
        id: 'settlement-recap-1',
        pick_id: 'pick-recap-1',
        status: 'settled',
        result: 'win',
        source: 'operator',
        confidence: 'confirmed',
        evidence_ref: 'boxscore://recap-1',
        notes: null,
        review_reason: null,
        settled_by: 'operator',
        settled_at: '2026-03-22T10:00:00.000Z',
        corrects_id: null,
        payload: {},
        created_at: '2026-03-22T10:00:00.000Z',
      },
      {
        id: 'settlement-recap-2',
        pick_id: 'pick-recap-2',
        status: 'settled',
        result: 'loss',
        source: 'operator',
        confidence: 'confirmed',
        evidence_ref: 'boxscore://recap-2',
        notes: null,
        review_reason: null,
        settled_by: 'operator',
        settled_at: '2026-03-22T11:00:00.000Z',
        corrects_id: null,
        payload: {},
        created_at: '2026-03-22T11:00:00.000Z',
      },
    ],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.recap.total_picks, 2);
  assert.equal(snapshot.recap.by_result['win'], 1);
  assert.equal(snapshot.recap.by_result['loss'], 1);
  assert.equal(snapshot.recap.hit_rate_pct, 50);
  assert.equal(snapshot.recap.correction_count, 0);
});

test('GET /api/operator/recap returns settlement summary', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/recap');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      total_picks: number;
      hit_rate_pct: number;
      flat_bet_roi: { roi_pct: number; total_wagered: number; total_profit: number };
      by_result: Record<string, number>;
      correction_count: number;
      pending_review_count: number;
    };
  };
  assert.equal(body.ok, true);
  assert.equal(typeof body.data.total_picks, 'number');
  assert.equal(typeof body.data.hit_rate_pct, 'number');
  assert.ok('roi_pct' in body.data.flat_bet_roi);
  assert.ok('by_result' in body.data);
});

test('GET / renders Settlement Recap section', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Settlement Recap/);
  assert.match(response.body, /hit rate %/);
  assert.match(response.body, /flat-bet ROI %/);
});

test('GET /api/operator/stats returns capper stats payload', async () => {
  const provider = createStaticProvider();
  const statsProvider = createStaticStatsProvider();
  const server = createOperatorServer({ provider, statsProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(
    address.port,
    '/api/operator/stats?capper=Griff&last=30&sport=NBA',
  );
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      scope: string;
      capper: string | null;
      picks: number;
      wins: number;
      losses: number;
      pushes: number;
      picksWithClv: number;
      lastFive: string[];
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.scope, 'capper');
  assert.equal(body.data.capper, 'Griff');
  assert.equal(body.data.picks, 2);
  assert.equal(body.data.wins, 2);
  assert.equal(body.data.losses, 0);
  assert.equal(body.data.pushes, 0);
  assert.equal(body.data.picksWithClv, 2);
  assert.deepEqual(body.data.lastFive, ['W', 'W']);
});

test('GET /api/operator/stats returns 400 when last is invalid', async () => {
  const provider = createStaticProvider();
  const statsProvider = createStaticStatsProvider();
  const server = createOperatorServer({ provider, statsProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/stats?last=99');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /must be one of 7, 14, 30, 90/);
});

test('buildCapperStatsResponse returns zero stats when capper has no picks in window', () => {
  const rows = createStatsRows(makeStatsFixture());
  const stats = buildCapperStatsResponse(
    { capper: 'Nobody', window: 30 },
    rows.filter((row) => row.settlement.settled_at >= '2026-02-24T00:00:00.000Z'),
  );

  assert.equal(stats.picks, 0);
  assert.equal(stats.capper, 'Nobody');
  assert.equal(stats.winRate, null);
  assert.equal(stats.roiPct, null);
  assert.equal(stats.avgClvPct, null);
  assert.equal(stats.beatsLine, null);
});

test('buildCapperStatsResponse filters by sport correctly', () => {
  const rows = createStatsRows(makeStatsFixture());
  const stats = buildCapperStatsResponse(
    { capper: 'Griff', window: 30, sport: 'MLB' },
    rows.filter((row) => row.settlement.settled_at >= '2026-02-24T00:00:00.000Z'),
  );

  assert.equal(stats.picks, 1);
  assert.equal(stats.wins, 0);
  assert.equal(stats.losses, 1);
  assert.equal(stats.pushes, 0);
});

test('buildCapperStatsResponse omits CLV metrics when no picks carry CLV data', () => {
  const fixture = makeStatsFixture();
  fixture.settlements = fixture.settlements.map((row) => ({
    ...row,
    payload: {},
  }));

  const stats = buildCapperStatsResponse(
    { capper: 'Griff', window: 30 },
    createStatsRows(fixture).filter((row) => row.settlement.settled_at >= '2026-02-24T00:00:00.000Z'),
  );

  assert.equal(stats.picksWithClv, 0);
  assert.equal(stats.avgClvPct, null);
  assert.equal(stats.beatsLine, null);
});

test('buildCapperStatsResponse excludes picks outside the requested window', () => {
  const rows = createStatsRows(makeStatsFixture());
  const stats = buildCapperStatsResponse(
    { capper: 'Griff', window: 7 },
    rows.filter((row) => row.settlement.settled_at >= '2026-03-19T00:00:00.000Z'),
  );

  assert.equal(stats.picks, 2);
  assert.deepEqual(stats.lastFive, ['L', 'W']);
});

function createStaticProvider(): OperatorSnapshotProvider {
  return {
    async getSnapshot(_filter?: OutboxFilter) {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [
          {
            id: 'outbox-1',
            pick_id: 'pick-1',
            target: 'discord:canary',
            status: 'sent',
            attempt_count: 0,
            next_attempt_at: null,
            last_error: null,
            payload: { market: 'NBA points' },
            claimed_at: '2026-03-20T12:00:00.000Z',
            claimed_by: 'worker-canary',
            idempotency_key: 'pick-1:discord:canary:distribution',
            created_at: '2026-03-20T12:00:00.000Z',
            updated_at: '2026-03-20T12:01:00.000Z',
          },
          {
            id: 'outbox-2',
            pick_id: 'pick-2',
            target: 'discord:best-bets',
            status: 'sent',
            attempt_count: 0,
            next_attempt_at: null,
            last_error: null,
            payload: { market: 'NBA assists' },
            claimed_at: '2026-03-20T12:10:00.000Z',
            claimed_by: 'worker-best-bets',
            idempotency_key: 'pick-2:discord:best-bets:distribution',
            created_at: '2026-03-20T12:10:00.000Z',
            updated_at: '2026-03-20T12:11:00.000Z',
          },
          {
            id: 'outbox-3',
            pick_id: 'pick-3',
            target: 'discord:trader-insights',
            status: 'sent',
            attempt_count: 0,
            next_attempt_at: null,
            last_error: null,
            payload: { market: 'MLB hits' },
            claimed_at: '2026-03-21T13:00:00.000Z',
            claimed_by: 'worker-trader-insights',
            idempotency_key: 'pick-3:discord:trader-insights:distribution',
            created_at: '2026-03-21T13:00:00.000Z',
            updated_at: '2026-03-21T13:01:00.000Z',
          },
        ],
        recentReceipts: [
          {
            id: 'receipt-1',
            outbox_id: 'outbox-1',
            external_id: 'discord-message-1',
            idempotency_key: 'receipt-key-1',
            receipt_type: 'discord.message',
            status: 'sent',
            channel: 'discord:1296531122234327100',
            payload: { adapter: 'discord' },
            recorded_at: '2026-03-20T12:01:01.000Z',
          },
          {
            id: 'receipt-2',
            outbox_id: 'outbox-2',
            external_id: 'discord-message-best-bets',
            idempotency_key: 'receipt-key-2',
            receipt_type: 'discord.message',
            status: 'sent',
            channel: 'discord:1288613037539852329',
            payload: { adapter: 'discord' },
            recorded_at: '2026-03-20T12:11:01.000Z',
          },
          {
            id: 'receipt-3',
            outbox_id: 'outbox-3',
            external_id: 'discord-message-trader-insights',
            idempotency_key: 'receipt-key-3',
            receipt_type: 'discord.message',
            status: 'sent',
            channel: 'discord:1356613995175481405',
            payload: { adapter: 'discord' },
            recorded_at: '2026-03-21T13:01:01.000Z',
          },
        ],
        recentSettlements: [
          {
            id: 'settlement-1',
            pick_id: 'pick-1',
            status: 'settled',
            result: 'win',
            source: 'operator',
            confidence: 'confirmed',
            evidence_ref: 'boxscore://game-1',
            notes: null,
            review_reason: null,
            settled_by: 'operator',
            settled_at: '2026-03-20T12:05:00.000Z',
            corrects_id: null,
            payload: { evidence: 'boxscore' },
            created_at: '2026-03-20T12:05:00.000Z',
          },
        ],
        recentRuns: [
          {
            id: 'run-1',
            run_type: 'distribution.process',
            status: 'succeeded',
            started_at: '2026-03-20T12:00:30.000Z',
            finished_at: '2026-03-20T12:01:00.000Z',
            actor: 'worker-canary',
            details: { outboxId: 'outbox-1' },
            created_at: '2026-03-20T12:00:30.000Z',
            idempotency_key: 'run-key-1',
          },
        ],
        recentPicks: [
          {
            id: 'pick-1',
            submission_id: 'submission-1',
            participant_id: null,
            market: 'NBA points',
            selection: 'Over 24.5',
            line: 24.5,
            odds: -110,
            stake_units: 1,
            confidence: 0.74,
            source: 'smart-form',
            approval_status: 'approved',
            promotion_status: 'not_eligible',
            promotion_target: null,
            promotion_score: null,
            promotion_reason: null,
            promotion_version: null,
            promotion_decided_at: null,
            promotion_decided_by: null,
            status: 'posted',
            posted_at: '2026-03-20T12:01:00.000Z',
            settled_at: null,
            metadata: {},
            created_at: '2026-03-20T11:59:00.000Z',
            updated_at: '2026-03-20T12:01:00.000Z',
          },
          {
            id: 'pick-3',
            submission_id: 'submission-3',
            participant_id: null,
            market: 'MLB hits',
            selection: 'Over 1.5',
            line: 1.5,
            odds: -108,
            stake_units: 1,
            confidence: 0.88,
            source: 'api',
            approval_status: 'approved',
            promotion_status: 'qualified',
            promotion_target: 'trader-insights',
            promotion_score: 90.2,
            promotion_reason: 'Week 11 proof candidate',
            promotion_version: 'v1',
            promotion_decided_at: '2026-03-21T13:00:20.000Z',
            promotion_decided_by: 'api',
            status: 'posted',
            posted_at: '2026-03-21T13:01:00.000Z',
            settled_at: null,
            metadata: {},
            created_at: '2026-03-21T12:59:00.000Z',
            updated_at: '2026-03-21T13:01:00.000Z',
          },
          {
            id: 'pick-2',
            submission_id: 'submission-2',
            participant_id: null,
            market: 'NBA assists',
            selection: 'Over 8.5',
            line: 8.5,
            odds: -105,
            stake_units: 1,
            confidence: 0.91,
            source: 'api',
            approval_status: 'approved',
            promotion_status: 'qualified',
            promotion_target: 'best-bets',
            promotion_score: 92.2,
            promotion_reason: 'Week 7 proof candidate',
            promotion_version: 'v1',
            promotion_decided_at: '2026-03-20T12:10:20.000Z',
            promotion_decided_by: 'api',
            status: 'settled',
            posted_at: '2026-03-20T12:11:00.000Z',
            settled_at: '2026-03-20T12:20:00.000Z',
            metadata: {},
            created_at: '2026-03-20T12:09:00.000Z',
            updated_at: '2026-03-20T12:20:00.000Z',
          },
        ],
        recentAudit: [
          {
            id: 'audit-1',
            entity_type: 'distribution_outbox',
            entity_id: 'outbox-1',
            entity_ref: null,
            action: 'distribution.sent',
            actor: 'worker-canary',
            payload: { outboxId: 'outbox-1' },
            created_at: '2026-03-20T12:01:02.000Z',
          },
        ],
      });
    },
  };
}

function createStaticStatsProvider(): OperatorStatsProvider {
  return {
    async getStats() {
      return buildCapperStatsResponse(
        { capper: 'Griff', window: 30, sport: 'NBA' },
        createStatsRows(makeStatsFixture()).filter(
          (row) =>
            row.settlement.settled_at >= '2026-02-24T00:00:00.000Z' &&
            row.submission?.submitted_by?.toLowerCase() === 'griff' &&
            (row.pick.metadata as { sport?: string }).sport === 'NBA',
        ),
      );
    },
  };
}

function makeStatsFixture() {
  return {
    settlements: [
      {
        id: 'settlement-stats-1',
        pick_id: 'pick-stats-1',
        status: 'settled',
        result: 'win',
        source: 'grading',
        confidence: 'confirmed',
        evidence_ref: null,
        notes: null,
        review_reason: null,
        settled_by: 'grading',
        settled_at: '2026-03-21T12:00:00.000Z',
        corrects_id: null,
        payload: { clvRaw: '2.5', beatsClosingLine: true },
        created_at: '2026-03-21T12:00:00.000Z',
      },
      {
        id: 'settlement-stats-2',
        pick_id: 'pick-stats-2',
        status: 'settled',
        result: 'loss',
        source: 'grading',
        confidence: 'confirmed',
        evidence_ref: null,
        notes: null,
        review_reason: null,
        settled_by: 'grading',
        settled_at: '2026-03-20T12:00:00.000Z',
        corrects_id: null,
        payload: {},
        created_at: '2026-03-20T12:00:00.000Z',
      },
      {
        id: 'settlement-stats-3',
        pick_id: 'pick-stats-3',
        status: 'settled',
        result: 'win',
        source: 'grading',
        confidence: 'confirmed',
        evidence_ref: null,
        notes: null,
        review_reason: null,
        settled_by: 'grading',
        settled_at: '2026-03-12T12:00:00.000Z',
        corrects_id: null,
        payload: { clvRaw: 1.5, beatsClosingLine: false },
        created_at: '2026-03-12T12:00:00.000Z',
      },
      {
        id: 'settlement-stats-4',
        pick_id: 'pick-stats-4',
        status: 'settled',
        result: 'push',
        source: 'grading',
        confidence: 'confirmed',
        evidence_ref: null,
        notes: null,
        review_reason: null,
        settled_by: 'grading',
        settled_at: '2026-02-01T12:00:00.000Z',
        corrects_id: null,
        payload: {},
        created_at: '2026-02-01T12:00:00.000Z',
      },
    ],
    picks: [
      makeStatsPick('pick-stats-1', 'submission-stats-1', 'NBA'),
      makeStatsPick('pick-stats-2', 'submission-stats-2', 'MLB'),
      makeStatsPick('pick-stats-3', 'submission-stats-3', 'NBA'),
      makeStatsPick('pick-stats-4', 'submission-stats-4', 'NBA'),
    ],
    submissions: [
      makeStatsSubmission('submission-stats-1', 'Griff'),
      makeStatsSubmission('submission-stats-2', 'Griff'),
      makeStatsSubmission('submission-stats-3', 'Griff'),
      makeStatsSubmission('submission-stats-4', 'Other'),
    ],
  };
}

function makeStatsPick(id: string, submissionId: string, sport: string) {
  return {
    id,
    submission_id: submissionId,
    participant_id: null,
    market: 'points-all-game-ou',
    selection: 'Over 20.5',
    line: 20.5,
    odds: -110,
    stake_units: 1,
    confidence: 0.8,
    source: 'api',
    approval_status: 'approved',
    promotion_status: 'qualified',
    promotion_target: null,
    promotion_score: null,
    promotion_reason: null,
    promotion_version: null,
    promotion_decided_at: null,
    promotion_decided_by: null,
    status: 'settled',
    posted_at: '2026-03-20T11:00:00.000Z',
    settled_at: '2026-03-20T12:00:00.000Z',
    metadata: { sport },
    created_at: '2026-03-20T11:00:00.000Z',
    updated_at: '2026-03-20T12:00:00.000Z',
  };
}

function makeStatsSubmission(id: string, submittedBy: string) {
  return {
    id,
    external_id: null,
    source: 'discord-bot',
    submitted_by: submittedBy,
    payload: {},
    status: 'validated',
    received_at: '2026-03-20T11:00:00.000Z',
    created_at: '2026-03-20T11:00:00.000Z',
    updated_at: '2026-03-20T11:00:00.000Z',
  };
}

function createCanaryOutbox(id: string, status: 'sent' | 'failed' | 'dead_letter', updatedAt: string) {
  return {
    id,
    pick_id: `pick-${id}`,
    target: 'discord:canary',
    status,
    attempt_count: 1,
    next_attempt_at: null,
    last_error: status === 'sent' ? null : 'failure',
    payload: {},
    claimed_at: '2026-03-20T12:00:00.000Z',
    claimed_by: 'worker-canary',
    idempotency_key: `${id}:discord:canary:distribution`,
    created_at: '2026-03-20T12:00:00.000Z',
    updated_at: updatedAt,
  };
}

function makeRequest(port: number, path: string) {
  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}
