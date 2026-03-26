import type { IngestorRepositoryBundle } from '@unit-talk/db';
import { ingestLeague, type IngestLeagueSummary } from './ingest-league.js';

export const SUPPORTED_SGO_LEAGUES = ['NBA', 'NFL', 'MLB', 'NHL'] as const;

export interface IngestorRunnerOptions {
  repositories: IngestorRepositoryBundle;
  leagues: string[];
  apiKey?: string;
  maxCycles?: number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  skipResults?: boolean;
  logger?: Pick<Console, 'warn' | 'info'>;
}

export interface IngestorCycleSummary {
  cycle: number;
  results: IngestLeagueSummary[];
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
          ...(options.logger ? { logger: options.logger } : {}),
        }),
      );
    }

    summaries.push({ cycle, results });

    if (cycle < maxCycles) {
      await sleep(pollIntervalMs);
    }
  }

  return summaries;
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
