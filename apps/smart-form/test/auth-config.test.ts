import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLocalAuthFallbackActive,
  isQaAuthBypassEnabled,
  resolveAuthSecret,
} from '../lib/auth-config.js';

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides };
}

test('resolveAuthSecret prefers AUTH_SECRET over NEXTAUTH_SECRET', () => {
  assert.equal(
    resolveAuthSecret(env({
      NODE_ENV: 'development',
      AUTH_SECRET: 'auth-secret',
      NEXTAUTH_SECRET: 'nextauth-secret',
    })),
    'auth-secret',
  );
});

test('resolveAuthSecret uses stable local fallback outside production', () => {
  assert.equal(
    resolveAuthSecret(env({ NODE_ENV: 'development' })),
    'unit-talk-smart-form-local-auth-secret',
  );
  assert.equal(isLocalAuthFallbackActive(env({ NODE_ENV: 'test' })), true);
});

test('resolveAuthSecret fails closed in production', () => {
  assert.throws(
    () => resolveAuthSecret(env({ NODE_ENV: 'production' })),
    /AUTH_SECRET or NEXTAUTH_SECRET/,
  );
});

test('isQaAuthBypassEnabled defaults on locally and never enables in production', () => {
  assert.equal(isQaAuthBypassEnabled(env({ NODE_ENV: 'development' })), true);
  assert.equal(isQaAuthBypassEnabled(env({ NODE_ENV: 'test', SMART_FORM_QA_AUTH_BYPASS: 'false' })), false);
  assert.equal(isQaAuthBypassEnabled(env({ NODE_ENV: 'production', SMART_FORM_QA_AUTH_BYPASS: 'true' })), false);
});
