import type { DatabaseConnectionConfig, EventRow, IngestorRepositoryBundle } from '@unit-talk/db';
import { ingestLeague, type IngestLeagueSummary } from './ingest-league.js';
import { ingestOddsApiLeague, type OddsApiIngestSummary } from './ingest-odds-api.js';
import type {
  ProviderIngestionDbWritePolicy,
  ProviderPayloadArchivePolicy,
} from './provider-ingestion-policy.js';
import {
  runProviderOfferHistoryRetention,
  type ProviderOfferHistoryRetentionResult,
} from './provider-offer-history-retention.js';
import { fetchSGOAccountUsage, type SGOAccountUsage } from './sgo-fetcher.js';
import {
  formatSchedulerLog,
  resolveCurrentPollIntervalMs,
  type SchedulerConfig,
} from './scheduler.js';

export const SUPPORTED_SGO_LEAGUES = ['NBA', 'NFL', 'MLB', 'NHL'] as const;

export interface IngestorRunnerOptions {
  repositories: IngestorRepositoryBundle;
  leagues: string[];
  apiKey?: string;
  oddsApiKey?: string;
  apiUrl?: string;
  /** undefined = run indefinitely */
  maxCycles?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Fixed poll interval (ms). Ignored when schedulerConfig.enabled=true. */
  pollIntervalMs?: number;
  /** Adaptive on-peak/off-peak scheduling. Takes precedence over pollIntervalMs when enabled. */
  schedulerConfig?: SchedulerConfig;
  fetchImpl?: typeof fetch;
  skipResults?: boolean;
  resultsLookbackHours?: number;
  /** Max total time for the results pagination loop (ms). Defaults to 300_000 in sgo-fetcher. */
  resultsMaxFetchMs?: number;
  logger?: Pick<Console, 'warn' | 'info'>;
  providerDbWritePolicy?: ProviderIngestionDbWritePolicy;
  providerPayloadArchivePolicy?: ProviderPayloadArchivePolicy;
  triggerGradingRun?: typeof triggerGradingRun;
  /** Called with the staleness message when cycle gap > CYCLE_GAP_WARN_MS. Wire to Discord in production. */
  onStalenessAlert?: (message: string) => Promise<void>;
  /**
   * When provided, the retention job runs once after all ingestor cycles
   * complete. Summarises and drops provider_offer_history partitions older
   * than retentionDays (default 7).
   */
  retentionConnection?: DatabaseConnectionConfig;
  /** Retention window in days. Defaults to 7. Only used when retentionConnection is set. */
  retentionDays?: number;
}

export interface IngestorGradingTriggerSummary {
  attempted: boolean;
  status: 'triggered' | 'skipped' | 'failed';
  reason?: string;
}

export interface IngestorCycleSummary {
  cycle: number;
  results: IngestLeagueSummary[];
  finalizedRepolls: IngestLeagueSummary[];
  oddsApiResults: OddsApiIngestSummary[];
  gradingTrigger: IngestorGradingTriggerSummary;
  sgoUsage: SGOAccountUsage | null;
  /** Present on the final cycle when retentionConnection is configured. */
  retentionResult?: ProviderOfferHistoryRetentionResult | null;
}

/** Warn when a cycle gap exceeds this threshold (10 minutes). */
const CYCLE_GAP_WARN_MS = 10 * 60 * 1000;
const DEFAULT_RESULTS_LOOKBACK_HOURS = 48;
const FINALIZED_REPOLL_BATCH_SIZE = 25;

