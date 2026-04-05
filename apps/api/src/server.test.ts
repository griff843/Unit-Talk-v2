import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiRuntimeDependencies, createApiServer } from './server.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processShadowSubmission, processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { enqueueDistributionWithRunTracking } from './run-audit-service.js';

test('GET /health returns degraded 503 when using in-memory repositories', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = (await response.json()) as {
      status: string;
      service: string;
      persistenceMode: string;
      runtimeMode: string;
      dbReachable: boolean;
    };

    assert.equal(response.status, 503);
    assert.equal(body.status, 'degraded');
    assert.equal(body.service, 'api');
    assert.equal(body.persistenceMode, 'in_memory');
    assert.equal(body.dbReachable, false);
  } finally {
    server.close();
  }
});

test('GET /health response body includes persistence mode indicators', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    // All required persistence indicators must be present
    assert.ok('status' in body, 'response must include status');
    assert.ok('persistenceMode' in body, 'response must include persistenceMode');
    assert.ok('dbReachable' in body, 'response must include dbReachable');
    assert.ok('runtimeMode' in body, 'response must include runtimeMode');
  } finally {
    server.close();
  }
});

test('GET /health uses a valid UUID probe when persistenceMode is database', async () => {
  const repositories = createInMemoryRepositoryBundle();
  let probedPickId: string | null = null;
  repositories.picks.findPickById = async (pickId: string) => {
    probedPickId = pickId;
    return null;
  };

  const runtime = createApiRuntimeDependencies({ repositories });
  runtime.persistenceMode = 'database';
  const server = createApiServer({ runtime });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = (await response.json()) as {
      status: string;
      dbReachable: boolean;
    };

    assert.equal(response.status, 200);
    assert.equal(body.status, 'healthy');
    assert.equal(body.dbReachable, true);
    assert.equal(probedPickId, '00000000-0000-0000-0000-000000000000');
  } finally {
    server.close();
  }
});

test('POST /api/submissions returns created submission payload', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/submissions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source: 'api',
        market: 'NBA points',
        selection: 'Player Over 18.5',
      }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        pickId: string;
        lifecycleState: string;
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.ok(body.data?.pickId);
    assert.equal(body.data?.lifecycleState, 'validated');
  } finally {
    server.close();
  }
});

