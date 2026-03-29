import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiServer } from './server.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { enqueueDistributionWithRunTracking } from './run-audit-service.js';

test('GET /health returns service status', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      persistenceMode: string;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'api');
    assert.equal(body.persistenceMode, 'in_memory');
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
        source: 'server-test',
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
    metadata: {},
  });

  const previousEnabled = process.env.ALERT_AGENT_ENABLED;
  const previousDryRun = process.env.ALERT_DRY_RUN;
  const previousMinTier = process.env.ALERT_MIN_TIER;
  const previousLookback = process.env.ALERT_LOOKBACK_MINUTES;
  process.env.ALERT_AGENT_ENABLED = 'false';
  process.env.ALERT_DRY_RUN = 'false';
  process.env.ALERT_MIN_TIER = 'alert-worthy';
  process.env.ALERT_LOOKBACK_MINUTES = '120';

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/alerts/status`);
    const body = (await response.json()) as {
      enabled: boolean;
      dryRun: boolean;
      minTier: string;
      lookbackMinutes: number;
      last1h: { notable: number; alertWorthy: number; notified: number };
      lastDetectedAt: string | null;
    };

    assert.equal(response.status, 200);
    assert.equal(body.enabled, false);
    assert.equal(body.dryRun, false);
    assert.equal(body.minTier, 'alert-worthy');
    assert.equal(body.lookbackMinutes, 120);
    assert.equal(body.last1h.notable, 1);
    assert.equal(body.last1h.alertWorthy, 0);
    assert.equal(body.last1h.notified, 0);
    assert.equal(body.lastDetectedAt, currentSnapshotAt);
  } finally {
    server.close();
    restoreEnv('ALERT_AGENT_ENABLED', previousEnabled);
    restoreEnv('ALERT_DRY_RUN', previousDryRun);
    restoreEnv('ALERT_MIN_TIER', previousMinTier);
    restoreEnv('ALERT_LOOKBACK_MINUTES', previousLookback);
  }
});

test('POST /api/picks/:id/settle settles a posted pick', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    {
      source: 'server-test',
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
        cappers: string[];
        ticketTypes: { id: string; name: string; enabled: boolean }[];
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data);
    assert.equal(body.data.sports.length, 9);
    assert.equal(body.data.sportsbooks.length, 11);
    assert.ok(body.data.cappers.includes('griff843'));

    const nba = body.data.sports.find((s) => s.id === 'NBA');
    assert.ok(nba);
    assert.ok(nba.marketTypes.includes('player-prop'));
    assert.ok(nba.statTypes.includes('Points'));
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
      source: 'server-test',
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
      source: 'server-test',
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
      source: 'server-test',
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
      source: 'server-test',
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
