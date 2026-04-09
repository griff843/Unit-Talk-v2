/**
 * Market Universe Materializer
 *
 * Phase 2 — UTV2-461
 * Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md
 *
 * Reads provider_offers rows and upserts into market_universe using the
 * natural key conflict target:
 *   (provider_key, provider_event_id, COALESCE(provider_participant_id,''), provider_market_key)
 *
 * Hard boundaries (never violate):
 * - Writes ONLY to market_universe — no other table
 * - Does NOT create pick_candidates
 * - Does NOT create picks
 * - Does NOT call POST /api/submissions
 * - Does NOT call promotion, settlement, or distribution services
 * - system-pick-scanner is NOT modified or called
 * - model_score / model_tier / model_confidence are NOT set (Phase 3 only)
 * - shadow_mode is NOT set false in Phase 2
 */

import { americanToImplied, applyDevig } from '@unit-talk/domain';
import type { IMarketUniverseRepository, MarketUniverseUpsertInput } from '@unit-talk/db';
import type { ProviderOfferRepository } from '@unit-talk/db';

// Phase 2: staleness threshold is hardcoded at 2 hours (see contract §4)
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// How far back to look for provider_offers rows per run. Default: 24 hours.
// This is a safety net for batch size — all offers within the window are materialised.
const DEFAULT_LOOKBACK_HOURS = 24;

// Max rows to process per run as a safety cap
const DEFAULT_MAX_ROWS = 5_000;

export interface MaterializerResult {
  upserted: number;
  errors: number;
  durationMs: number;
}

