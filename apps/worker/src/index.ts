import {
  createConsoleLogWriter,
  createDualLogWriter,
  createLogger,
  createLokiLogWriter,
} from '@unit-talk/observability';
import { createWorkerRuntimeDependencies } from './runtime.js';
import { createDeliveryAdapter, createSimulationDeliveryAdapter } from './delivery-adapters.js';
import { runWorkerCycles } from './runner.js';

const lokiUrl = process.env.LOKI_URL?.trim();
const writer = lokiUrl
  ? createDualLogWriter(createConsoleLogWriter(), createLokiLogWriter({ url: lokiUrl }))
  : undefined;
const logger = createLogger({ service: 'worker', ...(writer ? { writer } : {}) });

export function createWorkerRuntimeSummary() {
  const runtime = createWorkerRuntimeDependencies();

  return {
    service: 'worker',
    status: 'ready',
    persistenceMode: runtime.persistenceMode,
    workerId: runtime.workerId,
    distributionTargets: runtime.distributionTargets,
    adapterKind: runtime.adapterKind,
    pollIntervalMs: runtime.pollIntervalMs,
    maxCyclesPerRun: runtime.maxCyclesPerRun,
    staleClaimMs: runtime.staleClaimMs,
    heartbeatMs: runtime.heartbeatMs,
    watchdogMs: runtime.watchdogMs,
    dryRun: runtime.dryRun,
    autorun: runtime.autorun,
    simulationMode: runtime.simulationMode,
    nextStep: runtime.autorun
      ? 'worker cycles will execute with the configured delivery adapter'
      : 'set UNIT_TALK_WORKER_AUTORUN=true to execute worker cycles',
  };
}

const runtime = createWorkerRuntimeDependencies();

if (runtime.autorun) {
  const deliveryAdapter = runtime.simulationMode
    ? createSimulationDeliveryAdapter()
    : createDeliveryAdapter({
        kind: runtime.adapterKind,
        dryRun: runtime.dryRun,
      });

  runWorkerCycles({
    repositories: runtime.repositories,
    workerId: runtime.workerId,
    targets: runtime.distributionTargets,
    deliver: deliveryAdapter,
    maxCycles: runtime.maxCyclesPerRun,
    pollIntervalMs: runtime.pollIntervalMs,
    staleClaimMs: runtime.staleClaimMs,
    heartbeatMs: runtime.heartbeatMs,
    watchdogMs: runtime.watchdogMs,
  })
    .then((cycles) => {
      console.log(
        JSON.stringify(
          {
            ...createWorkerRuntimeSummary(),
            executedCycles: cycles.length,
            results: cycles,
          },
          null,
          2,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify(
          {
            ...createWorkerRuntimeSummary(),
            status: 'error',
            error: error instanceof Error ? error.message : 'unknown worker error',
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    });
} else {
  console.log(JSON.stringify(createWorkerRuntimeSummary(), null, 2));
}
