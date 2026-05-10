import type { ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies, ApiHealthResponse, ApiHealthStatus } from '../server.js';
import { writeJson } from '../http-utils.js';
import { checkSchemaDrift, type SchemaDriftCheckResult } from '../model-health-scanner.js';

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

interface ApiHealthResponseWithSchemaDrift extends ApiHealthResponse {
  warnings: string[];
  schemaDrift:
    | {
        status: 'not_applicable';
        checkedAt: null;
        materializationStatus: 'safe';
        unreachableTables: 0;
        warnings: [];
        remediation: null;
      }
    | {
        status: SchemaDriftCheckResult['status'];
        checkedAt: string;
        materializationStatus: SchemaDriftCheckResult['materializationStatus'];
        unreachableTables: number;
        warnings: string[];
        remediation: string;
      };
}

export async function handleHealth(response: ServerResponse, runtime: ApiRuntimeDependencies): Promise<void> {
  const dbReachable = await probeDbConnectivity(runtime);
  const schemaDrift =
    runtime.persistenceMode === 'database' && dbReachable
      ? await checkSchemaDrift({ logger: runtime.logger })
      : null;

  const isDurable = runtime.persistenceMode === 'database' && dbReachable && schemaDrift?.status !== 'drift';
  const status: ApiHealthStatus = isDurable ? 'healthy' : 'degraded';
  const httpStatus = isDurable ? 200 : 503;
  const warnings = schemaDrift?.warnings ?? [];

  writeJson(response, httpStatus, {
    status,
    service: 'api',
    persistenceMode: runtime.persistenceMode,
    runtimeMode: runtime.runtimeMode,
    dbReachable,
    version: {
      gitShaShort: runtime.versionInfo.gitShaShort,
      deploymentIdentifier: runtime.versionInfo.deploymentIdentifier,
      scorerRuntimeVersion: runtime.versionInfo.scorerRuntimeVersion,
      metadataComplete: runtime.versionInfo.metadataComplete,
    },
    warnings,
    schemaDrift: schemaDrift
      ? {
          status: schemaDrift.status,
          checkedAt: schemaDrift.checkedAt,
          materializationStatus: schemaDrift.materializationStatus,
          unreachableTables: schemaDrift.unreachableTables,
          warnings: schemaDrift.warnings,
          remediation: schemaDrift.remediation,
        }
      : {
          status: 'not_applicable',
          checkedAt: null,
          materializationStatus: 'safe',
          unreachableTables: 0,
          warnings: [],
          remediation: null,
        },
  } satisfies ApiHealthResponseWithSchemaDrift);
}
