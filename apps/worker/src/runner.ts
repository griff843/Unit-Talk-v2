import type { OutboxRecord, RepositoryBundle, SystemRunRecord } from '@unit-talk/db';
import { isTargetEnabled, resolveTargetRegistry, type TargetRegistryEntry } from '@unit-talk/contracts';
import {
  processNextDistributionWork,
  type DeliveryResult,
  type WorkerProcessResult,
  type WorkerProcessIdleResult,
  type WorkerProcessTargetDisabledResult,
} from './distribution-worker.js';
import { DeliveryCircuitBreaker } from './circuit-breaker.js';
import { readCircuitBreakerThreshold, readCircuitBreakerCooldownMs } from './runtime.js';

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
function isTransientNetworkError(error: unknown): boolean {
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
    let reaped: OutboxRecord[] = [];
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
    const results: WorkerProcessResult[] = [];

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
          } catch {
            // Non-fatal — circuit breaker state is in-process; DB write is best-effort
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

      results.push(result);
    }

    summaries.push({
      cycle,
      reapedOutboxIds: reaped.map((row) => row.id),
      results,
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

    if (cycle < maxCycles) {
      await sleep(pollIntervalMs);
    }
  }

  return summaries;
}

async function reapStaleClaims(
  repositories: RepositoryBundle,
  targets: string[],
  workerId: string,
  staleClaimMs: number,
) {
  const staleBefore = new Date(Date.now() - staleClaimMs).toISOString();
  const reaped: OutboxRecord[] = [];

  for (const target of targets) {
    const rows = await repositories.outbox.reapStaleClaims(
      target,
      staleBefore,
      `stale claim reaped by ${workerId}`,
    );

    for (const row of rows) {
      reaped.push(row);
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
