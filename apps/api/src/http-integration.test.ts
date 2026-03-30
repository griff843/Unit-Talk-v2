import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { AppEnv } from '@unit-talk/config';
import { createLogger, type StructuredLogEntry } from '@unit-talk/observability';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import {
  createApiRuntimeDependencies,
  createApiServer,
  type ApiRuntimeDependencies,
} from './server.js';

test('createApiRuntimeDependencies fails closed when database config is unavailable', () => {
  assert.throws(
    () =>
      createApiRuntimeDependencies({
        environment: createTestEnvironment({
          UNIT_TALK_APP_ENV: 'ci',
          UNIT_TALK_API_RUNTIME_MODE: 'fail_closed',
          SUPABASE_URL: undefined,
          SUPABASE_ANON_KEY: undefined,
          SUPABASE_SERVICE_ROLE_KEY: undefined,
        }),
      }),
    /fail_closed/i,
  );
});

test('POST /api/submissions rejects request bodies larger than the configured cap', async () => {
  const server = createApiServer({
    runtime: createTestRuntime({
      bodyLimitBytes: 128,
    }),
  });

  await listen(server);
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
        notes: 'x'.repeat(512),
      }),
    });
    const body = (await response.json()) as { ok: boolean; error?: { code: string } };

    assert.equal(response.status, 413);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'REQUEST_BODY_TOO_LARGE');
  } finally {
    server.close();
  }
});

