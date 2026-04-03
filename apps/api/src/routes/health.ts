import type { ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies, ApiHealthResponse, ApiHealthStatus } from '../server.js';
import { writeJson } from '../http-utils.js';

const HEALTH_PROBE_PICK_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Probes DB connectivity by issuing a lightweight query through the picks
 * repository.  Returns true only when persistence is backed by a real database
 * AND the database is reachable.
 */
async function probeDbConnectivity(runtime: ApiRuntimeDependencies): Promise<boolean> {
  if (runtime.persistenceMode !== 'database') {
    return false;
  }

  try {
    // Probe with a syntactically valid UUID so database-backed repositories can
    // round-trip cleanly even when the row does not exist.
    await runtime.repositories.picks.findPickById(HEALTH_PROBE_PICK_ID);
    return true;
  } catch {
    return false;
  }
}

export async function handleHealth(response: ServerResponse, runtime: ApiRuntimeDependencies): Promise<void> {
  const dbReachable = await probeDbConnectivity(runtime);

  const isDurable = runtime.persistenceMode === 'database' && dbReachable;
  const status: ApiHealthStatus = isDurable ? 'healthy' : 'degraded';
  const httpStatus = isDurable ? 200 : 503;

  writeJson(response, httpStatus, {
    status,
    service: 'api',
    persistenceMode: runtime.persistenceMode,
    runtimeMode: runtime.runtimeMode,
    dbReachable,
  } satisfies ApiHealthResponse);
}
