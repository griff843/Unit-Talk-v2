import { getRuntimeHealth } from './data/runtime-truth';
import type { GlobalHealth } from './global-health-contract';

export { retainPrivilegedHealthAcrossPublicLiveness } from './global-health-contract';
export type { GlobalHealth, GlobalHealthStatus } from './global-health-contract';

/** API health comes from its health endpoint, never from a pick outcome ratio. */
export async function getPrivilegedGlobalHealth(): Promise<GlobalHealth> {
  const health = await getRuntimeHealth();
  return {
    status: health.apiStatus,
    degradedSignals: health.apiStatus === 'healthy' ? [] : health.warnings.length > 0 ? health.warnings : ['runtime-api'],
    observedAt: new Date().toISOString(),
  };
}
