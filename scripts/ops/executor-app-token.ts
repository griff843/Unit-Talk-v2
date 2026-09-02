#!/usr/bin/env tsx
/**
 * UTV2-1572 Phase A — executor GitHub App installation-token minting.
 *
 * Mints short-lived installation access tokens for the `unit-talk-executor`
 * GitHub App so executor GitHub writes can be attributed to
 * `unit-talk-executor[bot]` instead of the owner's personal identity.
 *
 * Secrecy contract (never relaxed):
 *   - The App private key is read from disk (or a CI secret) and used only to
 *     sign the App JWT in-process. It is never logged, emitted, or returned to
 *     a caller.
 *   - Installation tokens are written only to a 0600 cache file and are never
 *     printed unless the caller passes the explicit `--print-token` flag to
 *     `mint` (the only consumer is the merge-wrapper's spawn boundary).
 *
 * Fail-closed contract:
 *   - If the App is not configured (`EXECUTOR_APP_ID` unset) or is disabled
 *     (`EXECUTOR_APP_DISABLED=1`), `resolveExecutorAppConfig` reports
 *     `configured: false` with a reason. Callers that migrate a write path
 *     MUST fall back to their pre-Phase-A behavior in that case (that is the
 *     rollback switch) and MUST say so in their output.
 *   - `exec` never silently runs a command under the ambient identity; a
 *     misconfigured App is a hard failure there.
 *
 * Commands:
 *   status                       report configuration + cache state (no secrets)
 *   mint [--refresh] [--print-token]
 *                                mint or reuse a cached installation token
 *   exec -- <command> [args...]  run a command with GH_TOKEN/GITHUB_TOKEN set
 *                                to a fresh installation token
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { bufferToText, type CommandRunner } from './merge-wrapper.js';
import { ROOT, emitJson, parseArgs, readConfiguredEnvValue } from './shared.js';

/** GitHub login every write minted through this helper is attributed to. */
export const EXECUTOR_APP_LOGIN = 'unit-talk-executor[bot]';

/** Refresh when a cached token has less than this much life left. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** App JWTs may live at most 10 minutes; use 9 with a 60s clock-skew backdate. */
const APP_JWT_LIFETIME_SECONDS = 9 * 60;
const APP_JWT_SKEW_SECONDS = 60;

const DEFAULT_API_BASE_URL = 'https://api.github.com';
const DEFAULT_CACHE_PATH = path.join(
  os.homedir(),
  '.config',
  'unit-talk',
  'secrets',
  'unit-talk-executor.token.json',
);

export const EXECUTOR_APP_ENV_KEYS = {
  appId: 'EXECUTOR_APP_ID',
  installationId: 'EXECUTOR_APP_INSTALLATION_ID',
  privateKeyPath: 'EXECUTOR_APP_PRIVATE_KEY_PATH',
  privateKey: 'EXECUTOR_APP_PRIVATE_KEY',
  cachePath: 'EXECUTOR_APP_TOKEN_CACHE_PATH',
  disabled: 'EXECUTOR_APP_DISABLED',
  apiBaseUrl: 'EXECUTOR_APP_API_BASE_URL',
} as const;

export interface ExecutorAppConfig {
  appId: string;
  installationId: string;
  /** PEM private key material. Never log or emit. */
  privateKeyPem: string;
  keySource: 'path' | 'env';
  cachePath: string;
  apiBaseUrl: string;
}

export type ExecutorAppResolution =
  | { configured: true; config: ExecutorAppConfig }
  | { configured: false; reason: string; code: 'disabled' | 'not_configured' | 'invalid' };

export interface MintedToken {
  token: string;
  expires_at: string;
  minted_at: string;
  app_id: string;
  installation_id: string;
  login: string;
  permissions: Record<string, string>;
}

/** Everything about a token that is safe to print. */
export type TokenSummary = Omit<MintedToken, 'token'>;

export function summarizeToken(token: MintedToken): TokenSummary {
  const { token: _secret, ...rest } = token;
  return rest;
}

function readEnv(key: string, env: NodeJS.ProcessEnv, root: string): string {
  try {
    return readConfiguredEnvValue(key, root, env);
  } catch {
    return '';
  }
}

/**
 * Resolves App configuration from process.env, then local.env > .env >
 * .env.example. Never throws for "not configured" — callers branch on
 * `configured` so the rollback switch (unset / EXECUTOR_APP_DISABLED=1) is a
 * first-class outcome, not an exception path.
 */
