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
 */

import type { IncomingMessage } from 'node:http';

export type AuthRole = 'operator' | 'submitter' | 'settler' | 'poster' | 'worker';

export interface AuthContext {
  /** Authenticated role */
  role: AuthRole;
  /** Human-readable identity for audit logs */
  identity: string;
}

export interface AuthConfig {
  /** True when at least one API key is configured */
  enabled: boolean;
  /** Map of raw API key → auth context */
  keys: Map<string, AuthContext>;
}

/**
 * Route authorization: which roles are allowed on each POST route pattern.
 * 'operator' is always allowed on every write endpoint.
 */
const ROUTE_ROLES: ReadonlyArray<{ pattern: RegExp; roles: readonly AuthRole[] }> = [
  { pattern: /^\/api\/submissions$/, roles: ['submitter', 'operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/settle$/, roles: ['settler', 'operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/review$/, roles: ['operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/retry-delivery$/, roles: ['operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/rerun-promotion$/, roles: ['operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/override-promotion$/, roles: ['operator'] },
  { pattern: /^\/api\/picks\/[^/]+\/requeue$/, roles: ['operator'] },
  { pattern: /^\/api\/grading\/run$/, roles: ['settler', 'operator'] },
  { pattern: /^\/api\/recap\/post$/, roles: ['poster', 'operator'] },
  { pattern: /^\/api\/member-tiers$/, roles: ['operator'] },
];

/** The context returned when auth is disabled (fail_open + no keys). */
const BYPASS_CONTEXT: AuthContext = { role: 'operator', identity: 'anonymous:auth-bypass' };

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

  return { enabled: keys.size > 0, keys };
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
 */
export function authenticateRequest(
  request: IncomingMessage,
  authConfig: AuthConfig,
): AuthContext | null {
  if (!authConfig.enabled) {
    return BYPASS_CONTEXT;
  }

  const token = extractBearerToken(request);
  if (!token) return null;

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
