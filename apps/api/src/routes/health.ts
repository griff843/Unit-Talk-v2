import type { ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies, ApiHealthResponse, ApiHealthStatus } from '../server.js';
import { writeJson } from '../http-utils.js';
import { checkSchemaDrift, type SchemaDriftCheckResult } from '../model-health-scanner.js';
import { recordQueueHealthMetrics } from '@unit-talk/observability';
import type { PickLifecycleState } from '@unit-talk/contracts';

const HEALTH_PROBE_PICK_ID = '00000000-0000-0000-0000-000000000000';
const ZOMBIE_PICK_LIFECYCLE_STATES: PickLifecycleState[] = ['draft', 'validated'];
const ZOMBIE_PICK_PROMOTION_STATUSES = new Set(['qualified', 'promoted']);
const ZOMBIE_PICK_OUTBOX_STATUSES = ['pending', 'sent', 'delivered'] as const;

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
  zombiePicks: ZombiePickHealth;
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

export interface ZombiePickHealth {
  status: 'healthy' | 'down';
  count: number;
  checkedAt: string;
  remediation: string | null;
}

export async function checkZombiePickHealth(
  runtime: ApiRuntimeDependencies,
): Promise<ZombiePickHealth> {
  const checkedAt = new Date(runtime.now()).toISOString();
  /*
   * Repository equivalent of the operator query:
   * SELECT count(*) FROM picks p
   * WHERE p.promotion_status IN ('qualified', 'promoted')
   *   AND p.status NOT IN ('queued', 'posted', 'settled', 'voided', 'awaiting_approval')
   *   AND NOT EXISTS (
   *     SELECT 1 FROM delivery_outbox o
   *     WHERE o.pick_id = p.id
   *       AND o.status IN ('pending', 'sent', 'delivered')
   *   );
   */
  const candidates = await runtime.repositories.picks.listByLifecycleStates(
    ZOMBIE_PICK_LIFECYCLE_STATES,
  );

  let count = 0;
  for (const pick of candidates) {
    if (
      !ZOMBIE_PICK_PROMOTION_STATUSES.has(pick.promotion_status) ||
      pick.promotion_target == null
    ) {
      continue;
    }

    const target = `discord:${pick.promotion_target}`;
    const activeOutbox = await runtime.repositories.outbox.findByPickAndTarget(
      pick.id,
      target,
      ZOMBIE_PICK_OUTBOX_STATUSES,
    );

    if (!activeOutbox) {
      count += 1;
    }
  }

  return {
    status: count > 0 ? 'down' : 'healthy',
    count,
    checkedAt,
    remediation: count > 0
      ? 'Operator recovery: POST /api/picks/:id/requeue for each zombie pick. The requeue path checks for existing active outbox rows before enqueueing, so replay repairs missing work without duplicate delivery.'
      : null,
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
  const zombiePicks = await checkZombiePickHealth(runtime);
  if (queueHealth) {
    recordQueueHealthMetrics(runtime.metricsCollector, queueHealth);
  }
  const queueUnhealthy = queueHealth?.status === 'degraded' || queueHealth?.status === 'down';
  const zombiePickUnhealthy = zombiePicks.status === 'down';
  const status: ApiHealthStatus = !isDurable
    ? 'degraded'
    : zombiePickUnhealthy
      ? 'down'
    : queueHealth?.status === 'down'
      ? 'down'
      : queueHealth?.status === 'degraded'
        ? 'degraded'
        : 'healthy';
  const httpStatus = isDurable && !queueUnhealthy && !zombiePickUnhealthy ? 200 : 503;
  const warnings = [
    ...(schemaDrift?.warnings ?? []),
    ...(queueHealth?.alerts.map((alert) => formatQueueAlertWarning(alert)) ?? []),
    ...(zombiePicks.status === 'down'
      ? [
          `zombie picks detected: count=${zombiePicks.count} [remediation=${zombiePicks.remediation}]`,
        ]
      : []),
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
    zombiePicks,
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
