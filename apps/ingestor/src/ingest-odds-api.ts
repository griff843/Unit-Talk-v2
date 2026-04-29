/**
 * The Odds API Ingest Module
 *
 * Fetches odds from The Odds API (Pinnacle + multi-book consensus)
 * and stores as provider_offers records alongside SGO data.
 *
 * Issue: UTV2-197 (Sprint D)
 */

import type { ProviderOfferInsert } from '@unit-talk/contracts';
import type { EventParticipantRole, IngestorRepositoryBundle, ParticipantRow } from '@unit-talk/db';
import {
  fetchOddsApiOdds,
  type NormalizedOddsOffer,
  normalizeOddsApiToOffers,
  type OddsApiFetchOptions,
  type OddsApiTelemetry,
} from './odds-api-fetcher.js';
import {
  classifyProviderIngestionFailure,
  createPartialMarketFailure,
  createZeroOffersFailure,
} from './provider-ingestion-failures.js';
import { chunkByPolicy, withProviderDbRetry } from './provider-ingestion-db.js';
import type {
  ProviderIngestionDbWritePolicy,
  ProviderPayloadArchivePolicy,
} from './provider-ingestion-policy.js';
import { archiveRawProviderPayload, shouldBlockOnArchiveFailure } from './raw-provider-payload-archive.js';

