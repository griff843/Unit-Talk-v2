import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authenticateCommandCenterRequest,
  assertCommandCenterAuthConfig,
  fetchRuntimeTruth,
  fetchRuntimeHealth,
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
  resolveOperatorIdentity,
} from './server-api';

function createEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    ...overrides,
  };
}

test('resolveApiBaseUrl prefers API_BASE_URL when present', () => {
  const baseUrl = resolveApiBaseUrl(
    createEnv({
      API_BASE_URL: 'http://localhost:4900',
      UNIT_TALK_API_URL: 'http://localhost:4000',
    }),
  );

  assert.equal(baseUrl, 'http://localhost:4900');
});

test('resolveApiBaseUrl falls back to UNIT_TALK_API_URL before localhost:4000', () => {
  const baseUrl = resolveApiBaseUrl(
    createEnv({
      UNIT_TALK_API_URL: 'http://localhost:4010',
    }),
  );

  assert.equal(baseUrl, 'http://localhost:4010');
});

test('resolveApiBaseUrl defaults to port 4000 when no override exists', () => {
  assert.equal(resolveApiBaseUrl(createEnv()), 'http://localhost:4000');
});

test('resolveCommandCenterApiHeaders includes bearer auth when configured', () => {
  const headers = resolveCommandCenterApiHeaders(
    createEnv({
      UNIT_TALK_CC_API_KEY: 'secret-token',
      COMMAND_CENTER_OPERATOR_IDENTITY: 'ops-alice',
    }),
  );

  assert.deepEqual(headers, {
    'Content-Type': 'application/json',
    'X-Operator-Identity': 'ops-alice',
    Authorization: 'Bearer secret-token',
  });
});

test('fetchRuntimeTruth calls the authenticated runtime truth endpoint', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const runtimeTruth = {
    service: 'api',
    observedAt: '2026-05-13T12:00:00.000Z',
    runtimeMode: 'fail_closed',
    persistenceMode: 'database',
    appVersion: '0.1.0',
    auth: { enabled: true, mode: 'enabled' },
    work: {
      doingRealWork: true,
      dryRun: false,
      lastWorkAt: null,
      workerTargets: ['discord:best-bets'],
      reason: 'database persistence is active for API writes',
    },
    details: {},
    redaction: { secretsExposed: false, redactedKeys: [] },
  };

  const result = await fetchRuntimeTruth({
    env: createEnv({
      API_BASE_URL: 'http://api.test',
      UNIT_TALK_CC_API_KEY: 'cc-secret',
      COMMAND_CENTER_OPERATOR_IDENTITY: 'ops-alice',
    }),
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify(runtimeTruth), { status: 200 });
    },
  });

  assert.deepEqual(result, runtimeTruth);
  assert.equal(calls[0]?.input, 'http://api.test/api/runtime/truth');
  assert.equal(
    (calls[0]?.init?.headers as Record<string, string>).Authorization,
    'Bearer cc-secret',
  );
  assert.equal(
    (calls[0]?.init?.headers as Record<string, string>)['X-Operator-Identity'],
    'ops-alice',
  );
});

test('resolveCommandCenterApiHeaders fails closed in production without API key', () => {
  assert.throws(
    () =>
      resolveCommandCenterApiHeaders(
        createEnv({
          NODE_ENV: 'production',
          UNIT_TALK_APP_ENV: 'production',
        }),
      ),
    /UNIT_TALK_CC_API_KEY/,
  );
});

test('assertCommandCenterAuthConfig requires app auth in production', () => {
  assert.throws(
    () =>
      assertCommandCenterAuthConfig(
        createEnv({
          NODE_ENV: 'production',
          UNIT_TALK_APP_ENV: 'production',
        }),
      ),
    /Command Center auth is required/,
  );
});

test('authenticateCommandCenterRequest accepts production basic auth', () => {
  const result = authenticateCommandCenterRequest({
    env: createEnv({
      NODE_ENV: 'production',
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_USERNAME: 'operator',
      COMMAND_CENTER_AUTH_PASSWORD: 'secret',
      COMMAND_CENTER_OPERATOR_IDENTITY: 'ops-alice',
    }),
    headers: {
      authorization: createBasicAuthHeader('operator', 'secret'),
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.auth.actor, 'ops-alice');
    assert.equal(result.auth.role, 'operator');
    assert.equal(result.auth.method, 'basic');
  }
});

test('authenticateCommandCenterRequest rejects missing production credentials', () => {
  const result = authenticateCommandCenterRequest({
    env: createEnv({
      NODE_ENV: 'production',
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'browser-token',
    }),
    headers: {},
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.code, 'COMMAND_CENTER_AUTH_REQUIRED');
    assert.match(result.challenge ?? '', /Basic realm/);
  }
});

test('authenticateCommandCenterRequest accepts bearer token auth', () => {
  const result = authenticateCommandCenterRequest({
    env: createEnv({
      NODE_ENV: 'production',
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'browser-token',
    }),
    headers: {
      authorization: 'Bearer browser-token',
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.auth.method, 'bearer');
  }
});

test('resolveOperatorIdentity defaults to command-center', () => {
  assert.equal(resolveOperatorIdentity(createEnv()), 'command-center');
});

const stubQueueHealth = {
  status: 'healthy' as const,
  observedAt: '2026-05-16T17:00:00.000Z',
  workerTargets: ['discord:best-bets'],
  queueDepth: 2,
  pendingCount: 2,
  pendingByTarget: { 'discord:best-bets': 2 },
  failedCount: 0,
  deadLetterCount: 0,
  processingCount: 0,
  oldestPendingAt: null,
  oldestPendingAgeMs: null,
  oldestPendingTarget: null,
  lastSuccessfulDeliveryAt: '2026-05-16T16:55:00.000Z',
  lastSuccessfulDeliveryAgeMs: 300_000,
  targetMismatches: [],
  silentStrandingRisk: false,
  alerts: [],
  metrics: {},
};

test('fetchRuntimeHealth returns queue health from /health endpoint', async () => {
  const result = await fetchRuntimeHealth({
    env: createEnv({ API_BASE_URL: 'http://api.test' }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ status: 'healthy', warnings: [], queueHealth: stubQueueHealth }),
        { status: 200 },
      ),
  });

  assert.equal(result.apiStatus, 'healthy');
  assert.deepEqual(result.warnings, []);
  assert.ok(result.queueHealth !== null);
  assert.equal(result.queueHealth?.status, 'healthy');
  assert.equal(result.queueHealth?.pendingCount, 2);
});

