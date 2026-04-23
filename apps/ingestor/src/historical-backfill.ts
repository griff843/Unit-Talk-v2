import type { IngestorRepositoryBundle } from '@unit-talk/db';
import {
  ingestLeague,
  type IngestLeagueOptions,
  type IngestLeagueSummary,
} from './ingest-league.js';

export interface HistoricalBackfillOptions {
  repositories: IngestorRepositoryBundle;
  leagues: string[];
  apiKey?: string;
  startDate: string;
  endDate: string;
  skipResults?: boolean;
  resultsOnly?: boolean;
  providerEventIds?: string[];
  fetchImpl?: IngestLeagueOptions['fetchImpl'];
  logger?: Pick<Console, 'warn' | 'info'>;
  ingestLeagueImpl?: typeof ingestLeague;
}

export interface HistoricalBackfillRun {
  date: string;
  league: string;
  summary: IngestLeagueSummary;
}

export interface HistoricalBackfillSummary {
  startDate: string;
  endDate: string;
  days: number;
  runs: HistoricalBackfillRun[];
}

export async function runHistoricalBackfill(
  options: HistoricalBackfillOptions,
): Promise<HistoricalBackfillSummary> {
  assertIsoDate(options.startDate, 'startDate');
  assertIsoDate(options.endDate, 'endDate');

  if (options.startDate > options.endDate) {
    throw new Error(
      `startDate must be on or before endDate; received ${options.startDate} > ${options.endDate}`,
    );
  }

  const ingest = options.ingestLeagueImpl ?? ingestLeague;
  const dates = enumerateDatesInclusive(options.startDate, options.endDate);
  const runs: HistoricalBackfillRun[] = [];

  for (const date of dates) {
    const startsAfter = `${date}T00:00:00.000Z`;
    const nextDate = toNextDate(date);

    for (const league of options.leagues) {
      const summary = await ingest(
        league,
        options.apiKey,
        options.repositories,
        {
          snapshotAt: nextDate,
          startsAfter,
          startsBefore: nextDate,
          resultsStartsAfter: startsAfter,
          resultsStartsBefore: nextDate,
          resultsLookbackHours: 24,
          historical: true,
          ...(options.providerEventIds !== undefined
            ? { providerEventIds: options.providerEventIds }
            : {}),
          ...(options.resultsOnly !== undefined
            ? { resultsOnly: options.resultsOnly }
            : {}),
          ...(options.skipResults !== undefined
            ? { skipResults: options.skipResults }
            : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.logger ? { logger: options.logger } : {}),
        },
      );

      runs.push({
        date,
        league,
        summary,
      });
    }
  }

  return {
    startDate: options.startDate,
    endDate: options.endDate,
    days: dates.length,
    runs,
  };
}

function assertIsoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be formatted as YYYY-MM-DD`);
  }
}

function enumerateDatesInclusive(startDate: string, endDate: string) {
  const dates: string[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = toNextDate(cursor);
  }

  return dates;
}

function toNextDate(date: string) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
