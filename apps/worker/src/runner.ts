import type { OutboxRecord, RepositoryBundle, SystemRunRecord } from '@unit-talk/db';
import { isTargetEnabled, resolveTargetRegistry, type TargetRegistryEntry } from '@unit-talk/contracts';
import {
  queueHealthLogFields,
  recordQueueHealthMetrics,
  type Logger,
  type MetricsCollector,
  type QueueHealthEvaluation,
} from '@unit-talk/observability';
import {
  processNextDistributionWork,
  type DeliveryResult,
  type WorkerProcessResult,
  type WorkerProcessIdleResult,
  type WorkerProcessTargetDisabledResult,
} from './distribution-worker.js';
import { DeliveryCircuitBreaker } from './circuit-breaker.js';
import { readCircuitBreakerThreshold, readCircuitBreakerCooldownMs } from './runtime.js';
import {
  runAutoRecoverySweep,
  isRecoveryEnabled,
  type AutoRecoveryResult,
} from './automated-recovery.js';

// ---------------------------------------------------------------------------
// Transient network error detection
// ---------------------------------------------------------------------------

/**
 * Returns true for network-level errors that are safe to retry without
 * side effects: fetch failures, Supabase/Cloudflare 5xx, rate limits.
 * These should never crash the worker process — the supervisor restart
 * loop adds no value and the stale claim reaper handles any orphaned rows.
 *
 * Includes Cloudflare 521 ("Web server is down") which Supabase returns
 * when the underlying Postgres instance is temporarily unavailable.
 * HTML responses (<!DOCTYPE) are also treated as transient — PostgREST
 * never returns HTML on success, so any HTML body indicates infrastructure issues.
 */
export function isTransientNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('fetch failed') ||
    msg.includes('TypeError: fetch') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('521') ||
    msg.includes('429') ||
    msg.includes('Bad gateway') ||
    msg.includes('Service Unavailable') ||
    msg.includes('Web server is down') ||
    msg.includes('<!DOCTYPE')
  );
}

export type DeliveryAdapter = (outbox: OutboxRecord) => Promise<DeliveryResult>;

export interface WorkerRunnerOptions {
  repositories: RepositoryBundle;
  workerId: string;
  targets: string[];
  deliver: DeliveryAdapter;
  circuitBreaker?: DeliveryCircuitBreaker;
  maxCycles?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  pollIntervalMs?: number | undefined;
  staleClaimMs?: number | undefined;
  heartbeatMs?: number | undefined;
  watchdogMs?: number | undefined;
  targetRegistry?: TargetRegistryEntry[] | undefined;
  /** Interval at which the runner writes a worker.heartbeat system_run per cycle. Pass 0 to disable. Default: 30000. */
  workerHeartbeatIntervalMs?: number | undefined;
  metricsCollector?: MetricsCollector | undefined;
  logger?: Logger | undefined;
  queueHealthProvider?: (() => Promise<QueueHealthEvaluation | null>) | undefined;
  /**
   * When true, runs automated recovery sweep each cycle (resets eligible failed/dead_letter
   * rows back to pending). Defaults to AUTOMATED_RECOVERY_ENABLED env var (false if unset).
   * Set explicitly in tests to avoid env var dependency.
   */
  autoRecoveryEnabled?: boolean | undefined;
  /**
   * Persistence mode controls atomic vs sequential claim/confirm paths.
   * - 'database': uses claimNextAtomic / confirmDeliveryAtomic (SELECT FOR UPDATE SKIP LOCKED).
   * - 'in_memory': uses sequential claimNext / markSent (safe for tests, not for concurrent workers).
   * Default: 'database' (fail-closed).
   */
  persistenceMode?: 'database' | 'in_memory' | undefined;
}

export interface WorkerCycleSummary {
  cycle: number;
  reapedOutboxIds: string[];
  results: WorkerProcessResult[];
  autoRecovery: AutoRecoveryResult | null;
}

interface ReapedClaimInfo {
  row: OutboxRecord;
  staleAgeMs: number | null;
}

