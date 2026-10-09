import type { ServerResponse } from 'node:http';
import type {
  ApiRuntimeDependencies,
  ApiHealthResponse,
  ApiHealthStatus,
} from '../server.js';
import { writeJson } from '../http-utils.js';
import {
  checkSchemaDrift,
  type SchemaDriftCheckResult,
} from '../model-health-scanner.js';
import { recordQueueHealthMetrics } from '@unit-talk/observability';
import { isProductionLikeRuntime } from '@unit-talk/config';
import {
  humanDeliveryTargets,
  isHumanCapperDeliveryAuthorized,
  isTrackOnlyPickMetadata,
  readSmartFormDistributionMode,
  type PickLifecycleState,
} from '@unit-talk/contracts';
import { POSTGREST_MAX_ROWS, type PromotedPickCandidate } from '@unit-talk/db';
import { isTestFixturePick } from '../fixture-pick.js';

const HEALTH_PROBE_PICK_ID = '00000000-0000-0000-0000-000000000000';
const ZOMBIE_PICK_LIFECYCLE_STATES: PickLifecycleState[] = [
  'draft',
  'validated',
];
const ZOMBIE_PICK_PROMOTION_STATUSES = new Set(['qualified', 'promoted']);
const ZOMBIE_PICK_OUTBOX_STATUSES = ['pending', 'sent', 'delivered'] as const;
const ZOMBIE_OUTBOX_LOOKUP_CONCURRENCY = 8;
const SCHEMA_DRIFT_CACHE_MS = 60_000;

/**
 * Probes DB connectivity by issuing a lightweight query through the picks
 * repository.  Returns true only when persistence is backed by a real database
 * AND the database is reachable.
 */
async function probeDbConnectivity(
  runtime: ApiRuntimeDependencies,
): Promise<boolean> {
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
  status: 'healthy' | 'down' | 'unknown';
  count: number;
  /**
   * Stranded picks that are CI / proof fixtures. Reported so they stay
   * visible, never counted in `count`: a fixture is owed no delivery, and
   * requeueing one would enqueue delivery work for synthetic data.
   */
  fixtureCount: number;
  checkedAt: string;
  remediation: string | null;
}

interface DeliveryCandidate {
  pick: PromotedPickCandidate;
  target: string;
}

function asMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function deliveryTargetForCandidate(
  pick: PromotedPickCandidate,
): string | null {
  if (
    !ZOMBIE_PICK_LIFECYCLE_STATES.includes(pick.status as PickLifecycleState)
  ) {
    return null;
  }
  const metadata = asMetadata(pick.metadata);
  if (
    readSmartFormDistributionMode(metadata) === 'delivery-eligible' &&
    isHumanCapperDeliveryAuthorized(metadata)
  ) {
    return `discord:${humanDeliveryTargets[0]}`;
  }
  return ZOMBIE_PICK_PROMOTION_STATUSES.has(pick.promotion_status) &&
    pick.promotion_target != null
    ? `discord:${pick.promotion_target}`
    : null;
}

/**
 * The whole candidate population, never one capped page. The repository's
 * dedicated read filters server-side and pages on a total order. The fallback
 * serves narrow repository fakes that do not implement it; it pages too, so a
 * fake can never reintroduce the 1,000-row truncation.
 */
