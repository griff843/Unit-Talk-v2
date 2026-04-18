/**
 * API authentication and authorization module (UTV2-215).
 *
 * Bearer token API key auth for all write endpoints. Designed for
 * service-to-service communication (command-center, discord-bot,
 * smart-form, worker, ingestor) — not end-user auth.
 *
 * Auth is bypassed when no keys are configured AND runtimeMode is
 * 'fail_open' (local dev / tests). In fail_closed mode, at least
 * one key must be configured or the server refuses to start.
 *
 * Capper JWT tokens (UTV2-658): smart-form cappers authenticate with a
 * HS256 JWT containing { sub, role: "capper", capperId, displayName }.
 * The API validates the JWT signature using UNIT_TALK_JWT_SECRET and
 * extracts capperId to set on the pick — the form never sends it as an
 * editable field.
 */

import type { IncomingMessage } from 'node:http';
import { jwtVerify, SignJWT } from 'jose';

export type AuthRole = 'operator' | 'submitter' | 'settler' | 'poster' | 'worker' | 'capper';

export interface AuthContext {
  /** Authenticated role */
  role: AuthRole;
  /** Human-readable identity for audit logs */
  identity: string;
  /** Canonical capper ID — set when role === 'capper', derived from JWT claim */
  capperId?: string | undefined;
  /** Display name for the capper — set when role === 'capper' */
  displayName?: string | undefined;
}

export interface AuthConfig {
  /** True when at least one API key is configured */
  enabled: boolean;
  /** Map of raw API key → auth context */
  keys: Map<string, AuthContext>;
  /** HS256 secret for verifying capper JWTs (UNIT_TALK_JWT_SECRET) */
  jwtSecret?: string | undefined;
}

/**
 * Route authorization: which roles are allowed on each POST route pattern.
 * 'operator' is always allowed on every write endpoint.
 */
const ROUTE_ROLES: ReadonlyArray<{ pattern: RegExp; roles: readonly AuthRole[] }> = [
  { pattern: /^\/api\/submissions$/, roles: ['submitter', 'operator', 'capper'] },
  { pattern: /^\/api\/picks\/[^/]+\/settle$/, roles: ['settler', 'operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/review$/, roles: ['operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/retry-delivery$/, roles: ['operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/rerun-promotion$/, roles: ['operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/override-promotion$/, roles: ['operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/requeue$/, roles: ['operator'] },
  { pattern: /^\/api\/grading\/run$/, roles: ['settler', 'operator'] },
  { pattern: /^\/api\/recap\/post$/, roles: ['poster', 'operator'] },
  { pattern: /^\/api\/member-tiers$/, roles: ['operator'] },
  { pattern: /^\/api\/board\/write-picks$/, roles: ['operator'] },
  { pattern: /^\/api\/board\/run-tuning$/, roles: ['operator'] },
];

/** The context returned when auth is disabled (fail_open + no keys). */
const BYPASS_CONTEXT: AuthContext = { role: 'operator', identity: 'anonymous:auth-bypass' };

/** True if a string looks like a JWT (three base64url segments separated by dots). */
function looksLikeJwt(token: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

/**
 * Validate a capper JWT. Returns AuthContext or null on failure.
 * Expects the token to be signed with HS256 using the provided secret.
 * Required claims: role === "capper", capperId (non-empty string).
 */
export async function validateCapperToken(
  token: string,
  secret: string,
): Promise<AuthContext | null> {
  if (!secret) return null;
  try {
    const secretBytes = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretBytes, { algorithms: ['HS256'] });
    if (payload['role'] !== 'capper') return null;
    const capperId = typeof payload['capperId'] === 'string' && payload['capperId'].trim()
      ? payload['capperId'].trim()
      : null;
    if (!capperId) return null;
    const displayName = typeof payload['displayName'] === 'string' ? payload['displayName'].trim() : capperId;
    const sub = typeof payload.sub === 'string' ? payload.sub : capperId;
    return {
      role: 'capper',
      identity: `capper:${sub}`,
      capperId,
      displayName: displayName || capperId,
    };
  } catch {
    return null;
  }
}

/**
 * Sign a capper JWT for issuance (utility — call from admin scripts or token-issuance endpoint).
 */
export async function signCapperToken(
  claims: { sub: string; capperId: string; displayName?: string; email?: string },
  secret: string,
  expiresIn?: string,
): Promise<string> {
  const secretBytes = new TextEncoder().encode(secret);
  let jwt = new SignJWT({ ...claims, role: 'capper' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
  if (expiresIn) jwt = jwt.setExpirationTime(expiresIn);
  return jwt.sign(secretBytes);
}

/**
 * Load auth configuration from environment variables.
 *
 * Env var format: UNIT_TALK_API_KEY_{ROLE}=<secret>
 * Example: UNIT_TALK_API_KEY_OPERATOR=sk-op-abc123
 */
export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const keys = new Map<string, AuthContext>();

  const roleMap: ReadonlyArray<{ envSuffix: string; role: AuthRole }> = [
    { envSuffix: 'OPERATOR', role: 'operator' },
    { envSuffix: 'SUBMITTER', role: 'submitter' },
    { envSuffix: 'SETTLER', role: 'settler' },
    { envSuffix: 'POSTER', role: 'poster' },
    { envSuffix: 'WORKER', role: 'worker' },
  ];

  for (const { envSuffix, role } of roleMap) {
    const key = env[`UNIT_TALK_API_KEY_${envSuffix}`]?.trim();
    if (key && key.length > 0) {
      keys.set(key, {
        role,
        identity: `${role}:${key.slice(0, 8)}`,
      });
    }
  }

  const jwtSecret = env['UNIT_TALK_JWT_SECRET']?.trim() || undefined;
  return { enabled: keys.size > 0, keys, jwtSecret };
}

/**
 * Extract Bearer token from the Authorization header.
 */
function extractBearerToken(request: IncomingMessage): string | null {
  const header = request.headers['authorization'];
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Authenticate a request. Returns AuthContext or null (unauthorized).
 *
 * When auth is disabled (no keys + fail_open), returns a bypass context
 * so all existing tests and local dev continue to work.
 *
 * Token resolution order:
 * 1. If token looks like a JWT and jwtSecret is configured → validate as capper JWT
 * 2. Otherwise → opaque key lookup in keys map
 */
export async function authenticateRequest(
  request: IncomingMessage,
  authConfig: AuthConfig,
): Promise<AuthContext | null> {
  if (!authConfig.enabled) {
    return BYPASS_CONTEXT;
  }

  const token = extractBearerToken(request);
  if (!token) return null;

  // Try capper JWT path first
  if (authConfig.jwtSecret && looksLikeJwt(token)) {
    const capperCtx = await validateCapperToken(token, authConfig.jwtSecret);
    if (capperCtx) return capperCtx;
    // JWT that fails validation is rejected — don't fall through to key map
    return null;
  }

  return authConfig.keys.get(token) ?? null;
}

/**
 * Check if the authenticated role is allowed for the given route.
 */
export function authorizeRoute(auth: AuthContext, pathname: string): boolean {
  for (const { pattern, roles } of ROUTE_ROLES) {
    if (pattern.test(pathname)) {
      return (roles as readonly string[]).includes(auth.role);
    }
  }
  // No matching route pattern found — this shouldn't happen for POST routes
  // that reach this point, but deny by default.
  return false;
}
