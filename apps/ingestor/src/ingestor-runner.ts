import type { IngestorRepositoryBundle } from '@unit-talk/db';
import { ingestLeague, type IngestLeagueSummary } from './ingest-league.js';
import { ingestOddsApiLeague, type OddsApiIngestSummary } from './ingest-odds-api.js';
import { fetchSGOAccountUsage, type SGOAccountUsage } from './sgo-fetcher.js';

export const SUPPORTED_SGO_LEAGUES = ['NBA', 'NFL', 'MLB', 'NHL'] as const;

export interface IngestorRunnerOptions {
  repositories: IngestorRepositoryBundle;
  leagues: string[];
  apiKey?: string;
  oddsApiKey?: string;
  apiUrl?: string;
  maxCycles?: number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  skipResults?: boolean;
  logger?: Pick<Console, 'warn' | 'info'>;
  triggerGradingRun?: typeof triggerGradingRun;
}

export interface IngestorGradingTriggerSummary {
  attempted: boolean;
  status: 'triggered' | 'skipped' | 'failed';
  reason?: string;
}

export interface IngestorCycleSummary {
  cycle: number;
  results: IngestLeagueSummary[];
  oddsApiResults: OddsApiIngestSummary[];
  gradingTrigger: IngestorGradingTriggerSummary;
  sgoUsage: SGOAccountUsage | null;
}

export async function runIngestorCycles(
  options: IngestorRunnerOptions,
): Promise<IngestorCycleSummary[]> {
  validateLeagues(options.leagues);

  const maxCycles = options.maxCycles ?? 1;
  const pollIntervalMs = options.pollIntervalMs ?? 300_000;
  const sleep = options.sleep ?? defaultSleep;
  const summaries: IngestorCycleSummary[] = [];

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const results: IngestLeagueSummary[] = [];

    for (const league of options.leagues) {
      results.push(
        await ingestLeague(league, options.apiKey, options.repositories, {
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.skipResults !== undefined ? { skipResults: options.skipResults } : {}),
          ...(options.sleep ? { sleep: options.sleep } : {}),
          ...(options.logger ? { logger: options.logger } : {}),
        }),
      );
    }

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
          }),
        );
      }
    }

    const gradingTrigger = await triggerGradingForCycle(results, options);

    let sgoUsage: SGOAccountUsage | null = null;
    if (options.apiKey) {
      try {
        sgoUsage = await fetchSGOAccountUsage(
          options.apiKey,
          options.fetchImpl ?? fetch,
        );
      } catch (error) {
        options.logger?.warn?.(
          `Failed to fetch SGO account usage: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    summaries.push({ cycle, results, oddsApiResults, gradingTrigger, sgoUsage });

    if (cycle < maxCycles) {
      await sleep(pollIntervalMs);
    }
  }

  return summaries;
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

  if (!results.some((summary) => summary.resultsEventsCount > 0)) {
    return {
      attempted: false,
      status: 'skipped',
      reason: 'no_completed_results',
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
