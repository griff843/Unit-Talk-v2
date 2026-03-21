import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';
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
  maxCycles?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  pollIntervalMs?: number | undefined;
}

export interface WorkerCycleSummary {
  cycle: number;
  results: WorkerProcessResult[];
}

export async function runWorkerCycles(
  options: WorkerRunnerOptions,
): Promise<WorkerCycleSummary[]> {
  const maxCycles = options.maxCycles ?? 1;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const sleep = options.sleep ?? defaultSleep;
  const summaries: WorkerCycleSummary[] = [];

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const results: WorkerProcessResult[] = [];

    for (const target of options.targets) {
      const result = await processNextDistributionWork(
        options.repositories,
        target,
        options.workerId,
        options.deliver,
      );
      results.push(result);
    }

    summaries.push({
      cycle,
      results,
    });

    if (cycle < maxCycles) {
      await sleep(pollIntervalMs);
    }
  }

  return summaries;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
