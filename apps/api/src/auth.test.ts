import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import {
  loadAuthConfig,
  authenticateRequest,
  authorizeRoute,
  routeAllowsRole,
  signCapperToken,
} from './auth.js';

function fakeRequest(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('loadAuthConfig', () => {
  test('returns enabled=false when no keys configured', () => {
    const config = loadAuthConfig({});
    assert.equal(config.enabled, false);
    assert.equal(config.keys.size, 0);
  });

  test('loads operator key from env', () => {
    const config = loadAuthConfig({
      UNIT_TALK_API_KEY_OPERATOR: 'sk-op-test123',
    });
    assert.equal(config.enabled, true);
    assert.equal(config.keys.size, 1);
    const ctx = config.keys.get('sk-op-test123');
    assert.equal(ctx?.role, 'operator');
    assert.ok(ctx?.identity.startsWith('operator:'));
  });

  test('loads multiple keys', () => {
    const config = loadAuthConfig({
      UNIT_TALK_API_KEY_OPERATOR: 'key-op',
      UNIT_TALK_API_KEY_SUBMITTER: 'key-sub',
      UNIT_TALK_API_KEY_SETTLER: 'key-set',
    });
    assert.equal(config.keys.size, 3);
    assert.equal(config.keys.get('key-op')?.role, 'operator');
    assert.equal(config.keys.get('key-sub')?.role, 'submitter');
    assert.equal(config.keys.get('key-set')?.role, 'settler');
  });

  test('ignores empty string keys', () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: '' });
    assert.equal(config.enabled, false);
  });

  test('trims whitespace from keys', () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: '  sk-op  ' });
    assert.ok(config.keys.has('sk-op'));
  });
});

test('loadAuthConfig fails closed when production has no API keys', () => {
  assert.throws(
    () =>
      loadAuthConfig({
        NODE_ENV: 'production',
        UNIT_TALK_APP_ENV: 'production',
        UNIT_TALK_API_RUNTIME_MODE: 'fail_closed',
      }),
    /API auth is fail_closed/,
  );
});

test('loadAuthConfig treats UNIT_TALK_CC_API_KEY as an operator key', () => {
  const config = loadAuthConfig({
    NODE_ENV: 'production',
    UNIT_TALK_APP_ENV: 'production',
    UNIT_TALK_CC_API_KEY: 'cc-secret',
  });

  const auth = config.keys.get('cc-secret');
  assert.equal(config.enabled, true);
  assert.equal(config.failClosed, true);
  assert.equal(auth?.role, 'operator');
  assert.equal(auth?.identity.startsWith('operator:command-center:'), true);
});

describe('authenticateRequest', () => {
  test('returns bypass context when auth is disabled', async () => {
    const config = loadAuthConfig({});
    const auth = await authenticateRequest(fakeRequest(), config);
    assert.ok(auth);
    assert.equal(auth.role, 'operator');
    assert.ok(auth.identity.includes('bypass'));
  });

  test('returns null when disabled auth config is explicitly fail-closed', async () => {
    const auth = await authenticateRequest(fakeRequest(), {
      enabled: false,
      failClosed: true,
      keys: new Map(),
    });
    assert.equal(auth, null);
  });

  test('returns null when auth enabled but no Authorization header', async () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'secret' });
    const auth = await authenticateRequest(fakeRequest(), config);
    assert.equal(auth, null);
  });

  test('returns null for invalid token', async () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'secret' });
    const auth = await authenticateRequest(
      fakeRequest({ authorization: 'Bearer wrong-token' }),
      config,
    );
    assert.equal(auth, null);
  });

  test('returns null for malformed Authorization header', async () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'secret' });
    const auth = await authenticateRequest(
      fakeRequest({ authorization: 'Basic dXNlcjpwYXNz' }),
      config,
    );
    assert.equal(auth, null);
  });

  test('returns context for valid token', async () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'secret' });
    const auth = await authenticateRequest(
      fakeRequest({ authorization: 'Bearer secret' }),
      config,
    );
    assert.ok(auth);
    assert.equal(auth.role, 'operator');
  });

  test('matches correct role for submitter key', async () => {
    const config = loadAuthConfig({
      UNIT_TALK_API_KEY_OPERATOR: 'op-key',
      UNIT_TALK_API_KEY_SUBMITTER: 'sub-key',
    });
    const auth = await authenticateRequest(
      fakeRequest({ authorization: 'Bearer sub-key' }),
      config,
    );
    assert.ok(auth);
    assert.equal(auth.role, 'submitter');
  });

  test('validates signed capper JWT and extracts capperId', async () => {
    const secret = 'test-jwt-secret-32-bytes-long-xx';
    const token = await signCapperToken(
      { sub: 'griff843', capperId: 'griff843', displayName: 'Griff' },
      secret,
    );
    const config = loadAuthConfig({
      UNIT_TALK_API_KEY_OPERATOR: 'op-key',
      UNIT_TALK_JWT_SECRET: secret,
    });
    const auth = await authenticateRequest(
      fakeRequest({ authorization: `Bearer ${token}` }),
      config,
    );
    assert.ok(auth);
    assert.equal(auth.role, 'capper');
    assert.equal(auth.capperId, 'griff843');
    assert.equal(auth.displayName, 'Griff');
  });

  test('rejects JWT signed with wrong secret', async () => {
    const token = await signCapperToken(
      { sub: 'griff843', capperId: 'griff843', displayName: 'Griff' },
      'wrong-secret',
    );
    const config = loadAuthConfig({
      UNIT_TALK_API_KEY_OPERATOR: 'op-key',
      UNIT_TALK_JWT_SECRET: 'correct-secret',
    });
    const auth = await authenticateRequest(
      fakeRequest({ authorization: `Bearer ${token}` }),
      config,
    );
    assert.equal(auth, null);
  });
});

