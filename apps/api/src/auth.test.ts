import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import {
  loadAuthConfig,
  authenticateRequest,
  authorizeRoute,
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
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'sk-op-test123' });
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

describe('authenticateRequest', () => {
  test('returns bypass context when auth is disabled', () => {
    const config = loadAuthConfig({});
    const auth = authenticateRequest(fakeRequest(), config);
    assert.ok(auth);
    assert.equal(auth.role, 'operator');
    assert.ok(auth.identity.includes('bypass'));
  });

  test('returns null when auth enabled but no Authorization header', () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'secret' });
    const auth = authenticateRequest(fakeRequest(), config);
    assert.equal(auth, null);
  });

  test('returns null for invalid token', () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'secret' });
    const auth = authenticateRequest(
      fakeRequest({ authorization: 'Bearer wrong-token' }),
      config,
    );
    assert.equal(auth, null);
  });

  test('returns null for malformed Authorization header', () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'secret' });
    const auth = authenticateRequest(
      fakeRequest({ authorization: 'Basic dXNlcjpwYXNz' }),
      config,
    );
    assert.equal(auth, null);
  });

  test('returns context for valid token', () => {
    const config = loadAuthConfig({ UNIT_TALK_API_KEY_OPERATOR: 'secret' });
    const auth = authenticateRequest(
      fakeRequest({ authorization: 'Bearer secret' }),
      config,
    );
    assert.ok(auth);
    assert.equal(auth.role, 'operator');
  });

  test('matches correct role for submitter key', () => {
    const config = loadAuthConfig({
      UNIT_TALK_API_KEY_OPERATOR: 'op-key',
      UNIT_TALK_API_KEY_SUBMITTER: 'sub-key',
    });
    const auth = authenticateRequest(
      fakeRequest({ authorization: 'Bearer sub-key' }),
      config,
    );
    assert.ok(auth);
    assert.equal(auth.role, 'submitter');
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