test('GET /api/alerts/recent returns empty state when no detections exist', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/alerts/recent`);
    const body = (await response.json()) as {
      detections: unknown[];
      total: number;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      detections: [],
      total: 0,
    });
  } finally {
    server.close();
  }
});

test('GET /api/alerts/status returns env-backed status and recent counts', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const currentSnapshotAt = new Date().toISOString();
  const baselineSnapshotAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await repositories.alertDetections.saveDetection({
    idempotencyKey: 'status-notable',
    eventId: 'event-1',
    participantId: null,
    marketKey: 'totals/nba',
    bookmakerKey: 'draftkings',
    baselineSnapshotAt,
    currentSnapshotAt,
    oldLine: 224.5,
    newLine: 226,
    lineChange: 1.5,
    lineChangeAbs: 1.5,
    velocity: 0.05,
    timeElapsedMinutes: 30,
    direction: 'up',
    marketType: 'total',
    tier: 'notable',
    steamDetected: false,
    metadata: {},
  });
  const failedDetection = await repositories.alertDetections.saveDetection({
    idempotencyKey: 'status-failed',
    eventId: 'event-2',
    participantId: null,
    marketKey: 'spreads/nba',
    bookmakerKey: 'fanduel',
    baselineSnapshotAt,
    currentSnapshotAt,
    oldLine: 4.5,
    newLine: 7,
    lineChange: 2.5,
    lineChangeAbs: 2.5,
    velocity: 0.083,
    timeElapsedMinutes: 30,
    direction: 'up',
    marketType: 'spread',
    tier: 'alert-worthy',
    steamDetected: true,
    metadata: {},
    notified: false,
  });
  assert.ok(failedDetection);
  await repositories.audit.record({
    entityType: 'alert_notification',
    entityId: failedDetection.id,
    entityRef: failedDetection.id,
    action: 'notify_attempt',
    actor: 'system:test',
    payload: {
      attempt: 3,
      statusCode: 500,
      error: 'discord returned 500',
    },
  });

  const previousEnabled = process.env.ALERT_AGENT_ENABLED;
  const previousDryRun = process.env.ALERT_DRY_RUN;
  const previousMinTier = process.env.ALERT_MIN_TIER;
  const previousLookback = process.env.ALERT_LOOKBACK_MINUTES;
  const previousSystemPicks = process.env.SYSTEM_PICKS_ENABLED;
  process.env.ALERT_AGENT_ENABLED = 'false';
  process.env.ALERT_DRY_RUN = 'false';
  process.env.ALERT_MIN_TIER = 'alert-worthy';
  process.env.ALERT_LOOKBACK_MINUTES = '120';
  process.env.SYSTEM_PICKS_ENABLED = 'true';

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/alerts/status`);
    const body = (await response.json()) as {
      enabled: boolean;
      dryRun: boolean;
      systemPicksEnabled: boolean;
      effectiveMode: 'disabled' | 'dry-run' | 'live';
      minTier: string;
      lookbackMinutes: number;
      activeSports: string[];
      systemPickEligibleMarketTypes: string[];
      systemPickBlockedMarketTypes: string[];
      last1h: {
        notable: number;
        alertWorthy: number;
        notified: number;
        failedDeliveries: number;
        steamEvents: number;
      };
      lastDetectedAt: string | null;
    };

    assert.equal(response.status, 200);
    assert.equal(body.enabled, false);
    assert.equal(body.dryRun, false);
    assert.equal(body.systemPicksEnabled, true);
    assert.equal(body.effectiveMode, 'disabled');
    assert.equal(body.minTier, 'alert-worthy');
    assert.equal(body.lookbackMinutes, 120);
    assert.deepEqual(body.activeSports, ['NBA', 'NHL', 'MLB']);
    assert.deepEqual(body.systemPickEligibleMarketTypes, ['moneyline', 'spread', 'total']);
    assert.deepEqual(body.systemPickBlockedMarketTypes, ['player_prop']);
    assert.equal(body.last1h.notable, 1);
    assert.equal(body.last1h.alertWorthy, 1);
    assert.equal(body.last1h.notified, 0);
    assert.equal(body.last1h.failedDeliveries, 1);
    assert.equal(body.last1h.steamEvents, 1);
    assert.equal(body.lastDetectedAt, currentSnapshotAt);
  } finally {
    server.close();
    restoreEnv('ALERT_AGENT_ENABLED', previousEnabled);
    restoreEnv('ALERT_DRY_RUN', previousDryRun);
    restoreEnv('ALERT_MIN_TIER', previousMinTier);
    restoreEnv('ALERT_LOOKBACK_MINUTES', previousLookback);
    restoreEnv('SYSTEM_PICKS_ENABLED', previousSystemPicks);
  }
});