export async function runIngestorCycles(
  options: IngestorRunnerOptions,
): Promise<IngestorCycleSummary[]> {
  validateLeagues(options.leagues);

  const maxCycles = options.maxCycles ?? 1;
  const fixedPollIntervalMs = options.pollIntervalMs ?? 300_000;
  const sleep = options.sleep ?? defaultSleep;
  const summaries: IngestorCycleSummary[] = [];
  let lastCycleEndMs: number | null = null;

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    if (lastCycleEndMs !== null) {
      const gapMs = Date.now() - lastCycleEndMs;
      if (gapMs > CYCLE_GAP_WARN_MS) {
        const stalenessMsg = `[ingestor] cycle=${cycle} STALENESS WARNING: ${Math.round(gapMs / 60000)}m since last cycle — offers may be stale`;
        options.logger?.warn?.(stalenessMsg);
        if (options.onStalenessAlert) {
          void options.onStalenessAlert(stalenessMsg).catch(() => {/* fire-and-forget */});
        }
      }
    }

    const results: IngestLeagueSummary[] = [];
    const cycleSnapshotAt = new Date().toISOString();

    for (const league of options.leagues) {
      try {
        results.push(
          await ingestLeague(league, options.apiKey, options.repositories, {
            snapshotAt: cycleSnapshotAt,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options.skipResults !== undefined ? { skipResults: options.skipResults } : {}),
            ...(options.resultsLookbackHours !== undefined
              ? { resultsLookbackHours: options.resultsLookbackHours }
              : {}),
            ...(options.resultsMaxFetchMs !== undefined
              ? { resultsMaxFetchMs: options.resultsMaxFetchMs }
              : {}),
            ...(options.sleep ? { sleep: options.sleep } : {}),
            ...(options.logger ? { logger: options.logger } : {}),
            ...(options.providerDbWritePolicy
              ? { providerDbWritePolicy: options.providerDbWritePolicy }
              : {}),
            ...(options.providerPayloadArchivePolicy
              ? { providerPayloadArchivePolicy: options.providerPayloadArchivePolicy }
              : {}),
          }),
        );
      } catch (leagueError: unknown) {
        options.logger?.warn?.(
          `[ingestor] league=${league} failed, skipping to next: ${leagueError instanceof Error ? leagueError.message : String(leagueError)}`,
        );
      }
    }

    const finalizedRepolls = await runFinalizedRepollsForCycle(
      cycleSnapshotAt,
      options,
    );

    // Odds API ingest (Pinnacle + multi-book consensus) — runs alongside SGO
    const oddsApiResults: OddsApiIngestSummary[] = [];
    if (options.oddsApiKey) {
      for (const league of options.leagues) {
        oddsApiResults.push(
          await ingestOddsApiLeague({
            apiKey: options.oddsApiKey,
            league,
            repositories: options.repositories,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options.logger ? { logger: options.logger } : {}),
            ...(options.providerDbWritePolicy
              ? { providerDbWritePolicy: options.providerDbWritePolicy }
              : {}),
            ...(options.providerPayloadArchivePolicy
              ? { providerPayloadArchivePolicy: options.providerPayloadArchivePolicy }
              : {}),
          }),
        );
      }
    }

    const gradingTrigger = await triggerGradingForCycle(results, options);

    let sgoUsage: SGOAccountUsage | null = null;
    if (options.apiKey && !options.fetchImpl) {
      try {
        sgoUsage = await fetchWithTimeout(
          fetchSGOAccountUsage(
            options.apiKey,
            options.fetchImpl ?? fetch,
          ),
          5_000,
          'SGO account usage fetch timed out',
        );
      } catch (error) {
        options.logger?.warn?.(
          `Failed to fetch SGO account usage: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    summaries.push({
      cycle,
      results,
      finalizedRepolls,
      oddsApiResults,
      gradingTrigger,
      sgoUsage,
    });
    lastCycleEndMs = Date.now();

    const isLastCycle = cycle >= maxCycles;
    if (!isLastCycle) {
      const resolution = resolveCurrentPollIntervalMs(
        options.schedulerConfig ?? { enabled: false, peakPollMs: 0, offPeakPollMs: 0, peakStartHourEt: 0, peakEndHourEt: 0 },
        fixedPollIntervalMs,
      );
      options.logger?.info?.(`[ingestor] cycle=${cycle} next-sleep ${formatSchedulerLog(resolution)}`);
      await sleep(resolution.intervalMs);
    }
  }

  // Run retention job once after all cycles complete (non-fatal).
  if (options.retentionConnection && summaries.length > 0) {
    let retentionResult: ProviderOfferHistoryRetentionResult | null = null;
    try {
      retentionResult = await runProviderOfferHistoryRetention({
        connection: options.retentionConnection,
        ...(options.retentionDays !== undefined ? { retentionDays: options.retentionDays } : {}),
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
      });
      options.logger?.info?.(
        `[ingestor] retention complete: partitions_summarized=${retentionResult.partitions_summarized} partitions_dropped=${retentionResult.partitions_dropped} cutoff_date=${retentionResult.cutoff_date}`,
      );
    } catch (error) {
      options.logger?.warn?.(
        `[ingestor] retention job failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Attach to the last cycle summary so callers can inspect / log it.
    const last = summaries[summaries.length - 1];
    if (last !== undefined) {
      last.retentionResult = retentionResult;
    }
  }

  return summaries;
}

async function runFinalizedRepollsForCycle(
  snapshotAt: string,
  options: IngestorRunnerOptions,
): Promise<IngestLeagueSummary[]> {
  if (!options.apiKey || options.skipResults) {
    return [];
  }

  const lookbackHours =
    options.resultsLookbackHours ?? DEFAULT_RESULTS_LOOKBACK_HOURS;
  const resultsStartsAfter = new Date(
    Date.parse(snapshotAt) - lookbackHours * 60 * 60 * 1000,
  ).toISOString();
  const startedEvents = await options.repositories.events.listStartedBySnapshot(
    snapshotAt,
  );
  const candidateIdsByLeague = new Map<string, string[]>();

  for (const event of startedEvents) {
    if (
      (event.status !== 'scheduled' && event.status !== 'in_progress') ||
      !event.external_id ||
      !options.leagues.includes(event.sport_id)
    ) {
      continue;
    }

    const startsAt = readEventStartsAt(event);
    if (!startsAt || startsAt > snapshotAt || startsAt < resultsStartsAfter) {
      continue;
    }

    const ids = candidateIdsByLeague.get(event.sport_id) ?? [];
    ids.push(event.external_id);
    candidateIdsByLeague.set(event.sport_id, ids);
  }

  const repolls: IngestLeagueSummary[] = [];
  for (const league of options.leagues) {
    const providerEventIds = candidateIdsByLeague.get(league) ?? [];
    for (const batch of chunk(providerEventIds, FINALIZED_REPOLL_BATCH_SIZE)) {
      if (batch.length === 0) {
        continue;
      }

      options.logger?.info?.(
        `[ingestor] finalized-repoll league=${league} candidates=${batch.length}`,
      );
      repolls.push(
        await ingestLeague(league, options.apiKey, options.repositories, {
          snapshotAt,
          resultsOnly: true,
          providerEventIds: batch,
          resultsStartsAfter,
          resultsStartsBefore: snapshotAt,
          resultsLookbackHours: lookbackHours,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.sleep ? { sleep: options.sleep } : {}),
          ...(options.logger ? { logger: options.logger } : {}),
          ...(options.providerDbWritePolicy
            ? { providerDbWritePolicy: options.providerDbWritePolicy }
            : {}),
          ...(options.providerPayloadArchivePolicy
            ? { providerPayloadArchivePolicy: options.providerPayloadArchivePolicy }
            : {}),
        }),
      );
    }
  }

  return repolls;
}

