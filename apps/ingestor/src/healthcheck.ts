/**
 * Container healthcheck for the ingestor (UTV2-1284).
 *
 * Replaces the `pgrep -f 'node'` liveness check — which only proved a node
 * process existed, not that the cycle loop was advancing — with a check of the
 * per-cycle heartbeat file. Exits 0 when the loop advanced within the freshness
 * window, 1 when the heartbeat is stale/missing (loop wedged).
 *
 * Invoked from the container healthcheck:
 *   node_modules/.bin/tsx apps/ingestor/src/healthcheck.ts
 */

import {
  evaluateHeartbeatLiveness,
  readHeartbeat,
  resolveHeartbeatFile,
  resolveHeartbeatMaxAgeMs,
} from './heartbeat.js';

export function runHealthcheck(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): { code: 0 | 1; message: string } {
  const filePath = resolveHeartbeatFile(env);
  const maxAgeMs = resolveHeartbeatMaxAgeMs(env);
  const heartbeat = readHeartbeat(filePath);
  const liveness = evaluateHeartbeatLiveness(heartbeat, maxAgeMs, now);
  return {
    code: liveness.healthy ? 0 : 1,
    message: `ingestor healthcheck: ${liveness.healthy ? 'OK' : 'UNHEALTHY'} — ${liveness.reason} (file=${filePath})`,
  };
}

// Run when executed directly (tsx entry), not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('healthcheck.ts')) {
  const result = runHealthcheck();
  console.log(result.message);
  process.exit(result.code);
}