test('GET /api/alerts/signal-quality returns insufficient-data empty state when no settled alert-agent picks exist', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/alerts/signal-quality`);
    const body = (await response.json()) as {
      periods: Record<string, { count: number; sufficientSample: boolean; avgClvPct: number | null; winRate: number | null }>;
      bySport: Record<string, unknown>;
      insufficientData: boolean;
      minimumSampleRequired: number;
      dataGaps: string[];
    };

    assert.equal(response.status, 200);
    assert.equal(body.periods['30d']?.count, 0);
    assert.equal(body.periods['30d']?.sufficientSample, false);
    assert.equal(body.periods['30d']?.avgClvPct, null);
    assert.equal(body.periods['30d']?.winRate, null);
    assert.deepEqual(body.bySport, {});
    assert.equal(body.insufficientData, true);
    assert.equal(body.minimumSampleRequired, 10);
    assert.deepEqual(body.dataGaps, [
      'rlm_public_money_pct_not_available',
      'sharp_book_classification_requires_longitudinal_first_mover_data',
    ]);
  } finally {
    server.close();
  }
});

test('GET /api/alerts/signal-quality returns aggregated alert-agent CLV and bySport metrics', async () => {
  const repositories = createInMemoryRepositoryBundle();
  for (let index = 0; index < 10; index += 1) {
    await createSettledAlertAgentPick(repositories, {
      selection: `NBA signal ${index}`,
      sport: 'NBA',
      settledAt: `2026-03-${String(index + 10).padStart(2, '0')}T12:00:00.000Z`,
      result: index < 7 ? 'win' : 'loss',
      clvPercent: 2,
    });
  }
  await createSettledAlertAgentPick(repositories, {
    selection: 'MLB signal',
    sport: 'MLB',
    settledAt: '2026-03-15T12:00:00.000Z',
    result: 'push',
    clvPercent: 1,
  });

  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/alerts/signal-quality`);
    const body = (await response.json()) as {
      periods: Record<string, { count: number; avgClvPct: number | null; winRate: number | null; sufficientSample: boolean }>;
      bySport: Record<string, { count: number; avgClvPct: number | null; winRate: number | null }>;
      insufficientData: boolean;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(body.periods['30d'], {
      count: 11,
      avgClvPct: 1.9091,
      winRate: 0.6364,
      sufficientSample: true,
    });
    assert.deepEqual(body.bySport, {
      MLB: {
        count: 1,
        avgClvPct: null,
        winRate: null,
      },
      NBA: {
        count: 10,
        avgClvPct: 2,
        winRate: 0.7,
      },
    });
    assert.equal(body.insufficientData, false);
  } finally {
    server.close();
  }
});

test('GET /api/shadow-models/summary returns grouped model-driven shadow outcomes', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const first = await processShadowSubmission(
    {
      source: 'model-driven',
      market: 'NBA spread',
      selection: 'Knicks -4.5',
      confidence: 0.82,
      eventName: 'Knicks vs Celtics',
      metadata: {
        sport: 'NBA',
        modelName: 'nba-spread-shadow',
      },
    },
    repositories,
  );

  await repositories.settlements.record({
    pickId: first.pick.id,
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: 'shadow://route-test',
    settledBy: 'server-test',
    settledAt: '2026-04-03T19:15:00.000Z',
    payload: {},
  });

  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/shadow-models/summary`);
    const body = (await response.json()) as {
      summaries: Array<{
        modelName: string;
        sport: string | null;
        wins: number;
        settledPredictions: number;
      }>;
      count: number;
    };

    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.summaries[0]?.modelName, 'nba-spread-shadow');
    assert.equal(body.summaries[0]?.sport, 'NBA');
    assert.equal(body.summaries[0]?.wins, 1);
    assert.equal(body.summaries[0]?.settledPredictions, 1);
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/settle settles a posted pick', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    {
      source: 'api',
      market: 'NBA rebounds',
      selection: 'Player Over 10.5',
    },
    repositories,
  );
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'posted',
    'posted',
    'poster',
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/settle`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'boxscore://server-test',
          settledBy: 'operator',
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        settlementStatus: string;
        finalLifecycleState: string;
        downstream: {
          effectiveSettlementResult: string | null;
          totalRecords: number;
          lossAttributionClassification: string | null;
        };
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.data?.settlementStatus, 'settled');
    assert.equal(body.data?.finalLifecycleState, 'settled');
    assert.equal(body.data?.downstream.effectiveSettlementResult, 'win');
    assert.equal(body.data?.downstream.totalRecords, 1);
    assert.equal(body.data?.downstream.lossAttributionClassification, null);
  } finally {
    server.close();
  }
});

