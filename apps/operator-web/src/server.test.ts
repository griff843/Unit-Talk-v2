import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SystemRunRecord } from '@unit-talk/db';
import {
  buildCapperRecapResponse,
  buildLeaderboardResponse,
  buildCapperStatsResponse,
  createOperatorSnapshotProvider,
  createOperatorServer,
  createSnapshotFromRows,
  createStatsRows,
  readOperatorSimulationMode,
  resolveOperatorWorkspaceRoot,
  type OperatorCapperRecapProvider,
  type OperatorLeaderboardProvider,
  type OperatorStatsProvider,
  type OperatorSnapshotProvider,
  type OutboxFilter,
} from './server.js';

test('resolveOperatorWorkspaceRoot targets repo root from operator server module path', () => {
  const root = resolveOperatorWorkspaceRoot();
  // test lives at apps/operator-web/src/server.test.ts — repo root is 3 levels up
  const expected = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  assert.equal(root, expected);
});

test('createOperatorSnapshotProvider fails closed when database config is unavailable', () => {
  assert.throws(
    () =>
      createOperatorSnapshotProvider({
        environment: {
          NODE_ENV: 'test',
          UNIT_TALK_APP_ENV: 'ci',
          UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\dev\\unit-talk-v2',
          UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
          LINEAR_TEAM_KEY: 'UNIT',
          LINEAR_TEAM_NAME: 'Unit Talk',
          NOTION_WORKSPACE_NAME: 'Unit Talk',
          SLACK_WORKSPACE_NAME: 'Unit Talk',
          UNIT_TALK_OPERATOR_RUNTIME_MODE: 'fail_closed',
        },
      }),
    /fail_closed/i,
  );
});

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
      entityHealth: {
        resolvedEventsCount: number;
        upcomingEventsCount: number;
        resolvedPlayersCount: number;
        resolvedTeamsWithExternalIdCount: number;
        totalTeamsCount: number;
      };
      upcomingEvents: Array<{
        id: string;
        eventName: string;
        teams: string[];
        playerCount: number;
      }>;
      canary: { target: string; latestMessageId: string | null };
      bestBets: { target: string; latestMessageId: string | null; activationHealthy: boolean };
      traderInsights: { target: string; latestMessageId: string | null; activationHealthy: boolean };
      workerRuntime: {
        drainState: string;
        latestDistributionRunStatus: string | null;
        latestSuccessfulDistributionRunAt: string | null;
      };
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
  assert.equal(body.data.entityHealth.resolvedEventsCount, 10);
  assert.equal(body.data.entityHealth.upcomingEventsCount, 3);
  assert.equal(body.data.entityHealth.resolvedPlayersCount, 84);
  assert.equal(body.data.entityHealth.resolvedTeamsWithExternalIdCount, 8);
  assert.equal(body.data.entityHealth.totalTeamsCount, 124);
  assert.equal(body.data.upcomingEvents[0]?.id, 'event-1');
  assert.equal(body.data.upcomingEvents[0]?.teams[0], 'New York Knicks');
  assert.equal(body.data.upcomingEvents[0]?.playerCount, 18);
  assert.equal(body.data.canary.target, 'discord:canary');
  assert.equal(body.data.canary.latestMessageId, 'discord-message-1');
  assert.equal(body.data.bestBets.target, 'discord:best-bets');
  assert.equal(body.data.bestBets.latestMessageId, 'discord-message-best-bets');
  assert.equal(body.data.bestBets.activationHealthy, true);
  assert.equal(body.data.traderInsights.target, 'discord:trader-insights');
  assert.equal(body.data.traderInsights.latestMessageId, 'discord-message-trader-insights');
  assert.equal(body.data.traderInsights.activationHealthy, true);
  assert.equal(body.data.workerRuntime.drainState, 'idle');
  assert.equal(body.data.workerRuntime.latestDistributionRunStatus, 'succeeded');
  assert.equal(
    body.data.workerRuntime.latestSuccessfulDistributionRunAt,
    '2026-03-20T12:00:30.000Z',
  );
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

test('GET /api/operator/participants returns participant list', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/participants');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    participants: Array<{ displayName: string; participantType: string }>;
    total: number;
    observedAt: string;
  };
  assert.equal(body.total, 4);
  assert.equal(body.participants.length, 4);
  assert.equal(body.participants[0]?.displayName, 'Boston Celtics');
  assert.equal(body.participants.some((row) => row.participantType === 'player'), true);
  assert.match(body.observedAt, /^20/);
});

test('GET /api/operator/participants filters to player participants', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/participants?type=player');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    participants: Array<{ displayName: string; participantType: string }>;
    total: number;
  };
  assert.equal(body.total, 2);
  assert.deepEqual(
    body.participants.map((row) => row.participantType),
    ['player', 'player'],
  );
  assert.equal(body.participants.some((row) => row.displayName === 'Jalen Brunson'), true);
});

test('GET /api/operator/participants filters case-insensitively by q', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/participants?q=BRUNSON');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    participants: Array<{ displayName: string }>;
    total: number;
  };
  assert.equal(body.total, 1);
  assert.deepEqual(body.participants.map((row) => row.displayName), ['Jalen Brunson']);
});

test('GET /api/operator/participants returns empty results when provider has no participant search', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'demo',
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

  const response = await makeRequest(address.port, '/api/operator/participants?type=team&q=knicks');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    participants: unknown[];
    total: number;
    observedAt: string;
  };
  assert.deepEqual(body.participants, []);
  assert.equal(body.total, 0);
  assert.match(body.observedAt, /^20/);
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
        capper_id: null,
        market_type_id: null,
        sport_id: null,
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
        idempotency_key: null,
        metadata: {},
        created_at: '2026-03-21T11:45:00.000Z',
        player_id: null,
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

test('GET / renders Upcoming Events section with seeded event rows', async () => {
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
  assert.match(response.body, /Upcoming Events/);
  assert.match(response.body, /Knicks vs\. Celtics/);
  assert.match(response.body, /New York Knicks, Boston Celtics/);
  assert.match(response.body, /18/);
});

test('GET / renders Entity Catalog health card with resolved counts', async () => {
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
  assert.match(response.body, /Entity Catalog/);
  assert.match(response.body, /Events resolved/);
  assert.match(response.body, /10 \(3 upcoming\)/);
  assert.match(response.body, /Players resolved/);
  assert.match(response.body, /84/);
  assert.match(response.body, /Teams with SGO ID/);
  assert.match(response.body, /8 \/ 124/);
});

test('GET / renders Last Ingest Cycle section from the latest ingestor run', async () => {
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
  assert.match(response.body, /Last Ingest Cycle/);
  assert.match(response.body, /succeeded/);
  assert.match(response.body, /NBA/);
  assert.match(response.body, /2026-03-21T14:00:00.000Z/);
  assert.match(response.body, /150\.0s/);
});

test('createSnapshotFromRows defaults entity health counts to zero in demo mode', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'demo',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.deepEqual(snapshot.entityHealth, {
    resolvedEventsCount: 0,
    upcomingEventsCount: 0,
    resolvedPlayersCount: 0,
    resolvedTeamsWithExternalIdCount: 0,
    totalTeamsCount: 0,
    observedAt: snapshot.entityHealth?.observedAt,
  });
  assert.deepEqual(snapshot.upcomingEvents, []);
});