function toEasternDate(utcIso: string): string {
  return new Date(utcIso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

const DEFAULT_ODDS_API_MARKETS = [
  'h2h',
  'spreads',
  'totals',
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
] as const;

export interface OddsApiIngestOptions {
  apiKey: string;
  league: string;
  repositories: IngestorRepositoryBundle;
  bookmakers?: string[];
  markets?: string[];
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'warn' | 'info'>;
  providerDbWritePolicy?: ProviderIngestionDbWritePolicy;
  providerPayloadArchivePolicy?: ProviderPayloadArchivePolicy;
}

export interface OddsApiIngestSummary {
  league: string;
  provider: 'odds-api';
  status: 'succeeded' | 'skipped' | 'failed';
  eventsCount: number;
  offersCount: number;
  insertedCount: number;
  skippedCount: number;
  telemetry: OddsApiTelemetry | null;
  error?: string;
}

/**
 * Ingest odds from The Odds API for a single league.
 * Fetches Pinnacle + configured bookmakers, normalizes, and upserts to provider_offers.
 */
export async function ingestOddsApiLeague(
  options: OddsApiIngestOptions,
): Promise<OddsApiIngestSummary> {
  const { apiKey, league, repositories, logger } = options;

  if (!apiKey) {
    return {
      league,
      provider: 'odds-api',
      status: 'skipped',
      eventsCount: 0,
      offersCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      telemetry: null,
    };
  }

  const snapshotAt = new Date().toISOString();
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
  const run = await repositories.runs.startRun({
    runType: 'ingestor.cycle',
    actor: 'ingestor',
    details: {
      provider: 'odds-api',
      league,
      snapshotAt,
    },
  });

  try {
    const fetchOptions: OddsApiFetchOptions = {
      apiKey,
      league,
      markets: options.markets ?? [...DEFAULT_ODDS_API_MARKETS],
      bookmakers: options.bookmakers ?? ['pinnacle', 'draftkings', 'fanduel', 'betmgm'],
      oddsFormat: 'american',
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    };

    const result = await fetchOddsApiOdds(fetchOptions);
    let archiveFailure: string | null = null;
    try {
      await archiveRawProviderPayload({
        providerKey: 'odds-api',
        league,
        runId: run.id,
        snapshotAt,
        kind: 'odds',
        payload: result.events,
        spoolDir: providerPayloadArchivePolicy.spoolDir,
      });
    } catch (error) {
      archiveFailure = error instanceof Error ? error.message : String(error);
      if (shouldBlockOnArchiveFailure(providerPayloadArchivePolicy.mode)) {
        throw new Error(`archive failure: ${archiveFailure}`);
      }
      logger?.warn?.(`[odds-api] archive fail-open for ${league}: ${archiveFailure}`);
    }
    await resolveOddsApiEvents(result.events, league, repositories, logger);
    const offers = normalizeOddsApiToOffers(result.events, snapshotAt);

    logger?.info?.(`[odds-api] ${league}: ${result.eventsCount} events, ${offers.length} offers from ${result.telemetry.bookmakerCount} bookmakers`);

    // Determine which (providerKey, eventId, marketKey, participantId) combinations
    // already exist in provider_offers so we can tag is_opening correctly.
    const providerEventIds = [...new Set(offers.map((o) => o.providerEventId))];
    const existingCombinations = await repositories.providerOffers.findExistingCombinations(
      providerEventIds,
    );

    // Batch upsert to provider_offers — deduplicate by idempotency key to avoid
    // "ON CONFLICT DO UPDATE cannot affect row a second time" errors when the
    // normalizer emits multiple offers with the same key in a single batch.
    const mapped = offers.map((offer) =>
      mapOddsApiOfferToProviderOfferInsert(offer, existingCombinations),
    );
    const seen = new Set<string>();
    const upsertInputs = mapped.filter((o) => {
      if (seen.has(o.idempotencyKey)) return false;
      seen.add(o.idempotencyKey);
      return true;
    });
    if (upsertInputs.length === 0) {
      const zeroOffersFailure = createZeroOffersFailure('odds-api', league);
      await repositories.providerOffers.upsertCycleStatus({
        runId: run.id,
        providerKey: 'odds-api',
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
          eventsCount: result.eventsCount,
          offersCount: offers.length,
        },
      });
    }

    const upsertResult = { insertedCount: 0, updatedCount: 0, totalProcessed: 0 };
    for (const chunk of chunkByPolicy(upsertInputs, providerDbWritePolicy.maxBatchSize)) {
      const chunkResult = await withProviderDbRetry(
        () => repositories.providerOffers.upsertBatch(chunk),
        providerDbWritePolicy,
        { providerKey: 'odds-api', sportKey: league },
      );
      upsertResult.insertedCount += chunkResult.insertedCount;
      upsertResult.updatedCount += chunkResult.updatedCount;
      upsertResult.totalProcessed += chunkResult.totalProcessed;
    }

    // Mark closing lines for any events that have already started
    const eventsForClosing = result.events.map((e) => ({
      providerEventId: e.id,
      commenceTime: e.commence_time,
    }));
    await repositories.providerOffers.markClosingLines(eventsForClosing, snapshotAt);
    const inserted = upsertResult.insertedCount;
    const skipped = upsertResult.totalProcessed - upsertResult.insertedCount - upsertResult.updatedCount;
    const partialFailure =
      offers.length !== upsertInputs.length
        ? createPartialMarketFailure(
            'odds-api',
            league,
            null,
            `Deduped ${offers.length - upsertInputs.length} duplicate normalized offer(s) before DB write`,
          )
        : null;

    await repositories.providerOffers.upsertCycleStatus({
      runId: run.id,
      providerKey: 'odds-api',
      league,
      cycleSnapshotAt: snapshotAt,
      stageStatus: upsertInputs.length === 0 ? 'failed' : 'merged',
      freshnessStatus: 'fresh',
      proofStatus: 'waived',
      stagedCount: upsertInputs.length,
      mergedCount: upsertResult.insertedCount + upsertResult.updatedCount,
      duplicateCount: 0,
      failureCategory:
        archiveFailure != null
          ? 'archive_failure'
          : partialFailure?.category ?? null,
      failureScope:
        archiveFailure != null
          ? 'archive'
          : partialFailure?.scope ?? null,
      affectedProviderKey: 'odds-api',
      affectedSportKey: league,
      lastError: archiveFailure ?? partialFailure?.message ?? null,
      metadata: {
        dbPolicy: providerDbWritePolicy,
        archivePolicy: providerPayloadArchivePolicy,
      },
    });

    await repositories.runs.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        provider: 'odds-api',
        league,
        snapshotAt,
        eventsCount: result.eventsCount,
        offersCount: offers.length,
        insertedCount: inserted,
        updatedCount: upsertResult.updatedCount,
        skippedCount: skipped,
        quota: {
          provider: 'odds-api',
          requestCount: result.telemetry.requestCount,
          successfulRequests: result.telemetry.requestCount,
          creditsUsed: result.telemetry.creditsUsed,
          limit: null,
          remaining: result.telemetry.creditsRemaining,
          resetAt: null,
          lastStatus: 200,
          rateLimitHitCount: 0,
          backoffCount: 0,
          backoffMs: 0,
          retryAfterMs: null,
          throttled: false,
          headersSeen: true,
        },
      },
    });

    return {
      league,
      provider: 'odds-api',
      status: 'succeeded',
      eventsCount: result.eventsCount,
      offersCount: offers.length,
      insertedCount: inserted,
      skippedCount: skipped,
      telemetry: result.telemetry,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = classifyProviderIngestionFailure(error, {
      providerKey: 'odds-api',
      sportKey: league,
    });
    await repositories.providerOffers.upsertCycleStatus({
      runId: run.id,
      providerKey: 'odds-api',
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
        dbPolicy: providerDbWritePolicy,
        archivePolicy: providerPayloadArchivePolicy,
      },
    });
    await repositories.runs.completeRun({
      runId: run.id,
      status: 'failed',
      details: {
        provider: 'odds-api',
        league,
        snapshotAt,
        error: message,
      },
    });
    logger?.warn?.(`[odds-api] ${league} ingest failed: ${message}`);
    return {
      league,
      provider: 'odds-api',
      status: 'failed',
      eventsCount: 0,
      offersCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      telemetry: null,
      error: message,
    };
  }
}