test('POST /api/submissions rate limits repeat callers and exposes reset metadata', async () => {
  let now = 1_000;
  const server = createApiServer({
    runtime: createTestRuntime({
      now: () => now,
      submissionRateLimit: {
        maxRequests: 1,
        windowMs: 60_000,
      },
    }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const first = await submitTestPick(address.port, {
      'x-forwarded-for': '203.0.113.5',
    });
    assert.equal(first.status, 201);
    assert.equal(first.headers.get('x-ratelimit-remaining'), '0');

    now += 1_000;
    const second = await submitTestPick(address.port, {
      'x-forwarded-for': '203.0.113.5',
    });
    const body = (await second.json()) as { ok: boolean; error?: { code: string } };

    assert.equal(second.status, 429);
    assert.equal(body.error?.code, 'RATE_LIMIT_EXCEEDED');
    assert.equal(second.headers.get('retry-after'), '59');
    assert.equal(second.headers.get('x-ratelimit-limit'), '1');
    assert.equal(second.headers.get('x-ratelimit-remaining'), '0');
  } finally {
    server.close();
  }
});

test('POST /api/submissions allows requests up to the configured limit', async () => {
  const now = 1_000;
  const server = createApiServer({
    runtime: createTestRuntime({
      now: () => now,
      submissionRateLimit: {
        maxRequests: 3,
        windowMs: 60_000,
      },
    }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    for (let i = 0; i < 3; i++) {
      const response = await submitTestPick(address.port, {
        'x-forwarded-for': '203.0.113.10',
      });
      assert.equal(response.status, 201, `request ${i + 1} should pass`);
    }
  } finally {
    server.close();
  }
});

test('POST /api/submissions keys rate limit by Discord user ID from body when present', async () => {
  let now = 1_000;
  const server = createApiServer({
    runtime: createTestRuntime({
      now: () => now,
      submissionRateLimit: {
        maxRequests: 1,
        windowMs: 60_000,
      },
    }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    // First Discord user uses one bucket
    const firstUserFirst = await submitTestPickWithDiscordId(address.port, 'user-alice');
    assert.equal(firstUserFirst.status, 201);
    assert.equal(firstUserFirst.headers.get('x-ratelimit-remaining'), '0');

    now += 1_000;

    // Second Discord user gets a separate bucket — should not be rate limited
    const secondUserFirst = await submitTestPickWithDiscordId(address.port, 'user-bob');
    assert.equal(secondUserFirst.status, 201, 'different Discord user ID should get a fresh bucket');

    now += 1_000;

    // First user is now rate-limited
    const firstUserSecond = await submitTestPickWithDiscordId(address.port, 'user-alice');
    const body = (await firstUserSecond.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(firstUserSecond.status, 429);
    assert.equal(body.error?.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(firstUserSecond.headers.get('retry-after'), 'Retry-After header should be set');
  } finally {
    server.close();
  }
});

test('POST /api/submissions keys rate limit by submittedBy when discordUserId absent', async () => {
  let now = 1_000;
  const server = createApiServer({
    runtime: createTestRuntime({
      now: () => now,
      submissionRateLimit: {
        maxRequests: 1,
        windowMs: 60_000,
      },
    }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const firstRequest = await submitTestPickWithSubmittedBy(address.port, 'capper-griff');
    assert.equal(firstRequest.status, 201);

    now += 1_000;

    // Same submittedBy — should be rate-limited
    const secondRequest = await submitTestPickWithSubmittedBy(address.port, 'capper-griff');
    const body = (await secondRequest.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(secondRequest.status, 429);
    assert.equal(body.error?.code, 'RATE_LIMIT_EXCEEDED');

    now += 1_000;

    // Different submittedBy — separate bucket
    const otherCapper = await submitTestPickWithSubmittedBy(address.port, 'capper-dalton');
    assert.equal(otherCapper.status, 201, 'different submittedBy should get a fresh bucket');
  } finally {
    server.close();
  }
});

test('API requests preserve inbound correlation ids in response headers and logs', async () => {
  const entries: StructuredLogEntry[] = [];
  const server = createApiServer({
    runtime: createTestRuntime({
      logger: createLogger({
        service: 'api',
        writer: {
          write(_level, entry) {
            entries.push(entry);
          },
        },
      }),
    }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await submitTestPick(address.port, {
      'x-correlation-id': 'corr-http-test',
    });

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-correlation-id'), 'corr-http-test');
    assert.equal(
      entries.some(
        (entry) =>
          entry.correlationId === 'corr-http-test' && entry.message === 'request completed',
      ),
      true,
    );
  } finally {
    server.close();
  }
});

test('POST /api/submissions accepts a body within the configured cap', async () => {
  const server = createApiServer({
    runtime: createTestRuntime({ bodyLimitBytes: 512 }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'body-size-test',
        market: 'NBA points',
        selection: 'Player Over 18.5',
      }),
    });

    assert.equal(response.status, 201);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/settle rejects bodies exceeding the configured cap', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    { source: 'body-size-test', market: 'NBA rebounds', selection: 'Player Over 10.5' },
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

  const server = createApiServer({
    runtime: createTestRuntime({ bodyLimitBytes: 64, repositories }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/settle`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'boxscore://body-size-test',
          settledBy: 'operator',
          notes: 'x'.repeat(256),
        }),
      },
    );
    const body = (await response.json()) as { ok: boolean; error?: { code: string } };

    assert.equal(response.status, 413);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'REQUEST_BODY_TOO_LARGE');
  } finally {
    server.close();
  }
});

test('POST /api/recap/post rejects bodies exceeding the configured cap', async () => {
  const server = createApiServer({
    runtime: createTestRuntime({ bodyLimitBytes: 32 }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/recap/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ period: 'daily', notes: 'x'.repeat(256) }),
    });
    const body = (await response.json()) as { ok: boolean; error?: { code: string } };

    assert.equal(response.status, 413);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'REQUEST_BODY_TOO_LARGE');
  } finally {
    server.close();
  }
});

test('POST /api/member-tiers rejects bodies exceeding the configured cap', async () => {
  const server = createApiServer({
    runtime: createTestRuntime({ bodyLimitBytes: 32 }),
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/member-tiers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discord_id: 'user-123',
        tier: 'vip',
        action: 'activate',
        source: 'discord-role',
        notes: 'x'.repeat(256),
      }),
    });
    const body = (await response.json()) as { ok: boolean; error?: { code: string } };

    assert.equal(response.status, 413);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'REQUEST_BODY_TOO_LARGE');
  } finally {
    server.close();
  }
});

test('UNIT_TALK_API_MAX_BODY_BYTES env var sets the body limit on createApiRuntimeDependencies', () => {
  const previousValue = process.env.UNIT_TALK_API_MAX_BODY_BYTES;
  process.env.UNIT_TALK_API_MAX_BODY_BYTES = '8192';

  try {
    const runtime = createApiRuntimeDependencies({
      repositories: createInMemoryRepositoryBundle(),
    });
    assert.equal(runtime.bodyLimitBytes, 8192);
  } finally {
    if (previousValue === undefined) {
      delete process.env.UNIT_TALK_API_MAX_BODY_BYTES;
    } else {
      process.env.UNIT_TALK_API_MAX_BODY_BYTES = previousValue;
    }
  }
});

function createTestRuntime(
  overrides: Partial<ApiRuntimeDependencies> = {},
): ApiRuntimeDependencies {
  return {
    repositories: createInMemoryRepositoryBundle(),
    persistenceMode: 'in_memory',
    runtimeMode: 'fail_open',
    bodyLimitBytes: 64 * 1024,
    submissionRateLimit: {
      maxRequests: 10,
      windowMs: 60_000,
    },
    logger: createLogger({ service: 'api', fields: { env: 'test' } }),
    now: Date.now,
    rateLimitStore: {
      consume(key, limit, now) {
        const bucket = testRateLimitBuckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
          const freshBucket = { count: 1, resetAt: now + limit.windowMs };
          testRateLimitBuckets.set(key, freshBucket);
          return {
            exceeded: false,
            limit: limit.maxRequests,
            remaining: Math.max(limit.maxRequests - 1, 0),
            resetAt: freshBucket.resetAt,
          };
        }

        bucket.count += 1;
        return {
          exceeded: bucket.count > limit.maxRequests,
          limit: limit.maxRequests,
          remaining: Math.max(limit.maxRequests - bucket.count, 0),
          resetAt: bucket.resetAt,
        };
      },
    },
    ...overrides,
  };
}

const testRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function createTestEnvironment(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    UNIT_TALK_APP_ENV: 'local',
    UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\dev\\unit-talk-v2',
    UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
    LINEAR_TEAM_KEY: 'UNIT',
    LINEAR_TEAM_NAME: 'Unit Talk',
    NOTION_WORKSPACE_NAME: 'Unit Talk',
    SLACK_WORKSPACE_NAME: 'Unit Talk',
    ...overrides,
  };
}

async function submitTestPick(port: number, headers: Record<string, string>) {
  return fetch(`http://127.0.0.1:${port}/api/submissions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      source: 'server-test',
      market: 'NBA points',
      selection: 'Player Over 18.5',
    }),
  });
}

async function submitTestPickWithDiscordId(port: number, discordUserId: string) {
  return fetch(`http://127.0.0.1:${port}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'discord',
      market: 'NBA points',
      selection: 'Player Over 18.5',
      discordUserId,
    }),
  });
}

async function submitTestPickWithSubmittedBy(port: number, submittedBy: string) {
  return fetch(`http://127.0.0.1:${port}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'discord',
      market: 'NBA points',
      selection: 'Player Over 18.5',
      submittedBy,
    }),
  });
}

async function listen(server: ReturnType<typeof createApiServer>) {
  server.listen(0);
  await once(server, 'listening');
  testRateLimitBuckets.clear();
}

// ---------------------------------------------------------------------------
// POST /api/member-tiers tests
// ---------------------------------------------------------------------------

test('POST /api/member-tiers activates a valid tier and returns 200', async () => {
  const server = createApiServer({ runtime: createTestRuntime() });
  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/member-tiers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discord_id: 'user-123',
        tier: 'vip',
        action: 'activate',
        source: 'discord-role',
      }),
    });
    const body = (await response.json()) as { ok: boolean; tier: string; action: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.tier, 'vip');
    assert.equal(body.action, 'activate');
  } finally {
    server.close();
  }
});

test('POST /api/member-tiers deactivates a valid tier and returns 200', async () => {
  const server = createApiServer({ runtime: createTestRuntime() });
  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/member-tiers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discord_id: 'user-456',
        tier: 'trial',
        action: 'deactivate',
        source: 'discord-role',
      }),
    });
    const body = (await response.json()) as { ok: boolean; tier: string; action: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.action, 'deactivate');
  } finally {
    server.close();
  }
});

