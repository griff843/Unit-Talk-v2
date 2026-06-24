import type { IngestorRepositoryBundle } from '@unit-talk/db';
import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitBreakerOptions,
  type CircuitBreakerSnapshot,
} from './circuit-breaker.js';
import { type ProviderQuarantineRegistry } from './provider-quarantine.js';
import { archiveRawProviderPayload, shouldBlockOnArchiveFailure } from './raw-provider-payload-archive.js';
import {
  buildOversizedArchiveMetadata,
  isPayloadOversized,
  resolveArchiveWriteTimeoutMs,
  resolveMaxArchivePayloadBytes,
  serializedPayloadBytes,
  sha256Hex,
  withArchiveWriteTimeout,
} from './archive-payload-guard.js';
import { resolveSgoEntities, type EntityResolutionSummary } from './entity-resolver.js';
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
import {
  chunkEventIds,
  selectPlayerPropEventIds,
} from './sgo-player-prop-scope.js';
import { mapCooperatively } from './cooperative.js';

/**
 * Lookback window for the opening-line dedup lookup (UTV2-1282). provider_offer_history
 * is daily-partitioned by snapshot_at; bounding the lookup to the last 72h prunes the
 * scan to ~3 recent partitions instead of all ~60. Actively-polled events snapshot every
 * cycle, so 72h is far more than enough to recognize an already-seen combination; SGO's
 * own per-offer opening signal still applies on top of this.
 */
const OPENING_DEDUP_LOOKBACK_HOURS = 72;

