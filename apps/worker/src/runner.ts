import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';
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
    msg.includes('429') ||
    msg.includes('Bad gateway') ||
    msg.includes('Service Unavailable')
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
          try {
            await options.repositories.runs.completeRun({
              runId,
              status: 'succeeded',
              details: { target, closedAt: new Date().toISOString() },
            });
          } catch {
            // Non-fatal
          }
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
