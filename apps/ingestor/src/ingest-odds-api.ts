/**
 * The Odds API Ingest Module
 *
 * Fetches odds from The Odds API (Pinnacle + multi-book consensus)
 * and stores as provider_offers records alongside SGO data.
 *
 * Issue: UTV2-197 (Sprint D)
 */

import type { IngestorRepositoryBundle } from '@unit-talk/db';
import {
  fetchOddsApiOdds,
  normalizeOddsApiToOffers,
  type OddsApiFetchOptions,
  type OddsApiTelemetry,
} from './odds-api-fetcher.js';

export interface OddsApiIngestOptions {
  apiKey: string;
  league: string;
  repositories: IngestorRepositoryBundle;
  bookmakers?: string[];
  markets?: string[];
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'warn' | 'info'>;
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

  try {
    const fetchOptions: OddsApiFetchOptions = {
      apiKey,
      league,
      markets: options.markets ?? ['h2h', 'spreads', 'totals'],
      bookmakers: options.bookmakers ?? ['pinnacle', 'draftkings', 'fanduel', 'betmgm'],
      oddsFormat: 'american',
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    };

    const result = await fetchOddsApiOdds(fetchOptions);
    const snapshotAt = new Date().toISOString();
    const offers = normalizeOddsApiToOffers(result.events, snapshotAt);

    logger?.info?.(`[odds-api] ${league}: ${result.eventsCount} events, ${offers.length} offers from ${result.telemetry.bookmakerCount} bookmakers`);

    // Batch upsert to provider_offers
    const upsertInputs = offers.map((offer) => ({
      idempotency_key: `${offer.providerKey}:${offer.providerEventId}:${offer.providerMarketKey}:${offer.snapshotAt}`,
      devig_mode: 'proportional' as const,
      provider_key: offer.providerKey,
      provider_event_id: offer.providerEventId,
      provider_market_key: offer.providerMarketKey,
      ...(offer.providerParticipantId != null ? { provider_participant_id: offer.providerParticipantId } : {}),
      snapshot_at: offer.snapshotAt,
      ...(offer.line != null ? { line: offer.line } : {}),
      ...(offer.overOdds != null ? { over_odds: offer.overOdds } : {}),
      ...(offer.underOdds != null ? { under_odds: offer.underOdds } : {}),
      ...(offer.sport ? { sport_key: offer.sport } : {}),
    }));

    const upsertResult = await repositories.providerOffers.upsertBatch(upsertInputs as unknown as Parameters<typeof repositories.providerOffers.upsertBatch>[0]);
    const inserted = upsertResult.insertedCount;
    const skipped = upsertResult.totalProcessed - upsertResult.insertedCount - upsertResult.updatedCount;

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