export async function runWorkerCycles(
  options: WorkerRunnerOptions,
): Promise<WorkerCycleSummary[]> {
  // 0 means "run indefinitely" — the process relies on SIGINT/SIGTERM for clean shutdown
  const maxCycles = options.maxCycles ?? 0;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const staleClaimMs = options.staleClaimMs ?? 300000;
  const sleep = options.sleep ?? defaultSleep;
  const cb = options.circuitBreaker ?? new DeliveryCircuitBreaker({
    threshold: readCircuitBreakerThreshold(),
    cooldownMs: readCircuitBreakerCooldownMs(),
  });
  const registry = options.targetRegistry ?? resolveTargetRegistry();
  const summaries: WorkerCycleSummary[] = [];
  const resolvedPersistenceMode = options.persistenceMode ?? 'database';
  // Surfaces active claim mode at startup so operators can verify atomicity guarantees from logs.
  console.log(JSON.stringify({
    event: 'worker.startup',
    workerId: options.workerId,
    targets: options.targets,
    persistenceMode: resolvedPersistenceMode,
    claimMode: resolvedPersistenceMode === 'database' ? 'atomic' : 'sequential',
  }));
  // Track system_run IDs for open circuits so we can close them when the circuit resets
  const openCircuitRunIds = new Map<string, string>();
  await hydrateOpenCircuitRuns(options.repositories, cb, openCircuitRunIds);
  // Write a worker.heartbeat row per cycle so the operator can detect silent failures.
  // Pass workerHeartbeatIntervalMs=0 to disable. Default: 30000.
  const heartbeatIntervalMs = options.workerHeartbeatIntervalMs ?? 30000;

  for (let cycle = 1; maxCycles === 0 || cycle <= maxCycles; cycle += 1) {
    let heartbeatRunId: string | undefined;
    if (heartbeatIntervalMs > 0) {
      try {
        const hb = await options.repositories.runs.startRun({
          runType: 'worker.heartbeat',
          actor: options.workerId,
          details: { cycle, targets: options.targets },
        });
        heartbeatRunId = hb.id;
      } catch {
        // Non-fatal — heartbeat write is best-effort
      }
    }

    // Transient network errors during stale reaping are non-fatal — log and continue
    // with an empty reap list. The stale claim reaper will retry next cycle.
    let reaped: ReapedClaimInfo[] = [];
    try {
      reaped = await reapStaleClaims(options.repositories, options.targets, options.workerId, staleClaimMs);
    } catch (reapError: unknown) {
      if (isTransientNetworkError(reapError)) {
        console.log(JSON.stringify({
          event: 'worker.stale-reap-skipped',
          workerId: options.workerId,
          cycle,
          reason: reapError instanceof Error ? reapError.message : String(reapError),
        }));
      } else {
        throw reapError;
      }
    }

    // Automated recovery sweep — resets eligible failed/dead_letter rows back to pending.
    // Runs before delivery so recovered rows can be claimed in the same cycle.
    const recoveryEnabled =
      options.autoRecoveryEnabled !== undefined ? options.autoRecoveryEnabled : isRecoveryEnabled();
    let autoRecovery = null;
    if (recoveryEnabled) {
      try {
        const { randomUUID } = await import('node:crypto');
        autoRecovery = await runAutoRecoverySweep(
          options.repositories,
          randomUUID(),
          () =>
            options.autoRecoveryEnabled !== undefined
              ? options.autoRecoveryEnabled
              : isRecoveryEnabled(),
        );
        if (autoRecovery.recovered > 0) {
          console.log(
            JSON.stringify({
              event: 'worker.auto-recovery-sweep',
              workerId: options.workerId,
              cycle,
              recovered: autoRecovery.recovered,
              skipped: autoRecovery.skipped,
              errors: autoRecovery.errors,
              correlationId: autoRecovery.correlationId,
            }),
          );
        }
      } catch (recoveryError: unknown) {
        if (!isTransientNetworkError(recoveryError)) {
          throw recoveryError;
        }
        console.log(
          JSON.stringify({
            event: 'worker.auto-recovery-skipped-transient',
            workerId: options.workerId,
            cycle,
            reason: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
          }),
        );
      }
    }

    const results: WorkerProcessResult[] = [];
    const reapedById = new Map(reaped.map((entry) => [entry.row.id, entry]));

    for (const target of options.targets) {
      if (cb.isOpen(target)) {
        results.push({ status: 'circuit-open', target, workerId: options.workerId });
        continue;
      }

      if (openCircuitRunIds.has(target)) {
        const runId = openCircuitRunIds.get(target)!;
        openCircuitRunIds.delete(target);
        await completeCircuitRun(options.repositories, runId, target, 'cooldown-expired');
      }

      const promotionTarget = target.startsWith('discord:') ? target.slice('discord:'.length) : null;
      const isGoverned = promotionTarget === 'best-bets' || promotionTarget === 'trader-insights' || promotionTarget === 'exclusive-insights';
      if (isGoverned && !isTargetEnabled(promotionTarget, registry)) {
        const disabledResult: WorkerProcessTargetDisabledResult = {
          status: 'target-disabled',
          target,
          workerId: options.workerId,
        };
        results.push(disabledResult);
        continue;
      }

      // Transient network errors during claim/delivery are non-fatal — log and treat
      // as idle. If a claim was partially made, the stale claim reaper will release it.
      let result: WorkerProcessResult;
      try {
        result = await processNextDistributionWork(
          options.repositories,
          target,
          options.workerId,
          options.deliver,
          {
            ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
            ...(options.watchdogMs === undefined ? {} : { watchdogMs: options.watchdogMs }),
            ...(options.persistenceMode === undefined ? {} : { persistenceMode: options.persistenceMode }),
            targetRegistry: registry,
          },
        );
      } catch (deliveryError: unknown) {
        if (isTransientNetworkError(deliveryError)) {
          console.log(JSON.stringify({
            event: 'worker.delivery-skipped-transient',
            workerId: options.workerId,
            target,
            cycle,
            reason: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
          }));
          const idleResult: WorkerProcessIdleResult = { status: 'idle', target, workerId: options.workerId };
          results.push(idleResult);
          continue;
        }
        throw deliveryError;
      }

      if (result.status === 'failed') {
        const wasOpen = cb.openTargets().includes(target);
        cb.recordFailure(target);
        const isNowOpen = cb.isOpen(target);
        if (!wasOpen && isNowOpen) {
          const resumeAt = cb.resumeAt(target);
          const resumeIso = resumeAt !== null ? new Date(resumeAt).toISOString() : null;
          console.log(JSON.stringify({
            event: 'circuit.opened',
            target,
            workerId: options.workerId,
            resumeAt: resumeIso,
          }));
          // Write a system_runs row so operator-web can detect open circuits
          try {
            const circuitRun = await options.repositories.runs.startRun({
              runType: 'worker.circuit-open',
              actor: options.workerId,
              details: {
                target,
                openedAt: new Date().toISOString(),
                resumeAt: resumeIso,
              },
            });
            openCircuitRunIds.set(target, circuitRun.id);
          } catch (err) {
            options.logger?.warn('worker circuit durable state not persisted', {
              target,
              error: err instanceof Error
                ? {
                    name: err.name,
                    message: err.message,
                    stack: err.stack ?? null,
                  }
                : String(err),
              note: 'Durable circuit state was not persisted; in-memory circuit remains open.',
            });
          }
        }
      } else if (result.status === 'sent') {
        const wasOpen = openCircuitRunIds.has(target);
        cb.recordSuccess(target);
        if (wasOpen) {
          const runId = openCircuitRunIds.get(target)!;
          openCircuitRunIds.delete(target);
          await completeCircuitRun(options.repositories, runId, target, 'delivery-succeeded');
        }
      }
      // 'idle' and 'skipped' do not affect circuit state

      logWorkerResult(options, result, reapedById.get(getResultOutboxId(result) ?? ''));
      results.push(result);
    }

    await recordWorkerQueueHealth(options, cycle, results);

    summaries.push({
      cycle,
      reapedOutboxIds: reaped.map((entry) => entry.row.id),
      results,
      autoRecovery,
    });

    if (heartbeatRunId !== undefined) {
      try {
        await options.repositories.runs.completeRun({
          runId: heartbeatRunId,
          status: 'succeeded',
          details: { cycle, targets: options.targets },
        });
      } catch {
        // Non-fatal
      }
    }

    if (maxCycles === 0 || cycle < maxCycles) {
      await sleep(pollIntervalMs);
    }
  }

  return summaries;
}

