import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandRunner } from './merge-wrapper.js';
import {
  EXECUTOR_APP_LOGIN,
  REFRESH_MARGIN_MS,
  buildAppJwt,
  getExecutorToken,
  isTokenFresh,
  mintInstallationToken,
  readTokenCache,
  resolveExecutorAppConfig,
  resolveExecutorGhIdentitySync,
  summarizeToken,
  writeTokenCache,
  type ExecutorAppConfig,
  type MintedToken,
} from './executor-app-token.js';

// A throwaway RSA key generated per test run. It is NOT the real App key and
// never leaves this process; the real key is never read by any test.
const { privateKey: TEST_PEM, publicKey: TEST_PUB } = (() => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    publicKey: pair.publicKey,
  };
})();

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1572-'));
}

/** An empty root so local.env/.env in the real repo can never leak into a test. */
function emptyRoot(): string {
  return scratchDir();
}

function writeKeyFile(dir: string, mode = 0o600): string {
  const keyPath = path.join(dir, 'app.pem');
  fs.writeFileSync(keyPath, TEST_PEM, { mode });
  fs.chmodSync(keyPath, mode);
  return keyPath;
}

function configuredEnv(dir: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    EXECUTOR_APP_ID: '4806091',
    EXECUTOR_APP_INSTALLATION_ID: '158513661',
    EXECUTOR_APP_PRIVATE_KEY_PATH: writeKeyFile(dir),
    EXECUTOR_APP_TOKEN_CACHE_PATH: path.join(dir, 'cache', 'token.json'),
    ...overrides,
  };
}

