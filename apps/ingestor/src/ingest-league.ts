import type { IngestorRepositoryBundle } from '@unit-talk/db';
import { resolveSgoEntities } from './entity-resolver.js';
import { fetchSGOResults } from './results-fetcher.js';
import { resolveAndInsertResults } from './results-resolver.js';
import { fetchAndPairSGOProps, type SGOFetchOptions } from './sgo-fetcher.js';
import { normalizeSGOPairedProp } from './sgo-normalizer.js';

export interface IngestLeagueOptions {
  fetchImpl?: SGOFetchOptions['fetchImpl'];
  snapshotAt?: string;
  startsAfter?: string;
  startsBefore?: string;
  skipResults?: boolean;
  logger?: Pick<Console, 'warn' | 'info'>;
}

export interface IngestLeagueSummary {
  league: string;
  status: 'succeeded' | 'skipped';
  eventsCount: number;
  pairedCount: number;
  normalizedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  resolvedEventsCount: number;
  resolvedParticipantsCount: number;
  resultsEventsCount: number;
  insertedResultsCount: number;
  skippedResultsCount: number;
  runId: string | null;
}

export async function ingestLeague(
  league: string,
  apiKey: string | undefined,
  repositories: IngestorRepositoryBundle,
  options: IngestLeagueOptions = {},
): Promise<IngestLeagueSummary> {
  if (!apiKey) {
    options.logger?.warn?.(`SGO_API_KEY missing; skipping ingest for ${league}`);
    return {
      league,
      status: 'skipped',
      eventsCount: 0,
      pairedCount: 0,
      normalizedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      resolvedEventsCount: 0,
      resolvedParticipantsCount: 0,
      resultsEventsCount: 0,
      insertedResultsCount: 0,
      skippedResultsCount: 0,
      runId: null,
    };
  }

  const snapshotAt = options.snapshotAt ?? new Date().toISOString();
  const run = await repositories.runs.startRun({
    runType: 'ingestor.cycle',
    actor: 'ingestor',
    details: {
      provider: 'sgo',
      league,
      snapshotAt,
    },
  });

  try {
    const fetched = await fetchAndPairSGOProps({
      apiKey,
      league,
      snapshotAt,
      ...(options.startsAfter ? { startsAfter: options.startsAfter } : {}),
      ...(options.startsBefore ? { startsBefore: options.startsBefore } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

    const resolved = await resolveSgoEntities(fetched.events, repositories, {
      ...(options.logger ? { logger: options.logger } : {}),
    });

    const normalized = fetched.pairedProps
      .map((prop) => normalizeSGOPairedProp(prop))
      .filter((offer) => offer !== null);

    const upsert = await repositories.providerOffers.upsertBatch(normalized);
    const skippedCount = fetched.pairedProps.length - normalized.length;
    const resolvedResults = options.skipResults
      ? {
          processedEvents: 0,
          completedEvents: 0,
          insertedResults: 0,
          skippedResults: 0,
          errors: 0,
        }
      : await resolveAndInsertResults(
          await fetchSGOResults({
            apiKey,
            league,
            snapshotAt,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          }),
          repositories,
          options.logger,
        );

    await repositories.runs.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        provider: 'sgo',
        league,
        snapshotAt,
        eventsCount: fetched.eventsCount,
        pairedCount: fetched.pairedProps.length,
        normalizedCount: normalized.length,
        insertedCount: upsert.insertedCount,
        updatedCount: upsert.updatedCount,
        skippedCount,
        resolvedEventsCount: resolved.resolvedEventsCount,
        resolvedParticipantsCount: resolved.resolvedParticipantsCount,
        resultsEventsCount: resolvedResults.completedEvents,
        insertedResultsCount: resolvedResults.insertedResults,
        skippedResultsCount: resolvedResults.skippedResults,
        resultsErrorsCount: resolvedResults.errors,
      },
    });

    return {
      league,
      status: 'succeeded',
      eventsCount: fetched.eventsCount,
      pairedCount: fetched.pairedProps.length,
      normalizedCount: normalized.length,
      insertedCount: upsert.insertedCount,
      updatedCount: upsert.updatedCount,
      skippedCount,
      resolvedEventsCount: resolved.resolvedEventsCount,
      resolvedParticipantsCount: resolved.resolvedParticipantsCount,
      resultsEventsCount: resolvedResults.completedEvents,
      insertedResultsCount: resolvedResults.insertedResults,
      skippedResultsCount: resolvedResults.skippedResults,
      runId: run.id,
    };
  } catch (error) {
    await repositories.runs.completeRun({
      runId: run.id,
      status: 'failed',
      details: {
        provider: 'sgo',
        league,
        snapshotAt,
        error: error instanceof Error ? error.message : 'unknown ingest error',
      },
    });
    throw error;
  }
}