async function listZombieCandidates(
  runtime: ApiRuntimeDependencies,
): Promise<PromotedPickCandidate[]> {
  const picks = runtime.repositories.picks;
  if (picks.listPromotedByLifecycleStates) {
    return picks.listPromotedByLifecycleStates(ZOMBIE_PICK_LIFECYCLE_STATES, [
      ...ZOMBIE_PICK_PROMOTION_STATUSES,
    ]);
  }
  const candidates: PromotedPickCandidate[] = [];
  for (let offset = 0; ; offset += POSTGREST_MAX_ROWS) {
    const page = await picks.listByLifecycleStates(
      ZOMBIE_PICK_LIFECYCLE_STATES,
      POSTGREST_MAX_ROWS,
      offset,
    );
    candidates.push(
      ...page.filter((pick) => deliveryTargetForCandidate(pick) !== null),
    );
    if (page.length < POSTGREST_MAX_ROWS) {
      return candidates;
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await fn(items[index] as T);
      }
    },
  );
  await Promise.all(workers);
  return results;
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
  const candidates = await listZombieCandidates(runtime);

  const awaitingDelivery: DeliveryCandidate[] = [];
  for (const pick of candidates) {
    // UTV2-1672 ZOMBIE_HEALTH_TRACK_ONLY_EXCLUSION_GUARD_START
    // A zombie is a pick that *should* have delivery work and does not. A Track
    // Only pick is force-qualified to best-bets by the smart-form promotion
    // path and then deliberately never enqueued, so it matches every clause of
    // the predicate above while being exactly what was asked for. Without this,
    // /health reports 503 after the first legitimate capper submission and
    // prescribes a requeue that the Track Only guard refuses -- an unresolvable
    // alarm that trains operators to ignore a real one.
    const pickMetadata = asMetadata(pick.metadata);
    if (isTrackOnlyPickMetadata(pickMetadata)) {
      continue;
    }
    // UTV2-1672 ZOMBIE_HEALTH_TRACK_ONLY_EXCLUSION_GUARD_END

    const target = deliveryTargetForCandidate(pick);
    if (target !== null) {
      awaitingDelivery.push({ pick, target });
    }
  }

  // One outbox lookup per candidate, run concurrently: serially they dominated
  // /health latency against production.
  const stranded = await mapWithConcurrency(
    awaitingDelivery,
    ZOMBIE_OUTBOX_LOOKUP_CONCURRENCY,
    async ({ pick, target }) => {
      const killSwitchKey = target.startsWith('discord:')
        ? target.slice('discord:'.length)
        : target;
      // A pick deliberately held by the live kill switch is not a zombie. The
      // repository fails closed for missing/unreadable rows, matching the
      // worker's dequeue gate. The pick remains untouched and becomes eligible
      // for this check automatically when an operator releases the target.
      const targetKilled = runtime.repositories.killSwitch
        ? await runtime.repositories.killSwitch.isKilled(killSwitchKey)
        : false;
      const activeOutbox =
        await runtime.repositories.outbox.findByPickAndTarget(
          pick.id,
          target,
          ZOMBIE_PICK_OUTBOX_STATUSES,
        );
      return activeOutbox ? null : { pick, targetKilled };
    },
  );

  let count = 0;
  let fixtureCount = 0;
  for (const strandedPick of stranded) {
    if (!strandedPick) continue;
    const { pick, targetKilled } = strandedPick;
    // WORK-2026092404 ZOMBIE_HEALTH_FIXTURE_EXCLUSION_GUARD_START
    // Production holds CI proof fixtures from before staging isolation. A
    // complete read finds stranded ones (8 on 2026-09-24, every one a fixture),
    // and counting them would hold /health at 503 on synthetic data and
    // prescribe a requeue that enqueues delivery for it. They are reported in
    // fixtureCount instead, so they stay visible without masking a real zombie.
    if (isTestFixturePick(pick)) {
      fixtureCount += 1;
      continue;
    }
    // WORK-2026092404 ZOMBIE_HEALTH_FIXTURE_EXCLUSION_GUARD_END
    // WORK-2026100901 ZOMBIE_HEALTH_KILLED_TARGET_EXCLUSION_GUARD_START
    if (targetKilled) {
      continue;
    }
    // WORK-2026100901 ZOMBIE_HEALTH_KILLED_TARGET_EXCLUSION_GUARD_END
    count += 1;
  }

  return {
    status: count > 0 ? 'down' : 'healthy',
    count,
    fixtureCount,
    checkedAt,
    remediation:
      count > 0
        ? 'Operator recovery: POST /api/picks/:id/requeue for each zombie pick. The requeue path checks for existing active outbox rows before enqueueing, so replay repairs missing work without duplicate delivery.'
        : null,
  };
}

function formatQueueAlertWarning(
  alert: NonNullable<ApiRuntimeDependencies['queueHealth']>['alerts'][number],
): string {
  const detailParts = [
    alert.target ? `target=${alert.target}` : null,
    alert.status ? `status=${alert.status}` : null,
    typeof alert.ageMs === 'number'
      ? `age=${Math.round(alert.ageMs / 60000)}m`
      : null,
    alert.remediation ? `remediation=${alert.remediation}` : null,
  ].filter((value): value is string => value !== null);

  return detailParts.length > 0
    ? `${alert.message} [${detailParts.join(' | ')}]`
    : alert.message;
}

// Per runtime, so one server's cached result can never answer for another.
const schemaDriftCache = new WeakMap<
  ApiRuntimeDependencies,
  { at: number; result: SchemaDriftCheckResult }
>();

/**
 * Schema drift changes on a migration or a PostgREST schema reload, not per
 * request. Probing every canonical table on every /health call made the probe
 * the dominant cost of the endpoint, so a successful result is reused for
 * SCHEMA_DRIFT_CACHE_MS. A failed check is never cached.
 */
async function readSchemaDriftCached(
  runtime: ApiRuntimeDependencies,
): Promise<SchemaDriftCheckResult> {
  const now = runtime.now();
  const cached = schemaDriftCache.get(runtime);
  if (cached && now - cached.at < SCHEMA_DRIFT_CACHE_MS) {
    return cached.result;
  }
  const result = await checkSchemaDrift({ logger: runtime.logger });
  schemaDriftCache.set(runtime, { at: now, result });
  return result;
}