function fakeConfig(dir: string): ExecutorAppConfig {
  return {
    appId: '4806091',
    installationId: '158513661',
    privateKeyPem: TEST_PEM,
    keySource: 'path',
    cachePath: path.join(dir, 'cache', 'token.json'),
    apiBaseUrl: 'https://api.example.test',
  };
}

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const { status, body } = handler(url, init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const T0 = Date.parse('2026-09-02T18:00:00.000Z');
const ONE_HOUR = 60 * 60 * 1000;

// ─── configuration resolution / rollback switch ─────────────────────────────

test('UTV2-1572: unset EXECUTOR_APP_ID resolves to not_configured (rollback = ambient identity)', () => {
  const resolution = resolveExecutorAppConfig({}, emptyRoot());
  assert.equal(resolution.configured, false);
  if (resolution.configured) return;
  assert.equal(resolution.code, 'not_configured');
  assert.match(resolution.reason, /EXECUTOR_APP_ID is not set/);
});

test('UTV2-1572: EXECUTOR_APP_DISABLED=1 disables a fully configured App (rollback switch wins)', () => {
  const dir = scratchDir();
  const resolution = resolveExecutorAppConfig(configuredEnv(dir, { EXECUTOR_APP_DISABLED: '1' }), emptyRoot());
  assert.equal(resolution.configured, false);
  if (resolution.configured) return;
  assert.equal(resolution.code, 'disabled');
});

test('UTV2-1572: a fully configured App resolves with key material loaded from the 0600 key path', () => {
  const dir = scratchDir();
  const resolution = resolveExecutorAppConfig(configuredEnv(dir), emptyRoot());
  assert.equal(resolution.configured, true);
  if (!resolution.configured) return;
  assert.equal(resolution.config.appId, '4806091');
  assert.equal(resolution.config.installationId, '158513661');
  assert.equal(resolution.config.keySource, 'path');
  assert.equal(resolution.config.privateKeyPem, TEST_PEM);
  assert.equal(resolution.config.cachePath, path.join(dir, 'cache', 'token.json'));
});

test('UTV2-1572: a group/world-readable key file is refused (fail closed, not configured)', () => {
  const dir = scratchDir();
  const env = configuredEnv(dir);
  fs.chmodSync(env.EXECUTOR_APP_PRIVATE_KEY_PATH as string, 0o644);
  const resolution = resolveExecutorAppConfig(env, emptyRoot());
  assert.equal(resolution.configured, false);
  if (resolution.configured) return;
  assert.equal(resolution.code, 'invalid');
  assert.match(resolution.reason, /chmod 600/);
});

test('UTV2-1572: missing key path and inline key is invalid; non-PEM inline key is invalid', () => {
  const dir = scratchDir();
  const noKey = resolveExecutorAppConfig(
    { ...configuredEnv(dir), EXECUTOR_APP_PRIVATE_KEY_PATH: '' },
    emptyRoot(),
  );
  assert.equal(noKey.configured, false);
  const badInline = resolveExecutorAppConfig(
    { ...configuredEnv(dir), EXECUTOR_APP_PRIVATE_KEY_PATH: '', EXECUTOR_APP_PRIVATE_KEY: 'not a key' },
    emptyRoot(),
  );
  assert.equal(badInline.configured, false);
  if (!badInline.configured) assert.match(badInline.reason, /PEM/);
});

test('UTV2-1572: inline EXECUTOR_APP_PRIVATE_KEY (CI secret) is accepted with escaped newlines normalized', () => {
  const dir = scratchDir();
  const resolution = resolveExecutorAppConfig(
    { ...configuredEnv(dir), EXECUTOR_APP_PRIVATE_KEY_PATH: '', EXECUTOR_APP_PRIVATE_KEY: TEST_PEM.replace(/\n/g, '\\n') },
    emptyRoot(),
  );
  assert.equal(resolution.configured, true);
  if (!resolution.configured) return;
  assert.equal(resolution.config.keySource, 'env');
  assert.equal(resolution.config.privateKeyPem.trim(), TEST_PEM.trim());
});

// ─── App JWT ────────────────────────────────────────────────────────────────

test('UTV2-1572: buildAppJwt produces an RS256 JWT bound to the App id with a <=10 minute life', () => {
  const nowSeconds = Math.floor(T0 / 1000);
  const jwt = buildAppJwt('4806091', TEST_PEM, nowSeconds);
  const [header, payload, signature] = jwt.split('.');
  assert.ok(header && payload && signature);
  const decode = (part: string) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.deepEqual(decode(header), { alg: 'RS256', typ: 'JWT' });
  const claims = decode(payload) as { iat: number; exp: number; iss: string };
  assert.equal(claims.iss, '4806091');
  assert.equal(claims.iat, nowSeconds - 60);
  assert.ok(claims.exp - claims.iat <= 600, 'GitHub rejects App JWTs longer than 10 minutes');
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    TEST_PUB,
    Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  );
  assert.equal(verified, true);
  assert.ok(!jwt.includes('PRIVATE KEY'), 'key material must never appear in the JWT');
});

// ─── minting ────────────────────────────────────────────────────────────────

test('UTV2-1572: mintInstallationToken posts to the installation access_tokens endpoint with a Bearer App JWT', async () => {
  const dir = scratchDir();
  const config = fakeConfig(dir);
  let seenAuth = '';
  const doFetch = fakeFetch((url, init) => {
    seenAuth = String((init.headers as Record<string, string>).Authorization ?? '');
    assert.equal(init.method, 'POST');
    return {
      status: 201,
      body: { token: 'ghs_fake_token', expires_at: new Date(T0 + ONE_HOUR).toISOString(), permissions: { contents: 'write' } },
    };
  });
  const minted = await mintInstallationToken(config, { fetch: doFetch, now: () => T0 });
  assert.deepEqual(doFetch.calls, ['https://api.example.test/app/installations/158513661/access_tokens']);
  assert.match(seenAuth, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(minted.token, 'ghs_fake_token');
  assert.equal(minted.login, EXECUTOR_APP_LOGIN);
  assert.equal(minted.app_id, '4806091');
  assert.equal(minted.installation_id, '158513661');
  assert.deepEqual(minted.permissions, { contents: 'write' });
  assert.equal(Object.hasOwn(summarizeToken(minted), 'token'), false, 'summary must never carry the token');
});

test('UTV2-1572: a non-2xx mint response throws with status + message and no credential echo', async () => {
  const dir = scratchDir();
  const doFetch = fakeFetch(() => ({ status: 401, body: { message: 'A JSON web token could not be decoded' } }));
  await assert.rejects(
    mintInstallationToken(fakeConfig(dir), { fetch: doFetch, now: () => T0 }),
    (error: Error) => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /could not be decoded/);
      assert.ok(!error.message.includes('PRIVATE KEY'));
      return true;
    },
  );
});