test('POST /api/member-tiers returns 400 for invalid tier', async () => {
  const server = createApiServer({ runtime: createTestRuntime() });
  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/member-tiers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discord_id: 'user-789',
        tier: 'super-premium-tier',
        action: 'activate',
        source: 'discord-role',
      }),
    });
    const body = (await response.json()) as { error: string };

    assert.equal(response.status, 400);
    assert.ok(body.error, 'response should have an error field');
  } finally {
    server.close();
  }
});

test('POST /api/member-tiers returns 400 for invalid action', async () => {
  const server = createApiServer({ runtime: createTestRuntime() });
  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/member-tiers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discord_id: 'user-789',
        tier: 'vip',
        action: 'grant',
        source: 'discord-role',
      }),
    });
    const body = (await response.json()) as { error: string };

    assert.equal(response.status, 400);
    assert.ok(body.error, 'response should have an error field');
  } finally {
    server.close();
  }
});

test('POST /api/member-tiers returns 400 when discord_id is missing', async () => {
  const server = createApiServer({ runtime: createTestRuntime() });
  await listen(server);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/member-tiers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tier: 'vip',
        action: 'activate',
        source: 'discord-role',
      }),
    });
    const body = (await response.json()) as { error: string };

    assert.equal(response.status, 400);
    assert.ok(body.error, 'response should have an error field');
  } finally {
    server.close();
  }
});