test('GET /api/reference-data/catalog returns full catalog', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/reference-data/catalog`);
    const body = (await response.json()) as {
      ok: boolean;
        data?: {
          sports: { id: string; name: string; marketTypes: string[]; statTypes: string[]; teams: string[] }[];
          sportsbooks: { id: string; name: string }[];
          cappers: { id: string; displayName: string }[];
          ticketTypes: { id: string; name: string; enabled: boolean }[];
        };
      };

    assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.ok(body.data);
      assert.equal(body.data.sports.length, 9);
      assert.equal(body.data.sportsbooks.length, 10);
      assert.ok(body.data.sportsbooks.some((sportsbook) => sportsbook.id === 'fanatics'));
      assert.ok(!body.data.sportsbooks.some((sportsbook) => sportsbook.id === 'williamhill'));
      assert.ok(!body.data.sportsbooks.some((sportsbook) => sportsbook.id === 'sgo'));
      assert.ok(body.data.cappers.some((capper) => capper.id === 'griff843'));

    const nba = body.data.sports.find((s) => s.id === 'NBA');
    assert.ok(nba);
    assert.ok(nba.marketTypes.includes('player-prop'));
    assert.ok(nba.statTypes.includes('Points'));
    assert.ok(nba.statTypes.includes('Points + Rebounds + Assists'));
    assert.equal(nba.teams.length, 30);
  } finally {
    server.close();
  }
});

test('GET /api/reference-data/search/teams returns matching teams', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/reference-data/search/teams?sport=NBA&q=Kni`,
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { displayName: string }[];
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data);
    assert.ok(body.data.length > 0);
    assert.ok(body.data.some((t) => t.displayName === 'Knicks'));
  } finally {
    server.close();
  }
});

test('GET /api/reference-data/leagues returns canonical leagues for a sport', async () => {
  const repositories = createInMemoryRepositoryBundle();
  repositories.referenceData = {
    ...repositories.referenceData,
    async listLeagues(sportId: string) {
      return sportId === 'NBA'
        ? [{ id: 'nba', sportId: 'NBA', displayName: 'NBA' }]
        : [];
    },
    async listMatchups() {
      return [];
    },
    async getEventBrowse() {
      return null;
    },
  };

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/reference-data/leagues?sport=NBA`,
    );
    const body = (await response.json()) as { ok: boolean; data?: Array<{ id: string; sportId: string }> };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, [{ id: 'nba', sportId: 'NBA', displayName: 'NBA' }]);
  } finally {
    server.close();
  }
});

test('GET /api/reference-data/matchups returns canonical matchup browse rows', async () => {
  const repositories = createInMemoryRepositoryBundle();
  repositories.referenceData = {
    ...repositories.referenceData,
    async listLeagues() {
      return [];
    },
    async listMatchups(sportId: string, date: string) {
      if (sportId !== 'NBA' || date !== '2026-04-02') {
        return [];
      }
      return [
        {
          eventId: 'event-1',
          externalId: 'NBA_20260402_DEN_UTA',
          eventName: 'Nuggets vs Jazz',
          eventDate: '2026-04-02',
          startTime: null,
          status: 'scheduled',
          sportId: 'NBA',
          leagueId: 'nba',
          teams: [
            { participantId: 'team-uta', teamId: 'nba:jazz', displayName: 'Jazz', role: 'home' as const },
            { participantId: 'team-den', teamId: 'nba:nuggets', displayName: 'Nuggets', role: 'away' as const },
          ],
        },
      ];
    },
    async getEventBrowse() {
      return null;
    },
  };

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/reference-data/matchups?sport=NBA&date=2026-04-02`,
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: Array<{ eventId: string; teams: Array<{ teamId: string | null; role: string }> }>;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.[0]?.eventId, 'event-1');
    assert.equal(body.data?.[0]?.teams[0]?.teamId, 'nba:jazz');
    assert.equal(body.data?.[0]?.teams[1]?.role, 'away');
  } finally {
    server.close();
  }
});