// ─── cache + refresh behavior ───────────────────────────────────────────────

function tokenExpiring(atMs: number, token = 'ghs_cached'): MintedToken {
  return {
    token,
    expires_at: new Date(atMs).toISOString(),
    minted_at: new Date(atMs - ONE_HOUR).toISOString(),
    app_id: '4806091',
    installation_id: '158513661',
    login: EXECUTOR_APP_LOGIN,
    permissions: {},
  };
}

test('UTV2-1572: isTokenFresh is true only while more than the refresh margin remains', () => {
  assert.equal(isTokenFresh(tokenExpiring(T0 + REFRESH_MARGIN_MS + 1000), T0), true);
  assert.equal(isTokenFresh(tokenExpiring(T0 + REFRESH_MARGIN_MS), T0), false);
  assert.equal(isTokenFresh(tokenExpiring(T0 - 1), T0), false);
  assert.equal(isTokenFresh({ expires_at: 'garbage' }, T0), false);
});

test('UTV2-1572: writeTokenCache writes 0600 inside a 0700 directory and readTokenCache round-trips', () => {
  const dir = scratchDir();
  const config = fakeConfig(dir);
  writeTokenCache(config.cachePath, tokenExpiring(T0 + ONE_HOUR));
  assert.equal(fs.statSync(config.cachePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(config.cachePath)).mode & 0o777, 0o700);
  const cached = readTokenCache(config.cachePath, config, T0);
  assert.equal(cached?.token, 'ghs_cached');
});

test('UTV2-1572: readTokenCache rejects a token minted for a different App/installation or a malformed file', () => {
  const dir = scratchDir();
  const config = fakeConfig(dir);
  writeTokenCache(config.cachePath, { ...tokenExpiring(T0 + ONE_HOUR), installation_id: '1' });
  assert.equal(readTokenCache(config.cachePath, config, T0), null);
  fs.writeFileSync(config.cachePath, '{not json');
  assert.equal(readTokenCache(config.cachePath, config, T0), null);
  assert.equal(readTokenCache(path.join(dir, 'missing.json'), config, T0), null);
});

test('UTV2-1572: getExecutorToken reuses a fresh cached token without a network call', async () => {
  const dir = scratchDir();
  const config = fakeConfig(dir);
  writeTokenCache(config.cachePath, tokenExpiring(T0 + ONE_HOUR));
  const doFetch = fakeFetch(() => {
    throw new Error('network must not be touched when the cache is fresh');
  });
  const result = await getExecutorToken(config, { fetch: doFetch, now: () => T0 });
  assert.equal(result.source, 'cache');
  assert.equal(result.token.token, 'ghs_cached');
  assert.deepEqual(doFetch.calls, []);
});

test('UTV2-1572: getExecutorToken re-mints when the cached token is inside the refresh margin, and caches the new one', async () => {
  const dir = scratchDir();
  const config = fakeConfig(dir);
  writeTokenCache(config.cachePath, tokenExpiring(T0 + REFRESH_MARGIN_MS - 1000));
  const doFetch = fakeFetch(() => ({
    status: 201,
    body: { token: 'ghs_new', expires_at: new Date(T0 + ONE_HOUR).toISOString(), permissions: {} },
  }));
  const result = await getExecutorToken(config, { fetch: doFetch, now: () => T0 });
  assert.equal(result.source, 'minted');
  assert.equal(result.token.token, 'ghs_new');
  assert.equal(doFetch.calls.length, 1);
  assert.equal(readTokenCache(config.cachePath, config, T0)?.token, 'ghs_new');

  // Second call inside the same window is served from the refreshed cache.
  const again = await getExecutorToken(config, { fetch: doFetch, now: () => T0 + 1000 });
  assert.equal(again.source, 'cache');
  assert.equal(doFetch.calls.length, 1);
});