export function resolveExecutorAppConfig(
  env: NodeJS.ProcessEnv = process.env,
  root: string = ROOT,
): ExecutorAppResolution {
  const disabled = readEnv(EXECUTOR_APP_ENV_KEYS.disabled, env, root);
  if (disabled && /^(1|true|yes)$/i.test(disabled)) {
    return {
      configured: false,
      code: 'disabled',
      reason: `${EXECUTOR_APP_ENV_KEYS.disabled}=${disabled} — executor App identity disabled (rollback switch)`,
    };
  }

  const appId = readEnv(EXECUTOR_APP_ENV_KEYS.appId, env, root);
  if (!appId) {
    return {
      configured: false,
      code: 'not_configured',
      reason: `${EXECUTOR_APP_ENV_KEYS.appId} is not set`,
    };
  }
  if (!/^\d+$/.test(appId)) {
    return { configured: false, code: 'invalid', reason: `${EXECUTOR_APP_ENV_KEYS.appId} must be numeric` };
  }

  const installationId = readEnv(EXECUTOR_APP_ENV_KEYS.installationId, env, root);
  if (!installationId || !/^\d+$/.test(installationId)) {
    return {
      configured: false,
      code: 'invalid',
      reason: `${EXECUTOR_APP_ENV_KEYS.installationId} must be set to the numeric installation id`,
    };
  }

  const inlineKey = env[EXECUTOR_APP_ENV_KEYS.privateKey]?.trim() ?? '';
  const keyPath = readEnv(EXECUTOR_APP_ENV_KEYS.privateKeyPath, env, root);

  let privateKeyPem = '';
  let keySource: 'path' | 'env';
  if (inlineKey) {
    privateKeyPem = inlineKey.replace(/\\n/g, '\n');
    keySource = 'env';
  } else if (keyPath) {
    const resolvedPath = keyPath.startsWith('~') ? path.join(os.homedir(), keyPath.slice(1)) : keyPath;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      return {
        configured: false,
        code: 'invalid',
        reason: `${EXECUTOR_APP_ENV_KEYS.privateKeyPath} does not point at a readable file`,
      };
    }
    if (!stat.isFile()) {
      return { configured: false, code: 'invalid', reason: `${EXECUTOR_APP_ENV_KEYS.privateKeyPath} is not a regular file` };
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      return {
        configured: false,
        code: 'invalid',
        reason: `${EXECUTOR_APP_ENV_KEYS.privateKeyPath} must not be group/world readable (chmod 600)`,
      };
    }
    privateKeyPem = fs.readFileSync(resolvedPath, 'utf8');
    keySource = 'path';
  } else {
    return {
      configured: false,
      code: 'invalid',
      reason: `neither ${EXECUTOR_APP_ENV_KEYS.privateKeyPath} nor ${EXECUTOR_APP_ENV_KEYS.privateKey} is set`,
    };
  }

  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKeyPem)) {
    return { configured: false, code: 'invalid', reason: 'private key material is not a PEM private key' };
  }

  const cachePathRaw = readEnv(EXECUTOR_APP_ENV_KEYS.cachePath, env, root);
  const cachePath = cachePathRaw
    ? cachePathRaw.startsWith('~')
      ? path.join(os.homedir(), cachePathRaw.slice(1))
      : cachePathRaw
    : DEFAULT_CACHE_PATH;

  const apiBaseUrl = (readEnv(EXECUTOR_APP_ENV_KEYS.apiBaseUrl, env, root) || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

  return {
    configured: true,
    config: { appId, installationId, privateKeyPem, keySource, cachePath, apiBaseUrl },
  };
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Builds the RS256 App JWT GitHub requires to mint installation tokens.
 * Pure given `nowSeconds`; the private key never leaves this function.
 */
export function buildAppJwt(appId: string, privateKeyPem: string, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iat: nowSeconds - APP_JWT_SKEW_SECONDS,
      exp: nowSeconds + APP_JWT_LIFETIME_SECONDS,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

export interface MintDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

/** Calls GitHub to mint a fresh installation token. Network-only; no cache. */
export async function mintInstallationToken(config: ExecutorAppConfig, deps: MintDeps = {}): Promise<MintedToken> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('global fetch is unavailable; Node 18+ is required to mint installation tokens');
  }

  const jwt = buildAppJwt(config.appId, config.privateKeyPem, Math.floor(now() / 1000));
  const url = `${config.apiBaseUrl}/app/installations/${config.installationId}/access_tokens`;
  const response = await doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'unit-talk-executor-app-token',
    },
  });

  if (!response.ok) {
    // GitHub's error body never echoes credentials; surface status + message only.
    let message = '';
    try {
      const body = (await response.json()) as { message?: string };
      message = body?.message ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(`installation token mint failed: HTTP ${response.status}${message ? ` — ${message}` : ''}`);
  }

  const body = (await response.json()) as {
    token?: string;
    expires_at?: string;
    permissions?: Record<string, string>;
  };
  if (!body.token || !body.expires_at) {
    throw new Error('installation token mint failed: response missing token/expires_at');
  }

  return {
    token: body.token,
    expires_at: body.expires_at,
    minted_at: new Date(now()).toISOString(),
    app_id: config.appId,
    installation_id: config.installationId,
    login: EXECUTOR_APP_LOGIN,
    permissions: body.permissions ?? {},
  };
}

