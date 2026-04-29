/**
 * System Pick Scanner — Governed Upstream Path (Phase 7B)
 *
 * Polls provider_offers for recent is_opening=true player prop rows and
 * materializes them into market_universe via the governed upstream path.
 *
 * Prior to UTV2-495, this scanner POSTed directly to /api/submissions to
 * create picks with source='system-pick-scanner'. That direct-submission
 * path is retired. The scanner now writes to market_universe, and the
 * governed downstream pipeline (board scan → candidates → scoring →
 * selection → construction → pick writer) handles pick creation.
 *
 * Gate: SYSTEM_PICK_SCANNER_ENABLED=true (default: off)
 * Interval: wired in index.ts (default 5 minutes)
 */

import { americanToImplied, applyDevig } from '@unit-talk/domain';
import type { AppEnv } from '@unit-talk/config';
import type {
  EventRepository,
  IMarketUniverseRepository,
  MarketUniverseUpsertInput,
  ParticipantRepository,
  ProviderOfferRepository,
} from '@unit-talk/db';

export interface SystemPickScanOptions {
  enabled: boolean;
  /** How far back to look for current opening lines. Default: 1 hour. */
  lookbackHours?: number;
  /** Max offers to process per run. Default: 100. */
  maxOffersPerRun?: number;
  /** Shrinks fair probabilities toward 0.5 for degraded provider health. */
  degradedConfidenceFactor?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface SystemPickScanResult {
  scanned: number;
  materialized: number;
  skipped: number;
  errors: number;
}

export function loadSystemPickScannerConfig(env: Pick<
  AppEnv,
  | 'SYSTEM_PICK_SCANNER_ENABLED'
  | 'SYSTEM_PICK_SCANNER_LOOKBACK_HOURS'
  | 'SYSTEM_PICK_SCANNER_MAX_PICKS'
  | 'SYSTEM_PICK_SCANNER_DEGRADED_CONFIDENCE_FACTOR'
>): Pick<SystemPickScanOptions, 'enabled' | 'lookbackHours' | 'maxOffersPerRun' | 'degradedConfidenceFactor'> {
  return {
    enabled: env.SYSTEM_PICK_SCANNER_ENABLED === 'true',
    lookbackHours: parsePositiveInt(env.SYSTEM_PICK_SCANNER_LOOKBACK_HOURS, 1),
    maxOffersPerRun: parsePositiveInt(env.SYSTEM_PICK_SCANNER_MAX_PICKS, 100),
    degradedConfidenceFactor: parseRatio(env.SYSTEM_PICK_SCANNER_DEGRADED_CONFIDENCE_FACTOR, 0.85),
  };
}

export async function runSystemPickScan(
  repositories: {
    providerOffers: ProviderOfferRepository;
    participants: ParticipantRepository;
    events: EventRepository;
    marketUniverse: IMarketUniverseRepository;
  },
  options: SystemPickScanOptions,
): Promise<SystemPickScanResult> {
  if (!options.enabled) {
    return { scanned: 0, materialized: 0, skipped: 0, errors: 0 };
  }

  const lookbackHours = options.lookbackHours ?? 24;
  const maxOffersPerRun = options.maxOffersPerRun ?? 100;

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const degradedConfidenceFactor = options.degradedConfidenceFactor ?? 0.85;
  const offers = await repositories.providerOffers.listOpeningCurrentOffers(
    since,
    'sgo',
    maxOffersPerRun,
  );

  if (offers.length === 0) {
    options.logger?.info?.(
      JSON.stringify({
        service: 'system-pick-scanner',
        event: 'scan.completed',
        scanned: 0,
        materialized: 0,
        skipped: 0,
        errors: 0,
        note: 'no opening offers in window',
      }),
    );
    return { scanned: 0, materialized: 0, skipped: 0, errors: 0 };
  }

  // Load alias lookup for canonical market key resolution
  const aliasMap = new Map<string, string>();
  try {
    const aliasRows = await repositories.providerOffers.listAliasLookup('sgo');
    for (const row of aliasRows) {
      aliasMap.set(`${row.provider_market_key}:${row.sport_id ?? ''}`, row.market_type_id);
    }
  } catch {
    // Non-fatal — continue without alias resolution
  }

  // Load participant alias lookup for FK resolution
  const participantMap = new Map<string, string>();
  try {
    const participantAliasRows = await repositories.providerOffers.listParticipantAliasLookup('sgo');
    for (const row of participantAliasRows) {
      if (row.provider_entity_id && row.participant_id) {
        participantMap.set(row.provider_entity_id, row.participant_id);
      }
    }
  } catch {
    // Non-fatal
  }

  const upsertBatchByKey = new Map<string, MarketUniverseUpsertInput>();
  let skipped = 0;
  let errors = 0;

  for (const offer of offers) {
    try {
      if (offer.provider_health_state === 'fail') {
        skipped++;
        continue;
      }

      // Resolve canonical market key
      const canonicalMarketKey = await repositories.providerOffers.resolveCanonicalMarketKey(
        offer.provider_market_key,
        offer.provider_key,
      );
      if (!canonicalMarketKey) {
        skipped++;
        continue;
      }

      // Compute devigged fair probability
      const overImplied = americanToImplied(offer.over_odds as number);
      const underImplied = americanToImplied(offer.under_odds as number);
      const devigged = applyDevig(overImplied, underImplied, 'proportional');
      const adjustedFair = offer.provider_health_state === 'degraded'
        ? applyConfidenceDrop(devigged, degradedConfidenceFactor)
        : devigged;

      // Resolve participant FK
      const participantId = offer.provider_participant_id
        ? participantMap.get(offer.provider_participant_id) ?? null
        : null;

      // Resolve market_type_id from alias map
      const sportKey = offer.sport_key ?? '';
      const marketTypeId =
        aliasMap.get(`${offer.provider_market_key}:${sportKey}`) ??
        aliasMap.get(`${offer.provider_market_key}:`) ??
        null;

      const row: MarketUniverseUpsertInput = {
        provider_key: offer.provider_key,
        provider_event_id: offer.provider_event_id,
        provider_participant_id: offer.provider_participant_id ?? null,
        provider_market_key: offer.provider_market_key,
        sport_key: offer.sport_key ?? 'unknown',
        league_key: offer.sport_key ?? 'unknown',
        event_id: null,
        participant_id: participantId,
        market_type_id: marketTypeId,
        canonical_market_key: canonicalMarketKey,
        current_line: offer.line ?? null,
        current_over_odds: offer.over_odds ?? null,
        current_under_odds: offer.under_odds ?? null,
        opening_line: offer.is_opening ? (offer.line ?? null) : null,
        opening_over_odds: offer.is_opening ? (offer.over_odds ?? null) : null,
        opening_under_odds: offer.is_opening ? (offer.under_odds ?? null) : null,
        closing_line: null,
        closing_over_odds: null,
        closing_under_odds: null,
        fair_over_prob: adjustedFair?.overFair ?? null,
        fair_under_prob: adjustedFair?.underFair ?? null,
        is_stale: false,
        last_offer_snapshot_at: offer.snapshot_at,
      };

      upsertBatchByKey.set(buildMarketUniverseKey(row), row);
    } catch (err) {
      errors++;
      options.logger?.error?.(
        JSON.stringify({
          service: 'system-pick-scanner',
          event: 'offer_processing_error',
          offerId: offer.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  const upsertBatch = Array.from(upsertBatchByKey.values());
  if (upsertBatch.length > 0) {
    try {
      await repositories.marketUniverse.upsertMarketUniverse(upsertBatch);
    } catch (err) {
      errors++;
      options.logger?.error?.(
        JSON.stringify({
          service: 'system-pick-scanner',
          event: 'market_universe_upsert_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return { scanned: offers.length, materialized: 0, skipped, errors };
    }
  }

  options.logger?.info?.(
    JSON.stringify({
      service: 'system-pick-scanner',
      event: 'scan.completed',
      scanned: offers.length,
      materialized: upsertBatch.length,
      skipped,
      errors,
    }),
  );

  return { scanned: offers.length, materialized: upsertBatch.length, skipped, errors };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatio(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function applyConfidenceDrop(
  fair:
    | {
        overFair: number;
        underFair: number;
      }
    | null,
  factor: number,
) {
  if (!fair) {
    return null;
  }

  return {
    overFair: 0.5 + (fair.overFair - 0.5) * factor,
    underFair: 0.5 + (fair.underFair - 0.5) * factor,
  };
}

function buildMarketUniverseKey(row: Pick<
  MarketUniverseUpsertInput,
  'provider_key' | 'provider_event_id' | 'provider_market_key' | 'provider_participant_id'
>) {
  return [
    row.provider_key,
    row.provider_event_id,
    row.provider_market_key,
    row.provider_participant_id ?? '',
  ].join(':');
}