async function recordWorkerQueueHealth(
  options: WorkerRunnerOptions,
  cycle: number,
  results: WorkerProcessResult[],
) {
  if (options.metricsCollector) {
    options.metricsCollector.increment('worker_cycles_total', { workerId: options.workerId });
    for (const result of results) {
      options.metricsCollector.increment('worker_delivery_results_total', {
        workerId: result.workerId,
        target: result.target,
        status: result.status,
      });
    }
  }

  if (!options.queueHealthProvider) {
    return;
  }

  const queueHealth = await options.queueHealthProvider();
  if (!queueHealth) {
    return;
  }

  if (options.metricsCollector) {
    recordQueueHealthMetrics(options.metricsCollector, queueHealth);
  }

  const fields = { cycle, workerId: options.workerId, ...queueHealthLogFields(queueHealth) };
  if (queueHealth.status === 'healthy') {
    options.logger?.info('worker queue health healthy', fields);
  } else {
    options.logger?.warn('worker queue health unhealthy', fields);
  }
}

async function reapStaleClaims(
  repositories: RepositoryBundle,
  targets: string[],
  workerId: string,
  staleClaimMs: number,
) {
  const staleBefore = new Date(Date.now() - staleClaimMs).toISOString();
  const reaped: ReapedClaimInfo[] = [];

  for (const target of targets) {
    const rows = await repositories.outbox.reapStaleClaims(
      target,
      staleBefore,
      `stale claim reaped by ${workerId}`,
    );

    for (const row of rows) {
      const claimedAtMs =
        typeof row.claimed_at === 'string' && Number.isFinite(Date.parse(row.claimed_at))
          ? Date.parse(row.claimed_at)
          : null;
      const staleAgeMs = claimedAtMs === null ? null : Math.max(0, Date.now() - claimedAtMs);
      reaped.push({ row, staleAgeMs });
      await repositories.audit.record({
        entityType: 'distribution_outbox',
        entityId: row.id,
        action: 'distribution.reaped_stale_claim',
        actor: workerId,
        payload: {
          outboxId: row.id,
          target: row.target,
          attemptCount: row.attempt_count,
          staleBefore,
        },
      });
    }
  }

  return reaped;
}