test('createSnapshotFromRows counts dead-letter outbox rows and degrades distribution health', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-dead-letter',
        pick_id: 'pick-dead-letter',
        target: 'discord:canary',
        status: 'dead_letter',
        attempt_count: 3,
        next_attempt_at: null,
        last_error: 'delivery permanently failed',
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: 'pick-dead-letter:discord:canary:distribution',
        created_at: '2026-03-22T12:00:00.000Z',
        updated_at: '2026-03-22T12:05:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.counts.deadLetterOutbox, 1);
  assert.equal(snapshot.health.find((signal) => signal.component === 'distribution')?.status, 'degraded');
  assert.match(
    snapshot.health.find((signal) => signal.component === 'distribution')?.detail ?? '',
    /dead-letter outbox/i,
  );
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

test('GET / renders dead-letter outbox count in the operator dashboard', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [
          {
            id: 'outbox-dead-letter',
            pick_id: 'pick-dead-letter',
            target: 'discord:canary',
            status: 'dead_letter',
            attempt_count: 3,
            next_attempt_at: null,
            last_error: 'delivery permanently failed',
            payload: {},
            claimed_at: null,
            claimed_by: null,
            idempotency_key: 'pick-dead-letter:discord:canary:distribution',
            created_at: '2026-03-22T12:00:00.000Z',
            updated_at: '2026-03-22T12:05:00.000Z',
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
  assert.match(response.body, /dead-letter outbox/i);
  assert.match(response.body, /<h2>dead-letter outbox<\/h2>[\s\S]*?<p class="stat-value">1<\/p>/i);
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

test('GET / renders CLV% and Beats Line columns in settlements table when payload has CLV data', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [
          {
            id: 'settlement-clv',
            pick_id: 'pick-clv',
            status: 'settled',
            result: 'win',
            source: 'grading',
            confidence: 'confirmed',
            evidence_ref: null,
            notes: null,
            review_reason: null,
            settled_by: 'grading',
            settled_at: '2026-03-27T10:00:00.000Z',
            corrects_id: null,
            payload: { clvPercent: 3.2, beatsClosingLine: true },
            created_at: '2026-03-27T10:00:00.000Z',
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
  const { port } = server.address() as import('node:net').AddressInfo;

  const response = await makeRequest(port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  // CLV% column: 3.2 → "3.2%"
  assert.match(response.body, /3\.2%/);
  // Beats Line column: true → "✓"
  assert.match(response.body, /✓/);
});

test('GET / renders Beats Line as ✗ and CLV% when beatsClosingLine is false', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [
          {
            id: 'settlement-clv-loss',
            pick_id: 'pick-clv-loss',
            status: 'settled',
            result: 'loss',
            source: 'grading',
            confidence: 'confirmed',
            evidence_ref: null,
            notes: null,
            review_reason: null,
            settled_by: 'grading',
            settled_at: '2026-03-27T10:00:00.000Z',
            corrects_id: null,
            payload: { clvPercent: -1.5, beatsClosingLine: false },
            created_at: '2026-03-27T10:00:00.000Z',
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
  const { port } = server.address() as import('node:net').AddressInfo;

  const response = await makeRequest(port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /-1\.5%/);
  assert.match(response.body, /✗/);
});

test('GET / renders — for CLV% and Beats Line when payload has no CLV data', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [
          {
            id: 'settlement-no-clv',
            pick_id: 'pick-no-clv',
            status: 'settled',
            result: 'win',
            source: 'operator',
            confidence: 'confirmed',
            evidence_ref: null,
            notes: null,
            review_reason: null,
            settled_by: 'operator',
            settled_at: '2026-03-27T10:00:00.000Z',
            corrects_id: null,
            payload: { evidence: 'manual' },
            created_at: '2026-03-27T10:00:00.000Z',
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
  const { port } = server.address() as import('node:net').AddressInfo;

  const response = await makeRequest(port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  // Both CLV columns should render the fallback dash character
  const dashCount = (response.body.match(/—/g) ?? []).length;
  assert.ok(dashCount >= 2, `expected at least 2 — chars for absent CLV, got ${dashCount}`);
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

test('createSnapshotFromRows summarizes worker runtime as stalled when pending outbox is queued without an active run', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-pending-1',
        pick_id: 'pick-pending-1',
        target: 'discord:best-bets',
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:00:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.workerRuntime.drainState, 'stalled');
  assert.match(snapshot.workerRuntime.detail, /pending outbox item\(s\) are queued without an active worker run/i);
  assert.equal(snapshot.workerRuntime.latestDistributionRunStatus, null);
});

test('createSnapshotFromRows summarizes worker runtime as draining when a distribution run is active', () => {
  const runningDistributionRun: SystemRunRecord = {
    id: 'run-distribution-running-1',
    run_type: 'distribution.process',
    status: 'running',
    started_at: '2026-03-27T10:05:00.000Z',
    finished_at: null,
    actor: 'worker-canary',
    details: {},
    created_at: '2026-03-27T10:05:00.000Z',
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-pending-2',
        pick_id: 'pick-pending-2',
        target: 'discord:canary',
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-27T10:04:00.000Z',
        updated_at: '2026-03-27T10:04:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [runningDistributionRun],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.workerRuntime.drainState, 'draining');
  assert.match(snapshot.workerRuntime.detail, /worker is running/i);
  assert.equal(snapshot.workerRuntime.latestDistributionRunStatus, 'running');
  assert.equal(snapshot.workerRuntime.latestDistributionRunAt, '2026-03-27T10:05:00.000Z');
});

test('createSnapshotFromRows includes ingestorHealth with status and lastRunAt when ingestor run exists', () => {
  const ingestorRun: SystemRunRecord = {
    id: 'run-ingestor-unit-1',
    run_type: 'ingestor.cycle',
    status: 'succeeded',
    started_at: '2026-03-27T10:00:00.000Z',
    finished_at: '2026-03-27T10:01:00.000Z',
    actor: 'ingestor',
    details: {
      league: 'NBA',
      quota: {
        provider: 'sgo',
        requestCount: 2,
        successfulRequests: 2,
        creditsUsed: 0,
        limit: 100,
        remaining: 98,
        resetAt: '2026-03-27T11:00:00.000Z',
        lastStatus: 200,
        rateLimitHitCount: 0,
        backoffCount: 0,
        backoffMs: 0,
        throttled: false,
        headersSeen: true,
      },
    },
    created_at: '2026-03-27T10:00:00.000Z',
    idempotency_key: null,
  };
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [ingestorRun],
    recentPicks: [],
    recentAudit: [],
  });
  assert.equal(snapshot.ingestorHealth.status, 'succeeded');
  assert.equal(snapshot.ingestorHealth.lastRunAt, '2026-03-27T10:00:00.000Z');
  assert.equal(snapshot.ingestorHealth.runCount, 1);
  assert.equal(snapshot.quotaSummary.providers[0]?.provider, 'sgo');
  assert.equal(snapshot.quotaSummary.providers[0]?.requestCount, 2);
  assert.equal(snapshot.quotaSummary.providers[0]?.remaining, 98);
});

test('createSnapshotFromRows returns ingestorHealth status=unknown and lastRunAt=null when no ingestor runs', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });
  assert.equal(snapshot.ingestorHealth.status, 'unknown');
  assert.equal(snapshot.ingestorHealth.lastRunAt, null);
  assert.equal(snapshot.ingestorHealth.runCount, 0);
  assert.deepEqual(snapshot.quotaSummary.providers, []);
});

test('createSnapshotFromRows aggregates quota telemetry across recent ingestor runs', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [
      {
        id: 'run-ingestor-quota-1',
        run_type: 'ingestor.cycle',
        status: 'succeeded',
        started_at: '2026-03-27T10:00:00.000Z',
        finished_at: '2026-03-27T10:01:00.000Z',
        actor: 'ingestor',
        details: {
          league: 'NBA',
          quota: {
            provider: 'sgo',
            requestCount: 3,
            successfulRequests: 2,
            creditsUsed: 0,
            limit: 100,
            remaining: 97,
            resetAt: '2026-03-27T11:00:00.000Z',
            lastStatus: 200,
            rateLimitHitCount: 1,
            backoffCount: 1,
            backoffMs: 2000,
            throttled: true,
            headersSeen: true,
          },
        },
        created_at: '2026-03-27T10:00:00.000Z',
        idempotency_key: null,
      },
      {
        id: 'run-ingestor-quota-2',
        run_type: 'ingestor.cycle',
        status: 'succeeded',
        started_at: '2026-03-27T11:00:00.000Z',
        finished_at: '2026-03-27T11:01:00.000Z',
        actor: 'ingestor',
        details: {
          league: 'MLB',
          quota: {
            provider: 'sgo',
            requestCount: 2,
            successfulRequests: 2,
            creditsUsed: 0,
            limit: 100,
            remaining: 95,
            resetAt: '2026-03-27T12:00:00.000Z',
            lastStatus: 200,
            rateLimitHitCount: 0,
            backoffCount: 0,
            backoffMs: 0,
            throttled: false,
            headersSeen: true,
          },
        },
        created_at: '2026-03-27T11:00:00.000Z',
        idempotency_key: null,
      },
    ],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.quotaSummary.providers[0]?.provider, 'sgo');
  assert.equal(snapshot.quotaSummary.providers[0]?.runCount, 2);
  assert.equal(snapshot.quotaSummary.providers[0]?.requestCount, 5);
  assert.equal(snapshot.quotaSummary.providers[0]?.successfulRequests, 4);
  assert.equal(snapshot.quotaSummary.providers[0]?.rateLimitHitCount, 1);
  assert.equal(snapshot.quotaSummary.providers[0]?.backoffMs, 2000);
  assert.equal(snapshot.quotaSummary.providers[0]?.remaining, 95);
});

test('GET / renders Ingestor health card with status and last run when ingestor run exists', async () => {
  const ingestorRun: SystemRunRecord = {
    id: 'run-ingestor-card-1',
    run_type: 'ingestor.cycle',
    status: 'succeeded',
    started_at: '2026-03-27T10:00:00.000Z',
    finished_at: '2026-03-27T10:01:00.000Z',
    actor: 'ingestor',
    details: {
      league: 'NBA',
      quota: {
        provider: 'sgo',
        requestCount: 2,
        successfulRequests: 2,
        creditsUsed: 0,
        limit: 100,
        remaining: 98,
        resetAt: '2026-03-27T11:00:00.000Z',
        lastStatus: 200,
        rateLimitHitCount: 0,
        backoffCount: 0,
        backoffMs: 0,
        throttled: false,
        headersSeen: true,
      },
    },
    created_at: '2026-03-27T10:00:00.000Z',
    idempotency_key: null,
  };
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [],
        recentSettlements: [],
        recentRuns: [ingestorRun],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as import('node:net').AddressInfo;

  const response = await makeRequest(port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Ingestor/);
  assert.match(response.body, /succeeded/);
  assert.match(response.body, /2026-03-27T10:00:00\.000Z/);
  assert.match(response.body, /Run count/);
  assert.match(response.body, /API Quota/);
  assert.match(response.body, /sgo/);
  assert.match(response.body, /98/);
});

test('GET / renders Worker Runtime card with drain state and timestamps', async () => {
  const distributionRun: SystemRunRecord = {
    id: 'run-distribution-card-1',
    run_type: 'distribution.process',
    status: 'succeeded',
    started_at: '2026-03-27T10:05:00.000Z',
    finished_at: '2026-03-27T10:05:30.000Z',
    actor: 'worker-best-bets',
    details: {},
    created_at: '2026-03-27T10:05:00.000Z',
    idempotency_key: null,
  };
  const provider: OperatorSnapshotProvider = {
    async getSnapshot() {
      return createSnapshotFromRows({
        persistenceMode: 'database',
        recentOutbox: [],
        recentReceipts: [
          {
            id: 'receipt-worker-card-1',
            outbox_id: 'outbox-worker-card-1',
            external_id: 'discord-message-worker-card-1',
            idempotency_key: 'receipt-worker-card-1',
            receipt_type: 'discord.message',
            status: 'sent',
            channel: 'discord:1288613037539852329',
            payload: {},
            recorded_at: '2026-03-27T10:05:31.000Z',
          },
        ],
        recentSettlements: [],
        recentRuns: [distributionRun],
        recentPicks: [],
        recentAudit: [],
      });
    },
  };

  const server = createOperatorServer({ provider });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as import('node:net').AddressInfo;

  const response = await makeRequest(port, '/');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Worker Runtime/);
  assert.match(response.body, /Status: <strong>idle<\/strong>/);
  assert.match(response.body, /Last distribution run: 2026-03-27T10:05:00\.000Z/);
  assert.match(response.body, /Last receipt: 2026-03-27T10:05:31\.000Z/);
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

test('GET /api/operator/capper-recap returns the latest settled picks for the requested capper', async () => {
  const provider = createStaticProvider();
  const capperRecapProvider = createStaticCapperRecapProvider();
  const server = createOperatorServer({ provider, capperRecapProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(
    address.port,
    '/api/operator/capper-recap?submittedBy=Griff&limit=2',
  );
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      submittedBy: string;
      picks: Array<{
        market: string;
        selection: string;
        result: string;
        profitLossUnits: number;
      }>;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.submittedBy, 'Griff');
  assert.equal(body.data.picks.length, 2);
  assert.equal(body.data.picks[0]?.result, 'win');
  assert.equal(body.data.picks[0]?.profitLossUnits, 1);
  assert.equal(body.data.picks[1]?.result, 'loss');
  assert.equal(body.data.picks[1]?.profitLossUnits, -1);
});

test('GET /api/operator/capper-recap includes CLV% and stake units in the recap payload', async () => {
  const provider = createStaticProvider();
  const capperRecapProvider = createStaticCapperRecapProvider();
  const server = createOperatorServer({ provider, capperRecapProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(
    address.port,
    '/api/operator/capper-recap?submittedBy=Griff&limit=1',
  );
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    data: {
      picks: Array<{
        clvPercent: number | null;
        stakeUnits: number | null;
      }>;
    };
  };

  assert.equal(body.data.picks[0]?.clvPercent, 3.2);
  assert.equal(body.data.picks[0]?.stakeUnits, 1);
});

test('GET /api/operator/capper-recap returns 400 when submittedBy is missing', async () => {
  const provider = createStaticProvider();
  const capperRecapProvider = createStaticCapperRecapProvider();
  const server = createOperatorServer({ provider, capperRecapProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/capper-recap?limit=2');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /submittedBy/);
});

test('GET /api/operator/leaderboard returns ranked entries with streaks', async () => {
  const provider = createStaticProvider();
  const leaderboardProvider = createStaticLeaderboardProvider();
  const server = createOperatorServer({ provider, leaderboardProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/leaderboard?last=30');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      window: number;
      minPicks: number;
      entries: Array<{
        rank: number;
        capper: string;
        wins: number;
        losses: number;
        pushes: number;
        streak: number;
      }>;
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.window, 30);
  assert.equal(body.data.minPicks, 3);
  assert.deepEqual(
    body.data.entries.map((entry) => ({
      rank: entry.rank,
      capper: entry.capper,
      wins: entry.wins,
      losses: entry.losses,
      pushes: entry.pushes,
      streak: entry.streak,
    })),
    [
      { rank: 1, capper: 'Casey', wins: 2, losses: 0, pushes: 1, streak: 1 },
      { rank: 2, capper: 'Vintage', wins: 3, losses: 0, pushes: 0, streak: 3 },
      { rank: 3, capper: 'Ace', wins: 2, losses: 1, pushes: 0, streak: 2 },
      { rank: 4, capper: 'Blake', wins: 1, losses: 2, pushes: 0, streak: -2 },
    ],
  );
});

test('GET /api/operator/leaderboard returns empty entries when all cappers fall below minPicks', async () => {
  const provider = createStaticProvider();
  const leaderboardProvider = createStaticLeaderboardProvider();
  const server = createOperatorServer({ provider, leaderboardProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(
    address.port,
    '/api/operator/leaderboard?last=30&minPicks=4&sport=MLB',
  );
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: { entries: unknown[] };
  };
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.entries, []);
});

test('GET /api/operator/leaderboard returns 400 when last is invalid', async () => {
  const provider = createStaticProvider();
  const leaderboardProvider = createStaticLeaderboardProvider();
  const server = createOperatorServer({ provider, leaderboardProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/leaderboard?last=99');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /must be one of 7, 14, 30, 90/);
});

test('GET /api/operator/leaderboard filters entries by sport', async () => {
  const provider = createStaticProvider();
  const leaderboardProvider = createStaticLeaderboardProvider();
  const server = createOperatorServer({ provider, leaderboardProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(
    address.port,
    '/api/operator/leaderboard?last=30&sport=NBA',
  );
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: { entries: Array<{ capper: string }> };
  };
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.entries.map((entry) => entry.capper), ['Vintage', 'Ace', 'Blake']);
});

test('GET /api/operator/leaderboard ranks higher win-rate cappers above lower win-rate cappers', async () => {
  const provider = createStaticProvider();
  const leaderboardProvider = createStaticLeaderboardProvider();
  const server = createOperatorServer({ provider, leaderboardProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/leaderboard?last=30&sport=NBA');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: { entries: Array<{ capper: string }> };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.entries[0]?.capper, 'Vintage');
  assert.equal(body.data.entries[body.data.entries.length - 1]?.capper, 'Blake');
});

test('GET /api/operator/leaderboard excludes picks outside the requested window', async () => {
  const provider = createStaticProvider();
  const leaderboardProvider = createStaticLeaderboardProvider();
  const server = createOperatorServer({ provider, leaderboardProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/leaderboard?last=7&sport=NBA');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: { entries: Array<{ capper: string }> };
  };
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.entries.map((entry) => entry.capper), ['Ace', 'Blake']);
});

test('GET /api/operator/leaderboard clamps limit instead of erroring', async () => {
  const provider = createStaticProvider();
  let capturedLimit = 0;
  const leaderboardProvider: OperatorLeaderboardProvider = {
    async getLeaderboard(query) {
      capturedLimit = query.limit;
      return {
        window: query.window,
        sport: query.sport ?? null,
        minPicks: query.minPicks,
        entries: [],
        observedAt: '2026-03-27T12:00:00.000Z',
      };
    },
  };
  const server = createOperatorServer({ provider, leaderboardProvider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/leaderboard?last=30&limit=99');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(capturedLimit, 25);
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
  const participants = [
    {
      id: 'participant-team-bos',
      displayName: 'Boston Celtics',
      participantType: 'team',
      sport: 'nba',
      league: 'NBA',
      externalId: 'sgo-bos',
      metadata: { teamCode: 'BOS' },
    },
    {
      id: 'participant-player-brown',
      displayName: 'Jaylen Brown',
      participantType: 'player',
      sport: 'nba',
      league: 'NBA',
      externalId: 'sgo-jbrown',
      metadata: { teamCode: 'BOS' },
    },
    {
      id: 'participant-player-brunson',
      displayName: 'Jalen Brunson',
      participantType: 'player',
      sport: 'nba',
      league: 'NBA',
      externalId: 'sgo-jbrunson',
      metadata: { teamCode: 'NYK' },
    },
    {
      id: 'participant-team-nyk',
      displayName: 'New York Knicks',
      participantType: 'team',
      sport: 'nba',
      league: 'NBA',
      externalId: 'sgo-nyk',
      metadata: { teamCode: 'NYK' },
    },
  ];

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
            id: 'run-ingestor-1',
            run_type: 'ingestor.cycle',
            status: 'succeeded',
            started_at: '2026-03-21T14:00:00.000Z',
            finished_at: '2026-03-21T14:02:30.000Z',
            actor: 'ingestor',
            details: { league: 'NBA' },
            created_at: '2026-03-21T14:00:00.000Z',
            idempotency_key: 'ingestor-cycle-1',
          },
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
            capper_id: null,
            market_type_id: null,
            sport_id: null,
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
            idempotency_key: null,
            metadata: {},
            created_at: '2026-03-20T11:59:00.000Z',
            player_id: null,
            updated_at: '2026-03-20T12:01:00.000Z',
          },
          {
            id: 'pick-3',
            submission_id: 'submission-3',
            participant_id: null,
            capper_id: null,
            market_type_id: null,
            sport_id: null,
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
            idempotency_key: null,
            metadata: {},
            created_at: '2026-03-21T12:59:00.000Z',
            player_id: null,
            updated_at: '2026-03-21T13:01:00.000Z',
          },
          {
            id: 'pick-2',
            submission_id: 'submission-2',
            participant_id: null,
            capper_id: null,
            market_type_id: null,
            sport_id: null,
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
            idempotency_key: null,
            metadata: {},
            created_at: '2026-03-20T12:09:00.000Z',
            player_id: null,
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
        entityHealth: {
          resolvedEventsCount: 10,
          upcomingEventsCount: 3,
          resolvedPlayersCount: 84,
          resolvedTeamsWithExternalIdCount: 8,
          totalTeamsCount: 124,
          observedAt: '2026-03-21T14:03:00.000Z',
        },
        upcomingEvents: [
          {
            id: 'event-1',
            eventName: 'Knicks vs. Celtics',
            eventDate: '2026-03-22',
            sport: 'nba',
            teams: ['New York Knicks', 'Boston Celtics'],
            playerCount: 18,
          },
          {
            id: 'event-2',
            eventName: 'Lakers vs. Suns',
            eventDate: '2026-03-23',
            sport: 'nba',
            teams: ['Los Angeles Lakers', 'Phoenix Suns'],
            playerCount: 16,
          },
        ],
      });
    },
    async getParticipants(filter) {
      const filtered = participants
        .filter((row) => (filter?.type ? row.participantType === filter.type : true))
        .filter((row) => (filter?.sport ? row.sport === filter.sport : true))
        .filter((row) =>
          filter?.q ? row.displayName.toLowerCase().includes(filter.q.toLowerCase()) : true,
        )
        .sort((left, right) => left.displayName.localeCompare(right.displayName));
      const limit = filter?.limit ?? 20;

      return {
        participants: filtered.slice(0, limit),
        total: filtered.length,
        observedAt: '2026-03-21T14:03:00.000Z',
      };
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

function createStaticCapperRecapProvider(): OperatorCapperRecapProvider {
  return {
    async getCapperRecap(query) {
      return buildCapperRecapResponse(query, createStatsRows(makeStatsFixture()));
    },
  };
}

function createStaticLeaderboardProvider(): OperatorLeaderboardProvider {
  return {
    async getLeaderboard(query) {
      const rows = createStatsRows(makeLeaderboardFixture()).filter((row) => {
        const since = createWindowSinceIso(query.window);
        return row.settlement.settled_at >= since;
      });

      return buildLeaderboardResponse(query, rows);
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
        payload: { clvRaw: '2.5', clvPercent: 3.2, beatsClosingLine: true },
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

function makeLeaderboardFixture() {
  return {
    settlements: [
      makeLeaderboardSettlement('settlement-leaderboard-1', 'pick-leaderboard-1', 'win', '2026-03-26T12:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-2', 'pick-leaderboard-2', 'win', '2026-03-25T12:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-3', 'pick-leaderboard-3', 'loss', '2026-03-24T12:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-4', 'pick-leaderboard-4', 'loss', '2026-03-26T13:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-5', 'pick-leaderboard-5', 'loss', '2026-03-25T13:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-6', 'pick-leaderboard-6', 'win', '2026-03-24T13:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-7', 'pick-leaderboard-7', 'win', '2026-03-26T14:00:00.000Z', { clvRaw: '1.4' }),
      makeLeaderboardSettlement('settlement-leaderboard-8', 'pick-leaderboard-8', 'push', '2026-03-25T14:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-9', 'pick-leaderboard-9', 'win', '2026-03-24T14:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-10', 'pick-leaderboard-10', 'win', '2026-03-10T12:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-11', 'pick-leaderboard-11', 'win', '2026-03-09T12:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-12', 'pick-leaderboard-12', 'win', '2026-03-08T12:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-13', 'pick-leaderboard-13', 'win', '2026-03-26T15:00:00.000Z'),
      makeLeaderboardSettlement('settlement-leaderboard-14', 'pick-leaderboard-14', 'loss', '2026-03-24T15:00:00.000Z'),
    ],
    picks: [
      makeStatsPick('pick-leaderboard-1', 'submission-leaderboard-1', 'NBA'),
      makeStatsPick('pick-leaderboard-2', 'submission-leaderboard-2', 'NBA'),
      makeStatsPick('pick-leaderboard-3', 'submission-leaderboard-3', 'NBA'),
      makeStatsPick('pick-leaderboard-4', 'submission-leaderboard-4', 'NBA'),
      makeStatsPick('pick-leaderboard-5', 'submission-leaderboard-5', 'NBA'),
      makeStatsPick('pick-leaderboard-6', 'submission-leaderboard-6', 'NBA'),
      makeStatsPick('pick-leaderboard-7', 'submission-leaderboard-7', 'MLB'),
      makeStatsPick('pick-leaderboard-8', 'submission-leaderboard-8', 'MLB'),
      makeStatsPick('pick-leaderboard-9', 'submission-leaderboard-9', 'MLB'),
      makeStatsPick('pick-leaderboard-10', 'submission-leaderboard-10', 'NBA'),
      makeStatsPick('pick-leaderboard-11', 'submission-leaderboard-11', 'NBA'),
      makeStatsPick('pick-leaderboard-12', 'submission-leaderboard-12', 'NBA'),
      makeStatsPick('pick-leaderboard-13', 'submission-leaderboard-13', 'NBA'),
      makeStatsPick('pick-leaderboard-14', 'submission-leaderboard-14', 'NBA'),
    ],
    submissions: [
      makeStatsSubmission('submission-leaderboard-1', 'Ace'),
      makeStatsSubmission('submission-leaderboard-2', 'Ace'),
      makeStatsSubmission('submission-leaderboard-3', 'Ace'),
      makeStatsSubmission('submission-leaderboard-4', 'Blake'),
      makeStatsSubmission('submission-leaderboard-5', 'Blake'),
      makeStatsSubmission('submission-leaderboard-6', 'Blake'),
      makeStatsSubmission('submission-leaderboard-7', 'Casey'),
      makeStatsSubmission('submission-leaderboard-8', 'Casey'),
      makeStatsSubmission('submission-leaderboard-9', 'Casey'),
      makeStatsSubmission('submission-leaderboard-10', 'Vintage'),
      makeStatsSubmission('submission-leaderboard-11', 'Vintage'),
      makeStatsSubmission('submission-leaderboard-12', 'Vintage'),
      makeStatsSubmission('submission-leaderboard-13', 'Tiny'),
      makeStatsSubmission('submission-leaderboard-14', 'Tiny'),
    ],
  };
}

function makeStatsPick(id: string, submissionId: string, sport: string) {
  return {
    id,
    submission_id: submissionId,
    participant_id: null,
    capper_id: null,
    market_type_id: null,
    sport_id: null,
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
    idempotency_key: null,
    metadata: { sport },
    created_at: '2026-03-20T11:00:00.000Z',
    player_id: null,
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

function makeLeaderboardSettlement(
  id: string,
  pickId: string,
  result: 'win' | 'loss' | 'push',
  settledAt: string,
  payload: Record<string, unknown> = {},
) {
  return {
    id,
    pick_id: pickId,
    status: 'settled',
    result,
    source: 'grading',
    confidence: 'confirmed',
    evidence_ref: null,
    notes: null,
    review_reason: null,
    settled_by: 'grading',
    settled_at: settledAt,
    corrects_id: null,
    payload: payload as never,
    created_at: settledAt,
  };
}

function createWindowSinceIso(window: 7 | 14 | 30 | 90) {
  const anchor = new Date('2026-03-27T00:00:00.000Z').getTime();
  return new Date(anchor - window * 24 * 60 * 60 * 1000).toISOString();
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

// ---------------------------------------------------------------------------
// memberTiers snapshot tests
// ---------------------------------------------------------------------------

test('createSnapshotFromRows includes memberTiers with zero counts when no rows provided', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'demo',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.ok(snapshot.memberTiers, 'memberTiers should be present');
  assert.equal(snapshot.memberTiers.counts['free'], 0);
  assert.equal(snapshot.memberTiers.counts['vip'], 0);
  assert.equal(snapshot.memberTiers.counts['vip-plus'], 0);
  assert.equal(snapshot.memberTiers.counts['trial'], 0);
  assert.equal(snapshot.memberTiers.counts['capper'], 0);
  assert.equal(snapshot.memberTiers.counts['operator'], 0);
});

test('createSnapshotFromRows counts active member tier rows correctly', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    memberTierRows: [
      { tier: 'vip' },
      { tier: 'vip' },
      { tier: 'vip-plus' },
      { tier: 'trial' },
      { tier: 'capper' },
    ],
  });

  assert.equal(snapshot.memberTiers.counts['vip'], 2);
  assert.equal(snapshot.memberTiers.counts['vip-plus'], 1);
  assert.equal(snapshot.memberTiers.counts['trial'], 1);
  assert.equal(snapshot.memberTiers.counts['capper'], 1);
  assert.equal(snapshot.memberTiers.counts['free'], 0);
  assert.equal(snapshot.memberTiers.counts['operator'], 0);
});

// ---------------------------------------------------------------------------
// alertAgent snapshot tests (UTV2-143)
// ---------------------------------------------------------------------------

test('createSnapshotFromRows includes alertAgent section with null values when no runs provided', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'demo',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.ok(snapshot.alertAgent, 'alertAgent section should be present');
  assert.equal(snapshot.alertAgent.lastDetectionRunAt, null);
  assert.equal(snapshot.alertAgent.lastDetectionStatus, null);
  assert.equal(snapshot.alertAgent.lastDetectionDetails, null);
  assert.equal(snapshot.alertAgent.lastNotificationRunAt, null);
  assert.equal(snapshot.alertAgent.lastNotificationStatus, null);
  assert.equal(snapshot.alertAgent.lastNotificationDetails, null);
});

test('createSnapshotFromRows alertAgent reflects last detection run from recentRuns', () => {
  const detectionRun: SystemRunRecord = {
    id: 'run-det-1',
    run_type: 'alert.detection',
    status: 'succeeded',
    started_at: '2026-03-28T10:00:00.000Z',
    finished_at: '2026-03-28T10:00:01.000Z',
    actor: null,
    details: { signalsFound: 3, alertWorthy: 1, notable: 2, watch: 0 },
    created_at: '2026-03-28T10:00:00.000Z',
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [detectionRun],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.alertAgent.lastDetectionRunAt, '2026-03-28T10:00:00.000Z');
  assert.equal(snapshot.alertAgent.lastDetectionStatus, 'succeeded');
  assert.ok(snapshot.alertAgent.lastDetectionDetails, 'lastDetectionDetails should be present');
  assert.equal(snapshot.alertAgent.lastDetectionDetails?.signalsFound, 3);
  assert.equal(snapshot.alertAgent.lastDetectionDetails?.alertWorthy, 1);
  assert.equal(snapshot.alertAgent.lastDetectionDetails?.notable, 2);
  assert.equal(snapshot.alertAgent.lastDetectionDetails?.watch, 0);
  assert.equal(snapshot.alertAgent.lastNotificationRunAt, null);
});

test('createSnapshotFromRows alertAgent reflects last notification run from recentRuns', () => {
  const notificationRun: SystemRunRecord = {
    id: 'run-notif-1',
    run_type: 'alert.notification',
    status: 'succeeded',
    started_at: '2026-03-28T10:01:00.000Z',
    finished_at: '2026-03-28T10:01:01.000Z',
    actor: null,
    details: { notified: 2, suppressed: 1 },
    created_at: '2026-03-28T10:01:00.000Z',
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [notificationRun],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.alertAgent.lastNotificationRunAt, '2026-03-28T10:01:00.000Z');
  assert.equal(snapshot.alertAgent.lastNotificationStatus, 'succeeded');
  assert.ok(snapshot.alertAgent.lastNotificationDetails, 'lastNotificationDetails should be present');
  assert.equal(snapshot.alertAgent.lastNotificationDetails?.notified, 2);
  assert.equal(snapshot.alertAgent.lastNotificationDetails?.suppressed, 1);
  assert.equal(snapshot.alertAgent.lastDetectionRunAt, null);
});

// ---------------------------------------------------------------------------
// Circuit breaker snapshot tests (UTV2-124)
// ---------------------------------------------------------------------------

test('createSnapshotFromRows marks worker degraded when a worker.circuit-open run is running', () => {
  const circuitOpenRun: SystemRunRecord = {
    id: 'circuit-run-1',
    run_type: 'worker.circuit-open',
    status: 'running',
    started_at: '2026-03-29T10:00:00.000Z',
    finished_at: null,
    actor: 'worker-dev',
    details: { target: 'discord:best-bets', openedAt: '2026-03-29T10:00:00.000Z', resumeAt: '2026-03-29T10:05:00.000Z' },
    created_at: '2026-03-29T10:00:00.000Z',
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [circuitOpenRun],
    recentPicks: [],
    recentAudit: [],
  });

  const workerSignal = snapshot.health.find((h) => h.component === 'worker');
  assert.ok(workerSignal, 'worker health signal should be present');
  assert.equal(workerSignal.status, 'degraded');
  assert.ok(
    workerSignal.detail?.includes('circuit breaker open'),
    `detail should mention circuit breaker open, got: ${workerSignal.detail}`,
  );
  assert.ok(
    workerSignal.detail?.includes('discord:best-bets'),
    `detail should include the target name, got: ${workerSignal.detail}`,
  );
});

test('createSnapshotFromRows does not degrade worker when worker.circuit-open run is succeeded and fresh worker activity exists', () => {
  const closedCircuitRun: SystemRunRecord = {
    id: 'circuit-run-2',
    run_type: 'worker.circuit-open',
    status: 'succeeded',
    started_at: '2026-03-29T10:00:00.000Z',
    finished_at: '2026-03-29T10:05:00.000Z',
    actor: 'worker-dev',
    details: { target: 'discord:best-bets', closedAt: '2026-03-29T10:05:00.000Z' },
    created_at: '2026-03-29T10:00:00.000Z',
    idempotency_key: null,
  };
  const normalRun: SystemRunRecord = {
    id: 'normal-run-1',
    run_type: 'worker.heartbeat',
    status: 'succeeded',
    started_at: new Date(Date.now() - 10_000).toISOString(),
    finished_at: new Date(Date.now() - 9_000).toISOString(),
    actor: 'worker-dev',
    details: null,
    created_at: new Date(Date.now() - 10_000).toISOString(),
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [normalRun, closedCircuitRun],
    recentPicks: [],
    recentAudit: [],
  });

  const workerSignal = snapshot.health.find((h) => h.component === 'worker');
  assert.ok(workerSignal, 'worker health signal should be present');
  assert.equal(workerSignal.status, 'healthy');
});

// ---------------------------------------------------------------------------
// UTV2-144: gradingAgent section in operator snapshot
// ---------------------------------------------------------------------------

test('createSnapshotFromRows gradingAgent returns nulls when no grading.run rows present', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'demo',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.ok(snapshot.gradingAgent, 'gradingAgent should be present');
  assert.equal(snapshot.gradingAgent.lastGradingRunAt, null);
  assert.equal(snapshot.gradingAgent.lastGradingRunStatus, null);
  assert.equal(snapshot.gradingAgent.lastPicksGraded, null);
  assert.equal(snapshot.gradingAgent.lastFailed, null);
  assert.equal(snapshot.gradingAgent.lastRecapPostAt, null);
  assert.equal(snapshot.gradingAgent.lastRecapChannel, null);
  assert.equal(snapshot.gradingAgent.runCount, 0);
});

test('createSnapshotFromRows gradingAgent reflects latest grading.run row', () => {
  const gradingRun: SystemRunRecord = {
    id: 'grading-run-1',
    run_type: 'grading.run',
    status: 'succeeded',
    started_at: '2026-03-29T10:00:00.000Z',
    finished_at: '2026-03-29T10:00:05.000Z',
    actor: 'grading-service',
    details: { picksGraded: 4, failed: 0 },
    created_at: '2026-03-29T10:00:00.000Z',
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [gradingRun],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.gradingAgent.lastGradingRunAt, '2026-03-29T10:00:00.000Z');
  assert.equal(snapshot.gradingAgent.lastGradingRunStatus, 'succeeded');
  assert.equal(snapshot.gradingAgent.lastPicksGraded, 4);
  assert.equal(snapshot.gradingAgent.lastFailed, 0);
  assert.equal(snapshot.gradingAgent.runCount, 1);
});

test('createSnapshotFromRows gradingAgent reflects latest recap.post row', () => {
  const recapRun: SystemRunRecord = {
    id: 'recap-run-1',
    run_type: 'recap.post',
    status: 'succeeded',
    started_at: '2026-03-29T10:01:00.000Z',
    finished_at: '2026-03-29T10:01:01.000Z',
    actor: 'grading-service',
    details: { channel: '1296531122234327100', pickCount: 1 },
    created_at: '2026-03-29T10:01:00.000Z',
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [recapRun],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.gradingAgent.lastRecapPostAt, '2026-03-29T10:01:00.000Z');
  assert.equal(snapshot.gradingAgent.lastRecapChannel, '1296531122234327100');
  assert.equal(snapshot.gradingAgent.runCount, 0);
});

// ---------------------------------------------------------------------------
// Worker heartbeat stale detection tests (UTV2-120)
// ---------------------------------------------------------------------------

test('createSnapshotFromRows marks worker degraded when worker.heartbeat is stale', () => {
  // Heartbeat that is 300 seconds old — well past the 120s default threshold
  const staleHeartbeatAt = new Date(Date.now() - 300_000).toISOString();
  const heartbeatRun: SystemRunRecord = {
    id: 'hb-stale-1',
    run_type: 'worker.heartbeat',
    status: 'succeeded',
    started_at: staleHeartbeatAt,
    finished_at: staleHeartbeatAt,
    actor: 'worker-dev',
    details: { cycle: 1, targets: ['discord:best-bets'] },
    created_at: staleHeartbeatAt,
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [heartbeatRun],
    recentPicks: [],
    recentAudit: [],
  });

  const workerSignal = snapshot.health.find((h) => h.component === 'worker');
  assert.ok(workerSignal, 'worker health signal should be present');
  assert.equal(workerSignal.status, 'degraded');
  assert.ok(
    workerSignal.detail?.includes('stale'),
    `detail should mention stale heartbeat, got: ${workerSignal.detail}`,
  );
});

test('createSnapshotFromRows keeps worker healthy when worker.heartbeat is fresh', () => {
  // Heartbeat that is 10 seconds old — well within the 120s default threshold
  const freshHeartbeatAt = new Date(Date.now() - 10_000).toISOString();
  const heartbeatRun: SystemRunRecord = {
    id: 'hb-fresh-1',
    run_type: 'worker.heartbeat',
    status: 'succeeded',
    started_at: freshHeartbeatAt,
    finished_at: freshHeartbeatAt,
    actor: 'worker-dev',
    details: { cycle: 1, targets: ['discord:best-bets'] },
    created_at: freshHeartbeatAt,
    idempotency_key: null,
  };
  const normalRun: SystemRunRecord = {
    id: 'normal-run-hb-2',
    run_type: 'distribution.process',
    status: 'succeeded',
    started_at: freshHeartbeatAt,
    finished_at: freshHeartbeatAt,
    actor: 'worker-dev',
    details: null,
    created_at: freshHeartbeatAt,
    idempotency_key: null,
  };

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [heartbeatRun, normalRun],
    recentPicks: [],
    recentAudit: [],
  });

  const workerSignal = snapshot.health.find((h) => h.component === 'worker');
  assert.ok(workerSignal, 'worker health signal should be present');
  assert.equal(workerSignal.status, 'healthy', `worker should be healthy with fresh heartbeat, got: ${workerSignal.status} (${workerSignal.detail})`);
});

// ─── UTV2-142: incident surfaces ──────────────────────────────────────────────

test('detectIncidents returns stuck-outbox incident for pending row older than 15 minutes', () => {
  const now = new Date('2026-03-30T12:20:00.000Z');
  // pending row created 20 minutes ago
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-stuck-1',
        pick_id: 'pick-stuck-1',
        target: 'discord:best-bets',
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-30T12:00:00.000Z',
        updated_at: '2026-03-30T12:00:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  const stuckIncident = snapshot.incidents.find((i) => i.type === 'stuck-outbox');
  assert.ok(stuckIncident, 'stuck-outbox incident should be present');
  assert.equal(stuckIncident.severity, 'critical');
  assert.equal(stuckIncident.affectedCount, 1);
  assert.match(stuckIncident.summary, /pending outbox row/i);
});

test('detectIncidents does not raise stuck-outbox when pending row is recent', () => {
  const now = new Date('2026-03-30T12:05:00.000Z');
  // pending row created 5 minutes ago (under threshold)
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-fresh-1',
        pick_id: 'pick-fresh-1',
        target: 'discord:best-bets',
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-30T12:00:00.000Z',
        updated_at: '2026-03-30T12:00:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  assert.equal(
    snapshot.incidents.some((i) => i.type === 'stuck-outbox'),
    false,
  );
});

test('detectIncidents returns delivery-stall incident when pending rows are old and no receipts exist in window', () => {
  const now = new Date('2026-03-30T12:20:00.000Z');
  // pending row created 20 minutes ago, no receipts in last 15 minutes
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-stall-1',
        pick_id: 'pick-stall-1',
        target: 'discord:best-bets',
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-30T12:00:00.000Z',
        updated_at: '2026-03-30T12:00:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  const stallIncident = snapshot.incidents.find((i) => i.type === 'delivery-stall');
  assert.ok(stallIncident, 'delivery-stall incident should be present');
  assert.equal(stallIncident.severity, 'critical');
  assert.equal(stallIncident.affectedCount, 1);
  assert.match(stallIncident.summary, /not processing/i);
});

test('detectIncidents does not raise delivery-stall when recent receipt exists in window', () => {
  const now = new Date('2026-03-30T12:20:00.000Z');
  // pending row is old, but a receipt was written 5 minutes ago
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-stall-2',
        pick_id: 'pick-stall-2',
        target: 'discord:best-bets',
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-30T12:00:00.000Z',
        updated_at: '2026-03-30T12:00:00.000Z',
      },
    ],
    recentReceipts: [
      {
        id: 'receipt-recent-1',
        outbox_id: 'outbox-other',
        external_id: null,
        idempotency_key: null,
        receipt_type: 'discord.message',
        status: 'sent',
        channel: 'discord:canary',
        payload: {},
        recorded_at: '2026-03-30T12:15:00.000Z',
      },
    ],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  assert.equal(
    snapshot.incidents.some((i) => i.type === 'delivery-stall'),
    false,
    'no delivery-stall when a receipt was written recently',
  );
});

test('detectIncidents does not raise delivery-stall when pending rows are fresh', () => {
  const now = new Date('2026-03-30T12:05:00.000Z');
  // pending row created 5 minutes ago (under 15-minute threshold)
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-fresh-stall',
        pick_id: 'pick-fresh-stall',
        target: 'discord:best-bets',
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-30T12:00:00.000Z',
        updated_at: '2026-03-30T12:00:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  assert.equal(
    snapshot.incidents.some((i) => i.type === 'delivery-stall'),
    false,
    'no delivery-stall when pending rows are under threshold',
  );
});

test('detectIncidents returns stale-worker incident when most recent distribution.process run finished more than 10 minutes ago', () => {
  const now = new Date('2026-03-30T12:15:00.000Z');
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [
      {
        id: 'run-worker-stale-1',
        run_type: 'distribution.process',
        status: 'succeeded',
        started_at: '2026-03-30T12:00:00.000Z',
        finished_at: '2026-03-30T12:00:30.000Z',
        actor: 'worker-dev',
        details: null,
        created_at: '2026-03-30T12:00:00.000Z',
        idempotency_key: null,
      },
    ],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  const staleIncident = snapshot.incidents.find((i) => i.type === 'stale-worker');
  assert.ok(staleIncident, 'stale-worker incident should be present');
  assert.equal(staleIncident.severity, 'warning');
  assert.equal(staleIncident.affectedCount, 1);
  assert.match(staleIncident.summary, /10 minutes/i);
});

test('detectIncidents returns stale-worker incident when no worker runs exist', () => {
  const now = new Date('2026-03-30T12:00:00.000Z');
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  const staleIncident = snapshot.incidents.find((i) => i.type === 'stale-worker');
  assert.ok(staleIncident, 'stale-worker incident should be present when no worker runs exist');
  assert.equal(staleIncident.severity, 'warning');
  assert.match(staleIncident.summary, /offline/i);
});

test('detectIncidents does not return stale-worker when worker heartbeat is fresh even without distribution work', () => {
  const now = new Date();
  const heartbeatCreatedAt = new Date(now.getTime() - 30_000).toISOString();
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [
      {
        id: 'run-hb-1',
        run_type: 'worker.heartbeat',
        status: 'succeeded',
        started_at: heartbeatCreatedAt,
        finished_at: new Date(now.getTime() - 29_000).toISOString(),
        actor: 'worker-dev',
        details: {},
        created_at: heartbeatCreatedAt,
        idempotency_key: null,
      },
      {
        id: 'run-ingestor-1',
        run_type: 'ingestor.cycle',
        status: 'failed',
        started_at: new Date(now.getTime() - 60_000).toISOString(),
        finished_at: new Date(now.getTime() - 50_000).toISOString(),
        actor: 'ingestor',
        details: {},
        created_at: new Date(now.getTime() - 60_000).toISOString(),
        idempotency_key: null,
      },
    ],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  assert.equal(snapshot.incidents.some((i) => i.type === 'stale-worker'), false);
  const workerHealth = snapshot.health.find((signal) => signal.component === 'worker');
  assert.equal(workerHealth?.status, 'healthy');
});

test('detectIncidents returns open-dead-letter incident when dead_letter rows exist', () => {
  const now = new Date('2026-03-30T12:00:00.000Z');
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-dl-1',
        pick_id: 'pick-dl-1',
        target: 'discord:best-bets',
        status: 'dead_letter',
        attempt_count: 5,
        next_attempt_at: null,
        last_error: 'permanently failed',
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-30T11:00:00.000Z',
        updated_at: '2026-03-30T11:30:00.000Z',
      },
      {
        id: 'outbox-dl-2',
        pick_id: 'pick-dl-2',
        target: 'discord:canary',
        status: 'dead_letter',
        attempt_count: 5,
        next_attempt_at: null,
        last_error: 'permanently failed',
        payload: {},
        claimed_at: null,
        claimed_by: null,
        idempotency_key: null,
        created_at: '2026-03-30T11:05:00.000Z',
        updated_at: '2026-03-30T11:35:00.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  const dlIncident = snapshot.incidents.find((i) => i.type === 'open-dead-letter');
  assert.ok(dlIncident, 'open-dead-letter incident should be present');
  assert.equal(dlIncident.severity, 'critical');
  assert.equal(dlIncident.affectedCount, 2);
  assert.match(dlIncident.summary, /dead-letter/i);
});

test('detectIncidents returns circuit-open incident when bestBets circuit is open', () => {
  const now = new Date('2026-03-30T12:00:00.000Z');
  // 3 failed rows + 0 sent rows triggers circuit open
  const failedOutboxRows = [1, 2, 3].map((i) => ({
    id: `outbox-fail-${i}`,
    pick_id: `pick-fail-${i}`,
    target: 'discord:best-bets' as const,
    status: 'failed' as const,
    attempt_count: 3,
    next_attempt_at: null,
    last_error: 'delivery failed',
    payload: {},
    claimed_at: null,
    claimed_by: null,
    idempotency_key: null,
    created_at: '2026-03-30T11:00:00.000Z',
    updated_at: '2026-03-30T11:30:00.000Z',
  }));

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: failedOutboxRows,
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  const circuitIncident = snapshot.incidents.find((i) => i.type === 'circuit-open');
  assert.ok(circuitIncident, 'circuit-open incident should be present');
  assert.equal(circuitIncident.severity, 'critical');
  assert.equal(circuitIncident.affectedCount, 1);
  assert.match(circuitIncident.summary, /discord:best-bets/);

  // Also check circuitBreaker field on bestBets channel summary
  assert.equal(snapshot.bestBets.circuitBreaker.status, 'open');
});

test('detectIncidents returns empty array when everything is healthy', () => {
  const now = new Date();
  // A recent successful distribution-worker run and sent outbox rows
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-sent-healthy',
        pick_id: 'pick-healthy-1',
        target: 'discord:best-bets',
        status: 'sent',
        attempt_count: 1,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: '2026-03-30T12:00:00.000Z',
        claimed_by: 'worker-dev',
        idempotency_key: 'key-healthy-1',
        created_at: '2026-03-30T12:00:00.000Z',
        updated_at: '2026-03-30T12:00:30.000Z',
      },
    ],
    recentReceipts: [],
    recentSettlements: [],
    recentRuns: [
      {
        id: 'run-worker-healthy-1',
        run_type: 'distribution.process',
        status: 'succeeded',
        started_at: new Date(now.getTime() - 30_000).toISOString(),
        finished_at: new Date(now.getTime() - 20_000).toISOString(),
        actor: 'worker-dev',
        details: null,
        created_at: new Date(now.getTime() - 30_000).toISOString(),
        idempotency_key: null,
      },
    ],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  const stuckOrDead = snapshot.incidents.filter(
    (i) => i.type === 'stuck-outbox' || i.type === 'open-dead-letter' || i.type === 'circuit-open',
  );
  assert.deepEqual(stuckOrDead, []);
  // stale-worker should also be absent since the run finished < 1 minute ago
  assert.equal(
    snapshot.incidents.some((i) => i.type === 'stale-worker'),
    false,
  );
});
// ---------------------------------------------------------------------------
// pick-detail route tests
// ---------------------------------------------------------------------------

test('GET /api/operator/picks/known-id returns PickDetailView JSON with correct shape', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/picks/known-id');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      pick: { id: string; status: string; market: string };
      lifecycle: unknown[];
      promotionHistory: unknown[];
      outboxRows: unknown[];
      receipts: unknown[];
      settlements: unknown[];
      auditTrail: unknown[];
      submission: { id: string } | null;
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.pick.id, 'known-id');
  assert.equal(typeof body.data.pick.status, 'string');
  assert.equal(typeof body.data.pick.market, 'string');
  assert.ok(Array.isArray(body.data.lifecycle), 'lifecycle should be an array');
  assert.ok(Array.isArray(body.data.promotionHistory), 'promotionHistory should be an array');
  assert.ok(Array.isArray(body.data.outboxRows), 'outboxRows should be an array');
  assert.ok(Array.isArray(body.data.receipts), 'receipts should be an array');
  assert.ok(Array.isArray(body.data.settlements), 'settlements should be an array');
  assert.ok(Array.isArray(body.data.auditTrail), 'auditTrail should be an array');
});

test('GET /api/operator/picks/unknown-id returns 404', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/picks/unknown-id');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 404);
  const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'NOT_FOUND');
});

