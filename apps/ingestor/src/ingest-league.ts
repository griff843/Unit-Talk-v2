import type { IngestorRepositoryBundle } from '@unit-talk/db';
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './circuit-breaker.js';
import { archiveRawProviderPayload, shouldBlockOnArchiveFailure } from './raw-provider-payload-archive.js';
import { resolveSgoEntities } from './entity-resolver.js';
import {
  fetchSGOResultsWithTelemetry,
  type SGORequestTelemetry,
} from './sgo-fetcher.js';
import {
  classifyProviderIngestionFailure,
  createPartialMarketFailure,
  createStaleAfterCycleFailure,
  createZeroOffersFailure,
} from './provider-ingestion-failures.js';
import { chunkByPolicy, withProviderDbRetry } from './provider-ingestion-db.js';
import type {
  ProviderIngestionDbWritePolicy,
  ProviderPayloadArchivePolicy,
} from './provider-ingestion-policy.js';
import {
  evaluateProviderOfferFreshnessGate,
  type ProviderOfferStagingMode,
  stageProviderOfferCycle,
} from './provider-offer-staging.js';
import type {
  ProviderOfferReplayCaptureSession,
  ProviderOfferReplayMarketCoverage,
} from './provider-offer-replay.js';
import { resolveAndInsertResults } from './results-resolver.js';
import {
  fetchAndPairSGOProps,
  type SGOFetchOptions,
  type SGOFetchResult,
} from './sgo-fetcher.js';
import { normalizeSGOPairedProp } from './sgo-normalizer.js';

export interface IngestLeagueOptions {
  fetchImpl?: SGOFetchOptions['fetchImpl'];
  snapshotAt?: string;
  startsAfter?: string;
  startsBefore?: string;
  resultsStartsAfter?: string;
  resultsStartsBefore?: string;
  providerEventIds?: string[];
  resultsLookbackHours?: number;
  /** Max total time for the results pagination loop. Passed to fetchSGOResultsWithTelemetry. */
  resultsMaxFetchMs?: number;
  skipResults?: boolean;
  resultsOnly?: boolean;
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Console, 'warn' | 'info'>;
  /** Circuit breaker options for odds API calls. */
  circuitBreaker?: CircuitBreakerOptions;
  /** Pre-built circuit breakers per league (managed by the runner for cross-cycle persistence). */
  circuitBreakers?: {
    odds?: CircuitBreaker<SGOFetchResult>;
    results?: CircuitBreaker<
      Awaited<ReturnType<typeof fetchSGOResultsWithTelemetry>>
    >;
  };
  /**
   * When true, fetches in historical mode with finalized events plus SGO
   * alt-line and open/close bookmaker fields.
   * Use for backfill of completed events. Live ingest should leave this unset.
   */
  historical?: boolean;
  providerOfferStagingMode?: ProviderOfferStagingMode;
  providerDbWritePolicy?: ProviderIngestionDbWritePolicy;
  providerPayloadArchivePolicy?: ProviderPayloadArchivePolicy;
  providerOfferProofStatus?: 'required' | 'verified' | 'waived';
  providerOfferFreshnessMaxAgeMs?: number;
  replayCaptureSession?: ProviderOfferReplayCaptureSession;
}

export interface IngestQuotaSummary {
  provider: 'sgo';
  requestCount: number;
  successfulRequests: number;
  creditsUsed: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  lastStatus: number | null;
  rateLimitHitCount: number;
  backoffCount: number;
  backoffMs: number;
  retryAfterMs: number | null;
  throttled: boolean;
  headersSeen: boolean;
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
  quota: IngestQuotaSummary;
}