test('GET /api/reference-data/events/:id/browse returns grouped live offers with canonical entities', async () => {
  const repositories = createInMemoryRepositoryBundle();
  repositories.referenceData = {
    ...repositories.referenceData,
    async listLeagues() {
      return [];
    },
    async listMatchups() {
      return [];
    },
    async getEventBrowse(eventId: string) {
      if (eventId !== 'event-1') {
        return null;
      }
      return {
        eventId: 'event-1',
        externalId: 'NBA_20260402_DEN_UTA',
        eventName: 'Nuggets vs Jazz',
        eventDate: '2026-04-02',
        startTime: null,
        status: 'scheduled',
        sportId: 'NBA',
        leagueId: 'nba',
        participants: [
          {
            participantId: 'player-murray',
            canonicalId: 'player-murray',
            participantType: 'player' as const,
            displayName: 'Jamal Murray',
            role: 'competitor',
            teamId: 'nba:nuggets',
            teamName: 'Nuggets',
          },
        ],
        offers: [
          {
            sportsbookId: 'draftkings',
            sportsbookName: 'DraftKings',
            marketTypeId: 'player_assists_ou',
            marketDisplayName: 'Player Assists',
            participantId: 'player-murray',
            participantName: 'Jamal Murray',
            line: 7,
            overOdds: -140,
            underOdds: 110,
            snapshotAt: '2026-04-02T00:00:00.000Z',
            providerKey: 'odds-api:draftkings',
            providerMarketKey: 'assists-all-game-ou',
            providerParticipantId: 'JAMAL_MURRAY_1_NBA',
          },
        ],
      };
    },
  };

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/reference-data/events/event-1/browse`,
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        participants: Array<{ canonicalId: string | null }>;
        offers: Array<{ sportsbookId: string | null; marketTypeId: string | null; participantName: string | null }>;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.participants[0]?.canonicalId, 'player-murray');
    assert.equal(body.data?.offers[0]?.sportsbookId, 'draftkings');
    assert.equal(body.data?.offers[0]?.marketTypeId, 'player_assists_ou');
    assert.equal(body.data?.offers[0]?.participantName, 'Jamal Murray');
  } finally {
    server.close();
  }
});

test('GET /api/reference-data/search returns canonical browse search results with matchup context', async () => {
  const repositories = createInMemoryRepositoryBundle();
  repositories.referenceData = {
    ...repositories.referenceData,
    async searchBrowse(sportId: string, date: string, query: string) {
      if (sportId !== 'NBA' || date !== '2026-04-02' || query !== 'Jam') {
        return [];
      }

      return [
        {
          resultType: 'player' as const,
          participantId: 'player-murray',
          displayName: 'Jamal Murray',
          contextLabel: 'Nuggets · Jazz @ Nuggets · Apr 2, 7:00 PM',
          teamId: 'nba:nuggets',
          teamName: 'Nuggets',
          matchup: {
            eventId: 'event-1',
            externalId: 'NBA_20260402_DEN_UTA',
            eventName: 'Nuggets vs Jazz',
            eventDate: '2026-04-02T23:00:00.000Z',
            startTime: null,
            status: 'scheduled',
            sportId: 'NBA',
            leagueId: 'nba',
            teams: [
              { participantId: 'team-uta', teamId: 'nba:jazz', displayName: 'Jazz', role: 'away' as const },
              { participantId: 'team-den', teamId: 'nba:nuggets', displayName: 'Nuggets', role: 'home' as const },
            ],
          },
        },
      ];
    },
  };

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/reference-data/search?sport=NBA&date=2026-04-02&q=Jam`,
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: Array<{ resultType: string; displayName: string; matchup: { eventId: string } }>;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.[0]?.resultType, 'player');
    assert.equal(body.data?.[0]?.displayName, 'Jamal Murray');
    assert.equal(body.data?.[0]?.matchup.eventId, 'event-1');
  } finally {
    server.close();
  }
});

