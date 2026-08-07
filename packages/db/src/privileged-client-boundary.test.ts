import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
} from './target-identity.js';
import {
  PrivilegedTargetRefusedError,
  assertTargetAllowed,
  classifyKeyRole,
  classifyTarget,
  createPrivilegedClient,
  decideTarget,
  detectRestriction,
} from './privileged-client-boundary.js';

const PRODUCTION_URL = `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const STAGING_URL = `https://${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co`;

const RESTRICTED = { NODE_TEST_CONTEXT: 'child-v8' } as NodeJS.ProcessEnv;
const UNRESTRICTED = {} as NodeJS.ProcessEnv;

function jwt(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  return `header.${payload}.signature`;
}

const SERVICE_KEY = jwt('service_role');
const ANON_KEY = jwt('anon');

// ---------------------------------------------------------------------------
// Restriction detection
// ---------------------------------------------------------------------------

test('the node:test runner puts the process in a restricted context', () => {
  // Not a fixture: this suite is itself running under node:test.
  assert.equal(detectRestriction(process.env).restricted, true);
  assert.match(detectRestriction(process.env).signal, /NODE_TEST_CONTEXT/u);
});

test('an ordinary process is unrestricted', () => {
  assert.deepEqual(detectRestriction(UNRESTRICTED), { restricted: false, signal: 'none' });
});

test('a CI job can opt into the same containment without node:test', () => {
  assert.equal(
    detectRestriction({ UNIT_TALK_DB_TARGET_POLICY: 'staging-only' }).restricted,
    true,
  );
  assert.equal(detectRestriction({ NODE_ENV: 'test' }).restricted, true);
});

// ---------------------------------------------------------------------------
// The core rule
// ---------------------------------------------------------------------------

test('a test process may not open a service-role connection to production', () => {
  const decision = decideTarget({ url: PRODUCTION_URL, key: SERVICE_KEY }, RESTRICTED);
  assert.equal(decision.allowed, false);
  assert.equal(decision.kind, 'canonical-production');
  assert.equal(decision.role, 'service_role');
  assert.match(decision.reason, /CANONICAL PRODUCTION/u);
});

test('a test process may not open an ANON connection to production either', () => {
  // The rule is about the target, not only about the credential: a read against
  // production from the test suite is still the test suite reaching production.
  const decision = decideTarget({ url: PRODUCTION_URL, key: ANON_KEY }, RESTRICTED);
  assert.equal(decision.allowed, false);
});

test('a test process may reach the approved staging project', () => {
  const decision = decideTarget({ url: STAGING_URL, key: SERVICE_KEY }, RESTRICTED);
  assert.equal(decision.allowed, true);
  assert.equal(decision.kind, 'approved-staging');
});

test('a test process may reach literal loopback, which the offline suite uses', () => {
  for (const url of ['http://127.0.0.1:1', 'http://localhost:54321', 'http://[::1]:5432']) {
    assert.equal(decideTarget({ url, key: SERVICE_KEY }, RESTRICTED).allowed, true, url);
  }
});

test('production runtime is not second-guessed', () => {
  const decision = decideTarget({ url: PRODUCTION_URL, key: SERVICE_KEY }, UNRESTRICTED);
  assert.equal(decision.allowed, true);
  assert.equal(decision.kind, 'canonical-production');
});

// ---------------------------------------------------------------------------
// Fail-closed on everything that is not positively identified
// ---------------------------------------------------------------------------

test('an unidentifiable target is refused from a test process, not waved through', () => {
  const hostile = [
    // A custom domain or reverse proxy could front production.
    'https://db.unit-talk.com',
    // A pooler host is one label deeper than a project host.
    `https://db.${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
    // A tunnel.
    'https://abcdefghijklmnopqrst.trycloudflare.com',
    // A lookalike suffix.
    `https://${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co.evil.example`,
    // Ref-shaped label on a host that is not Supabase at all.
    'https://abcdefghijklmnopqrst.evil.example',
    // Missing and malformed.
    '',
    'not a url',
  ];
  for (const url of hostile) {
    const decision = decideTarget({ url, key: SERVICE_KEY }, RESTRICTED);
    assert.equal(decision.allowed, false, `expected refusal for ${JSON.stringify(url)}`);
  }
});

test('a percent-encoded production host is resolved, not smuggled past', () => {
  const disguised = 'https://zfzdnfwdarxucxtaojx%6d.supabase.co';
  const { kind } = classifyTarget(disguised);
  assert.equal(kind, 'canonical-production');
  assert.equal(decideTarget({ url: disguised, key: SERVICE_KEY }, RESTRICTED).allowed, false);
});

test('a trailing-dot FQDN for production is resolved, not treated as unknown', () => {
  const fqdn = `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co.`;
  assert.equal(classifyTarget(fqdn).kind, 'canonical-production');
});

test('a hostname that merely resolves to loopback is not accepted as loopback', () => {
  // Only literal loopback forms count, so this cannot be widened by DNS or hosts.
  assert.equal(classifyTarget('http://local.test').kind, 'unidentified');
  assert.equal(decideTarget({ url: 'http://local.test', key: SERVICE_KEY }, RESTRICTED).allowed, false);
});

// ---------------------------------------------------------------------------
// Role is measured
// ---------------------------------------------------------------------------

test('key role is read from the key, not declared by the caller', () => {
  assert.equal(classifyKeyRole(SERVICE_KEY), 'service_role');
  assert.equal(classifyKeyRole(ANON_KEY), 'anon');
  assert.equal(classifyKeyRole('sb_secret_abc123'), 'service_role');
  assert.equal(classifyKeyRole('sb_publishable_abc123'), 'anon');
});

test('an unreadable key is treated as privileged, not as safe', () => {
  for (const key of ['', undefined, 'garbage', 'a.b.c', jwt('authenticated')]) {
    assert.equal(classifyKeyRole(key), 'unidentified', JSON.stringify(key));
  }
});

// ---------------------------------------------------------------------------
// Throwing path
// ---------------------------------------------------------------------------

test('assertTargetAllowed throws, and the message carries identity but no credential', () => {
  const secret = jwt('service_role');
  let thrown: unknown;
  try {
    assertTargetAllowed({ url: PRODUCTION_URL, key: secret }, 'unit test', RESTRICTED);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof PrivilegedTargetRefusedError);
  const message = (thrown as Error).message;
  assert.match(message, new RegExp(CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF, 'u'));
  assert.ok(!message.includes(secret), 'the key must never appear in the message');
  assert.ok(
    !message.includes(secret.split('.')[1] as string),
    'no part of the key may appear in the message',
  );
});

test('createPrivilegedClient refuses production from this very test process', () => {
  // No env argument: this asserts against the real process environment, which
  // is restricted because node:test is running. This is the invariant the lane
  // exists for, exercised end to end.
  assert.throws(
    () => createPrivilegedClient(PRODUCTION_URL, SERVICE_KEY),
    PrivilegedTargetRefusedError,
  );
});

test('createPrivilegedClient returns a client for loopback from a test process', () => {
  const client = createPrivilegedClient('http://127.0.0.1:1', SERVICE_KEY);
  assert.equal(typeof client.from, 'function');
});