export async function handleHealth(
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const dbReachable = await probeDbConnectivity(runtime);
  const schemaDrift = await (async () => {
    if (runtime.persistenceMode !== 'database' || !dbReachable) return null;
    try {
      return await readSchemaDriftCached(runtime);
    } catch (err: unknown) {
      // Supabase credentials unavailable in this environment — skip drift check.
      runtime.logger.warn(
        JSON.stringify({
          event: 'schema_drift_check_skipped',
          reason: String(err),
        }),
      );
      return null;
    }
  })();

  const isDurable =
    runtime.persistenceMode === 'database' &&
    dbReachable &&
    schemaDrift?.status !== 'drift';
  const queueHealth = runtime.queueHealth ?? null;
  // WORK-2026100901 ZOMBIE_HEALTH_FAILURE_UNKNOWN_GUARD_START
  const zombiePicks: ZombiePickHealth = dbReachable
    ? await checkZombiePickHealth(runtime).catch((error: unknown) => ({
        status: 'unknown' as const,
        count: 0,
        fixtureCount: 0,
        checkedAt: new Date(runtime.now()).toISOString(),
        remediation: `Zombie-pick health check failed: ${error instanceof Error ? error.message : String(error)}`,
      }))
    : {
        status: 'unknown' as const,
        count: 0,
        fixtureCount: 0,
        checkedAt: new Date(runtime.now()).toISOString(),
        remediation:
          'Zombie-pick health check was not run because the database is unreachable.',
      };
  // WORK-2026100901 ZOMBIE_HEALTH_FAILURE_UNKNOWN_GUARD_END
  if (queueHealth) {
    recordQueueHealthMetrics(runtime.metricsCollector, queueHealth);
  }
  const queueUnhealthy =
    queueHealth?.status === 'degraded' || queueHealth?.status === 'down';
  const zombiePickUnhealthy = zombiePicks.status === 'down';
  const zombiePickUnknown = zombiePicks.status === 'unknown';
  // UTV2-1427: the ops alert webhook must fail loud when unset in a production-like
  // environment where Discord delivery is active — previously it silently
  // dropped alerts (DEVOPS_PRODUCTION_POSTURE_AUDIT.md:186,234). Reads the
  // already-loaded, validated runtime environment (not raw process.env) via
  // the same isProductionLikeRuntime helper server.ts uses elsewhere, so
  // local dev, CI, and unit tests that construct a custom environment are
  // unaffected.
  // environment is always populated by createApiRuntimeDependencies; a small
  // number of pre-existing test files construct a minimal runtime stub
  // without it, so treat "no loaded environment" as "not production-like"
  // rather than throwing on those stubs.
  const opsAlertWebhookMissing =
    runtime.environment !== undefined &&
    isProductionLikeRuntime(runtime.environment) &&
    !runtime.environment.UNIT_TALK_OPS_ALERT_WEBHOOK_URL?.trim();
  const status: ApiHealthStatus = !isDurable
    ? 'degraded'
    : zombiePickUnhealthy
      ? 'down'
      : queueHealth?.status === 'down'
        ? 'down'
        : queueHealth?.status === 'degraded' ||
            zombiePickUnknown ||
            opsAlertWebhookMissing
          ? 'degraded'
          : 'healthy';
  const httpStatus =
    isDurable &&
    !queueUnhealthy &&
    !zombiePickUnhealthy &&
    !zombiePickUnknown &&
    !opsAlertWebhookMissing
      ? 200
      : 503;
  const warnings = [
    ...(schemaDrift?.warnings ?? []),
    ...(queueHealth?.alerts.map((alert) => formatQueueAlertWarning(alert)) ??
      []),
    ...(zombiePicks.status === 'down'
      ? [
          `zombie picks detected: count=${zombiePicks.count} [remediation=${zombiePicks.remediation}]`,
        ]
      : []),
    ...(zombiePicks.status === 'unknown'
      ? [
          `zombie pick health unknown: ${zombiePicks.remediation ?? 'check failed'}`,
        ]
      : []),
    ...(zombiePicks.fixtureCount > 0
      ? [
          `stranded test-fixture picks (not counted as zombies, not to be requeued): count=${zombiePicks.fixtureCount}`,
        ]
      : []),
    ...(opsAlertWebhookMissing
      ? [
          'UNIT_TALK_OPS_ALERT_WEBHOOK_URL is unset in a non-local environment — ops alerts are silently dropping. Set the webhook or this health check will keep reporting degraded.',
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
