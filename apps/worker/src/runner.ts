import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';
import {
  type TargetRegistryEntry,
  isTargetEnabled,
  resolveTargetRegistry,
} from '@unit-talk/contracts';
import {
  processNextDistributionWork,
  type DeliveryResult,
  type WorkerProcessResult,
} from './distribution-worker.js';

export type DeliveryAdapter = (outbox: OutboxRecord) => Promise<DeliveryResult>;

export interface WorkerRunnerOptions {
  repositories: RepositoryBundle;
  workerId: string;
  targets: string[];
  deliver: DeliveryAdapter;
  targetRegistry?: TargetRegistryEntry[] | undefined;
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
  const summaries: WorkerCycleSummary[] = [];

  const registry = options.targetRegistry ?? resolveTargetRegistry();

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const reaped = await reapStaleClaims(options.repositories, options.targets, options.workerId, staleClaimMs);
    const results: WorkerProcessResult[] = [];

    for (const target of options.targets) {
      // Registry entries use promotion target names ('best-bets'), not Discord target paths
      const promotionTargetName = target.startsWith('discord:')
        ? target.slice('discord:'.length)
        : target;
      if (!isTargetEnabled(promotionTargetName, registry)) {
        results.push({ status: 'target-disabled', target, workerId: options.workerId });
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
