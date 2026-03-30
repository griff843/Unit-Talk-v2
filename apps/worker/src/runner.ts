import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';
import {
  processNextDistributionWork,
  type DeliveryResult,
  type WorkerProcessResult,
} from './distribution-worker.js';
import { DeliveryCircuitBreaker } from './circuit-breaker.js';
import { readCircuitBreakerThreshold, readCircuitBreakerCooldownMs } from './runtime.js';

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
}

export interface WorkerCycleSummary {
  cycle: number;
  reapedOutboxIds: string[];
  results: WorkerProcessResult[];
}

export async function runWorkerCycles(
  options: WorkerRunnerOptions,
): Promise<WorkerCycleSummary[]> {
  const maxCycles = options.maxCycles ?? 1;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const staleClaimMs = options.staleClaimMs ?? 300000;
  const sleep = options.sleep ?? defaultSleep;
  const cb = options.circuitBreaker ?? new DeliveryCircuitBreaker({
    threshold: readCircuitBreakerThreshold(),
    cooldownMs: readCircuitBreakerCooldownMs(),
  });
  const summaries: WorkerCycleSummary[] = [];
  // Track system_run IDs for open circuits so we can close them when the circuit resets
  const openCircuitRunIds = new Map<string, string>();

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const reaped = await reapStaleClaims(options.repositories, options.targets, options.workerId, staleClaimMs);
    const results: WorkerProcessResult[] = [];

    for (const target of options.targets) {
      if (cb.isOpen(target)) {
        results.push({ status: 'circuit-open', target, workerId: options.workerId });
        continue;
      }

      const result = await processNextDistributionWork(
        options.repositories,
        target,
        options.workerId,
        options.deliver,
        {
          ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
          ...(options.watchdogMs === undefined ? {} : { watchdogMs: options.watchdogMs }),
        },
      );

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