function readEventStartsAt(event: EventRow) {
  const metadataStartsAt = event.metadata?.starts_at;
  if (typeof metadataStartsAt === 'string' && metadataStartsAt.length > 0) {
    return metadataStartsAt;
  }
  return `${event.event_date}T00:00:00.000Z`;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function triggerGradingForCycle(
  results: IngestLeagueSummary[],
  options: IngestorRunnerOptions,
): Promise<IngestorGradingTriggerSummary> {
  if (options.skipResults) {
    return {
      attempted: false,
      status: 'skipped',
      reason: 'results_ingest_disabled',
    };
  }

  if (!options.apiUrl) {
    return {
      attempted: false,
      status: 'skipped',
      reason: 'api_url_not_configured',
    };
  }

  const trigger = options.triggerGradingRun ?? triggerGradingRun;

  try {
    await trigger(options.apiUrl);
    options.logger?.info?.(
      `Triggered grading after ingest cycle for ${results
        .map((summary) => summary.league)
        .join(', ')}`,
    );

    return {
      attempted: true,
      status: 'triggered',
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'unknown grading trigger error';
    options.logger?.warn?.(`Failed to trigger grading after ingest cycle: ${reason}`);

    return {
      attempted: true,
      status: 'failed',
      reason,
    };
  }
}

export async function triggerGradingRun(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(new URL('/api/grading/run', apiUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      source: 'ingestor.cycle',
    }),
  });

  if (!response.ok) {
    throw new Error(`grading trigger returned ${response.status}`);
  }
}

export function parseConfiguredLeagues(value: string | undefined) {
  const source = value ?? SUPPORTED_SGO_LEAGUES.join(',');
  return source
    .split(',')
    .map((league) => league.trim().toUpperCase())
    .filter((league) => league.length > 0);
}

function validateLeagues(leagues: string[]) {
  for (const league of leagues) {
    if (!SUPPORTED_SGO_LEAGUES.includes(league as (typeof SUPPORTED_SGO_LEAGUES)[number])) {
      throw new Error(`Unsupported SGO league: ${league}`);
    }
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fetchWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
