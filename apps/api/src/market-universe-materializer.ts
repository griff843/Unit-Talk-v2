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
import type {
  EventRepository,
  IMarketUniverseRepository,
  MarketUniverseUpsertInput,
  ProviderOfferRepository,
} from '@unit-talk/db';

// Phase 2: staleness threshold is hardcoded at 2 hours (see contract §4)
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// How far back to look for provider_offers rows per run.
// 72h ensures closing-line offers (marked after game start) are picked up even when
// there is a multi-day gap between the ingest cycle and the materializer run.
const DEFAULT_LOOKBACK_HOURS = 72;

// Max rows to process per run as a safety cap
const DEFAULT_MAX_ROWS = 5_000;
const PARTICIPANT_FORBIDDEN_MARKET_TYPE_IDS = new Set([
  'game_total_ou',
  '1h_total_ou',
  '2h_total_ou',
]);

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
      events: EventRepository;
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

    // Fetch closing offers separately — they carry pre-commence timestamps so they
    // sort behind live offers and get cut by the listRecentOffers row cap. Merge by
    // id to deduplicate rows that appear in both result sets.
    let closingOffers: typeof offers = [];
    try {
      closingOffers = await this.repos.providerOffers.listClosingOffers(since);
    } catch (err) {
      logger?.error?.(
        JSON.stringify({
          service: 'market-universe-materializer',
          event: 'fetch_closing_offers_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      // Fail loudly — CLV settlement must not proceed with silently missing closing data.
      throw err;
    }

    const offerById = new Map<string, (typeof offers)[0]>();
    for (const o of offers) offerById.set(o.id, o);
    for (const o of closingOffers) offerById.set(o.id, o);
    const allOffers = Array.from(offerById.values());

    if (allOffers.length === 0) {
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

    const eventIdByProviderEventId = await resolveEventIdsByProviderEventId(
      this.repos.events,
      allOffers.map((offer) => offer.provider_event_id),
      logger,
    );

    // Load alias lookup once per run for O(1) per-market resolution
    // Key structure: `${provider_market_key}:${sport_id ?? ''}` (sport-aware)
    // Fallback key: `${provider_market_key}:` (sport-agnostic)
    type AliasEntry = { market_type_id: string };
    const aliasMap = new Map<string, AliasEntry>();
    try {
      const aliasRows = await this.repos.providerOffers.listAliasLookup(offers[0]?.provider_key ?? 'sgo');
      for (const row of aliasRows) {
        // Sport-specific key takes precedence; sport-agnostic key is the fallback
        aliasMap.set(`${row.provider_market_key}:${row.sport_id ?? ''}`, { market_type_id: row.market_type_id });
      }
    } catch {
      // Alias load failure is non-fatal — materializer continues without resolution
    }

    // Load participant alias lookup once per run for O(1) per-row participant FK resolution
    // Key: provider_entity_id (matches provider_offers.provider_participant_id)
    // Value: participant_id (UUID FK into participants table)
    const participantMap = new Map<string, string>();
    try {
      const participantAliasRows = await this.repos.providerOffers.listParticipantAliasLookup(
        offers[0]?.provider_key ?? 'sgo',
      );
      for (const row of participantAliasRows) {
        if (row.provider_entity_id && row.participant_id) {
          participantMap.set(row.provider_entity_id, row.participant_id);
        }
      }
    } catch {
      // Participant alias load failure is non-fatal — materializer continues without resolution
    }

    // Group offers by natural key to find opening, closing, and current (latest) per group
    type NaturalKey = string;
    interface GroupedOffers {
      opening: (typeof offers)[0] | null;  // earliest is_opening=true by snapshot_at ASC
      closing: (typeof offers)[0] | null;  // earliest is_closing=true by snapshot_at ASC
      latest: (typeof offers)[0];          // most recent snapshot_at
    }

    const groups = new Map<NaturalKey, GroupedOffers>();

    for (const offer of allOffers) {
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

        // Alias resolution: try sport-specific key first, then sport-agnostic fallback
        const sportKey = latest.sport_key ?? '';
        const aliasCandidate =
          aliasMap.get(`${latest.provider_market_key}:${sportKey}`) ??
          aliasMap.get(`${latest.provider_market_key}:`);
        const alias = isParticipantForbiddenAlias(
          latest.provider_participant_id ?? null,
          aliasCandidate?.market_type_id ?? null,
        )
          ? undefined
          : aliasCandidate;

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
          event_id: eventIdByProviderEventId.get(latest.provider_event_id) ?? null,
          participant_id: participantMap.get(latest.provider_participant_id ?? '') ?? null,
          market_type_id: alias?.market_type_id ?? null,
          canonical_market_key: alias?.market_type_id ?? latest.provider_market_key,

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
        recentOffersRead: offers.length,
        closingOffersRead: closingOffers.length,
        totalOffersProcessed: allOffers.length,
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
    events: EventRepository;
  },
  options: MaterializerOptions = {},
): Promise<MaterializerResult> {
  return new MarketUniverseMaterializer(repos).run(options);
}

async function resolveEventIdsByProviderEventId(
  events: EventRepository,
  providerEventIds: string[],
  logger?: Pick<Console, 'warn'>,
): Promise<Map<string, string | null>> {
  const eventIdByProviderEventId = new Map<string, string | null>();
  const uniqueProviderEventIds = Array.from(new Set(providerEventIds));

  await Promise.all(
    uniqueProviderEventIds.map(async (providerEventId) => {
      try {
        const event = await events.findByExternalId(providerEventId);
        eventIdByProviderEventId.set(providerEventId, event?.id ?? null);
      } catch (err) {
        eventIdByProviderEventId.set(providerEventId, null);
        logger?.warn?.(
          JSON.stringify({
            service: 'market-universe-materializer',
            event: 'event_lookup_failed',
            providerEventId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }),
  );

  return eventIdByProviderEventId;
}

function isParticipantForbiddenAlias(
  providerParticipantId: string | null,
  marketTypeId: string | null,
) {
  return Boolean(
    providerParticipantId &&
      marketTypeId &&
      PARTICIPANT_FORBIDDEN_MARKET_TYPE_IDS.has(marketTypeId),
  );
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