// ── Wave 4: Performance + Intelligence endpoint tests ─────────────

test('GET /api/operator/performance returns extended stats shape with CLV and stake fields', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected server address');

  const response = await makeRequest(address.port, '/api/operator/performance');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as { ok: boolean; data: Record<string, unknown> };
  assert.equal(body.ok, true);

  const data = body.data;
  // Verify extended shape
  assert.ok('windows' in data);
  assert.ok('bySource' in data);
  assert.ok('bySport' in data);
  assert.ok('byIndividualSource' in data);
  assert.ok('decisions' in data);
  assert.ok('insights' in data);

  // Verify windows have CLV fields
  const windows = data['windows'] as Record<string, Record<string, unknown>>;
  for (const key of ['today', 'last7d', 'last30d', 'mtd']) {
    const w = windows[key]!;
    assert.ok('avgClvPct' in w, `${key} missing avgClvPct`);
    assert.ok('avgStakeUnits' in w, `${key} missing avgStakeUnits`);
  }

  // Verify decisions has held stats
  const decisions = data['decisions'] as Record<string, unknown>;
  assert.ok('held' in decisions);
  assert.ok('heldCount' in decisions);

  // Verify insights has new fields
  const insights = data['insights'] as Record<string, unknown>;
  assert.ok('approvedVsDeniedDelta' in insights);
  assert.ok('strongestSport' in insights);
  assert.ok('weakestSport' in insights);
  const topCapper = insights['topCapper'] as Record<string, unknown>;
  assert.ok('sampleSize' in topCapper);
});

