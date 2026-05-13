import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authenticateCommandCenterRequest,
  assertCommandCenterAuthConfig,
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

function createBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}