export interface MaterializerOptions {
  lookbackHours?: number;
  maxRows?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export class MarketUniverseMaterializer {
  constructor(
    private readonly repos: {
      providerOffers: ProviderOfferRepository;
      marketUniverse: IMarketUniverseRepository;
    },
  ) {}

  async run(options: MaterializerOptions = {}): Promise<MaterializerResult> {
    const startMs = Date.now();
    const lookbackHours = options.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
    const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
    const logger = options.logger;

    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

    let offers;
    try {
      offers = await this.repos.providerOffers.listRecentOffers(since, maxRows);
    } catch (err) {
      logger?.error?.(
        JSON.stringify({
          service: 'market-universe-materializer',
          event: 'fetch_offers_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return { upserted: 0, errors: 1, durationMs: Date.now() - startMs };
    }

    if (offers.length === 0) {
      logger?.info?.(
        JSON.stringify({
          service: 'market-universe-materializer',
          event: 'run.completed',
          upserted: 0,
          errors: 0,
          note: 'no offers in window',
        }),
      );
      return { upserted: 0, errors: 0, durationMs: Date.now() - startMs };
    }

    // Group offers by natural key to find opening, closing, and current (latest) per group
    type NaturalKey = string;
    interface GroupedOffers {
      opening: (typeof offers)[0] | null;  // earliest is_opening=true by snapshot_at ASC
      closing: (typeof offers)[0] | null;  // earliest is_closing=true by snapshot_at ASC
      latest: (typeof offers)[0];          // most recent snapshot_at
    }

    const groups = new Map<NaturalKey, GroupedOffers>();

    for (const offer of offers) {
      const k = naturalKeyString(
        offer.provider_key,
        offer.provider_event_id,
        offer.provider_participant_id ?? null,
        offer.provider_market_key,
      );

      const existing = groups.get(k);
      if (!existing) {
        groups.set(k, {
          opening: offer.is_opening ? offer : null,
          closing: offer.is_closing ? offer : null,
          latest: offer,
        });
      } else {
        // Track opening: keep the earliest is_opening=true row
        if (offer.is_opening) {
          if (!existing.opening || offer.snapshot_at < existing.opening.snapshot_at) {
            existing.opening = offer;
          }
        }
        // Track closing: keep the earliest is_closing=true row
        if (offer.is_closing) {
          if (!existing.closing || offer.snapshot_at < existing.closing.snapshot_at) {
            existing.closing = offer;
          }
        }
        // Track latest: most recent snapshot_at
        if (offer.snapshot_at > existing.latest.snapshot_at) {
          existing.latest = offer;
        }
      }
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const upsertBatch: MarketUniverseUpsertInput[] = [];
    let errors = 0;

    for (const [, group] of groups) {
      try {
        const { opening, closing, latest } = group;

        // Compute fair probabilities from the latest snapshot's odds
        // Null on failure — not a hard error (contract §4)
        let fair_over_prob: number | null = null;
        let fair_under_prob: number | null = null;
        try {
          if (
            latest.over_odds !== null &&
            latest.under_odds !== null &&
            Number.isFinite(latest.over_odds) &&
            Number.isFinite(latest.under_odds)
          ) {
            const overImplied = americanToImplied(latest.over_odds);
            const underImplied = americanToImplied(latest.under_odds);
            const devigged = applyDevig(overImplied, underImplied, 'proportional');
            if (devigged) {
              fair_over_prob = devigged.overFair;
              fair_under_prob = devigged.underFair;
            }
          }
        } catch {
          // Intentionally swallowed — devig failure is not materializer failure
        }

        // is_stale: last_offer_snapshot_at < now - 2 hours
        const lastSnapshotMs = new Date(latest.snapshot_at).getTime();
        const is_stale = lastSnapshotMs < now - STALE_THRESHOLD_MS;

        const row: MarketUniverseUpsertInput = {
          // Natural key
          provider_key: latest.provider_key,
          provider_event_id: latest.provider_event_id,
          provider_participant_id: latest.provider_participant_id ?? null,
          provider_market_key: latest.provider_market_key,

          // Descriptive fields
          // sport_key comes from the offer; league_key defaults to sport_key
          // when not separately stored on provider_offers (it isn't in Phase 2)
          sport_key: latest.sport_key ?? 'unknown',
          league_key: latest.sport_key ?? 'unknown',
          event_id: null,       // Phase 2: event FK resolution deferred (no event lookup in materializer)
          participant_id: null, // Phase 2: participant FK resolution deferred
          market_type_id: null, // Phase 2: market type resolution deferred
          canonical_market_key: latest.provider_market_key, // Phase 2: use provider key as-is

          // Current line (from the most recent snapshot)
          current_line: latest.line ?? null,
          current_over_odds: latest.over_odds ?? null,
          current_under_odds: latest.under_odds ?? null,

          // Opening values (from earliest is_opening=true snapshot)
          opening_line: opening?.line ?? null,
          opening_over_odds: opening?.over_odds ?? null,
          opening_under_odds: opening?.under_odds ?? null,

          // Closing values (from earliest is_closing=true snapshot)
          closing_line: closing?.line ?? null,
          closing_over_odds: closing?.over_odds ?? null,
          closing_under_odds: closing?.under_odds ?? null,

          // Devigged fair probabilities
          fair_over_prob,
          fair_under_prob,

          // Staleness
          is_stale,

          // Snapshot time of the most recent provider_offers row
          last_offer_snapshot_at: latest.snapshot_at,
        };

        upsertBatch.push(row);
      } catch (err) {
        errors++;
        logger?.error?.(
          JSON.stringify({
            service: 'market-universe-materializer',
            event: 'row_build_error',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    if (upsertBatch.length > 0) {
      try {
        await this.repos.marketUniverse.upsertMarketUniverse(upsertBatch);
      } catch (err) {
        logger?.error?.(
          JSON.stringify({
            service: 'market-universe-materializer',
            event: 'upsert_failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return {
          upserted: 0,
          errors: errors + 1,
          durationMs: Date.now() - startMs,
        };
      }
    }

    const durationMs = Date.now() - startMs;

    logger?.info?.(
      JSON.stringify({
        service: 'market-universe-materializer',
        event: 'run.completed',
        offersRead: offers.length,
        uniqueMarkets: groups.size,
        upserted: upsertBatch.length,
        errors,
        durationMs,
        runAt: nowIso,
      }),
    );

    return {
      upserted: upsertBatch.length,
      errors,
      durationMs,
    };
  }
}

/**
 * Convenience wrapper for use in index.ts scheduled job.
 */
export async function runMarketUniverseMaterializer(
  repos: {
    providerOffers: ProviderOfferRepository;
    marketUniverse: IMarketUniverseRepository;
  },
  options: MaterializerOptions = {},
): Promise<MaterializerResult> {
  return new MarketUniverseMaterializer(repos).run(options);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function naturalKeyString(
  providerKey: string,
  providerEventId: string,
  providerParticipantId: string | null,
  providerMarketKey: string,
): string {
  return [providerKey, providerEventId, providerParticipantId ?? '', providerMarketKey].join(':');
}