test('GET /api/operator/intelligence returns intelligence shape', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected server address');

  const response = await makeRequest(address.port, '/api/operator/intelligence');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as { ok: boolean; data: Record<string, unknown> };
  assert.equal(body.ok, true);

  const data = body.data;
  // Verify shape
  assert.ok('recentForm' in data);
  assert.ok('scoreQuality' in data);
  assert.ok('decisionQuality' in data);
  assert.ok('feedbackLoop' in data);
  assert.ok('insights' in data);
  assert.ok('observedAt' in data);

  // Verify recentForm structure
  const recentForm = data['recentForm'] as Record<string, unknown>;
  for (const key of ['overall', 'capper', 'system', 'approved', 'denied']) {
    const form = recentForm[key] as Record<string, unknown>;
    assert.ok('last5' in form, `recentForm.${key} missing last5`);
    assert.ok('last10' in form, `recentForm.${key} missing last10`);
    assert.ok('last20' in form, `recentForm.${key} missing last20`);
    const last5 = form['last5'] as Record<string, unknown>;
    assert.ok('wins' in last5);
    assert.ok('losses' in last5);
    assert.ok('hitRatePct' in last5);
    assert.ok('roiPct' in last5);
    assert.ok('streak' in last5);
  }
  assert.ok('bySport' in recentForm);
  assert.ok('bySource' in recentForm);

  // Verify scoreQuality
  const scoreQuality = data['scoreQuality'] as Record<string, unknown>;
  assert.ok('bands' in scoreQuality);
  assert.ok('scoreVsOutcome' in scoreQuality);
  const scoreVsOutcome = scoreQuality['scoreVsOutcome'] as Record<string, unknown>;
  assert.ok('correlation' in scoreVsOutcome);

  // Verify decisionQuality
  const decisionQuality = data['decisionQuality'] as Record<string, unknown>;
  assert.ok('approvedWinRate' in decisionQuality);
  assert.ok('deniedWouldHaveWonRate' in decisionQuality);
  assert.ok('approvedVsDeniedRoiDelta' in decisionQuality);
  assert.ok('holdsResolvedCount' in decisionQuality);
  assert.ok('holdsTotal' in decisionQuality);

  // Verify feedbackLoop is an array
  assert.ok(Array.isArray(data['feedbackLoop']));

  // Verify insights
  const insights = data['insights'] as Record<string, unknown>;
  assert.ok('warnings' in insights);
  assert.ok(Array.isArray(insights['warnings']));
});