function subtractHoursFromIso(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() - hours * 3_600_000).toISOString();
}

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
   * open/close bookmaker fields. Use for backfill of completed events.
   * Live ingest should leave this unset.
   */
  historical?: boolean;
  /** When true, passes bookmakerID=pinnacle to SGO — use during peak-window polling. */
  pinnacleOnly?: boolean;
  /**
   * PLAYER_ID-wildcard oddID patterns for a dedicated player-prop fetch
   * (UTV2-1275 Wave 1). When set on a live (non-historical) ingest, a SECOND SGO
   * request is issued for these patterns WITHOUT pinnacleOnly, so player props are
   * ingested every cycle regardless of peak Pinnacle-only game-line polling, and
   * the props are merged with the game-line result before normalization.
   */
  playerPropOddIdPatterns?: string[];
  providerOfferStagingMode?: ProviderOfferStagingMode;
  providerDbWritePolicy?: ProviderIngestionDbWritePolicy;
  providerPayloadArchivePolicy?: ProviderPayloadArchivePolicy;
  providerOfferProofStatus?: 'required' | 'verified' | 'waived';
  providerOfferFreshnessMaxAgeMs?: number;
  replayCaptureSession?: ProviderOfferReplayCaptureSession;
  /** Optional quarantine registry — receives circuit-open events for this provider. */
  quarantineRegistry?: ProviderQuarantineRegistry;
  /**
   * External abort signal (per-league timeout from the runner). When it fires,
   * in-flight SGO fetches are cancelled and the next phase checkpoint throws,
   * routing into the catch below so the cycle is recorded fail-closed rather than
   * hanging. (UTV2-1280)
   */
  signal?: AbortSignal;
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
    mode: 'fail_closed' as const,
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

  // Phase-level timing (UTV2-1283) — recorded on the run so a slow/blocking phase is
  // visible from system_runs.details even when a cycle fails closed on timeout.
  // Declared outside the try so the catch can record timings up to the failure point.
  const phaseTimings: Record<string, number> = {};
  const timePhase = async <R>(
    name: string,
    work: () => Promise<R>,
  ): Promise<R> => {
    const startedAtMs = Date.now();
    try {
      return await work();
    } finally {
      phaseTimings[name] = (phaseTimings[name] ?? 0) + (Date.now() - startedAtMs);
    }
  };

  try {
    options.quarantineRegistry?.assertAvailable('sgo');

    let fetched: SGOFetchResult;
    let resolved: EntityResolutionSummary = {
      resolvedEventsCount: 0,
      resolvedParticipantsCount: 0,
    };
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
      // Shared request options for both the game-line and player-prop fetches.
      const sharedFetchOptions: SGOFetchOptions = {
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
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.replayCaptureSession
          ? { requestObserver: (capture) => options.replayCaptureSession?.recordRequest(capture) }
          : {}),
        ...(options.historical ? { historical: true } : {}),
      };

      // Game-line fetch: may be Pinnacle-only during peak polling.
      const gameLineFetchFn = () =>
        fetchAndPairSGOProps({
          ...sharedFetchOptions,
          ...(options.pinnacleOnly ? { pinnacleOnly: true } : {}),
        });

      const oddsCb =
        options.circuitBreakers?.odds ??
        new CircuitBreaker(
          gameLineFetchFn,
          createEmptyFetchResult(snapshotAt),
          options.circuitBreaker,
        );
      const gameLineResult = await oddsCb.call(gameLineFetchFn);

      // Player-prop fetch (UTV2-1275 Wave 1): a SEPARATE request using PLAYER_ID
      // oddID patterns, never Pinnacle-only (Pinnacle carries no player props),
      // run every cycle on live ingest so props stay fresh and are not dropped by
      // peak Pinnacle-only game-line polling. Merged before normalization.
      //
      // Event-scoping (UTV2-1281): a single league-wide PLAYER_ID-wildcard query
      // over a full slate (e.g. in-season MLB) expands to every player on every
      // game and returns a payload large enough to exhaust the per-league
      // wall-clock bound — so the MLB cycle never completes and MLB never produces
      // offers. The game-line fetch above already enumerated the slate; restrict
      // the prop fetch to the imminent subset of those events, in small batches, so
      // each request stays small and fast (the shape that already completes in
      // seconds for NBA/NFL). When the caller already scoped to specific events
      // (e.g. a finalized repoll), honor that scope directly.
      const propPatterns = options.playerPropOddIdPatterns ?? [];
      let propResult: SGOFetchResult | null = null;
      if (!options.historical && propPatterns.length > 0) {
        const scopedEventIds =
          options.providerEventIds && options.providerEventIds.length > 0
            ? options.providerEventIds
            : selectPlayerPropEventIds(gameLineResult.events, snapshotAt);

        for (const batch of chunkEventIds(scopedEventIds)) {
          if (batch.length === 0) {
            continue;
          }
          // Stop before issuing another scoped request if the per-league deadline
          // fired during a prior batch. (UTV2-1280)
          options.signal?.throwIfAborted();
          const propFetchFn = () =>
            fetchAndPairSGOProps({
              ...sharedFetchOptions,
              providerEventIds: batch,
              playerPropOddIdPatterns: propPatterns,
              includeOpenCloseOdds: true,
            });
          const batchResult = await oddsCb.call(propFetchFn);
          propResult = propResult
            ? mergeSgoFetchResults(propResult, batchResult)
            : batchResult;
        }
      }

      fetched = propResult
        ? mergeSgoFetchResults(gameLineResult, propResult)
        : gameLineResult;

      // Checkpoint: if the per-league deadline fired during the fetch phase, stop
      // before the heavier DB write/entity-resolution phase. (UTV2-1280)
      options.signal?.throwIfAborted();

      // Provider event IDs for this snapshot — recorded in compact metadata when an
      // archive payload is too large to store as one giant JSON value (UTV2-1294).
      const archiveEventIds = fetched.events
        .map((event) => event.providerEventId)
        .filter((providerEventId) => providerEventId.length > 0);

      try {
        await archiveRawProviderPayload({
          providerKey: 'sgo',
          league,
          runId: run.id,
          snapshotAt,
          kind: 'odds',
          payload: fetched.rawPayloads,
          spoolDir: providerPayloadArchivePolicy.spoolDir,
          rawPayloadsRepository: repositories.rawPayloads,
          rawBody: fetched.rawBodies.join('\n'),
          eventIds: archiveEventIds,
          ...(options.logger ? { logger: options.logger } : {}),
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

      // Write immutable OddsSnapshot (WS-1.1 — UTV2-1085).
      // Best-effort: non-fatal. Bounded by the same size guard + write timeout as the
      // raw_payloads archive (UTV2-1294) so the oversized MLB game-line odds blob can
      // never starve the settlement-critical path via PostgREST statement_timeout.
      try {
        const snapshotSerialized = JSON.stringify(fetched.rawPayloads);
        const snapshotBytes = serializedPayloadBytes(snapshotSerialized);
        const snapshotMaxBytes = resolveMaxArchivePayloadBytes();
        const snapshotPriceBlob = isPayloadOversized(snapshotBytes, snapshotMaxBytes)
          ? buildOversizedArchiveMetadata({
              provider: 'sgo',
              league,
              kind: 'odds_snapshot',
              payloadBytes: snapshotBytes,
              maxPayloadBytes: snapshotMaxBytes,
              payloadHash: sha256Hex(snapshotSerialized),
              snapshotAt,
              eventIds: archiveEventIds,
            })
          : fetched.rawPayloads;
        await withArchiveWriteTimeout(
          () =>
            repositories.oddsSnapshots.insert({
              providerKey: 'sgo',
              marketKey: 'odds',
              league,
              runId: run.id,
              snapshotAt,
              priceBlob: snapshotPriceBlob,
            }),
          resolveArchiveWriteTimeoutMs(),
          `odds_snapshots:${league}`,
        );
      } catch (snapshotError) {
        options.logger?.warn?.(
          `[ingestor] odds_snapshot write failed for sgo/${league} (non-fatal): ${
            snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
          }`,
        );
      }

      resolved = await resolveSgoEntities(fetched.events, repositories, {
        ...(options.logger ? { logger: options.logger } : {}),
        providerKey: 'sgo',
        ingestionCycleRunId: run.id,
        snapshotAt,
        historical: options.historical ?? false,
      });

      // UTV2-1298: surface entity-resolution phase timing in the cycle phase-timings log
      // (previously the dominant, uninstrumented cost behind the 240s MLB wall-clock).
      const entityTimings = resolved.timings;
      if (entityTimings) {
        phaseTimings['entityResolution'] = entityTimings.totalMs;
        phaseTimings['entityPlayerUpsert'] = entityTimings.playerUpsertMs;
        phaseTimings['entityEventParticipant'] = entityTimings.eventParticipantMs;
        phaseTimings['entityEventUpsert'] = entityTimings.eventUpsertMs;
        phaseTimings['entityTeamLink'] = entityTimings.teamLinkMs;
        options.logger?.info?.(
          `[ingestor] entity-resolution sgo/${league}: ${entityTimings.totalMs}ms ` +
            `concurrency=${entityTimings.concurrency} events=${entityTimings.events} ` +
            `players=${entityTimings.players} eventParticipants=${entityTimings.eventParticipants} ` +
            `teamLinks=${entityTimings.teamLinks} errors=${entityTimings.errors}`,
        );
      }

      const providerEventIds = fetched.events
        .map((event) => event.providerEventId)
        .filter((providerEventId) => providerEventId.length > 0);
      const existingCombinations = await timePhase('dedup', () =>
        repositories.providerOffers.findExistingCombinations(providerEventIds, {
          includeBookmakerKey: true,
          beforeSnapshotAt: snapshotAt,
          // Bound the opening-line dedup lookup to a recent window so it prunes to
          // the last few daily partitions of provider_offer_history instead of
          // scanning all history (which times out on a full slate). (UTV2-1282)
          afterSnapshotAt: subtractHoursFromIso(
            snapshotAt,
            OPENING_DEDUP_LOOKBACK_HOURS,
          ),
        }),
      );
      const seenCombinations = new Set(existingCombinations);

      // Normalize cooperatively: a full slate yields tens of thousands of paired
      // props; a single synchronous map().filter().map() over them blocks the event
      // loop and defeats the per-league timeout (the cycle wedges). Yield between
      // chunks and observe the abort signal mid-transform. (UTV2-1283)
      const normalized = await timePhase('normalize', async () => {
        const normalizedCandidates = (
          await mapCooperatively(
            fetched.pairedProps,
            (prop) => normalizeSGOPairedProp(prop),
            { signal: options.signal },
          )
        ).filter(
          (offer): offer is NonNullable<typeof offer> => offer !== null,
        );
        return mapCooperatively(
          normalizedCandidates,
          (offer) => {
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
          },
          { signal: options.signal },
        );
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
      rawBodies: [],
      requestTelemetry: createEmptyRequestTelemetry('results'),
    };
    let fetchedResults: Awaited<
      ReturnType<typeof fetchSGOResultsWithTelemetry>
    >;
    if (options.skipResults) {
      fetchedResults = emptyResults;
    } else {
      // Checkpoint before the results fetch/resolve phase. (UTV2-1280)
      options.signal?.throwIfAborted();
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
          ...(options.signal ? { signal: options.signal } : {}),
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
      fetchedResults = await resultsCb.call(resultsFetchFn);
      try {
        await archiveRawProviderPayload({
          providerKey: 'sgo',
          league,
          runId: run.id,
          snapshotAt,
          kind: 'results',
          payload: fetchedResults.rawPayloads,
          spoolDir: providerPayloadArchivePolicy.spoolDir,
          rawPayloadsRepository: repositories.rawPayloads,
          rawBody: fetchedResults.rawBodies.join('\n'),
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

    options.logger?.info?.(
      `[ingestor] cycle sgo/${league} phase timings(ms): ${JSON.stringify(phaseTimings)}`,
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
        phaseTimings,
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
    if (error instanceof CircuitOpenError && options.quarantineRegistry) {
      const snap = selectCircuitOpenSnapshot(options.circuitBreakers);
      options.quarantineRegistry.quarantine('sgo', 'circuit_open', {
        failureCount: snap?.totalFailures ?? 0,
        league,
        openedAt: error.openedAt,
      });
    }
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
        // Phase timings up to the failure point — on a per-league timeout this shows
        // which phase was running when the cycle was aborted. (UTV2-1283)
        phaseTimings,
      },
    });
    throw error;
  }
}

function selectCircuitOpenSnapshot(
  circuitBreakers: IngestLeagueOptions['circuitBreakers'],
): CircuitBreakerSnapshot | undefined {
  const snapshots = [
    circuitBreakers?.odds?.snapshot(),
    circuitBreakers?.results?.snapshot(),
  ].filter((snapshot): snapshot is CircuitBreakerSnapshot => snapshot !== undefined);
  return (
    snapshots.find((snapshot) => snapshot.state === 'open') ??
    snapshots.find((snapshot) => snapshot.state === 'half-open') ??
    snapshots.sort((left, right) => right.totalFailures - left.totalFailures)[0]
  );
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
    rawBodies: [],
    requestTelemetry: createEmptyRequestTelemetry('odds'),
  };
}

/**
 * Merge the game-line and player-prop SGO fetch results (UTV2-1275 Wave 1).
 * Events are de-duplicated by providerEventId (event metadata is identical across
 * the two requests); paired props and raw payloads are concatenated; telemetry is
 * summed so quota accounting reflects both requests.
 */
function mergeSgoFetchResults(
  gameLine: SGOFetchResult,
  prop: SGOFetchResult,
): SGOFetchResult {
  const eventsById = new Map<string, SGOFetchResult['events'][number]>();
  for (const event of gameLine.events) {
    eventsById.set(event.providerEventId, event);
  }
  for (const event of prop.events) {
    if (!eventsById.has(event.providerEventId)) {
      eventsById.set(event.providerEventId, event);
    }
  }
  const events = [...eventsById.values()];
  return {
    eventsCount: events.length,
    events,
    pairedProps: [...gameLine.pairedProps, ...prop.pairedProps],
    rawPayloads: [...gameLine.rawPayloads, ...prop.rawPayloads],
    rawBodies: [...gameLine.rawBodies, ...prop.rawBodies],
    requestTelemetry: mergeOddsTelemetry(
      gameLine.requestTelemetry,
      prop.requestTelemetry,
    ),
  };
}

function mergeOddsTelemetry(
  a: SGORequestTelemetry,
  b: SGORequestTelemetry,
): SGORequestTelemetry {
  return {
    provider: 'sgo',
    endpoint: 'odds',
    requestCount: a.requestCount + b.requestCount,
    successfulRequests: a.successfulRequests + b.successfulRequests,
    creditsUsed: a.creditsUsed + b.creditsUsed,
    limit: b.limit ?? a.limit,
    remaining: b.remaining ?? a.remaining,
    resetAt: b.resetAt ?? a.resetAt,
    lastStatus: b.lastStatus ?? a.lastStatus,
    rateLimitHitCount: a.rateLimitHitCount + b.rateLimitHitCount,
    backoffCount: a.backoffCount + b.backoffCount,
    backoffMs: a.backoffMs + b.backoffMs,
    retryAfterMs: b.retryAfterMs ?? a.retryAfterMs,
    throttled: a.throttled || b.throttled,
    headersSeen: a.headersSeen || b.headersSeen,
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