test('GET /api/reference-data/search/teams returns 400 without sport param', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/reference-data/search/teams?q=Kni`,
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'MISSING_PARAM');
  } finally {
    server.close();
  }
});

test('GET /api/reference-data/search/teams returns 400 for short query', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/reference-data/search/teams?sport=NBA&q=K`,
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'QUERY_TOO_SHORT');
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/settle returns downstream loss attribution when inputs exist', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    {
      source: 'api',
      market: 'NBA rebounds',
      selection: 'Player Over 10.5',
      metadata: {
        lossAttribution: {
          ev: 5.2,
          clvAtBet: -4.2,
          clvAtClose: -4.1,
          hasFeatureSnapshot: true,
        },
      },
    },
    repositories,
  );
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'posted',
    'posted',
    'poster',
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/settle`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'settled',
          result: 'loss',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'boxscore://server-test-loss',
          settledBy: 'operator',
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        downstream: {
          effectiveSettlementResult: string | null;
          lossAttributionClassification: string | null;
        };
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.data?.downstream.effectiveSettlementResult, 'loss');
    assert.equal(
      body.data?.downstream.lossAttributionClassification,
      'PRICE_MISS',
    );
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/requeue returns 404 when pick does not exist', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/missing-pick/requeue`,
      { method: 'POST' },
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'PICK_NOT_FOUND');
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/requeue returns 422 when pick is not qualified', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    {
      source: 'api',
      market: 'NBA points',
      selection: 'Player Over 18.5',
    },
    repositories,
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/requeue`,
      { method: 'POST' },
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    assert.equal(response.status, 422);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'PICK_NOT_QUALIFIED');
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/requeue returns 409 when pick is already queued in outbox', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await createQualifiedPick(repositories);
  await enqueueDistributionWithRunTracking(
    created.pick,
    'discord:best-bets',
    'server-test',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/requeue`,
      { method: 'POST' },
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'ALREADY_QUEUED');
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/requeue returns 409 when pick is already terminal', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await createQualifiedPick(repositories);
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'posted', 'posted', 'poster');
  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'settled',
    'settled',
    'settler',
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/requeue`,
      { method: 'POST' },
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'PICK_TERMINAL');
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/requeue returns 200 and enqueues orphaned qualified pick', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await createQualifiedPick(repositories);

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/requeue`,
      { method: 'POST' },
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { outboxId: string; target: string; pickId: string };
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.pickId, created.pick.id);
    assert.equal(body.data?.target, 'discord:best-bets');
    assert.ok(body.data?.outboxId);

    const claimed = await repositories.outbox.claimNext('discord:best-bets', 'requeue-test');
    assert.ok(claimed, 'expected requeued outbox record');
    assert.equal(claimed?.pick_id, created.pick.id);
  } finally {
    server.close();
  }
});

test('POST /api/recap/post returns ok true and posts a recap embed when settled picks exist', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await createSettledRecapPick(repositories, {
    settledAt: buildYesterdayMiddayIso(),
    selection: 'Over 24.5',
    market: 'points-all-game-ou',
    odds: 150,
    stakeUnits: 1,
    submittedBy: 'griff843',
    result: 'win',
  });

  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  const previousFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody = '';
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify({
    'discord:recaps': '1300411261854547968',
  });
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ id: 'message-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await previousFetch(`http://127.0.0.1:${address.port}/api/recap/post`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ period: 'daily' }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      postsCount?: number;
      channel?: string;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.postsCount, 1);
    assert.equal(body.channel, 'discord:recaps');
    assert.equal(
      capturedUrl,
      'https://discord.com/api/v10/channels/1300411261854547968/messages',
    );

    const payload = JSON.parse(capturedBody) as {
      embeds?: Array<{ title?: string; fields?: Array<{ name: string; value: string }> }>;
    };
    assert.equal(payload.embeds?.[0]?.title?.startsWith('Daily Recap - '), true);
    assert.ok(
      payload.embeds?.[0]?.fields?.some((field) => field.name === 'Record' && field.value === '1-0-0'),
    );
  } finally {
    server.close();
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = previousToken;
    }
    if (previousTargetMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = previousTargetMap;
    }
  }
});