// ---------------------------------------------------------------------------
// Snapshot pagination tests (UTV2-131)
// ---------------------------------------------------------------------------

test('GET /api/operator/snapshot returns pagination metadata with default limit', async () => {
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
    data: Record<string, unknown>;
    pagination: { limit: number; hasMore: boolean };
  };
  assert.equal(body.ok, true);
  assert.equal(body.pagination.limit, 25);
  assert.equal(body.pagination.hasMore, false);
});

test('GET /api/operator/snapshot truncates arrays when limit < array length', async () => {
  // Build a provider that returns 4 outbox items (more than limit=2)
  const outboxItems = Array.from({ length: 4 }, (_, i) => ({
    id: `outbox-pg-${i}`,
    pick_id: `pick-pg-${i}`,
    target: 'discord:canary' as const,
    status: 'sent' as const,
    attempt_count: 0,
    next_attempt_at: null,
    last_error: null,
    payload: { market: 'NBA points' },
    claimed_at: `2026-03-20T12:0${i}:00.000Z`,
    claimed_by: 'worker-canary',
    idempotency_key: `pg-${i}:discord:canary:distribution`,
    created_at: `2026-03-20T12:0${i}:00.000Z`,
    updated_at: `2026-03-20T12:0${i}:01.000Z`,
  }));
  const provider: OperatorSnapshotProvider = {
    async getSnapshot(_filter?: OutboxFilter) {
      return createSnapshotFromRows({
        persistenceMode: 'demo',
        recentOutbox: outboxItems,
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

  const response = await makeRequest(address.port, '/api/operator/snapshot?limit=2');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: { recentOutbox: unknown[] };
    pagination: { limit: number; hasMore: boolean };
  };
  assert.equal(body.pagination.limit, 2);
  assert.equal(body.pagination.hasMore, true);
  assert.equal(body.data.recentOutbox.length, 2);
});

test('GET /api/operator/snapshot clamps limit to max 100', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot(_filter?: OutboxFilter) {
      return createSnapshotFromRows({
        persistenceMode: 'demo',
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

  const response = await makeRequest(address.port, '/api/operator/snapshot?limit=999');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    pagination: { limit: number; hasMore: boolean };
  };
  assert.equal(body.pagination.limit, 100);
  assert.equal(body.pagination.hasMore, false);
});

test('GET /api/operator/snapshot hasMore is false when arrays fit within limit', async () => {
  const provider: OperatorSnapshotProvider = {
    async getSnapshot(_filter?: OutboxFilter) {
      return createSnapshotFromRows({
        persistenceMode: 'demo',
        recentOutbox: [
          {
            id: 'outbox-fit-1',
            pick_id: 'pick-fit-1',
            target: 'discord:canary',
            status: 'sent',
            attempt_count: 0,
            next_attempt_at: null,
            last_error: null,
            payload: {},
            claimed_at: '2026-03-20T12:00:00.000Z',
            claimed_by: 'worker',
            idempotency_key: 'fit-1',
            created_at: '2026-03-20T12:00:00.000Z',
            updated_at: '2026-03-20T12:00:00.000Z',
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

  const response = await makeRequest(address.port, '/api/operator/snapshot?limit=5');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: { recentOutbox: unknown[] };
    pagination: { limit: number; hasMore: boolean };
  };
  assert.equal(body.pagination.limit, 5);
  assert.equal(body.pagination.hasMore, false);
  assert.equal(body.data.recentOutbox.length, 1);
});

// --- Simulation mode count separation tests ---

test('createSnapshotFromRows separates simulated deliveries from sentOutbox', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'demo',
    recentOutbox: [
      {
        id: 'outbox-real-1',
        pick_id: 'pick-1',
        target: 'discord:canary',
        status: 'sent',
        attempt_count: 1,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: '2026-03-20T12:00:00.000Z',
        claimed_by: 'worker-1',
        idempotency_key: 'real-key-1',
        created_at: '2026-03-20T12:00:00.000Z',
        updated_at: '2026-03-20T12:01:00.000Z',
      },
      {
        id: 'outbox-sim-1',
        pick_id: 'pick-2',
        target: 'discord:best-bets',
        status: 'sent',
        attempt_count: 1,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: '2026-03-20T12:00:00.000Z',
        claimed_by: 'worker-sim',
        idempotency_key: 'sim-key-1',
        created_at: '2026-03-20T12:00:00.000Z',
        updated_at: '2026-03-20T12:01:00.000Z',
      },
    ],
    recentReceipts: [
      {
        id: 'receipt-real-1',
        outbox_id: 'outbox-real-1',
        external_id: 'discord-msg-1',
        idempotency_key: 'receipt-real-key-1',
        receipt_type: 'discord.message',
        status: 'sent',
        channel: 'discord:1296531122234327100',
        payload: {},
        recorded_at: '2026-03-20T12:01:01.000Z',
      },
      {
        id: 'receipt-sim-1',
        outbox_id: 'outbox-sim-1',
        external_id: 'sim:outbox-sim-1',
        idempotency_key: 'receipt-sim-key-1',
        receipt_type: 'worker.simulation',
        status: 'sent',
        channel: 'simulated:discord:best-bets',
        payload: { simulated: true },
        recorded_at: '2026-03-20T12:01:01.000Z',
      },
    ],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.counts.sentOutbox, 1, 'sentOutbox should exclude simulated deliveries');
  assert.equal(snapshot.counts.simulatedDeliveries, 1, 'simulatedDeliveries should count simulation receipts');
});

test('createSnapshotFromRows has zero simulatedDeliveries when no simulation receipts exist', () => {
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'demo',
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
        claimed_by: 'worker-1',
        idempotency_key: 'key-1',
        created_at: '2026-03-20T12:00:00.000Z',
        updated_at: '2026-03-20T12:01:00.000Z',
      },
    ],
    recentReceipts: [
      {
        id: 'receipt-1',
        outbox_id: 'outbox-1',
        external_id: 'discord-msg-1',
        idempotency_key: 'receipt-key-1',
        receipt_type: 'discord.message',
        status: 'sent',
        channel: 'discord:1296531122234327100',
        payload: {},
        recorded_at: '2026-03-20T12:01:01.000Z',
      },
    ],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });

  assert.equal(snapshot.counts.sentOutbox, 1);
  assert.equal(snapshot.counts.simulatedDeliveries, 0);
});

// --- Simulation mode data-derived detection tests (UTV2-171) ---

test('createSnapshotFromRows sets simulationMode=true when simulation receipts exist without env var', () => {
  delete process.env['UNIT_TALK_SIMULATION_MODE'];
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [
      {
        id: 'receipt-sim-detect-1',
        outbox_id: 'outbox-sim-1',
        external_id: null,
        idempotency_key: null,
        receipt_type: 'worker.simulation',
        status: 'sent',
        channel: 'simulated:discord:canary',
        payload: {},
        recorded_at: '2026-03-31T12:00:00.000Z',
      },
    ],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });
  assert.equal(snapshot.simulationMode, true);
  assert.equal(snapshot.counts.simulatedDeliveries, 1);
});

test('createSnapshotFromRows sets simulationMode=true when env var is set even without simulation receipts', () => {
  process.env['UNIT_TALK_SIMULATION_MODE'] = 'true';
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });
  assert.equal(snapshot.simulationMode, true);
  assert.equal(snapshot.counts.simulatedDeliveries, 0);
  delete process.env['UNIT_TALK_SIMULATION_MODE'];
});

