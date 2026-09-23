import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';
import { signInDocument } from './sign-in-response';
import {
  authenticateSessionOrHeader, issueOperatorSession, isSameOriginSessionRequest,
  SESSION_COOKIE, SESSION_SECONDS, sessionCookieOptions,
} from './session-auth';

const env = {
  NODE_ENV: 'production', COMMAND_CENTER_AUTH_USERNAME: 'operator',
  COMMAND_CENTER_AUTH_PASSWORD: 'test-password', COMMAND_CENTER_OPERATOR_IDENTITY: 'griff843',
};
const credentials = new Headers({ authorization: `Basic ${Buffer.from('operator:test-password').toString('base64')}` });
const now = Date.parse('2026-09-20T12:00:00Z');
function sessionHeaders(value: string) { return new Headers({ cookie: `${SESSION_COOKIE}=${value}` }); }

test('server-issued sessions prove actor identity without forwarding the original password', async () => {
  const session = await issueOperatorSession(credentials, env, now);
  assert.doesNotMatch(Buffer.from(session.split('.')[0]!, 'base64url').toString(), /test-password/);
  assert.deepEqual(await authenticateSessionOrHeader(sessionHeaders(session), env, now), {
    ok: true, auth: { actor: 'griff843', role: 'operator', method: 'session' },
  });
});

test('forged identity, tampered signatures, duplicate cookies and malformed sessions are refused', async () => {
  const session = await issueOperatorSession(credentials, env, now);
  const forged = Buffer.from(JSON.stringify({ actor: 'attacker', expires: now + 999999 })).toString('base64url');
  for (const value of ['', 'griff843', `${forged}.${session.split('.')[1]}`, `${session.slice(0, -3)}aaa`, 'a.b.c', 'x'.repeat(3000)]) {
    const headers = sessionHeaders(value);
    headers.set('x-command-center-actor', 'griff843');
    assert.equal((await authenticateSessionOrHeader(headers, env, now)).ok, false);
  }
  assert.equal((await authenticateSessionOrHeader(new Headers({ cookie: `${SESSION_COOKIE}=${session}; ${SESSION_COOKIE}=${session}` }), env, now)).ok, false);
});

test('expiry, future issuance, credential rotation and actor remapping invalidate sessions', async () => {
  const session = await issueOperatorSession(credentials, env, now);
  for (const [configuration, clock] of [
    [env, now + SESSION_SECONDS * 1000], [env, now - 1000],
    [{ ...env, COMMAND_CENTER_AUTH_PASSWORD: 'rotated' }, now],
    [{ ...env, COMMAND_CENTER_OPERATOR_IDENTITY: 'another-operator' }, now],
  ] as const) {
    assert.equal((await authenticateSessionOrHeader(sessionHeaders(session), configuration, clock)).ok, false);
  }
});

test('sessions never bypass explicit bad credentials or missing authentication configuration', async () => {
  const session = await issueOperatorSession(credentials, env, now);
  const headers = sessionHeaders(session);
  headers.set('authorization', 'Bearer wrong');
  assert.equal((await authenticateSessionOrHeader(headers, env, now)).ok, false);
  const result = await authenticateSessionOrHeader(sessionHeaders(session), { NODE_ENV: 'production' }, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
  await assert.rejects(issueOperatorSession(new Headers(), env, now));
  await assert.rejects(issueOperatorSession(new Headers(), { NODE_ENV: 'development' }, now));
});

test('session endpoints require exact same origin, and deployed cookies require HTTPS', () => {
  const forwarded = new Headers({ origin: 'https://cc.example', host: 'cc.example', 'x-forwarded-proto': 'https' });
  assert.equal(isSameOriginSessionRequest(new Request('http://localhost:4300/api/session', { headers: forwarded })), true);
  assert.equal(sessionCookieOptions('http://localhost:4300', forwarded).secure, true);
  assert.equal(sessionCookieOptions('http://localhost:4300', new Headers({ host: 'cc.example' })).secure, true);
  assert.equal(isSameOriginSessionRequest(new Request('https://cc.example/api/session', { headers: { origin: 'https://cc.example', 'sec-fetch-site': 'same-origin' } })), true);
  for (const origin of ['https://attacker.example', 'http://cc.example', 'null', 'https://cc.example:444']) {
    assert.equal(isSameOriginSessionRequest(new Request('https://cc.example/api/session', { headers: { origin } })), false);
  }
  assert.equal(isSameOriginSessionRequest(new Request('https://cc.example/api/session')), false);
  assert.equal(sessionCookieOptions('https://cc.example').secure, true);
  assert.equal(sessionCookieOptions('http://cc.example').secure, true);
  assert.equal(sessionCookieOptions('http://127.0.0.1:4302').secure, false);
  assert.equal(sessionCookieOptions('http://localhost:4302').httpOnly, true);
  assert.equal(sessionCookieOptions('http://localhost:4302').sameSite, 'strict');
});

test('UTF-8 operator credentials work, and token-only deployments have a usable form', async () => {
  const unicodeEnv = { ...env, COMMAND_CENTER_AUTH_PASSWORD: 'sëcret🔑' };
  const authorization = `Basic ${Buffer.from('operator:sëcret🔑').toString('base64')}`;
  const session = await issueOperatorSession(new Headers({ authorization }), unicodeEnv, now);
  assert.equal((await authenticateSessionOrHeader(sessionHeaders(session), unicodeEnv, now)).ok, true);
  const html = signInDocument('testnonce', false, false);
  assert.match(html, /Operator access token/);
  assert.doesNotMatch(html, /id="username"/);
});

test('anonymous document gets a sign-in form at 401, while API requests stay refused', async () => {
  const saved = { ...process.env };
  try {
    for (const name of Object.keys(process.env)) if (/^(UNIT_TALK_|COMMAND_CENTER_|NODE_ENV)/.test(name)) delete process.env[name];
    Object.assign(process.env, env);
    const response = await middleware(new NextRequest('http://localhost/picks/deep-link', { headers: { accept: 'text/html' } }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), null, 'the browser must not hide the visible form behind a native prompt');
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const html = await response.text();
    assert.match(html, /Sign in to Command Center/);
    assert.doesNotMatch(html, /test-password|griff843/);
    const api = await middleware(new NextRequest('http://localhost/api/session', { method: 'POST' }));
    assert.equal(api.status, 401);
    assert.equal(api.headers.get('www-authenticate'), null);
    assert.equal((await api.json()).ok, false);
    const credential = await issueOperatorSession(credentials);
    const authenticated = await middleware(new NextRequest('http://localhost/picks', { headers: sessionHeaders(credential) }));
    assert.equal(authenticated.headers.get('x-middleware-next'), '1');
    assert.equal(authenticated.headers.get('x-middleware-request-x-command-center-actor'), 'griff843');
  } finally {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});