describe('authorizeRoute', () => {
  test('operator is allowed on all routes', () => {
    const op = { role: 'operator' as const, identity: 'test' };
    assert.ok(authorizeRoute(op, '/api/submissions'));
    assert.ok(authorizeRoute(op, '/api/picks/abc/settle'));
    assert.ok(authorizeRoute(op, '/api/picks/abc/review'));
    assert.ok(authorizeRoute(op, '/api/picks/abc/retry-delivery'));
    assert.ok(authorizeRoute(op, '/api/picks/abc/rerun-promotion'));
    assert.ok(authorizeRoute(op, '/api/picks/abc/override-promotion'));
    assert.ok(authorizeRoute(op, '/api/picks/abc/requeue'));
    assert.ok(authorizeRoute(op, '/api/grading/run'));
    assert.ok(authorizeRoute(op, '/api/recap/post'));
    assert.ok(authorizeRoute(op, '/api/member-tiers'));
  });

  test('submitter can only access /api/submissions', () => {
    const sub = { role: 'submitter' as const, identity: 'test' };
    assert.ok(authorizeRoute(sub, '/api/submissions'));
    assert.equal(authorizeRoute(sub, '/api/picks/abc/settle'), false);
    assert.equal(authorizeRoute(sub, '/api/picks/abc/review'), false);
    assert.equal(authorizeRoute(sub, '/api/member-tiers'), false);
  });

  test('settler can access settle and grading', () => {
    const settler = { role: 'settler' as const, identity: 'test' };
    assert.ok(authorizeRoute(settler, '/api/picks/abc/settle'));
    assert.ok(authorizeRoute(settler, '/api/grading/run'));
    assert.equal(authorizeRoute(settler, '/api/submissions'), false);
    assert.equal(authorizeRoute(settler, '/api/picks/abc/review'), false);
  });

  test('poster can only access recap', () => {
    const poster = { role: 'poster' as const, identity: 'test' };
    assert.ok(authorizeRoute(poster, '/api/recap/post'));
    assert.equal(authorizeRoute(poster, '/api/submissions'), false);
    assert.equal(authorizeRoute(poster, '/api/member-tiers'), false);
  });

  test('denies unknown routes', () => {
    const op = { role: 'submitter' as const, identity: 'test' };
    assert.equal(authorizeRoute(op, '/api/unknown'), false);
  });
});

test('operator-only Command Center mutation routes deny non-operator roles', () => {
  const operatorRoutes = [
    '/api/picks/pick-123/review',
    '/api/picks/pick-123/retry-delivery',
    '/api/picks/pick-123/rerun-promotion',
    '/api/picks/pick-123/override-promotion',
    '/api/picks/pick-123/requeue',
    '/api/board/write-picks',
    '/api/board/run-tuning',
    '/api/model-health/decision',
    '/api/qa/seed-pick',
  ];

  for (const route of operatorRoutes) {
    assert.equal(routeAllowsRole('operator', route), true, route);
    assert.equal(routeAllowsRole('submitter', route), false, route);
  }
});