test('createSnapshotFromRows sets simulationMode=false when no simulation receipts and no env var', () => {
  delete process.env['UNIT_TALK_SIMULATION_MODE'];
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [
      {
        id: 'receipt-real-detect-1',
        outbox_id: 'outbox-real-1',
        external_id: 'discord-msg-1',
        idempotency_key: null,
        receipt_type: 'discord.message',
        status: 'sent',
        channel: 'discord:canary',
        payload: {},
        recorded_at: '2026-03-31T12:00:00.000Z',
      },
    ],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
  });
  assert.equal(snapshot.simulationMode, false);
  assert.equal(snapshot.counts.simulatedDeliveries, 0);
});

test('readOperatorSimulationMode returns true when env var is set', () => {
  process.env['UNIT_TALK_SIMULATION_MODE'] = 'true';
  assert.equal(readOperatorSimulationMode(), true);
  delete process.env['UNIT_TALK_SIMULATION_MODE'];
});

test('readOperatorSimulationMode returns false when env var is absent', () => {
  delete process.env['UNIT_TALK_SIMULATION_MODE'];
  assert.equal(readOperatorSimulationMode(), false);
});

test('createSnapshotFromRows aging counts zero when no stale picks or outbox rows exist', () => {
  const now = new Date('2026-03-25T12:00:00.000Z');
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [
      {
        id: 'pick-fresh',
        submission_id: 'sub-1',
        participant_id: null,
        capper_id: null,
        market_type_id: null,
        sport_id: null,
        market: 'NBA points',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -110,
        stake_units: 1,
        confidence: 0.8,
        source: 'smart-form',
        approval_status: 'approved',
        promotion_status: 'not_eligible',
        promotion_target: null,
        promotion_score: null,
        promotion_reason: null,
        promotion_version: null,
        promotion_decided_at: null,
        promotion_decided_by: null,
        status: 'validated',
        posted_at: null,
        settled_at: null,
        idempotency_key: null,
        metadata: {},
        created_at: '2026-03-25T11:00:00.000Z', // 1h old, under 24h threshold
        player_id: null,
        updated_at: '2026-03-25T11:00:00.000Z',
      },
    ],
    recentAudit: [],
    now,
  });

  assert.equal(snapshot.aging.staleValidated, 0);
  assert.equal(snapshot.aging.stalePosted, 0);
  assert.equal(snapshot.aging.staleProcessing, 0);
  assert.equal(snapshot.aging.oldestValidatedAge, '2026-03-25T11:00:00.000Z');
  assert.equal(snapshot.aging.oldestPostedAge, null);
});

test('createSnapshotFromRows aging detects stale validated picks older than 24h', () => {
  const now = new Date('2026-03-25T12:00:00.000Z');
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [
      {
        id: 'pick-stale-validated',
        submission_id: 'sub-1',
        participant_id: null,
        capper_id: null,
        market_type_id: null,
        sport_id: null,
        market: 'NBA points',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -110,
        stake_units: 1,
        confidence: 0.8,
        source: 'smart-form',
        approval_status: 'approved',
        promotion_status: 'not_eligible',
        promotion_target: null,
        promotion_score: null,
        promotion_reason: null,
        promotion_version: null,
        promotion_decided_at: null,
        promotion_decided_by: null,
        status: 'validated',
        posted_at: null,
        settled_at: null,
        idempotency_key: null,
        metadata: {},
        created_at: '2026-03-23T10:00:00.000Z', // ~50h old
        player_id: null,
        updated_at: '2026-03-23T10:00:00.000Z',
      },
    ],
    recentAudit: [],
    now,
  });

  assert.equal(snapshot.aging.staleValidated, 1);
  assert.equal(snapshot.aging.oldestValidatedAge, '2026-03-23T10:00:00.000Z');
  // Should produce a degraded health signal for aging
  const agingSignal = snapshot.health.find(
    (s) => s.component === 'api' && s.detail.includes('stale validated'),
  );
  assert.ok(agingSignal, 'Expected a degraded api health signal for stale validated picks');
  assert.equal(agingSignal.status, 'degraded');
});

test('createSnapshotFromRows aging detects stale posted picks older than 7d', () => {
  const now = new Date('2026-03-25T12:00:00.000Z');
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [
      {
        id: 'pick-stale-posted',
        submission_id: 'sub-1',
        participant_id: null,
        capper_id: null,
        market_type_id: null,
        sport_id: null,
        market: 'NBA points',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -110,
        stake_units: 1,
        confidence: 0.8,
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
        posted_at: '2026-03-10T12:00:00.000Z',
        settled_at: null,
        idempotency_key: null,
        metadata: {},
        created_at: '2026-03-10T12:00:00.000Z', // 15d old
        player_id: null,
        updated_at: '2026-03-10T12:00:00.000Z',
      },
    ],
    recentAudit: [],
    now,
  });

  assert.equal(snapshot.aging.stalePosted, 1);
  assert.equal(snapshot.aging.oldestPostedAge, '2026-03-10T12:00:00.000Z');
  const agingSignal = snapshot.health.find(
    (s) => s.component === 'api' && s.detail.includes('stale'),
  );
  assert.ok(agingSignal);
  assert.equal(agingSignal.status, 'degraded');
});

