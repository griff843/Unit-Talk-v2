/**
 * Client-safe half of the global health contract.
 *
 * `global-health.ts` reaches the privileged data client, which transitively
 * imports `next/headers` and cannot appear in a client bundle. The shape and
 * the pure retention rule live here so `'use client'` components can import
 * them without dragging a server-only module across the boundary.
 *
 * This module must never import from `./data`, `./request-auth`, or anything
 * that reaches `next/headers` — `global-health-contract.test.ts` pins that.
 */
export type GlobalHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface GlobalHealth {
  status: GlobalHealthStatus;
  degradedSignals: string[];
  observedAt: string;
}

/**
 * The public liveness endpoint may answer with a body that carries no
 * privileged health. Keep the last privileged reading rather than degrading
 * to an unauthenticated one.
 */
export function retainPrivilegedHealthAcrossPublicLiveness(
  current: GlobalHealth | null,
  responseBody: unknown,
): GlobalHealth | null {
  return isGlobalHealth(responseBody) ? responseBody : current;
}

function isGlobalHealth(value: unknown): value is GlobalHealth {
  if (!value || typeof value !== 'object') return false;
  const status = Reflect.get(value, 'status');
  const degradedSignals = Reflect.get(value, 'degradedSignals');
  const observedAt = Reflect.get(value, 'observedAt');
  return (
    (status === 'healthy' || status === 'degraded' || status === 'down' || status === 'unknown') &&
    Array.isArray(degradedSignals) &&
    degradedSignals.every((signal) => typeof signal === 'string') &&
    typeof observedAt === 'string'
  );
}