test('UTV2-1572: --refresh semantics bypass a fresh cache; noCache never touches disk', async () => {
  const dir = scratchDir();
  const config = fakeConfig(dir);
  writeTokenCache(config.cachePath, tokenExpiring(T0 + ONE_HOUR));
  const doFetch = fakeFetch(() => ({
    status: 201,
    body: { token: 'ghs_forced', expires_at: new Date(T0 + ONE_HOUR).toISOString(), permissions: {} },
  }));
  const forced = await getExecutorToken(config, { fetch: doFetch, now: () => T0, refresh: true });
  assert.equal(forced.source, 'minted');
  assert.equal(forced.token.token, 'ghs_forced');

  const noCacheConfig = { ...config, cachePath: path.join(dir, 'never-written.json') };
  const uncached = await getExecutorToken(noCacheConfig, { fetch: doFetch, now: () => T0, noCache: true });
  assert.equal(uncached.source, 'minted');
  assert.equal(fs.existsSync(noCacheConfig.cachePath), false);
});

// ─── synchronous identity boundary used by the merge-wrapper ────────────────

test('UTV2-1572: resolveExecutorGhIdentitySync returns ambient (with reason) when the App is not configured, without spawning', () => {
  let spawned = 0;
  const runner: CommandRunner = () => {
    spawned += 1;
    return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''), error: undefined };
  };
  const identity = resolveExecutorGhIdentitySync({ cwd: '/tmp', env: {} }, { runner, root: emptyRoot() });
  assert.equal(identity.mode, 'ambient');
  if (identity.mode === 'ambient') assert.match(identity.reason, /EXECUTOR_APP_ID is not set/);
  assert.equal(spawned, 0);
});

test('UTV2-1572: resolveExecutorGhIdentitySync spawns the mint CLI and returns GH_TOKEN env when configured', () => {
  const dir = scratchDir();
  const env = configuredEnv(dir);
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const runner: CommandRunner = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return {
      status: 0,
      stdout: Buffer.from(JSON.stringify({ ok: true, token: 'ghs_spawned', expires_at: new Date(T0 + ONE_HOUR).toISOString(), source: 'minted', login: EXECUTOR_APP_LOGIN })),
      stderr: Buffer.from(''),
      error: undefined,
    };
  };
  const identity = resolveExecutorGhIdentitySync({ cwd: '/elsewhere', env }, { runner, root: dir });
  assert.equal(identity.mode, 'app');
  if (identity.mode !== 'app') return;
  assert.equal(identity.env.GH_TOKEN, 'ghs_spawned');
  assert.equal(identity.env.GITHUB_TOKEN, 'ghs_spawned');
  assert.equal(identity.login, EXECUTOR_APP_LOGIN);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'pnpm');
  assert.deepEqual(calls[0].args.slice(0, 2), ['exec', 'tsx']);
  assert.ok(calls[0].args[2].endsWith(path.join('scripts', 'ops', 'executor-app-token.ts')));
  assert.deepEqual(calls[0].args.slice(3), ['mint', '--print-token', '--json']);
  assert.equal(calls[0].cwd, dir);
});

test('UTV2-1572: a configured App whose mint fails is an error, never a silent ambient fallback', () => {
  const dir = scratchDir();
  const env = configuredEnv(dir);
  const runner: CommandRunner = () => ({
    status: 1,
    stdout: Buffer.from(''),
    stderr: Buffer.from('{"ok":false,"code":"executor_app_mint_failed"}'),
    error: undefined,
  });
  assert.throws(
    () => resolveExecutorGhIdentitySync({ cwd: '/tmp', env }, { runner, root: dir }),
    /token mint failed \(exit 1\)/,
  );
});