test('POST /api/recap/post returns no settled picks reason when the requested window is empty', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/recap/post`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ period: 'daily' }),
    });
    const body = (await response.json()) as { ok: boolean; reason?: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'no settled picks in window');
  } finally {
    server.close();
  }
});

test('POST /api/recap/post returns DISCORD_BOT_TOKEN not configured when picks exist but token is absent', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await createSettledRecapPick(repositories, {
    settledAt: buildYesterdayMiddayIso(),
    selection: 'Over 24.5',
    market: 'points-all-game-ou',
    odds: -110,
    stakeUnits: 1,
    submittedBy: 'griff843',
    result: 'win',
  });

  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  delete process.env.DISCORD_BOT_TOKEN;
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify({
    'discord:recaps': '1300411261854547968',
  });

  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/recap/post`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ period: 'daily' }),
    });
    const body = (await response.json()) as { ok: boolean; reason?: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'DISCORD_BOT_TOKEN not configured');
  } finally {
    server.close();
    if (previousToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = previousToken;
    }
    if (previousTargetMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = previousTargetMap;
    }
  }
});

async function createQualifiedPick(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
) {
  return processSubmission(
    {
      source: 'api',
      market: 'NBA assists',
      selection: 'Player Over 8.5',
      confidence: 0.9,
      metadata: {
        sport: 'NBA',
        eventName: 'Suns vs Nuggets',
        promotionScores: {
          edge: 78,
          trust: 79,
          readiness: 88,
          uniqueness: 82,
          boardFit: 90,
        },
      },
    },
    repositories,
  );
}

async function createSettledAlertAgentPick(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  input: {
    selection: string;
    sport: string;
    settledAt: string;
    result: 'win' | 'loss' | 'push';
    clvPercent: number;
  },
) {
  const created = await processSubmission(
    {
      source: 'alert-agent',
      market: `${input.sport} moneyline`,
      selection: input.selection,
      confidence: 0.65,
      metadata: {
        sport: input.sport,
      },
    },
    repositories,
  );

  await repositories.settlements.record({
    pickId: created.pick.id,
    status: 'settled',
    result: input.result,
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `server-alert-signal://${created.pick.id}`,
    settledBy: 'server-test',
    settledAt: input.settledAt,
    payload: {
      clvPercent: input.clvPercent,
    },
  });
}

async function createSettledRecapPick(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  input: {
    settledAt: string;
    selection: string;
    market: string;
    odds: number;
    stakeUnits: number;
    submittedBy: string;
    result: 'win' | 'loss' | 'push';
  },
) {
  const created = await processSubmission(
    {
      source: 'api',
      market: input.market,
      selection: input.selection,
      odds: input.odds,
      stakeUnits: input.stakeUnits,
      submittedBy: input.submittedBy,
      metadata: {
        submittedBy: input.submittedBy,
      },
    },
    repositories,
  );

  await repositories.settlements.record({
    pickId: created.pick.id,
    status: 'settled',
    result: input.result,
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `server-test://${created.pick.id}`,
    settledBy: 'server-test',
    settledAt: input.settledAt,
    payload: {},
  });

  return created.pick.id;
}

function buildYesterdayMiddayIso(now: Date = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12, 0, 0, 0),
  ).toISOString();
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

// --- Pick query endpoint ---

