import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { AppEnv } from '@unit-talk/config';
import { createLogger, type StructuredLogEntry } from '@unit-talk/observability';
import { createInMemoryRepositoryBundle } from './persistence.js';
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

async function listen(server: ReturnType<typeof createApiServer>) {
  server.listen(0);
  await once(server, 'listening');
  testRateLimitBuckets.clear();
}