test('createSnapshotFromRows aging detects stuck processing outbox rows older than 10min', () => {
  const now = new Date('2026-03-25T12:00:00.000Z');
  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentOutbox: [
      {
        id: 'outbox-stuck',
        pick_id: 'pick-1',
        target: 'discord:canary',
        status: 'processing',
        attempt_count: 1,
        next_attempt_at: null,
        last_error: null,
        payload: {},
        claimed_at: '2026-03-25T11:30:00.000Z', // 30min ago
        claimed_by: 'worker-1',
        idempotency_key: 'key-1',
        created_at: '2026-03-25T11:00:00.000Z',
        updated_at: '2026-03-25T11:30:00.000Z',
      },
    ],
    recentReceipts: [],
    recentRuns: [],
    recentPicks: [],
    recentAudit: [],
    now,
  });

  assert.equal(snapshot.aging.staleProcessing, 1);
  const workerSignal = snapshot.health.find(
    (s) => s.component === 'worker' && s.detail.includes('stuck in processing'),
  );
  assert.ok(workerSignal, 'Expected degraded worker signal for stuck processing outbox');
  assert.equal(workerSignal.status, 'degraded');
});

test('GET /api/operator/intelligence-coverage returns burn-in enrichment aggregates', async () => {
  // Use relative dates so picks stay within the 7d window regardless of when this runs
  const d = (offsetHours: number) => new Date(Date.now() - offsetHours * 60 * 60 * 1000).toISOString();
  const provider = createAggregateProvider({
    picks: [
      {
        id: 'pick-1',
        created_at: d(50),
        odds: -110,
        metadata: {
          domainAnalysis: {
            realEdge: 0.06,
            realEdgeSource: 'pinnacle',
          },
          deviggingResult: { impliedProbability: 0.54 },
          kellySizing: { kellyFraction: 0.03 },
        },
      },
      {
        id: 'pick-2',
        created_at: d(49),
        odds: -120,
        metadata: {
          domainAnalysis: {
            confidenceDelta: 0.08,
            realEdgeSource: 'confidence-delta',
          },
        },
      },
      {
        id: 'pick-3',
        created_at: d(48),
        odds: null,
        metadata: {},
      },
    ],
    settlement_records: [
      {
        id: 'settlement-1',
        created_at: d(47),
        status: 'settled',
        payload: { clvRaw: 0.12 },
      },
      {
        id: 'settlement-2',
        created_at: d(46),
        status: 'settled',
        payload: {},
      },
    ],
  });
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/intelligence-coverage?window=7d');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      window: string;
      totalPicks: number;
      picksWithOdds: number;
      domainAnalysis: { count: number; rate: number };
      deviggingResult: { count: number; rate: number };
      kellySizing: { count: number; rate: number };
      realEdge: { count: number; rate: number };
      edgeSourceDistribution: Record<string, number>;
      clvCoverage: { settledPicks: number; withClv: number; rate: number };
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.window, '7d');
  assert.equal(body.data.totalPicks, 3);
  assert.equal(body.data.picksWithOdds, 2);
  assert.equal(body.data.domainAnalysis.count, 2);
  assert.equal(body.data.domainAnalysis.rate, 1);
  assert.equal(body.data.deviggingResult.count, 1);
  assert.equal(body.data.kellySizing.count, 1);
  assert.equal(body.data.realEdge.count, 1);
  assert.equal(body.data.edgeSourceDistribution.realEdge, 1);
  assert.equal(body.data.edgeSourceDistribution.confidenceDelta, 1);
  assert.equal(body.data.edgeSourceDistribution.unknown, 1);
  assert.equal(body.data.clvCoverage.settledPicks, 2);
  assert.equal(body.data.clvCoverage.withClv, 1);
  assert.equal(body.data.clvCoverage.rate, 0.5);
});

test('GET /api/operator/provider-health returns provider freshness and quota truth', async () => {
  const now = Date.now();
  const provider = createAggregateProvider({
    provider_offers: [
      {
        provider_key: 'sgo',
        created_at: new Date(now - 10 * 60 * 1000).toISOString(),
        snapshot_at: new Date(now - 5 * 60 * 1000).toISOString(),
        provider_event_id: 'event-1',
      },
      {
        provider_key: 'sgo',
        created_at: new Date(now - 20 * 60 * 1000).toISOString(),
        snapshot_at: new Date(now - 15 * 60 * 1000).toISOString(),
        provider_event_id: 'event-2',
      },
      {
        provider_key: 'odds-api:pinnacle',
        created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        snapshot_at: new Date(now - 90 * 60 * 1000).toISOString(),
        provider_event_id: 'event-1',
      },
    ],
  });
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/provider-health');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      providers: Array<{
        providerKey: string;
        totalRows: number;
        last24hRows: number;
        status: string;
        latestSnapshotAt: string | null;
      }>;
      ingestorHealth: { status: string; lastRunAt: string | null };
      quotaSummary: {
        sgo: { creditsUsed: number; creditsRemaining: number | null } | null;
        oddsApi: { creditsUsed: number; creditsRemaining: number | null } | null;
      };
      distinctEventsLast24h: number;
    };
  };

  assert.equal(body.ok, true);
  const sgoRow = body.data.providers.find((row) => row.providerKey === 'sgo');
  const oddsRow = body.data.providers.find((row) => row.providerKey === 'odds-api:pinnacle');
  assert.ok(sgoRow);
  assert.equal(sgoRow?.totalRows, 2);
  assert.equal(sgoRow?.last24hRows, 2);
  assert.equal(sgoRow?.status, 'active');
  assert.ok(oddsRow);
  assert.equal(oddsRow?.status, 'stale');
  assert.equal(body.data.distinctEventsLast24h, 2);
  assert.equal(typeof body.data.ingestorHealth.status, 'string');
  assert.ok(body.data.quotaSummary.sgo === null || typeof body.data.quotaSummary.sgo.creditsUsed === 'number');
});

test('GET /api/operator/exception-queues surfaces missing canonical market and book alias review counts', async () => {
  const provider = createAggregateProvider({
    provider_offers: [
      {
        provider_key: 'odds-api:fanatics',
        provider_market_key: 'points-assists-all-game-ou',
        created_at: '2026-04-02T03:00:00.000Z',
      },
      {
        provider_key: 'odds-api:fanatics',
        provider_market_key: 'points-assists-all-game-ou',
        created_at: '2026-04-02T04:00:00.000Z',
      },
      {
        provider_key: 'sgo',
        provider_market_key: 'points-all-game-ou',
        created_at: '2026-04-02T05:00:00.000Z',
      },
    ],
    provider_book_aliases: [
      {
        provider: 'sgo',
        provider_book_key: 'sgo',
      },
    ],
    provider_market_aliases: [
      {
        provider: 'sgo',
        provider_market_key: 'points-all-game-ou',
        sport_id: 'NBA',
      },
    ],
  });
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/exception-queues');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      counts: {
        missingBookAliases: number;
        missingMarketAliases: number;
      };
      missingBookAliases: Array<{ provider: string; providerBookKey: string; occurrences: number }>;
      missingMarketAliases: Array<{ provider: string; providerMarketKey: string; occurrences: number }>;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.counts.missingBookAliases, 1);
  assert.equal(body.data.counts.missingMarketAliases, 1);
  assert.deepEqual(body.data.missingBookAliases[0], {
    provider: 'odds-api',
    providerBookKey: 'fanatics',
    occurrences: 2,
    latestSeenAt: '2026-04-02T04:00:00.000Z',
  });
  assert.deepEqual(body.data.missingMarketAliases[0], {
    provider: 'odds-api',
    providerMarketKey: 'points-assists-all-game-ou',
    occurrences: 2,
    latestSeenAt: '2026-04-02T04:00:00.000Z',
  });
});

test('GET /api/operator/exception-queues surfaces awaiting_approval lifecycle drift and stale rows', async () => {
  const provider = createAggregateProvider({
    picks: [
      {
        id: 'pick-awaiting-missing-lifecycle',
        status: 'awaiting_approval',
        source: 'system-pick-scanner',
        market: 'NBA Spread',
        selection: 'Knicks -4.5',
        created_at: '2026-04-10T10:00:00.000Z',
      },
      {
        id: 'pick-awaiting-mismatched-lifecycle',
        status: 'awaiting_approval',
        source: 'alert-agent',
        market: 'NBA Total',
        selection: 'Over 228.5',
        created_at: '2026-04-10T17:00:00.000Z',
      },
      {
        id: 'pick-awaiting-healthy',
        status: 'awaiting_approval',
        source: 'system-pick-scanner',
        market: 'NBA Moneyline',
        selection: 'Knicks ML',
        created_at: '2026-04-10T19:30:00.000Z',
      },
    ],
    pick_lifecycle: [
      {
        id: 'lifecycle-1',
        pick_id: 'pick-awaiting-mismatched-lifecycle',
        from_state: 'validated',
        to_state: 'awaiting_approval',
        created_at: '2026-04-10T17:00:00.000Z',
      },
      {
        id: 'lifecycle-2',
        pick_id: 'pick-awaiting-mismatched-lifecycle',
        from_state: 'awaiting_approval',
        to_state: 'queued',
        created_at: '2026-04-10T17:30:00.000Z',
      },
      {
        id: 'lifecycle-3',
        pick_id: 'pick-awaiting-healthy',
        from_state: 'validated',
        to_state: 'awaiting_approval',
        created_at: '2026-04-10T19:30:00.000Z',
      },
    ],
  });
  const realNow = Date.now;
  Date.now = () => new Date('2026-04-10T20:00:00.000Z').getTime();
  const server = createOperatorServer({ provider });

  try {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server address');
    }

    const response = await makeRequest(address.port, '/api/operator/exception-queues');

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      ok: boolean;
      data: {
        counts: {
          awaitingApprovalDrift: number;
          awaitingApprovalStale: number;
        };
        awaitingApprovalDrift: Array<{
          id: string;
          stale: boolean;
          missingLifecycleEvidence: boolean;
          lifecycleMismatch: boolean;
          latestLifecycleToState: string | null;
        }>;
      };
    };

    assert.equal(body.ok, true);
    assert.equal(body.data.counts.awaitingApprovalDrift, 2);
    assert.equal(body.data.counts.awaitingApprovalStale, 1);
    assert.deepEqual(
      body.data.awaitingApprovalDrift.map((row) => row.id),
      ['pick-awaiting-missing-lifecycle', 'pick-awaiting-mismatched-lifecycle'],
    );
    assert.equal(body.data.awaitingApprovalDrift[0]?.missingLifecycleEvidence, true);
    assert.equal(body.data.awaitingApprovalDrift[0]?.stale, true);
    assert.equal(body.data.awaitingApprovalDrift[1]?.lifecycleMismatch, true);
    assert.equal(body.data.awaitingApprovalDrift[1]?.latestLifecycleToState, 'queued');
  } finally {
    Date.now = realNow;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('GET /api/operator/picks/:id returns canonical submittedBy from submission identity', async () => {
  const provider = createAggregateProvider({
    picks: [
      {
        id: 'pick-detail-1',
        submission_id: 'submission-detail-1',
        source: 'smart-form',
        market: 'points-all-game-ou',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -120,
        stake_units: 2,
        status: 'posted',
        approval_status: 'approved',
        promotion_status: 'qualified',
        promotion_target: 'best-bets',
        promotion_score: 81,
        posted_at: '2026-04-02T18:00:00.000Z',
        settled_at: null,
        created_at: '2026-04-02T17:55:00.000Z',
        metadata: {
          capper: 'griff843',
        },
      },
    ],
    submissions: [
      {
        id: 'submission-detail-1',
        submitted_by: 'griff843',
        payload: {
          submittedBy: 'griff843',
        },
        created_at: '2026-04-02T17:54:00.000Z',
      },
    ],
    pick_lifecycle: [],
    pick_promotion_history: [],
    distribution_outbox: [],
    settlement_records: [],
    audit_log: [],
    distribution_receipts: [],
  });
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/picks/pick-detail-1');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      pick: {
        submittedBy: string | null;
        source: string;
      };
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.pick.submittedBy, 'griff843');
  assert.equal(body.data.pick.source, 'smart-form');
});