test('fetchRuntimeHealth handles 503 degraded response with body', async () => {
  const result = await fetchRuntimeHealth({
    env: createEnv({ API_BASE_URL: 'http://api.test' }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ status: 'degraded', warnings: ['queue stale'], queueHealth: null }),
        { status: 503 },
      ),
  });

  assert.equal(result.apiStatus, 'degraded');
  assert.deepEqual(result.warnings, ['queue stale']);
  assert.equal(result.queueHealth, null);
});

test('fetchRuntimeHealth throws on non-503 error', async () => {
  await assert.rejects(
    () =>
      fetchRuntimeHealth({
        env: createEnv({ API_BASE_URL: 'http://api.test' }),
        fetchImpl: async () => new Response('{}', { status: 500 }),
      }),
    /Runtime health request failed: 500/,
  );
});

test('fetchRuntimeHealth returns null queue health when field is absent', async () => {
  const result = await fetchRuntimeHealth({
    env: createEnv({ API_BASE_URL: 'http://api.test' }),
    fetchImpl: async () =>
      new Response(JSON.stringify({ status: 'healthy', warnings: [] }), { status: 200 }),
  });

  assert.equal(result.queueHealth, null);
});

function createBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}


test('runtime health rejects a missing or invented status instead of calling it down', async () => {
  for (const status of [undefined, 'fine', 200]) {
    await assert.rejects(() => fetchRuntimeHealth({
      env: createEnv({ API_BASE_URL: 'http://api.test' }),
      fetchImpl: async (_input, init) => {
        assert.ok(init?.signal, 'runtime dependency reads must have a timeout');
        return Response.json({ status });
      },
    }), /recognized status/);
  }
});

// WORK-2026102703: settlement attribution is the middleware actor, so a Basic
// login authenticates as the operator who holds the credential.
function productionEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return createEnv({ NODE_ENV: 'production', UNIT_TALK_APP_ENV: 'production', ...overrides });
}

test('Basic login without an explicit identity authenticates as the canonical username', () => {
  const env = productionEnv({
    COMMAND_CENTER_AUTH_TOKEN: 'machine-token',
    COMMAND_CENTER_AUTH_USERNAME: 'griff843',
    COMMAND_CENTER_AUTH_PASSWORD: 'secret',
  });
  const basic = authenticateCommandCenterRequest({ env, headers: { authorization: createBasicAuthHeader('griff843', 'secret') } });
  assert.equal(basic.ok && basic.auth.actor, 'griff843');
  assert.equal(basic.ok && basic.auth.method, 'basic');
  // The machine token on the same configuration is never attributed to the human.
  const bearer = authenticateCommandCenterRequest({ env, headers: { authorization: 'Bearer machine-token' } });
  assert.equal(bearer.ok && bearer.auth.actor, 'command-center');
});

test('a non-canonical Basic username never becomes the actor', () => {
  for (const username of ['Griff843', 'griff 843', 'ops@example.com', '-griff']) {
    const env = productionEnv({ COMMAND_CENTER_AUTH_USERNAME: username, COMMAND_CENTER_AUTH_PASSWORD: 'secret' });
    const result = authenticateCommandCenterRequest({ env, headers: { authorization: createBasicAuthHeader(username, 'secret') } });
    assert.equal(result.ok && result.auth.actor, 'command-center', username);
  }
});

test('an explicit operator identity still wins over the Basic username', () => {
  const env = productionEnv({
    COMMAND_CENTER_AUTH_USERNAME: 'griff843',
    COMMAND_CENTER_AUTH_PASSWORD: 'secret',
    COMMAND_CENTER_OPERATOR_IDENTITY: 'ops-alice',
  });
  const result = authenticateCommandCenterRequest({ env, headers: { authorization: createBasicAuthHeader('griff843', 'secret') } });
  assert.equal(result.ok && result.auth.actor, 'ops-alice');
});

test('wrong or missing Basic credentials are still refused', () => {
  const env = productionEnv({ COMMAND_CENTER_AUTH_USERNAME: 'griff843', COMMAND_CENTER_AUTH_PASSWORD: 'secret' });
  for (const headers of [
    { authorization: createBasicAuthHeader('griff843', 'wrong') },
    { authorization: createBasicAuthHeader('kingro623', 'secret') },
    {},
  ]) {
    assert.equal(authenticateCommandCenterRequest({ env, headers }).ok, false);
  }
});
