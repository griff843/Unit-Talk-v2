import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
  const baseUrl = resolveApiBaseUrl(createEnv({
    API_BASE_URL: 'http://localhost:4900',
    UNIT_TALK_API_URL: 'http://localhost:4000',
  }));

  assert.equal(baseUrl, 'http://localhost:4900');
});

test('resolveApiBaseUrl falls back to UNIT_TALK_API_URL before localhost:4000', () => {
  const baseUrl = resolveApiBaseUrl(createEnv({
    UNIT_TALK_API_URL: 'http://localhost:4010',
  }));

  assert.equal(baseUrl, 'http://localhost:4010');
});

test('resolveApiBaseUrl defaults to port 4000 when no override exists', () => {
  assert.equal(resolveApiBaseUrl(createEnv()), 'http://localhost:4000');
});

test('resolveCommandCenterApiHeaders includes bearer auth when configured', () => {
  const headers = resolveCommandCenterApiHeaders(createEnv({
    UNIT_TALK_CC_API_KEY: 'secret-token',
  }));

  assert.deepEqual(headers, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer secret-token',
  });
});

test('resolveOperatorIdentity defaults to command-center', () => {
  assert.equal(resolveOperatorIdentity(createEnv()), 'command-center');
});
