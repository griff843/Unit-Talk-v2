/**
 * HTTP-level integration tests for apps/api.
 *
 * Spins up the real createApiServer on a random port (port 0) and sends real
 * HTTP requests via the global fetch API. All tests use InMemory repositories —
 * no live DB or Supabase credentials required.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiServer, createApiRuntimeDependencies } from './server.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { createErrorTracker, createMetricsCollector } from '@unit-talk/observability';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestServer(overrides: Parameters<typeof createApiServer>[0] = {}) {
  return createApiServer({
    runtime: createApiRuntimeDependencies({
      repositories: createInMemoryRepositoryBundle(),
      ...overrides,
    }),
  });
}

async function startServer(server: ReturnType<typeof createApiServer>) {
  server.listen(0);
  await once(server, 'listening');
  return server.address() as AddressInfo;
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

test('GET /health returns 503 degraded for in-memory persistence', async () => {
  const server = createTestServer();
  const address = await startServer(server);

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
    assert.equal(
      response.headers.get('content-type'),
      'application/json; charset=utf-8',
    );
    assert.equal(body.status, 'degraded');
    assert.equal(body.service, 'api');
    assert.equal(body.persistenceMode, 'in_memory');
    assert.equal(body.dbReachable, false);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/submissions — success
// ---------------------------------------------------------------------------

test('POST /api/submissions with valid body returns 201 and pick id', async () => {
  const server = createTestServer();
  const address = await startServer(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/submissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'api',
          market: 'NBA points',
          selection: 'Player Over 22.5',
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { pickId: string; lifecycleState: string };
    };

    assert.equal(response.status, 201);
    assert.equal(
      response.headers.get('content-type'),
      'application/json; charset=utf-8',
    );
    assert.equal(body.ok, true);
    assert.ok(body.data?.pickId, 'pickId must be present');
    assert.equal(body.data?.lifecycleState, 'validated');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/submissions — malformed JSON → 400
// ---------------------------------------------------------------------------

test('POST /api/submissions with malformed JSON body returns 400', async () => {
  const server = createTestServer();
  const address = await startServer(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/submissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ this is not valid json }',
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code: string; message: string };
    };

    assert.equal(response.status, 400);
    assert.equal(
      response.headers.get('content-type'),
      'application/json; charset=utf-8',
    );
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'INVALID_JSON_BODY');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/submissions — oversized body → 413
// ---------------------------------------------------------------------------

test('POST /api/submissions with oversized body returns 413', async () => {
  const smallLimitServer = createApiServer({
    runtime: {
      repositories: createInMemoryRepositoryBundle(),
      persistenceMode: 'in_memory',
      runtimeMode: 'fail_open',
      authConfig: { enabled: false, keys: new Map() },
      bodyLimitBytes: 64,
      submissionRateLimit: { maxRequests: 100, windowMs: 60_000 },
      logger: createApiRuntimeDependencies({
        repositories: createInMemoryRepositoryBundle(),
      }).logger,
      errorTracker: createErrorTracker({ service: 'api' }),
      now: Date.now,
      metricsCollector: createMetricsCollector(),
      rateLimitStore: {
        consume(_key, limit, now) {
          return {
            exceeded: false,
            limit: limit.maxRequests,
            remaining: limit.maxRequests,
            resetAt: now + limit.windowMs,
          };
        },
      },
    },
  });

  const address = await startServer(smallLimitServer);

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/submissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'api',
          market: 'NBA points',
          selection: 'Player Over 22.5',
          notes: 'x'.repeat(512),
        }),
      },
    );
    const body = (await response.json()) as { ok: boolean; error?: { code: string } };

    assert.equal(response.status, 413);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'REQUEST_BODY_TOO_LARGE');
  } finally {
    smallLimitServer.close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/picks/:id/settle — success
// ---------------------------------------------------------------------------

test('POST /api/picks/:id/settle with valid posted pick returns 201', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    {
      source: 'api',
      market: 'NBA rebounds',
      selection: 'Player Over 9.5',
    },
    repositories,
  );

  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'queued',
    'queued',
  );
  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'posted',
    'posted',
    'poster',
  );

  const server = createApiServer({ repositories });
  const address = await startServer(server);

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
          evidenceRef: 'boxscore://http-test',
          settledBy: 'operator',
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { settlementStatus: string; finalLifecycleState: string };
    };

    assert.equal(response.status, 201);
    assert.equal(
      response.headers.get('content-type'),
      'application/json; charset=utf-8',
    );
    assert.equal(body.ok, true);
    assert.equal(body.data?.settlementStatus, 'settled');
    assert.equal(body.data?.finalLifecycleState, 'settled');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/picks/:id/settle — 400 missing required fields
// ---------------------------------------------------------------------------

test('POST /api/picks/:id/settle with empty body returns 400', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    {
      source: 'api',
      market: 'NBA assists',
      selection: 'Player Over 6.5',
    },
    repositories,
  );

  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'queued',
    'queued',
  );
  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'posted',
    'posted',
    'poster',
  );

  const server = createApiServer({ repositories });
  const address = await startServer(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/settle`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    const body = (await response.json()) as { ok: boolean; error?: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.ok(body.error?.code, 'error code must be present');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/picks/:id/settle — 404 non-existent pick
// ---------------------------------------------------------------------------

test('POST /api/picks/:id/settle with non-existent pick id returns 404', async () => {
  const server = createTestServer();
  const address = await startServer(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/does-not-exist/settle`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'boxscore://missing',
          settledBy: 'operator',
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code: string };
    };

    assert.equal(response.status, 404);
    assert.equal(
      response.headers.get('content-type'),
      'application/json; charset=utf-8',
    );
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'PICK_NOT_FOUND');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Unknown route → 404
// ---------------------------------------------------------------------------

test('GET /unknown-route returns 404 with NOT_FOUND error code', async () => {
  const server = createTestServer();
  const address = await startServer(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/unknown-route`,
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code: string };
    };

    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'NOT_FOUND');
  } finally {
    server.close();
  }
});