export function tokenMillisRemaining(token: Pick<MintedToken, 'expires_at'>, nowMs: number): number {
  const expiresAt = Date.parse(token.expires_at);
  if (!Number.isFinite(expiresAt)) return Number.NEGATIVE_INFINITY;
  return expiresAt - nowMs;
}

/** True when a token still has more than the refresh margin of life left. */
export function isTokenFresh(token: Pick<MintedToken, 'expires_at'>, nowMs: number): boolean {
  return tokenMillisRemaining(token, nowMs) > REFRESH_MARGIN_MS;
}

function isMintedToken(value: unknown): value is MintedToken {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.token === 'string' &&
    record.token.length > 0 &&
    typeof record.expires_at === 'string' &&
    typeof record.installation_id === 'string' &&
    typeof record.app_id === 'string'
  );
}

/**
 * Reads the cache. Returns null when absent, unreadable, malformed, minted
 * for a different App/installation, or inside the refresh margin.
 */
export function readTokenCache(cachePath: string, config: Pick<ExecutorAppConfig, 'appId' | 'installationId'>, nowMs: number): MintedToken | null {
  let raw: string;
  try {
    raw = fs.readFileSync(cachePath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isMintedToken(parsed)) return null;
  if (parsed.app_id !== config.appId || parsed.installation_id !== config.installationId) return null;
  if (!isTokenFresh(parsed, nowMs)) return null;
  return parsed;
}

export function writeTokenCache(cachePath: string, token: MintedToken): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(token, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(tmpPath, 0o600);
  fs.renameSync(tmpPath, cachePath);
}

export interface GetTokenOptions extends MintDeps {
  /** Ignore the cache and mint a new token. */
  refresh?: boolean;
  /** Skip reading and writing the cache entirely. */
  noCache?: boolean;
}

export interface GetTokenResult {
  token: MintedToken;
  source: 'cache' | 'minted';
}

/**
 * Cache-then-mint. A cached token is reused only while it has more than
 * REFRESH_MARGIN_MS of life left; otherwise a new one is minted and cached.
 */
export async function getExecutorToken(config: ExecutorAppConfig, options: GetTokenOptions = {}): Promise<GetTokenResult> {
  const now = options.now ?? Date.now;
  if (!options.refresh && !options.noCache) {
    const cached = readTokenCache(config.cachePath, config, now());
    if (cached) return { token: cached, source: 'cache' };
  }
  const minted = await mintInstallationToken(config, { fetch: options.fetch, now });
  if (!options.noCache) {
    writeTokenCache(config.cachePath, minted);
  }
  return { token: minted, source: 'minted' };
}

// ─── Synchronous boundary for callers that cannot await (merge-wrapper) ──────

export type ExecutorGhIdentity =
  | { mode: 'app'; login: string; env: { GH_TOKEN: string; GITHUB_TOKEN: string }; expires_at: string; source: 'cache' | 'minted' }
  | { mode: 'ambient'; reason: string };

export type ExecutorGhIdentityResolver = (input: { cwd: string; env?: NodeJS.ProcessEnv }) => ExecutorGhIdentity;

/**
 * Resolves the identity a GitHub write should run under, synchronously, by
 * spawning this script's `mint --print-token` through the supplied runner.
 * Not configured / disabled → `ambient` (the pre-Phase-A path). A configured
 * App whose mint FAILS is an error, not a silent fallback: a caller that has
 * opted into App identity must not quietly write as the human.
 */
export function resolveExecutorGhIdentitySync(
  input: { cwd: string; env?: NodeJS.ProcessEnv },
  deps: { runner: CommandRunner; root?: string },
): ExecutorGhIdentity {
  const env = input.env ?? process.env;
  const root = deps.root ?? ROOT;
  const resolution = resolveExecutorAppConfig(env, root);
  if (!resolution.configured) {
    return { mode: 'ambient', reason: resolution.reason };
  }

  const scriptPath = path.join(root, 'scripts', 'ops', 'executor-app-token.ts');
  const run = deps.runner('pnpm', ['exec', 'tsx', scriptPath, 'mint', '--print-token', '--json'], {
    cwd: root,
    timeoutMs: 60_000,
    env,
  });
  if (run.error || run.status !== 0) {
    const stderr = bufferToText(run.stderr).trim();
    throw new Error(
      `executor App is configured but token mint failed (${run.error ? run.error.message : `exit ${run.status}`})${stderr ? `: ${stderr.split('\n').at(-1)}` : ''}`,
    );
  }

  let parsed: { token?: string; expires_at?: string; source?: 'cache' | 'minted'; login?: string };
  try {
    parsed = JSON.parse(bufferToText(run.stdout)) as typeof parsed;
  } catch (error) {
    throw new Error(`executor App mint output was not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed.token || !parsed.expires_at) {
    throw new Error('executor App mint output missing token/expires_at');
  }

  return {
    mode: 'app',
    login: parsed.login ?? EXECUTOR_APP_LOGIN,
    env: { GH_TOKEN: parsed.token, GITHUB_TOKEN: parsed.token },
    expires_at: parsed.expires_at,
    source: parsed.source ?? 'minted',
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function statusReport(env: NodeJS.ProcessEnv, nowMs: number): Record<string, unknown> {
  const resolution = resolveExecutorAppConfig(env);
  if (!resolution.configured) {
    return {
      configured: false,
      code: resolution.code,
      reason: resolution.reason,
      fallback: 'ambient gh identity (pre-Phase-A behavior)',
      login: null,
    };
  }
  const { config } = resolution;
  const cached = readTokenCache(config.cachePath, config, nowMs);
  let cacheFilePresent = false;
  try {
    cacheFilePresent = fs.statSync(config.cachePath).isFile();
  } catch {
    cacheFilePresent = false;
  }
  return {
    configured: true,
    login: EXECUTOR_APP_LOGIN,
    app_id: config.appId,
    installation_id: config.installationId,
    key_source: config.keySource,
    api_base_url: config.apiBaseUrl,
    cache_path: config.cachePath,
    cache: {
      file_present: cacheFilePresent,
      fresh: cached !== null,
      expires_at: cached?.expires_at ?? null,
      seconds_remaining: cached ? Math.floor(tokenMillisRemaining(cached, nowMs) / 1000) : null,
      refresh_margin_seconds: REFRESH_MARGIN_MS / 1000,
    },
  };
}

function usage(): never {
  process.stderr.write(
    [
      'usage:',
      '  ops:executor-app-token status',
      '  ops:executor-app-token mint [--refresh] [--no-cache] [--print-token] [--json]',
      '  ops:executor-app-token exec [--refresh] -- <command> [args...]',
      '',
      'The private key is never printed. The token is printed only with --print-token.',
    ].join('\n') + '\n',
  );
  process.exit(2);
}

async function main(argv: string[]): Promise<number> {
  const separator = argv.indexOf('--');
  const ownArgs = separator === -1 ? argv : argv.slice(0, separator);
  const execArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const { positionals, bools } = parseArgs(ownArgs);
  const command = positionals[0];

  if (command === 'status') {
    emitJson(statusReport(process.env, Date.now()));
    return 0;
  }

  if (command === 'mint' || command === 'exec') {
    const resolution = resolveExecutorAppConfig(process.env);
    if (!resolution.configured) {
      emitJson({
        ok: false,
        code: `executor_app_${resolution.code}`,
        reason: resolution.reason,
        hint: 'executor App identity is not available; callers must use their pre-Phase-A path explicitly',
      });
      return 1;
    }

    let result: GetTokenResult;
    try {
      result = await getExecutorToken(resolution.config, {
        refresh: bools.has('refresh'),
        noCache: bools.has('no-cache'),
      });
    } catch (error) {
      emitJson({ ok: false, code: 'executor_app_mint_failed', reason: error instanceof Error ? error.message : String(error) });
      return 1;
    }

    if (command === 'mint') {
      const summary = summarizeToken(result.token);
      const payload: Record<string, unknown> = { ok: true, source: result.source, ...summary };
      if (bools.has('print-token')) {
        payload.token = result.token.token;
      }
      emitJson(payload);
      return 0;
    }

    if (execArgs.length === 0) usage();
    const [child, ...childArgs] = execArgs;
    const run = spawnSync(child, childArgs, {
      stdio: 'inherit',
      env: { ...process.env, GH_TOKEN: result.token.token, GITHUB_TOKEN: result.token.token },
    });
    if (run.error) {
      process.stderr.write(`exec failed: ${run.error.message}\n`);
      return 1;
    }
    return run.status ?? 1;
  }

  usage();
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
