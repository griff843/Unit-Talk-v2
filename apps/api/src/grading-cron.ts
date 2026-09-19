import { fileURLToPath } from 'node:url';
import type { RepositoryBundle, SystemRunRecord } from '@unit-talk/db';
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
    | 'marketUniverse'
    | 'outbox'
    | 'receipts'
    | 'runs'
  >;
  maxCycles?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Console, 'error' | 'info' | 'warn'>;
  runGradingPass?: typeof runGradingPass;
  /** Called for grading health open/clear transitions. Wire to Discord in production. */
  onStalenessAlert?: (message: string) => Promise<void>;
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
  let runGapAlertOpen = false;

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
    const recentRuns = await options.repositories.runs.listByType('grading.run', 20);
    if (recentRuns.length > 0) {
      const lastRunAt = new Date(recentRuns[0]!.created_at).getTime();
      const gapMs = Date.now() - lastRunAt;
      if (gapMs > GRADING_STALE_WARN_MS && !runGapAlertOpen) {
        runGapAlertOpen = true;
        const stalenessMsg = `[grading-cron] STALENESS WARNING: ${Math.round(gapMs / 60000)}m since last grading.run — picks may be accumulating ungraded`;
        options.logger?.error?.(stalenessMsg);
        if (options.onStalenessAlert) {
          void options.onStalenessAlert(stalenessMsg).catch(() => {/* fire-and-forget */});
        }
      } else if (gapMs <= GRADING_STALE_WARN_MS && runGapAlertOpen) {
        runGapAlertOpen = false;
        const clearMessage = '[grading-cron] RECOVERY: grading.run recency returned within threshold';
        options.logger?.info?.(clearMessage);
        if (options.onStalenessAlert) {
          void options.onStalenessAlert(clearMessage).catch(() => {/* fire-and-forget */});
        }
      }
    }

    const outcomeTransition = evaluateGradingHealthAlertTransition(recentRuns);
    if (outcomeTransition) {
      if (outcomeTransition.kind === 'open') {
        options.logger?.error?.(outcomeTransition.message);
      } else {
        options.logger?.info?.(outcomeTransition.message);
      }
      if (options.onStalenessAlert) {
        void options.onStalenessAlert(outcomeTransition.message).catch(() => {/* fire-and-forget */});
      }
    }

    await sleep(pollIntervalMs);
  }
}

export interface GradingHealthAlertTransition {
  kind: 'open' | 'clear';
  message: string;
}

function readOutcomeClass(run: SystemRunRecord | undefined): string | null {
  const details = run?.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return null;
  }
  const outcomeClass = (details as Record<string, unknown>)['outcome_class'];
  return typeof outcomeClass === 'string' ? outcomeClass : null;
}

/**
 * Emits only durable health transitions. Repeated unhealthy runs deduplicate,
 * no-op runs neither open nor clear an incident, and fresh successful work
 * clears the most recent failed/stale-input state even if no-ops occurred in
 * between.
 */
export function evaluateGradingHealthAlertTransition(
  runs: readonly SystemRunRecord[],
): GradingHealthAlertTransition | null {
  const latest = runs[0];
  const latestOutcome = readOutcomeClass(latest);
  const isUnhealthy = (outcome: string | null) =>
    outcome === 'degraded_stale_input' || outcome === 'failed';
  const isDecisive = (outcome: string | null) =>
    outcome === 'succeeded_with_work' || isUnhealthy(outcome);

  if (!isDecisive(latestOutcome)) {
    return null;
  }

  const previousDecisive = runs
    .slice(1)
    .map(readOutcomeClass)
    .find(isDecisive) ?? null;

  if (isUnhealthy(latestOutcome)) {
    if (isUnhealthy(previousDecisive)) {
      return null;
    }
    const details = latest?.details as Record<string, unknown>;
    const freshness = details['input_freshness'] as Record<string, unknown> | undefined;
    const reasons = details['skipped_reasons'];
    return {
      kind: 'open',
      message:
        `[grading-cron] ALERT OPEN: grading outcome=${latestOutcome}; ` +
        `input=${String(freshness?.['status'] ?? 'unknown')}; ` +
        `newest_result=${String(details['newest_game_result_sourced_at'] ?? 'none')}; ` +
        `skips=${JSON.stringify(reasons ?? {})}. Check results ingestion and grading dependencies.`,
    };
  }

  if (latestOutcome === 'succeeded_with_work' && isUnhealthy(previousDecisive)) {
    return {
      kind: 'clear',
      message:
        `[grading-cron] ALERT CLEARED: fresh grading work succeeded ` +
        `(graded=${String((latest?.details as Record<string, unknown>)['graded_count'] ?? 'unknown')}).`,
    };
  }

  return null;
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

/**
 * Fire-and-forget post to a Discord webhook URL.
 * Used for ops staleness alerts. Never throws.
 */
async function postOpsAlert(webhookUrl: string, message: string): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
  } catch {
    // intentionally swallowed — this is a best-effort ops notification
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runtime = createGradingCronRuntimeDependencies();
  const opsAlertWebhookUrl = process.env['UNIT_TALK_OPS_ALERT_WEBHOOK_URL']?.trim() || undefined;

  if (runtime.autorun) {
    void startGradingCronLoop({
      repositories: runtime.repositories,
      pollIntervalMs: runtime.pollIntervalMs,
      logger: console,
      ...(opsAlertWebhookUrl
        ? { onStalenessAlert: (msg) => postOpsAlert(opsAlertWebhookUrl, msg) }
        : {}),
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
