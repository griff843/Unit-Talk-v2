import { getDashboardData } from './data';
import type { LifecycleSignal } from './types';
import type { GlobalHealth } from './global-health-contract';

// Server callers keep importing the whole contract from here unchanged.
export {
  retainPrivilegedHealthAcrossPublicLiveness,
} from './global-health-contract';
export type { GlobalHealth, GlobalHealthStatus } from './global-health-contract';

function scoreSignal(signal: LifecycleSignal): number {
  if (signal.status === 'BROKEN') return 0;
  if (signal.status === 'DEGRADED') return 1;
  return 2;
}

export async function getPrivilegedGlobalHealth(): Promise<GlobalHealth> {
  const data = await getDashboardData();
  const min = data.signals.length === 0 ? null : Math.min(...data.signals.map(scoreSignal));

  return {
    status: min === null ? 'unknown' : min === 0 ? 'down' : min === 1 ? 'degraded' : 'healthy',
    degradedSignals: data.signals
      .filter((signal) => signal.status !== 'WORKING')
      .map((signal) => signal.signal),
    observedAt: data.observedAt,
  };
}