function getResultOutboxId(result: WorkerProcessResult): string | null {
  if (!('outbox' in result)) {
    return null;
  }

  return result.outbox.id;
}

function logWorkerResult(
  options: WorkerRunnerOptions,
  result: WorkerProcessResult,
  reaped: ReapedClaimInfo | undefined,
) {
  if (!options.logger || !('outbox' in result)) {
    return;
  }

  const recoveryAction = reaped ? describeRecoveryAction(result) : null;
  const fields = {
    workerId: result.workerId,
    target: result.target,
    outboxId: result.outbox.id,
    attemptCount: result.outbox.attempt_count,
    finalState: result.outbox.status,
    deliveryStatus: result.status,
    recoveredFromStaleClaim: reaped !== undefined,
    staleAgeMs: reaped?.staleAgeMs ?? null,
    recoveryAction,
  };

  if (result.status === 'failed' || reaped !== undefined) {
    options.logger.warn('worker recovery result', fields);
    return;
  }

  options.logger.info('worker recovery result', fields);
}

function describeRecoveryAction(result: WorkerProcessResult) {
  if (!('outbox' in result)) {
    return null;
  }

  if (result.outbox.status === 'sent') {
    return 'reaped-and-sent';
  }

  if (result.outbox.status === 'dead_letter') {
    return 'reaped-and-dead-lettered';
  }

  if (result.status === 'failed') {
    return 'reaped-and-retried';
  }

  return 'reaped-and-processed';
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function hydrateOpenCircuitRuns(
  repositories: RepositoryBundle,
  circuitBreaker: DeliveryCircuitBreaker,
  openCircuitRunIds: Map<string, string>,
) {
  let runs: SystemRunRecord[] = [];
  try {
    runs = await repositories.runs.listByType('worker.circuit-open', 100);
  } catch {
    return;
  }

  for (const run of runs) {
    if (run.status !== 'running') {
      continue;
    }

    const details = parseCircuitRunDetails(run);
    if (!details) {
      continue;
    }

    if (openCircuitRunIds.has(details.target)) {
      await completeCircuitRun(repositories, run.id, details.target, 'duplicate-open-run');
      continue;
    }

    circuitBreaker.restoreOpen(details.target, details.openedAtMs);
    if (circuitBreaker.isOpen(details.target)) {
      openCircuitRunIds.set(details.target, run.id);
    } else {
      await completeCircuitRun(repositories, run.id, details.target, 'cooldown-expired-on-startup');
    }
  }
}

function parseCircuitRunDetails(run: SystemRunRecord) {
  if (!run.details || typeof run.details !== 'object' || Array.isArray(run.details)) {
    return null;
  }

  const target = run.details['target'];
  if (typeof target !== 'string' || target.length === 0) {
    return null;
  }

  const openedAt = run.details['openedAt'];
  const openedAtMs =
    typeof openedAt === 'string' && Number.isFinite(Date.parse(openedAt))
      ? Date.parse(openedAt)
      : Date.parse(run.started_at);

  if (!Number.isFinite(openedAtMs)) {
    return null;
  }

  return { target, openedAtMs };
}

async function completeCircuitRun(
  repositories: RepositoryBundle,
  runId: string,
  target: string,
  closeReason: string,
) {
  try {
    await repositories.runs.completeRun({
      runId,
      status: 'succeeded',
      details: { target, closedAt: new Date().toISOString(), closeReason },
    });
  } catch {
    // Non-fatal: delivery can continue and the next health snapshot will retry from durable state.
  }
}
