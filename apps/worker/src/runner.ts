import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';
import {
  defaultTargetRegistry,
  type TargetRegistryEntry,
  isTargetEnabled,
  resolveTargetRegistry,
} from '@unit-talk/contracts';
import {
  processNextDistributionWork,
  type DeliveryResult,
  type WorkerProcessResult,
} from './distribution-worker.js';
import type { DeliveryCircuitBreaker } from './circuit-breaker.js';

export type DeliveryAdapter = (outbox: OutboxRecord) => Promise<DeliveryResult>;

export interface WorkerProcessCircuitOpenResult {
  status: 'circuit-open';
  target: string;
  workerId: string;
  resumeAt: number | null;
}

export interface WorkerRunnerOptions {
  repositories: RepositoryBundle;
  workerId: string;
  targets: string[];
  deliver: DeliveryAdapter;
  targetRegistry?: TargetRegistryEntry[] | undefined;
  circuitBreaker?: DeliveryCircuitBreaker | undefined;
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
  results: (WorkerProcessResult | WorkerProcessCircuitOpenResult)[];
}

export async function runWorkerCycles(
  options: WorkerRunnerOptions,
): Promise<WorkerCycleSummary[]> {
  const maxCycles = options.maxCycles ?? 1;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const staleClaimMs = options.staleClaimMs ?? 300000;
  const sleep = options.sleep ?? defaultSleep;
  const summaries: WorkerCycleSummary[] = [];

  const registry = options.targetRegistry ?? resolveTargetRegistry();
  checkTargetRegistryDrift(registry);
  const cb = options.circuitBreaker;

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const reaped = await reapStaleClaims(options.repositories, options.targets, options.workerId, staleClaimMs);
    const results: (WorkerProcessResult | WorkerProcessCircuitOpenResult)[] = [];

    for (const target of options.targets) {
      // Registry entries use promotion target names ('best-bets'), not Discord target paths
      const promotionTargetName = target.startsWith('discord:')
        ? target.slice('discord:'.length)
        : target;
      if (!isTargetEnabled(promotionTargetName, registry)) {
        results.push({ status: 'target-disabled', target, workerId: options.workerId });
        continue;
      }

      // Circuit breaker check — skip delivery if circuit is open
      if (cb?.isOpen(target)) {
        results.push({
          status: 'circuit-open',
          target,
          workerId: options.workerId,
          resumeAt: cb.resumeAt(target),
        });
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

      // Update circuit breaker state based on result
      if (cb) {
        if (result.status === 'failed') {
          const justOpened = cb.recordFailure(target);
          if (justOpened) {
            await options.repositories.runs.startRun({
              runType: 'circuit-breaker.open',
              actor: options.workerId,
              details: { target, resumeAt: cb.resumeAt(target) },
            });
          }
        } else if (result.status === 'sent') {
          const wasClosed = cb.recordSuccess(target);
          if (wasClosed) {
            // Circuit was open and is now closing — record the close event
            const closeRun = await options.repositories.runs.startRun({
              runType: 'circuit-breaker.close',
              actor: options.workerId,
              details: { target },
            });
            await options.repositories.runs.completeRun({
              runId: closeRun.id,
              status: 'succeeded',
              details: { target },
            });
          }
        }
      }

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

/**
 * Checks whether UNIT_TALK_ENABLED_TARGETS is overriding a target that is
 * disabled in the canonical defaultTargetRegistry.
 *
 * Logs a structured warning for each such override — does NOT block startup.
 */
export function checkTargetRegistryDrift(
  effectiveRegistry: TargetRegistryEntry[],
): void {
  for (const entry of effectiveRegistry) {
    if (!entry.enabled) continue;

    const defaultEntry = defaultTargetRegistry.find((d) => d.target === entry.target);
    if (defaultEntry && !defaultEntry.enabled) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'target-registry.drift-detected',
          target: entry.target,
          defaultDisabledReason: defaultEntry.disabledReason ?? 'no reason recorded',
          override: 'UNIT_TALK_ENABLED_TARGETS',
          message: `Target '${entry.target}' is disabled in defaultTargetRegistry but enabled via UNIT_TALK_ENABLED_TARGETS. Ensure activation contract is ratified.`,
        }),
      );
    }
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
