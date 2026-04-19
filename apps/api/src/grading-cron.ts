import { fileURLToPath } from 'node:url';
import type { RepositoryBundle } from '@unit-talk/db';
import { createApiRuntimeDependencies } from './server.js';
import {
  runGradingPass,
  type GradingPassResult,
  type GradingRetryState,
} from './grading-service.js';

export interface GradingCronCycleSummary {
  cycle: number;
  result?: GradingPassResult;
  error?: string;
}

export interface GradingCronRunnerOptions {
  repositories: Pick<
    RepositoryBundle,
    | 'picks'
    | 'settlements'
    | 'audit'
    | 'gradeResults'
    | 'providerOffers'
    | 'participants'
    | 'events'
    | 'eventParticipants'
    | 'outbox'
    | 'receipts'
    | 'runs'
  >;
  maxCycles?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Console, 'error' | 'info' | 'warn'>;
  runGradingPass?: typeof runGradingPass;
}

export interface GradingCronRuntimeDependencies {
  repositories: RepositoryBundle;
  persistenceMode: 'database' | 'in_memory';
  pollIntervalMs: number;
  maxCyclesPerRun: number;
  autorun: boolean;
}

export async function runGradingCronCycles(
  options: GradingCronRunnerOptions,
): Promise<GradingCronCycleSummary[]> {
  const maxCycles = options.maxCycles ?? 1;
  const pollIntervalMs = options.pollIntervalMs ?? 300_000;
  const sleep = options.sleep ?? defaultSleep;
  const runPass = options.runGradingPass ?? runGradingPass;
  const summaries: GradingCronCycleSummary[] = [];
  const retryState: GradingRetryState = new Map();

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    summaries.push(
      await runGradingCronCycle({
        cycle,
        repositories: options.repositories,
        runPass,
        retryState,
        ...(options.logger ? { logger: options.logger } : {}),
      }),
    );

    if (cycle < maxCycles) {
      await sleep(pollIntervalMs);
    }
  }

  return summaries;
}

const GRADING_STALE_WARN_MS = parseInt(
  process.env.UNIT_TALK_GRADING_STALE_WARN_MS ?? '2700000',
  10,
); // default 45 minutes

export async function startGradingCronLoop(
  options: Omit<GradingCronRunnerOptions, 'maxCycles'>,
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 300_000;
  const sleep = options.sleep ?? defaultSleep;
  const runPass = options.runGradingPass ?? runGradingPass;
  const retryState: GradingRetryState = new Map();
  let cycle = 0;

  while (true) {
    cycle += 1;
    const summary = await runGradingCronCycle({
      cycle,
      repositories: options.repositories,
      runPass,
      retryState,
      ...(options.logger ? { logger: options.logger } : {}),
    });

    if (summary.error) {
      options.logger?.error?.(summary.error);
    } else if (summary.result) {
      options.logger?.info?.(
        `Grading cron cycle ${cycle} completed: attempted=${summary.result.attempted} graded=${summary.result.graded} skipped=${summary.result.skipped} errors=${summary.result.errors}`,
      );
    }

    // Write heartbeat so external monitoring can detect gaps
    const heartbeatRun = await options.repositories.runs.startRun({
      runType: 'grading.cron.heartbeat',
      details: { cycle },
    });
    await options.repositories.runs.completeRun({
      runId: heartbeatRun.id,
      status: 'succeeded',
      details: { cycle },
    });

    // Staleness check: warn if grading.run gap exceeds threshold
    const recentRuns = await options.repositories.runs.listByType('grading.run', 1);
    if (recentRuns.length > 0) {
      const lastRunAt = new Date(recentRuns[0]!.created_at).getTime();
      const gapMs = Date.now() - lastRunAt;
      if (gapMs > GRADING_STALE_WARN_MS) {
        options.logger?.error?.(
          `[grading-cron] STALENESS WARNING: ${Math.round(gapMs / 60000)}m since last grading.run — picks may be accumulating ungraded`,
        );
      }
    }

    await sleep(pollIntervalMs);
  }
}

export function createGradingCronRuntimeDependencies(): GradingCronRuntimeDependencies {
  const runtime = createApiRuntimeDependencies();
  const pollIntervalMs = parsePositiveInt(process.env.UNIT_TALK_GRADING_CRON_POLL_MS, 300_000);
  const configuredMaxCycles = parsePositiveInt(
    process.env.UNIT_TALK_GRADING_CRON_MAX_CYCLES,
    0,
  );

  return {
    repositories: runtime.repositories,
    persistenceMode: runtime.persistenceMode,
    pollIntervalMs,
    maxCyclesPerRun: configuredMaxCycles,
    autorun: process.env.UNIT_TALK_GRADING_CRON_AUTORUN === 'true',
  };
}

export function createGradingCronRuntimeSummary() {
  const runtime = createGradingCronRuntimeDependencies();

  return {
    service: 'api',
    mode: 'grading-cron',
    status: 'ready',
    persistenceMode: runtime.persistenceMode,
    pollIntervalMs: runtime.pollIntervalMs,
    maxCyclesPerRun: runtime.maxCyclesPerRun,
    autorun: runtime.autorun,
    nextStep: runtime.autorun
      ? 'grading cron will execute on the configured interval'
      : 'set UNIT_TALK_GRADING_CRON_AUTORUN=true to start the grading cron loop',
  };
}

async function runGradingCronCycle(options: {
  cycle: number;
  repositories: GradingCronRunnerOptions['repositories'];
  runPass: typeof runGradingPass;
  retryState: GradingRetryState;
  logger?: Pick<Console, 'error' | 'info' | 'warn'>;
}): Promise<GradingCronCycleSummary> {
  try {
    const runPassOptions = {
      retryState: options.retryState,
      ...(options.logger ? { logger: options.logger } : {}),
    };
    const result = await options.runPass(
      options.repositories,
      runPassOptions,
    );

    return {
      cycle: options.cycle,
      result,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'unknown grading cron error';

    return {
      cycle: options.cycle,
      error: message,
    };
  }
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runtime = createGradingCronRuntimeDependencies();

  if (runtime.autorun) {
    void startGradingCronLoop({
      repositories: runtime.repositories,
      pollIntervalMs: runtime.pollIntervalMs,
      logger: console,
    }).catch((error: unknown) => {
      console.error(
        JSON.stringify(
          {
            ...createGradingCronRuntimeSummary(),
            status: 'error',
            error: error instanceof Error ? error.message : 'unknown grading cron error',
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    });
  } else {
    console.log(JSON.stringify(createGradingCronRuntimeSummary(), null, 2));
  }
}
