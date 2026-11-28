/**
 * deploy/production/command-center-edge.sh — the single writer of the public
 * Command Center edge (Caddy site + Google sign-in gate). Exercised in `render`
 * mode, which performs no ssh and masks credentials.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

const SCRIPT = resolve(process.cwd(), 'deploy/production/command-center-edge.sh');

const BASE = {
  CC_ENABLED: 'true',
  CC_PUBLIC: 'true',
  CC_DOMAIN: 'cc.example.com',
  CC_ALLOWED_EMAILS: 'Operator@Example.com, second@example.com',
  GOOGLE_CLIENT_ID: 'client-id-value',
  GOOGLE_CLIENT_SECRET: 'client-secret-value',
  NEXTAUTH_SECRET: 'nextauth-secret-value',
  DEPLOY_USER: 'deploy',
  DEPLOY_HOST: 'host',
  DEPLOY_PATH: '/opt/unit-talk',
};

function render(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  for (const [k, v] of Object.entries({ ...BASE, ...overrides })) if (v !== undefined) env[k] = v;
  const r = spawnSync('bash', [SCRIPT, 'render'], { env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('enabled: renders the gate env, allow-list and site, with credentials masked', () => {
  const r = render();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /OAUTH2_PROXY_PROVIDER=google/);
  assert.match(r.out, /OAUTH2_PROXY_REDIRECT_URL=https:\/\/cc\.example\.com\/oauth2\/callback/);
  assert.match(r.out, /OAUTH2_PROXY_AUTHENTICATED_EMAILS_FILE=\/etc\/oauth2-proxy\/allowed-emails\.txt/);
  assert.match(r.out, /OAUTH2_PROXY_COOKIE_SECURE=true/);
  assert.match(r.out, /^cc\.example\.com \{$/m);
  assert.ok(!r.out.includes('__COMMAND_CENTER_DOMAIN__'));
  for (const secret of ['client-secret-value', 'nextauth-secret-value', 'client-id-value']) {
    assert.ok(!r.out.includes(secret), `${secret} must never be printed`);
  }
  assert.ok(!/operator@|second@/i.test(r.out), 'allow-list addresses are masked in render output');
  assert.equal((r.out.match(/^\*\*\*@example\.com$/gm) ?? []).length, 2, 'two normalised, de-duplicated entries');
});

test('disabled: removes the gate env, allow-list and site and writes nothing', () => {
  for (const flag of [undefined, '', 'false', 'TRUE']) {
    const r = render({ CC_PUBLIC: flag });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /rm -f .*\.env\.command-center-auth.*allowed-emails\.txt.*caddy-sites\/command-center\.caddy/);
    assert.ok(!r.out.includes('OAUTH2_PROXY_'), 'nothing is written when disabled');
  }
});

test('refuses a public edge without a running Command Center', () => {
  const r = render({ CC_ENABLED: 'false' });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /UNIT_TALK_COMMAND_CENTER_ENABLED/);
});

test('refuses missing values, a bad hostname and a bad or empty allow-list', () => {
  for (const name of ['CC_DOMAIN', 'CC_ALLOWED_EMAILS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXTAUTH_SECRET']) {
    const r = render({ [name]: '' });
    assert.notEqual(r.code, 0, `${name} empty must be refused`);
  }
  for (const domain of ['CC.Example.com', 'cc.example.com/x', 'cc example.com', 'localhost', 'a.com;rm -rf /', '-x.example.com']) {
    assert.notEqual(render({ CC_DOMAIN: domain }).code, 0, `${domain} must be refused`);
  }
  for (const emails of [' , ', 'not-an-email', 'ok@example.com, bad']) {
    assert.notEqual(render({ CC_ALLOWED_EMAILS: emails }).code, 0, `${emails} must be refused`);
  }
});

test('the cookie secret is derived, 32 bytes, and changes with NEXTAUTH_SECRET', () => {
  // Re-derive exactly as the script does, without printing it from the script.
  const derive = (key: string) =>
    spawnSync('bash', ['-c', `printf '%s' 'unit-talk/command-center-auth/cookie/v1' | openssl dgst -sha256 -hmac "$K" -binary | base64 | tr '+/' '-_' | tr -d '=\\n'`], {
      env: { PATH: process.env.PATH ?? '', K: key },
      encoding: 'utf8',
    }).stdout;
  const a = derive('one');
  const b = derive('two');
  assert.equal(a.length, 43);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.notEqual(a, b);
  assert.notEqual(a, 'one');
});
