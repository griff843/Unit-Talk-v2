/**
 * Candidate Builder Service — UTV2-758
 *
 * Reads opening provider_offers rows and materializes corresponding
 * qualified pick_candidates rows (idempotent by market-universe ID).
 *
 * Hard boundary invariants:
 * - Writes ONLY to pick_candidates.
 * - Sets status = 'qualified' on write.
 * - Never touches picks/submissions/settlement tables.
 * - Uses upsert semantics to avoid duplicates.
 */

import crypto from 'node:crypto';
import type {
  IPickCandidateRepository,
  IMarketUniverseRepository,
  PickCandidateUpsertInput,
  ProviderOfferRecord,
  ProviderOfferRepository,
  MarketUniverseRow,
} from '@unit-talk/db';

export interface CandidateBuilderOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  /** How far back to look for opening offers. Default: 24 hours. */
  lookbackHours?: number;
  /** Provider filter. Default: sgo. */
  provider?: string;
  /** Max offers returned from listOpeningOffers. Default: 500. */
  limit?: number;
  /** Scan universe rows to load for candidate lookup. */
  universeScanLimit?: number;
  /** Optional clock for deterministic tests. */
  now?: () => number;
}

export interface CandidateBuilderResult {
  scanned: number;
  createdOrUpdated: number;
  skipped: number;
  duplicatesSkipped: number;
  errors: number;
}

interface CandidateBuilderDependencies {
  providerOffers: ProviderOfferRepository;
  marketUniverse: IMarketUniverseRepository;
  pickCandidates: IPickCandidateRepository;
}

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_LIMIT = 500;
const DEFAULT_UNIVERSE_SCAN_LIMIT = 10_000;
const DEFAULT_PROVIDER = 'sgo';
const RUN_VERSION = '1.0.0';

export class CandidateBuilderService {
  constructor(
    private readonly repos: CandidateBuilderDependencies,
    private readonly options: CandidateBuilderOptions = {},
  ) {}

  async build(): Promise<CandidateBuilderResult> {
    const now = this.options.now ?? Date.now;
    const lookbackHours = this.options.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
    const provider = this.options.provider ?? DEFAULT_PROVIDER;
    const limit = this.options.limit ?? DEFAULT_LIMIT;
    const universeScanLimit = this.options.universeScanLimit ?? DEFAULT_UNIVERSE_SCAN_LIMIT;
    const logger = this.options.logger;

    const since = new Date(now() - lookbackHours * 60 * 60 * 1_000).toISOString();

    let openingOffers: ProviderOfferRecord[];
    try {
      openingOffers = await this.repos.providerOffers.listOpeningOffers(since, provider, limit);
    } catch (err) {
      logger?.error?.(
        JSON.stringify({
          service: 'candidate-builder',
          event: 'openings_load_failed',
          provider,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return { scanned: 0, createdOrUpdated: 0, skipped: 0, duplicatesSkipped: 0, errors: 1 };
    }

    if (openingOffers.length === 0) {
      logger?.info?.(
        JSON.stringify({
          service: 'candidate-builder',
          event: 'run.completed',
          provider,
          scanned: 0,
          createdOrUpdated: 0,
          skipped: 0,
          duplicatesSkipped: 0,
          errors: 0,
        }),
      );
      return { scanned: 0, createdOrUpdated: 0, skipped: 0, duplicatesSkipped: 0, errors: 0 };
    }

    // Build an in-memory map of market_universe rows to resolve universe_id.
    const universeRows = await this.repos.marketUniverse.listForScan(universeScanLimit);
    const universeMap = createUniverseLookupMap(universeRows);

    const filter_details = {
      missing_canonical_identity: false,
      stale_price_data: false,
      unsupported_market_family: false,
      missing_participant_linkage: false,
      invalid_odds_structure: false,
      duplicate_suppressed: false,
      freshness_window_failed: false,
    };

    const scanRunId = crypto.randomUUID();
    const provenance = {
      scanVersion: RUN_VERSION,
      source: 'candidate-builder',
      provider,
      builtAt: new Date().toISOString(),
    };

    const seenOfferKeys = new Set<string>();
    const candidates: PickCandidateUpsertInput[] = [];
    let skipped = 0;
    let duplicatesSkipped = 0;
    const errors = 0;

    for (const offer of openingOffers) {
      const key = [
        offer.provider_event_id,
        offer.provider_market_key,
        offer.bookmaker_key ?? '',
        offer.provider_participant_id ?? '',
      ].join(':');

      if (seenOfferKeys.has(key)) {
        duplicatesSkipped += 1;
        continue;
      }
      seenOfferKeys.add(key);

      const universe = resolveUniverseByOffer(universeRows, universeMap, offer);
      if (!universe) {
        skipped += 1;
        continue;
      }

      candidates.push({
        universe_id: universe.id,
        status: 'qualified',
        rejection_reason: null,
        filter_details,
        scan_run_id: scanRunId,
        provenance,
        expires_at: null,
      });
    }

    if (candidates.length === 0) {
      logger?.info?.(
        JSON.stringify({
          service: 'candidate-builder',
          event: 'run.completed',
          provider,
          scanned: openingOffers.length,
          createdOrUpdated: 0,
          skipped,
          duplicatesSkipped,
          errors,
        }),
      );
      return {
        scanned: openingOffers.length,
        createdOrUpdated: 0,
        skipped,
        duplicatesSkipped,
        errors,
      };
    }

    try {
      await this.repos.pickCandidates.upsertCandidates(candidates);
    } catch (err) {
      logger?.error?.(
        JSON.stringify({
          service: 'candidate-builder',
          event: 'upsert_failed',
          provider,
          scanned: openingOffers.length,
          candidateCount: candidates.length,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return {
        scanned: openingOffers.length,
        createdOrUpdated: 0,
        skipped,
        duplicatesSkipped,
        errors: errors + 1,
      };
    }

    logger?.info?.(
      JSON.stringify({
        service: 'candidate-builder',
        event: 'run.completed',
        provider,
        scanned: openingOffers.length,
        createdOrUpdated: candidates.length,
        skipped,
        duplicatesSkipped,
        errors,
      }),
    );

    return {
      scanned: openingOffers.length,
      createdOrUpdated: candidates.length,
      skipped,
      duplicatesSkipped,
      errors,
    };
  }
}

function resolveUniverseByOffer(
  universeRows: MarketUniverseRow[],
  universeMap: Map<string, string>,
  offer: ProviderOfferRecord,
): MarketUniverseRow | null {
  const participantKey = offer.provider_participant_id ?? '';
  const directKey = `${offer.provider_key}:${offer.provider_event_id}:${participantKey}:${offer.provider_market_key}`;
  const universeId = universeMap.get(directKey);
  if (universeId) {
    return universeRows.find((row) => row.id === universeId) ?? null;
  }

  // Fallback: direct scan for providers storing null participant IDs differently.
  const fallback = universeRows.find((row) =>
    row.provider_key === offer.provider_key &&
    row.provider_event_id === offer.provider_event_id &&
    row.provider_market_key === offer.provider_market_key &&
    (row.provider_participant_id ?? '') === participantKey,
  );
  return fallback ?? null;
}

function createUniverseLookupMap(rows: MarketUniverseRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = [
      row.provider_key,
      row.provider_event_id,
      row.provider_participant_id ?? '',
      row.provider_market_key,
    ].join(':');
    map.set(key, row.id);
  }
  return map;
}