test('GET /api/picks returns 400 without status param', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/picks`);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'MISSING_STATUS');
  } finally {
    server.close();
  }
});

test('GET /api/picks?status=validated returns picks in that state', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await processSubmission(
    { source: 'api', market: 'NBA', selection: 'Over 200.5' },
    repositories,
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks?status=validated`,
    );
    const body = (await response.json()) as { ok: boolean; picks: unknown[]; count: number };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.count, 1);
    assert.equal(body.picks.length, 1);
  } finally {
    server.close();
  }
});

test('GET /api/picks?status=settled returns empty when no settled picks', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await processSubmission(
    { source: 'api', market: 'NBA', selection: 'Over 200.5' },
    repositories,
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks?status=settled`,
    );
    const body = (await response.json()) as { ok: boolean; picks: unknown[]; count: number };

    assert.equal(response.status, 200);
    assert.equal(body.count, 0);
  } finally {
    server.close();
  }
});

test('GET /api/picks/:id/trace returns the full pick lifecycle aggregate', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await createQualifiedPick(repositories);

  await enqueueDistributionWithRunTracking(
    created.pick,
    'discord:best-bets',
    'server-test',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );
  const [outboxEntry] = await repositories.outbox.listByPickId(created.pick.id);
  assert.ok(outboxEntry, 'expected trace seed outbox entry');
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'posted', 'posted', 'poster');

  await repositories.receipts.record({
    outboxId: outboxEntry.id,
    receiptType: 'discord.message',
    status: 'sent',
    channel: 'discord:best-bets',
    externalId: 'message-1',
    idempotencyKey: 'trace-receipt-1',
    payload: { ok: true },
  });

  await repositories.settlements.record({
    pickId: created.pick.id,
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `trace://${created.pick.id}`,
    settledBy: 'trace-tester',
    settledAt: new Date().toISOString(),
    payload: {},
  });
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'settled', 'settled', 'settler');
  await repositories.audit.record({
    entityType: 'trace_seed',
    entityId: 'trace-seed-1',
    entityRef: created.pick.id,
    action: 'trace.seeded',
    actor: 'server-test',
    payload: { pickId: created.pick.id },
  });

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/trace`,
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        pick: { id: string };
        submissionEvents: Array<{ submission_id: string }>;
        promotionHistory: Array<{ pick_id: string }>;
        outboxEntries: Array<{ pick_id: string }>;
        distributionReceipts: Array<{ outbox_id: string }>;
        settlementRecords: Array<{ pick_id: string }>;
        auditLogEntries: Array<{ entity_ref: string }>;
        lifecycleEvents: Array<{ pick_id: string; to_state: string }>;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.pick.id, created.pick.id);
    assert.equal(body.data?.submissionEvents[0]?.submission_id, created.submission.id);
    assert.equal(body.data?.promotionHistory[0]?.pick_id, created.pick.id);
    assert.equal(body.data?.outboxEntries[0]?.pick_id, created.pick.id);
    assert.equal(body.data?.distributionReceipts[0]?.outbox_id, outboxEntry.id);
    assert.equal(body.data?.settlementRecords[0]?.pick_id, created.pick.id);
    assert.ok(body.data?.auditLogEntries.some((entry) => entry.entity_ref === created.pick.id));
    assert.ok(body.data?.lifecycleEvents.some((entry) => entry.to_state === 'queued'));
    assert.ok(body.data?.lifecycleEvents.some((entry) => entry.to_state === 'settled'));
  } finally {
    server.close();
  }
});

test('GET /api/picks/:id/trace returns 404 for unknown pick', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/missing-pick/trace`,
    );
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'PICK_NOT_FOUND');
  } finally {
    server.close();
  }
});

// --- Settlement query endpoint ---

test('GET /api/settlements/recent returns empty array when no settlements', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/settlements/recent`,
    );
    const body = (await response.json()) as { ok: boolean; settlements: unknown[]; count: number };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.count, 0);
    assert.deepEqual(body.settlements, []);
  } finally {
    server.close();
  }
});
