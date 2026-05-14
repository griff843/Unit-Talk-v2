import type { ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies, ApiHealthResponse, ApiHealthStatus } from '../server.js';
import { writeJson } from '../http-utils.js';
import { checkSchemaDrift, type SchemaDriftCheckResult } from '../model-health-scanner.js';
import { recordQueueHealthMetrics } from '@unit-talk/observability';

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
  queueHealth: ApiRuntimeDependencies['queueHealth'];
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

function formatQueueAlertWarning(alert: NonNullable<ApiRuntimeDependencies['queueHealth']>['alerts'][number]): string {
  const detailParts = [
    alert.target ? `target=${alert.target}` : null,
    alert.status ? `status=${alert.status}` : null,
    typeof alert.ageMs === 'number' ? `age=${Math.round(alert.ageMs / 60000)}m` : null,
    alert.remediation ? `remediation=${alert.remediation}` : null,
  ].filter((value): value is string => value !== null);

  return detailParts.length > 0 ? `${alert.message} [${detailParts.join(' | ')}]` : alert.message;
}

export async function handleHealth(response: ServerResponse, runtime: ApiRuntimeDependencies): Promise<void> {
  const dbReachable = await probeDbConnectivity(runtime);
  const schemaDrift = await (async () => {
    if (runtime.persistenceMode !== 'database' || !dbReachable) return null;
    try {
      return await checkSchemaDrift({ logger: runtime.logger });
    } catch (err: unknown) {
      // Supabase credentials unavailable in this environment — skip drift check.
      runtime.logger.warn(
        JSON.stringify({ event: 'schema_drift_check_skipped', reason: String(err) }),
      );
      return null;
    }
  })();

  const isDurable = runtime.persistenceMode === 'database' && dbReachable && schemaDrift?.status !== 'drift';
  const queueHealth = runtime.queueHealth ?? null;
  if (queueHealth) {
    recordQueueHealthMetrics(runtime.metricsCollector, queueHealth);
  }
  const queueUnhealthy = queueHealth?.status === 'degraded' || queueHealth?.status === 'down';
  const status: ApiHealthStatus = !isDurable
    ? 'degraded'
    : queueHealth?.status === 'down'
      ? 'down'
      : queueHealth?.status === 'degraded'
        ? 'degraded'
        : 'healthy';
  const httpStatus = isDurable && !queueUnhealthy ? 200 : 503;
  const warnings = [
    ...(schemaDrift?.warnings ?? []),
    ...(queueHealth?.alerts.map((alert) => formatQueueAlertWarning(alert)) ?? []),
  ];

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
    queueHealth,
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