async function resolveOddsApiEvents(
  events: Awaited<ReturnType<typeof fetchOddsApiOdds>>['events'],
  league: string,
  repositories: IngestorRepositoryBundle,
  logger?: Pick<Console, 'warn' | 'info'>,
) {
  const sportId = normalizeOddsApiLeague(league);
  if (!sportId) {
    return;
  }

  const teams = await repositories.participants.listByType('team', sportId);
  const players = await repositories.participants.listByType('player', sportId);
  if (teams.length === 0) {
    logger?.warn?.(`[odds-api] ${league}: no canonical team participants available for event hydration`);
    return;
  }

  for (const event of events) {
    const home = findTeamParticipant(teams, event.home_team);
    const away = findTeamParticipant(teams, event.away_team);
    if (!home || !away) {
      logger?.warn?.(
        `[odds-api] ${league}: skipping event ${event.id} because canonical teams could not be matched (${event.away_team} @ ${event.home_team})`,
      );
      continue;
    }

    const resolvedEvent = await repositories.events.upsertByExternalId({
      externalId: event.id,
      sportId,
      eventName: `${event.away_team} @ ${event.home_team}`,
      eventDate: toEasternDate(event.commence_time),
      status: 'scheduled',
      metadata: {
        provider: 'odds-api',
        sport_key: event.sport_key,
        sport_title: event.sport_title,
        starts_at: event.commence_time,
        home_team_name: event.home_team,
        away_team_name: event.away_team,
      },
    });

    await linkOddsApiTeamParticipant(repositories, resolvedEvent.id, home.id, 'home');
    await linkOddsApiTeamParticipant(repositories, resolvedEvent.id, away.id, 'away');

    const playerNames = collectOddsApiPlayerParticipantNames(event);
    for (const playerName of playerNames) {
      const player = findParticipantByDisplayName(players, playerName);
      if (!player) {
        logger?.warn?.(
          `[odds-api] ${league}: skipping unmatched player participant "${playerName}" for event ${event.id}`,
        );
        continue;
      }

      await repositories.eventParticipants.upsert({
        eventId: resolvedEvent.id,
        participantId: player.id,
        role: 'competitor',
      });
    }
  }
}

async function linkOddsApiTeamParticipant(
  repositories: IngestorRepositoryBundle,
  eventId: string,
  participantId: string,
  role: Extract<EventParticipantRole, 'home' | 'away'>,
) {
  await repositories.eventParticipants.upsert({
    eventId,
    participantId,
    role,
  });
}

function normalizeOddsApiLeague(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function findTeamParticipant(teams: ParticipantRow[], displayName: string) {
  return findParticipantByDisplayName(teams, displayName);
}

function findParticipantByDisplayName(participants: ParticipantRow[], displayName: string) {
  return participants.find((row) => namesMatch(row.display_name, displayName)) ?? null;
}

function collectOddsApiPlayerParticipantNames(
  event: Awaited<ReturnType<typeof fetchOddsApiOdds>>['events'][number],
) {
  const playerNames = new Set<string>();

  for (const bookmaker of event.bookmakers) {
    for (const market of bookmaker.markets) {
      for (const outcome of market.outcomes) {
        const playerName = outcome.description?.trim();
        if (playerName) {
          playerNames.add(playerName);
        }
      }
    }
  }

  return [...playerNames];
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function namesMatch(left: string, right: string) {
  const normalizedLeft = normalizeName(left);
  const normalizedRight = normalizeName(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(normalizedRight) ||
    normalizedRight.endsWith(normalizedLeft)
  );
}

export function mapOddsApiOfferToProviderOfferInsert(
  offer: NormalizedOddsOffer,
  existingCombinations: Set<string> = new Set(),
): ProviderOfferInsert {
  const participantKey = offer.providerParticipantId ?? '';
  const combinationKey = `${offer.providerKey}:${offer.providerEventId}:${offer.providerMarketKey}:${participantKey}`;

  return {
    idempotencyKey: `${offer.providerKey}:${offer.providerEventId}:${offer.providerMarketKey}:${participantKey}:${offer.snapshotAt}`,
    devigMode: 'PAIRED',
    providerKey: offer.providerKey,
    providerEventId: offer.providerEventId,
    providerMarketKey: offer.providerMarketKey,
    providerParticipantId: offer.providerParticipantId,
    sportKey: offer.sport || null,
    line: offer.line,
    overOdds: offer.overOdds,
    underOdds: offer.underOdds,
    isOpening: !existingCombinations.has(combinationKey),
    isClosing: false, // set post-insert by markClosingLines for started events
    snapshotAt: offer.snapshotAt,
    bookmakerKey: null,
  };
}
