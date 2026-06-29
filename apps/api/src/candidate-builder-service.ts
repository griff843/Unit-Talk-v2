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
  AuditLogRepository,
} from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Candidate quality gates — UTV2-1364
// These gates fire before any candidate enters the pick pipeline.
// ---------------------------------------------------------------------------

/** Milliseconds in one hour — stale data threshold for Gate 3. */
export const CANDIDATE_STALE_THRESHOLD_MS = 3_600_000;

/** Absolute odds threshold for extreme juice rejection (Gate 1). */
export const EXTREME_JUICE_THRESHOLD = 500;

export interface BuilderQualityGateInput {
  overOdds: number | null | undefined;
  underOdds: number | null | undefined;
  snapshotAt: string | null | undefined;
}

export interface BuilderQualityGateResult {
  rejected: boolean;
  reason?: 'extreme_juice' | 'stale_odds_data';
}

/**
 * Pure function: evaluates candidate quality gates for the builder stage.
 * Gate 1 — Extreme juice: |odds| > 500 on either side.
 * Gate 3 — Stale data: snapshot is older than 1 hour.
 *
 * @param input  Offer data needed to evaluate the gates.
 * @param nowMs  Current time in milliseconds (injectable for tests).
 */
export function evaluateBuilderQualityGates(
  input: BuilderQualityGateInput,
  nowMs: number,
): BuilderQualityGateResult {
  // Gate 1: Extreme juice
  const overOdds = input.overOdds;
  const underOdds = input.underOdds;
  if (
    (overOdds !== null && overOdds !== undefined && Math.abs(overOdds) > EXTREME_JUICE_THRESHOLD) ||
    (underOdds !== null && underOdds !== undefined && Math.abs(underOdds) > EXTREME_JUICE_THRESHOLD)
  ) {
    return { rejected: true, reason: 'extreme_juice' };
  }

  // Gate 3: Stale data — snapshot older than 1 hour
  if (input.snapshotAt !== null && input.snapshotAt !== undefined) {
    const snapshotMs = Date.parse(input.snapshotAt);
    if (Number.isFinite(snapshotMs) && nowMs - snapshotMs > CANDIDATE_STALE_THRESHOLD_MS) {
      return { rejected: true, reason: 'stale_odds_data' };
    }
  }

  return { rejected: false };
}

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
  /** Count of candidates rejected by quality gates (extreme juice, stale data). */
  gateRejected: number;
}

interface CandidateBuilderDependencies {
  providerOffers: ProviderOfferRepository;
  marketUniverse: IMarketUniverseRepository;
  pickCandidates: IPickCandidateRepository;
  /** Optional audit log — receives candidate.rejected events for quality gate rejections. */
  audit?: AuditLogRepository;
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
      return { scanned: 0, createdOrUpdated: 0, skipped: 0, duplicatesSkipped: 0, errors: 1, gateRejected: 0 };
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
          gateRejected: 0,
        }),
      );
      return { scanned: 0, createdOrUpdated: 0, skipped: 0, duplicatesSkipped: 0, errors: 0, gateRejected: 0 };
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
    let gateRejected = 0;
    const errors = 0;
    const nowMs = now();

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

      // UTV2-1364: Quality gates — evaluate before candidate creation.
      const gateResult = evaluateBuilderQualityGates(
        {
          overOdds: offer.over_odds,
          underOdds: offer.under_odds,
          snapshotAt: offer.snapshot_at,
        },
        nowMs,
      );
      if (gateResult.rejected) {
        gateRejected += 1;
        logger?.warn?.(
          JSON.stringify({
            service: 'candidate-builder',
            event: 'candidate.gate_rejected',
            reason: gateResult.reason,
            providerEventId: offer.provider_event_id,
            providerMarketKey: offer.provider_market_key,
          }),
        );
        // Log to audit_log for traceability.
        await this.repos.audit?.record({
          entityType: 'pick_candidates',
          entityId: null,
          entityRef: null,
          action: 'candidate.rejected',
          actor: 'system:candidate-builder',
          payload: {
            reason: gateResult.reason,
            providerEventId: offer.provider_event_id,
            providerMarketKey: offer.provider_market_key,
            providerKey: offer.provider_key,
            overOdds: offer.over_odds,
            underOdds: offer.under_odds,
            snapshotAt: offer.snapshot_at,
          },
        });
        continue;
      }

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
          gateRejected,
        }),
      );
      return {
        scanned: openingOffers.length,
        createdOrUpdated: 0,
        skipped,
        duplicatesSkipped,
        errors,
        gateRejected,
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
        gateRejected,
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
        gateRejected,
      }),
    );

    return {
      scanned: openingOffers.length,
      createdOrUpdated: candidates.length,
      skipped,
      duplicatesSkipped,
      errors,
      gateRejected,
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