export async function ingestLeague(
  league: string,
  apiKey: string | undefined,
  repositories: IngestorRepositoryBundle,
  options: IngestLeagueOptions = {},
): Promise<IngestLeagueSummary> {
  if (!apiKey) {
    options.logger?.warn?.(
      `SGO_API_KEY missing; skipping ingest for ${league}`,
    );
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
      quota: createEmptyQuotaSummary(),
    };
  }

  const snapshotAt = options.snapshotAt ?? new Date().toISOString();
  const providerDbWritePolicy = options.providerDbWritePolicy ?? {
    statementTimeoutMs: 15_000,
    lockTimeoutMs: 5_000,
    maxBatchSize: 500,
    mergeChunkSize: 250,
    retryMaxAttempts: 2,
    retryBackoffMs: 1_000,
  };
  const providerPayloadArchivePolicy = options.providerPayloadArchivePolicy ?? {
    mode: 'fail_open' as const,
    spoolDir: 'out/provider-payload-archive',
  };
  const providerOfferStagingMode = options.providerOfferStagingMode ?? 'off';
  const providerOfferProofStatus = options.providerOfferProofStatus ?? 'required';
  const providerOfferFreshnessMaxAgeMs =
    options.providerOfferFreshnessMaxAgeMs ?? 30 * 60 * 1000;
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
    let fetched: SGOFetchResult;
    let resolved = { resolvedEventsCount: 0, resolvedParticipantsCount: 0 };
    let upsert = { insertedCount: 0, updatedCount: 0 };
    let normalizedCount = 0;
    let skippedCount = 0;
    let archiveFailure:
      | {
          message: string;
          archivedAt: string | null;
        }
      | null = null;

    if (options.resultsOnly) {
      fetched = createEmptyFetchResult(snapshotAt);
    } else {
      const oddsFetchFn = () =>
        fetchAndPairSGOProps({
          apiKey,
          league,
          snapshotAt,
          ...(options.startsAfter ? { startsAfter: options.startsAfter } : {}),
          ...(options.startsBefore
            ? { startsBefore: options.startsBefore }
            : {}),
          ...(options.providerEventIds
            ? { providerEventIds: options.providerEventIds }
            : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.sleep ? { sleep: options.sleep } : {}),
          ...(options.replayCaptureSession
            ? { requestObserver: (capture) => options.replayCaptureSession?.recordRequest(capture) }
            : {}),
          ...(options.historical ? { historical: true } : {}),
        });

      const oddsCb =
        options.circuitBreakers?.odds ??
        new CircuitBreaker(
          oddsFetchFn,
          createEmptyFetchResult(snapshotAt),
          options.circuitBreaker,
        );
      fetched = await oddsCb.call();

      try {
        await archiveRawProviderPayload({
          providerKey: 'sgo',
          league,
          runId: run.id,
          snapshotAt,
          kind: 'odds',
          payload: fetched.rawPayloads,
          spoolDir: providerPayloadArchivePolicy.spoolDir,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        archiveFailure = {
          message,
          archivedAt: null,
        };
        if (shouldBlockOnArchiveFailure(providerPayloadArchivePolicy.mode)) {
          throw new Error(`archive failure: ${message}`);
        }
        options.logger?.warn?.(
          `[ingestor] archive fail-open for sgo/${league}: ${message}`,
        );
      }

      resolved = await resolveSgoEntities(fetched.events, repositories, {
        ...(options.logger ? { logger: options.logger } : {}),
        providerKey: 'sgo',
        ingestionCycleRunId: run.id,
        snapshotAt,
        historical: options.historical ?? false,
      });

      const providerEventIds = fetched.events
        .map((event) => event.providerEventId)
        .filter((providerEventId) => providerEventId.length > 0);
      const existingCombinations =
        await repositories.providerOffers.findExistingCombinations(
          providerEventIds,
          {
            includeBookmakerKey: true,
            beforeSnapshotAt: snapshotAt,
          },
        );
      const seenCombinations = new Set(existingCombinations);

      const normalized = fetched.pairedProps
        .map((prop) => normalizeSGOPairedProp(prop))
        .filter((offer) => offer !== null)
        .map((offer) => {
          const combinationKey = buildSgoCombinationKey({
            providerKey: offer.providerKey,
            providerEventId: offer.providerEventId,
            providerMarketKey: offer.providerMarketKey,
            providerParticipantId: offer.providerParticipantId,
            bookmakerKey: offer.bookmakerKey,
          });
          const isOpening =
            offer.isOpening || !seenCombinations.has(combinationKey);
          seenCombinations.add(combinationKey);
          return {
            ...offer,
            isOpening,
          };
        });
      normalizedCount = normalized.length;
      if (options.replayCaptureSession) {
        options.replayCaptureSession.recordMarketCoverage(
          summarizeReplayMarkets(normalized),
        );
      }
      if (normalized.length === 0) {
        const zeroOffersFailure = createZeroOffersFailure('sgo', league);
        await repositories.providerOffers.upsertCycleStatus({
          runId: run.id,
          providerKey: 'sgo',
          league,
          cycleSnapshotAt: snapshotAt,
          stageStatus: 'failed',
          freshnessStatus: 'unknown',
          proofStatus: 'waived',
          failureCategory: zeroOffersFailure.category,
          failureScope: zeroOffersFailure.scope,
          affectedProviderKey: zeroOffersFailure.affectedProviderKey,
          affectedSportKey: zeroOffersFailure.affectedSportKey,
          lastError: zeroOffersFailure.message,
          metadata: {
            providerOfferStagingMode,
            pairedCount: fetched.pairedProps.length,
            normalizedCount,
          },
        });
      } else if (providerOfferStagingMode === 'off') {
        for (const chunk of chunkByPolicy(
          normalized,
          providerDbWritePolicy.maxBatchSize,
        )) {
          const result = await withProviderDbRetry(
            () => repositories.providerOffers.upsertBatch(chunk),
            providerDbWritePolicy,
            { providerKey: 'sgo', sportKey: league },
          );
          upsert.insertedCount += result.insertedCount;
          upsert.updatedCount += result.updatedCount;
        }

        const freshness = evaluateProviderOfferFreshnessGate({
          snapshotAt,
          maxAgeMs: providerOfferFreshnessMaxAgeMs,
        });
        const partialFailure =
          fetched.pairedProps.length !== normalized.length
            ? createPartialMarketFailure(
                'sgo',
                league,
                null,
                `Normalization skipped ${fetched.pairedProps.length - normalized.length} provider offer row(s)`,
              )
            : null;
        const staleFailure =
          freshness.status !== 'fresh'
            ? createStaleAfterCycleFailure(
                'sgo',
                league,
                `Freshness degraded after cycle with status=${freshness.status}`,
              )
            : null;

        await repositories.providerOffers.upsertCycleStatus({
          runId: run.id,
          providerKey: 'sgo',
          league,
          cycleSnapshotAt: snapshotAt,
          stageStatus: 'merged',
          freshnessStatus: freshness.status,
          proofStatus: 'waived',
          stagedCount: normalized.length,
          mergedCount: upsert.insertedCount + upsert.updatedCount,
          duplicateCount: 0,
          failureCategory:
            archiveFailure != null
              ? 'archive_failure'
              : partialFailure?.category ?? staleFailure?.category ?? null,
          failureScope:
            archiveFailure != null
              ? 'archive'
              : partialFailure?.scope ?? staleFailure?.scope ?? null,
          affectedProviderKey: 'sgo',
          affectedSportKey: league,
          lastError:
            archiveFailure?.message ??
            partialFailure?.message ??
            staleFailure?.message ??
            null,
          metadata: {
            directWrite: true,
            providerOfferStagingMode,
            dbPolicy: providerDbWritePolicy,
            archivePolicy: providerPayloadArchivePolicy,
          },
        });
      } else {
        const stagingResult = await stageProviderOfferCycle({
          repositories,
          runId: run.id,
          providerKey: 'sgo',
          league,
          snapshotAt,
          offers: normalized,
          mode: providerOfferStagingMode,
          freshnessMaxAgeMs: providerOfferFreshnessMaxAgeMs,
          proofStatus: providerOfferProofStatus,
          mergeChunkSize: providerDbWritePolicy.mergeChunkSize,
        });
        upsert = {
          insertedCount: stagingResult.mergedCount,
          updatedCount: stagingResult.duplicateCount,
        };
      }

      const startedEvents =
        await repositories.events.listStartedBySnapshot(snapshotAt);
      const closingCandidates = new Map<
        string,
        { providerEventId: string; commenceTime: string }
      >();
      for (const event of fetched.events) {
        if (typeof event.startsAt === 'string' && event.startsAt.length > 0) {
          closingCandidates.set(event.providerEventId, {
            providerEventId: event.providerEventId,
            commenceTime: event.startsAt,
          });
        }
      }
      for (const event of startedEvents) {
        if (!event.external_id) {
          continue;
        }
        const commenceTime = event.metadata?.starts_at;
        if (typeof commenceTime !== 'string' || commenceTime.length === 0) {
          continue;
        }
        closingCandidates.set(event.external_id, {
          providerEventId: event.external_id,
          commenceTime,
        });
      }
      await repositories.providerOffers.markClosingLines(
        [...closingCandidates.values()],
        snapshotAt,
        { includeBookmakerKey: true },
      );
      skippedCount = fetched.pairedProps.length - normalized.length;
    }
    const emptyResults = {
      results: [],
      rawPayloads: [],
      requestTelemetry: createEmptyRequestTelemetry('results'),
    };
    let fetchedResults: Awaited<
      ReturnType<typeof fetchSGOResultsWithTelemetry>
    >;
    if (options.skipResults) {
      fetchedResults = emptyResults;
    } else {
      const resultsFetchFn = () =>
        fetchSGOResultsWithTelemetry({
          apiKey,
          league,
          snapshotAt,
          ...(options.resultsStartsAfter
            ? { startsAfter: options.resultsStartsAfter }
            : {}),
          ...(options.resultsStartsBefore
            ? { startsBefore: options.resultsStartsBefore }
            : {}),
          ...(options.providerEventIds
            ? { providerEventIds: options.providerEventIds }
            : {}),
          ...(options.resultsLookbackHours !== undefined
            ? { lookbackHours: options.resultsLookbackHours }
            : {}),
          ...(options.resultsMaxFetchMs !== undefined
            ? { maxFetchMs: options.resultsMaxFetchMs }
            : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.sleep ? { sleep: options.sleep } : {}),
          ...(options.replayCaptureSession
            ? { requestObserver: (capture) => options.replayCaptureSession?.recordRequest(capture) }
            : {}),
        });

      const resultsCb =
        options.circuitBreakers?.results ??
        new CircuitBreaker(
          resultsFetchFn,
          emptyResults,
          options.circuitBreaker,
        );
      fetchedResults = await resultsCb.call();
      try {
        await archiveRawProviderPayload({
          providerKey: 'sgo',
          league,
          runId: run.id,
          snapshotAt,
          kind: 'results',
          payload: fetchedResults.rawPayloads,
          spoolDir: providerPayloadArchivePolicy.spoolDir,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (shouldBlockOnArchiveFailure(providerPayloadArchivePolicy.mode)) {
          throw new Error(`archive failure: ${message}`);
        }
        archiveFailure = { message, archivedAt: null };
        options.logger?.warn?.(
          `[ingestor] archive fail-open for sgo/${league} results: ${message}`,
        );
      }
    }

    const completedResultEvents = fetchedResults.results
      .map((result) => result.resolvedEvent)
      .filter(
        (
          event,
        ): event is NonNullable<
          (typeof fetchedResults.results)[number]['resolvedEvent']
        > => event !== null,
      );

    const resultResolved =
      completedResultEvents.length > 0
        ? await resolveSgoEntities(completedResultEvents, repositories, {
            ...(options.logger ? { logger: options.logger } : {}),
            providerKey: 'sgo',
            ingestionCycleRunId: run.id,
            snapshotAt,
            historical: options.historical ?? false,
          })
        : { resolvedEventsCount: 0, resolvedParticipantsCount: 0 };

    const resolvedEventsCount =
      resolved.resolvedEventsCount + resultResolved.resolvedEventsCount;
    const resolvedParticipantsCount =
      resolved.resolvedParticipantsCount +
      resultResolved.resolvedParticipantsCount;

    const resolvedResults = options.skipResults
      ? {
          processedEvents: 0,
          completedEvents: 0,
          insertedResults: 0,
          skippedResults: 0,
          errors: 0,
        }
      : await resolveAndInsertResults(
          fetchedResults.results,
          repositories,
          options.logger,
        );

    const quota = summarizeQuotaTelemetry([
      fetched.requestTelemetry,
      fetchedResults.requestTelemetry,
    ]);

    await repositories.runs.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        provider: 'sgo',
        league,
        snapshotAt,
        eventsCount: fetched.eventsCount,
        pairedCount: fetched.pairedProps.length,
        normalizedCount,
        insertedCount: upsert.insertedCount,
        updatedCount: upsert.updatedCount,
        skippedCount,
        resolvedEventsCount,
        resolvedParticipantsCount,
        resultsEventsCount: resolvedResults.completedEvents,
        insertedResultsCount: resolvedResults.insertedResults,
        skippedResultsCount: resolvedResults.skippedResults,
        resultsErrorsCount: resolvedResults.errors,
        quota,
      },
    });

    return {
      league,
      status: 'succeeded',
      eventsCount: fetched.eventsCount,
      pairedCount: fetched.pairedProps.length,
      normalizedCount,
      insertedCount: upsert.insertedCount,
      updatedCount: upsert.updatedCount,
      skippedCount,
      resolvedEventsCount,
      resolvedParticipantsCount,
      resultsEventsCount: resolvedResults.completedEvents,
      insertedResultsCount: resolvedResults.insertedResults,
      skippedResultsCount: resolvedResults.skippedResults,
      runId: run.id,
      quota,
    };
  } catch (error) {
    const failure = classifyProviderIngestionFailure(error, {
      providerKey: 'sgo',
      sportKey: league,
    });
    await repositories.providerOffers.upsertCycleStatus({
      runId: run.id,
      providerKey: 'sgo',
      league,
      cycleSnapshotAt: snapshotAt,
      stageStatus: 'failed',
      freshnessStatus: 'unknown',
      proofStatus: 'waived',
      failureCategory: failure.category,
      failureScope: failure.scope,
      affectedProviderKey: failure.affectedProviderKey,
      affectedSportKey: failure.affectedSportKey,
      affectedMarketKey: failure.affectedMarketKey,
      lastError: failure.message,
      metadata: {
        providerOfferStagingMode,
        dbPolicy: providerDbWritePolicy,
        archivePolicy: providerPayloadArchivePolicy,
      },
    });
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

function summarizeQuotaTelemetry(
  telemetry: SGORequestTelemetry[],
): IngestQuotaSummary {
  const meaningful = telemetry.filter((entry) => entry.requestCount > 0);
  if (meaningful.length === 0) {
    return createEmptyQuotaSummary();
  }

  return meaningful.reduce<IngestQuotaSummary>(
    (summary, entry) => ({
      provider: 'sgo',
      requestCount: summary.requestCount + entry.requestCount,
      successfulRequests: summary.successfulRequests + entry.successfulRequests,
      creditsUsed: summary.creditsUsed + entry.creditsUsed,
      limit: entry.limit ?? summary.limit,
      remaining: entry.remaining ?? summary.remaining,
      resetAt: entry.resetAt ?? summary.resetAt,
      lastStatus: entry.lastStatus ?? summary.lastStatus,
      rateLimitHitCount: summary.rateLimitHitCount + entry.rateLimitHitCount,
      backoffCount: summary.backoffCount + entry.backoffCount,
      backoffMs: summary.backoffMs + entry.backoffMs,
      retryAfterMs: entry.retryAfterMs ?? summary.retryAfterMs,
      throttled: summary.throttled || entry.throttled,
      headersSeen: summary.headersSeen || entry.headersSeen,
    }),
    createEmptyQuotaSummary(),
  );
}

function createEmptyQuotaSummary(): IngestQuotaSummary {
  return {
    provider: 'sgo',
    requestCount: 0,
    successfulRequests: 0,
    creditsUsed: 0,
    limit: null,
    remaining: null,
    resetAt: null,
    lastStatus: null,
    rateLimitHitCount: 0,
    backoffCount: 0,
    backoffMs: 0,
    retryAfterMs: null,
    throttled: false,
    headersSeen: false,
  };
}

function createEmptyRequestTelemetry(
  endpoint: 'odds' | 'results',
): SGORequestTelemetry {
  return {
    ...createEmptyQuotaSummary(),
    endpoint,
  };
}

function createEmptyFetchResult(_snapshotAt: string): SGOFetchResult {
  return {
    eventsCount: 0,
    events: [],
    pairedProps: [],
    rawPayloads: [],
    requestTelemetry: createEmptyRequestTelemetry('odds'),
  };
}

function buildSgoCombinationKey(input: {
  providerKey: string;
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  bookmakerKey: string | null;
}) {
  return [
    input.providerKey,
    input.providerEventId,
    input.providerMarketKey,
    input.providerParticipantId ?? '',
    input.bookmakerKey ?? '',
  ].join(':');
}

function summarizeReplayMarkets(
  offers: Array<{
    providerKey: string;
    providerMarketKey: string;
    sportKey: string | null;
  }>,
): ProviderOfferReplayMarketCoverage[] {
  const coverage = new Map<string, ProviderOfferReplayMarketCoverage>();
  for (const offer of offers) {
    const key = [
      offer.providerKey,
      offer.sportKey ?? '',
      offer.providerMarketKey,
    ].join(':');
    const existing = coverage.get(key);
    if (existing) {
      existing.offerCount += 1;
    } else {
      coverage.set(key, {
        providerKey: offer.providerKey,
        sportKey: offer.sportKey,
        providerMarketKey: offer.providerMarketKey,
        offerCount: 1,
      });
    }
  }
  return Array.from(coverage.values());
}