test('GET /api/operator/picks/:id marks settlement rows with CLV presence', async () => {
  const provider = createAggregateProvider({
    picks: [
      {
        id: 'pick-detail-clv',
        submission_id: 'submission-detail-clv',
        source: 'smart-form',
        market: 'points-all-game-ou',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -120,
        stake_units: 2,
        status: 'settled',
        approval_status: 'approved',
        promotion_status: 'qualified',
        promotion_target: 'best-bets',
        promotion_score: 81,
        posted_at: '2026-04-02T18:00:00.000Z',
        settled_at: '2026-04-02T19:00:00.000Z',
        created_at: '2026-04-02T17:55:00.000Z',
        metadata: {},
      },
    ],
    submissions: [
      {
        id: 'submission-detail-clv',
        submitted_by: 'griff843',
        payload: {},
        created_at: '2026-04-02T17:54:00.000Z',
      },
    ],
    pick_lifecycle: [],
    pick_promotion_history: [],
    distribution_outbox: [],
    settlement_records: [
      {
        id: 'settlement-clv',
        pick_id: 'pick-detail-clv',
        result: 'win',
        status: 'settled',
        confidence: 'confirmed',
        evidence_ref: null,
        corrects_id: null,
        settled_by: 'grader',
        settled_at: '2026-04-02T19:00:00.000Z',
        created_at: '2026-04-02T19:00:00.000Z',
        payload: {
          clvRaw: 0.11,
        },
      },
    ],
    audit_log: [],
    distribution_receipts: [],
  });
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/picks/pick-detail-clv');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      settlements: Array<{
        hasClv: boolean;
      }>;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.settlements[0]?.hasClv, true);
});

test('GET /api/operator/pick-search surfaces submitter separately from intake source', async () => {
  const provider = createAggregateProvider({
    picks: [
      {
        id: 'pick-search-1',
        submission_id: 'submission-search-1',
        source: 'smart-form',
        market: 'points-all-game-ou',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -110,
        stake_units: 1.5,
        status: 'posted',
        approval_status: 'approved',
        promotion_status: 'qualified',
        promotion_target: 'best-bets',
        promotion_score: 79,
        created_at: '2026-04-02T18:00:00.000Z',
        metadata: {
          sport: 'NBA',
          capper: 'griff843',
        },
      },
    ],
    submissions: [
      {
        id: 'submission-search-1',
        submitted_by: 'griff843',
        payload: {
          submittedBy: 'griff843',
        },
      },
    ],
  });
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/pick-search?capper=griff&sport=NBA');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      total: number;
      picks: Array<{
        source: string;
        submitter: string | null;
        sport: string | null;
      }>;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.picks[0]?.source, 'smart-form');
  assert.equal(body.data.picks[0]?.submitter, 'griff843');
  assert.equal(body.data.picks[0]?.sport, 'NBA');
});

test('GET /api/operator/review-queue includes awaiting_approval picks and excludes held rows', async () => {
  const provider = createAggregateProvider({
    picks: [
      {
        id: 'pick-awaiting-review',
        status: 'awaiting_approval',
        approval_status: 'pending',
        source: 'system-pick-scanner',
        market: 'NBA Spread',
        selection: 'Knicks -4.5',
        promotion_score: 81.2,
        created_at: '2026-04-10T18:00:00.000Z',
      },
      {
        id: 'pick-held-awaiting',
        status: 'awaiting_approval',
        approval_status: 'pending',
        source: 'alert-agent',
        market: 'NBA Total',
        selection: 'Over 228.5',
        promotion_score: 74.1,
        created_at: '2026-04-10T17:00:00.000Z',
      },
      {
        id: 'pick-legacy-pending',
        status: 'validated',
        approval_status: 'pending',
        source: 'smart-form',
        market: 'NBA Moneyline',
        selection: 'Knicks ML',
        promotion_score: 69.5,
        created_at: '2026-04-10T16:00:00.000Z',
      },
    ],
    pick_reviews: [
      {
        id: 'review-held',
        pick_id: 'pick-held-awaiting',
        decision: 'hold',
        reason: 'Need confirmation',
        decided_by: 'operator',
        decided_at: '2026-04-10T18:15:00.000Z',
      },
    ],
  });
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/review-queue');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      total: number;
      picks: Array<{ id: string; governanceQueueState: string }>;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.total, 2);
  assert.deepEqual(
    body.data.picks.map((pick) => pick.id),
    ['pick-awaiting-review', 'pick-legacy-pending'],
  );
  assert.equal(body.data.picks[0]?.governanceQueueState, 'awaiting_approval');
  assert.equal(body.data.picks[1]?.governanceQueueState, 'pending_review');
});

test('GET /api/operator/held-queue includes held awaiting_approval picks', async () => {
  const provider = createAggregateProvider({
    picks: [
      {
        id: 'pick-held-awaiting',
        status: 'awaiting_approval',
        approval_status: 'pending',
        source: 'system-pick-scanner',
        market: 'NBA Total',
        selection: 'Over 228.5',
        promotion_score: 74.1,
        created_at: '2026-04-10T17:00:00.000Z',
      },
    ],
    pick_reviews: [
      {
        id: 'review-held',
        pick_id: 'pick-held-awaiting',
        decision: 'hold',
        reason: 'Need confirmation',
        decided_by: 'operator',
        decided_at: '2026-04-10T18:15:00.000Z',
      },
    ],
  });
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/held-queue');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      total: number;
      picks: Array<{ id: string; governanceQueueState: string; holdReason: string }>;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.picks[0]?.id, 'pick-held-awaiting');
  assert.equal(body.data.picks[0]?.governanceQueueState, 'awaiting_approval');
  // holdReason is not available from picks_current_state view (no reason column);
  // the field is preserved as null for backward-compatible shape.
  assert.equal(body.data.picks[0]?.holdReason, null);
});

function createAggregateProvider(tables: Record<string, Array<Record<string, unknown>>>): OperatorSnapshotProvider {
  return {
    ...createStaticProvider(),
    _supabaseClient: createMockSupabaseClient(tables),
  };
}

function createMockSupabaseClient(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const rows =
        table === 'picks_current_state' && !tables[table]
          ? buildPicksCurrentStateRows(tables)
          : (tables[table] ?? []);
      return new MockSupabaseQuery(rows);
    },
  };
}

function buildPicksCurrentStateRows(tables: Record<string, Array<Record<string, unknown>>>) {
  const promotionByPick = new Map<string, Record<string, unknown>>();
  for (const row of [...(tables['pick_promotion_history'] ?? [])].reverse()) {
    const pickId = row['pick_id'];
    if (typeof pickId === 'string' && !promotionByPick.has(pickId)) {
      promotionByPick.set(pickId, row);
    }
  }

  const settlementByPick = new Map<string, Record<string, unknown>>();
  for (const row of [...(tables['settlement_records'] ?? [])].reverse()) {
    const pickId = row['pick_id'];
    if (typeof pickId === 'string' && !settlementByPick.has(pickId)) {
      settlementByPick.set(pickId, row);
    }
  }

  const reviewByPick = new Map<string, Record<string, unknown>>();
  for (const row of [...(tables['pick_reviews'] ?? [])].reverse()) {
    const pickId = row['pick_id'];
    if (typeof pickId === 'string' && !reviewByPick.has(pickId)) {
      reviewByPick.set(pickId, row);
    }
  }

  return (tables['picks'] ?? []).map((pick) => {
    const metadata =
      typeof pick['metadata'] === 'object' &&
      pick['metadata'] !== null &&
      !Array.isArray(pick['metadata'])
        ? (pick['metadata'] as Record<string, unknown>)
        : {};
    const pickId = typeof pick['id'] === 'string' ? pick['id'] : null;
    const promotion = pickId ? promotionByPick.get(pickId) ?? null : null;
    const settlement = pickId ? settlementByPick.get(pickId) ?? null : null;
    const review = pickId ? reviewByPick.get(pickId) ?? null : null;

    return {
      ...pick,
      capper_display_name:
        typeof metadata['capper'] === 'string' ? metadata['capper'] : null,
      sport_id: typeof metadata['sport'] === 'string' ? metadata['sport'] : null,
      sport_display_name:
        typeof metadata['sport'] === 'string' ? metadata['sport'] : null,
      market_type_display_name: null,
      promotion_status_current:
        typeof promotion?.['status'] === 'string' ? promotion['status'] : null,
      promotion_target_current:
        typeof promotion?.['target'] === 'string' ? promotion['target'] : null,
      promotion_score_current:
        typeof promotion?.['score'] === 'number' ? promotion['score'] : null,
      promotion_decided_at_current:
        typeof promotion?.['decided_at'] === 'string' ? promotion['decided_at'] : null,
      settlement_result:
        typeof settlement?.['result'] === 'string' ? settlement['result'] : null,
      settlement_status:
        typeof settlement?.['status'] === 'string' ? settlement['status'] : null,
      settlement_source:
        typeof settlement?.['source'] === 'string' ? settlement['source'] : null,
      settlement_recorded_at:
        typeof settlement?.['created_at'] === 'string' ? settlement['created_at'] : null,
      review_decision:
        typeof review?.['decision'] === 'string' ? review['decision'] : null,
      review_decided_by:
        typeof review?.['decided_by'] === 'string' ? review['decided_by'] : null,
      review_decided_at:
        typeof review?.['decided_at'] === 'string' ? review['decided_at'] : null,
    };
  });
}

class MockSupabaseQuery {
  private readonly rows: Array<Record<string, unknown>>;
  private filters: Array<(row: Record<string, unknown>) => boolean> = [];
  private sortField: string | null = null;
  private sortAscending = true;
  private resultLimit: number | null = null;
  private rangeStart: number | null = null;
  private rangeEnd: number | null = null;

  constructor(rows: Array<Record<string, unknown>>) {
    this.rows = rows.map((row) => ({ ...row }));
  }

  select() {
    return this;
  }

  single() {
    const { data, error } = this.execute();
    return Promise.resolve({
      data: data[0] ?? null,
      error: error ?? (data.length === 0 ? { message: 'Row not found' } : null),
    });
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  gte(field: string, value: unknown) {
    this.filters.push((row) => compareSortable(row[field], value) >= 0);
    return this;
  }

  lte(field: string, value: unknown) {
    this.filters.push((row) => compareSortable(row[field], value) <= 0);
    return this;
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]));
    return this;
  }

  ilike(field: string, pattern: string) {
    const needle = pattern.replaceAll('%', '').toLowerCase();
    this.filters.push((row) => String(row[field] ?? '').toLowerCase().includes(needle));
    return this;
  }

  or(expression: string) {
    const clauses = expression
      .split(',')
      .map((clause) => clause.trim())
      .filter((clause) => clause.length > 0)
      .map((clause) => {
        const parts = clause.split('.');
        const field = parts[0] ?? '';
        const operator = parts[1] ?? '';
        const value = parts.slice(2).join('.');
        return { field, operator, value };
      });

    this.filters.push((row) =>
      clauses.some(({ field, operator, value }) => {
        if (operator === 'eq') {
          return String(row[field] ?? '') === value;
        }
        if (operator === 'ilike') {
          const needle = value.replaceAll('%', '').toLowerCase();
          return String(row[field] ?? '').toLowerCase().includes(needle);
        }
        return false;
      }),
    );
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.sortField = field;
    this.sortAscending = options?.ascending ?? true;
    return this;
  }

  limit(limit: number) {
    this.resultLimit = limit;
    return this;
  }

  range(from: number, to: number) {
    this.rangeStart = from;
    this.rangeEnd = to;
    return this;
  }

  then<TResult1 = { data: Array<Record<string, unknown>>; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Array<Record<string, unknown>>; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    let rows = [...this.rows];
    for (const filter of this.filters) {
      rows = rows.filter(filter);
    }

    if (this.sortField) {
      const field = this.sortField;
      const direction = this.sortAscending ? 1 : -1;
      rows.sort((left, right) => compareSortable(left[field], right[field]) * direction);
    }

    if (this.resultLimit != null) {
      rows = rows.slice(0, this.resultLimit);
    }

    if (this.rangeStart != null && this.rangeEnd != null) {
      rows = rows.slice(this.rangeStart, this.rangeEnd + 1);
    }

    return { data: rows, error: null };
  }
}

// ---------------------------------------------------------------------------
// Board-state overlay tests (UTV2-444)
// ---------------------------------------------------------------------------

test('GET /api/operator/board-state returns empty board state when no DB client', async () => {
  const provider = createStaticProvider();
  const server = createOperatorServer({ provider });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/api/operator/board-state');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);

  const body = JSON.parse(response.body) as {
    ok: boolean;
    data: {
      slate: { current: number };
      scoreBreakdowns: unknown[];
      conflictCards: unknown[];
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.slate.current, 0);
  assert.deepEqual(body.data.scoreBreakdowns, []);
  assert.deepEqual(body.data.conflictCards, []);
});

function compareSortable(left: unknown, right: unknown) {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  const leftValue = left == null ? '' : String(left);
  const rightValue = right == null ? '' : String(right);
  return leftValue.localeCompare(rightValue);
}
