/**
 * Board Scan Service
 *
 * Phase 2 — UTV2-463
 * Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md §5.2, 5.3, 5.5
 *
 * Reads market_universe rows and writes pick_candidates rows.
 *
 * Hard Phase 2 boundaries (NEVER violate):
 * - Writes ONLY to pick_candidates — no other table
 * - Does NOT create picks
 * - Does NOT call POST /api/submissions
 * - Does NOT call promotion, settlement, or distribution services
 * - pick_id MUST remain NULL on every candidate row written
 * - shadow_mode MUST remain DEFAULT true — never set to false
 * - model_score / model_tier / model_confidence MUST remain NULL
 * - system-pick-scanner is NOT modified or called
 *
 * Feature gate:
 *   SYNDICATE_MACHINE_ENABLED=true  → board scan runs
 *   SYNDICATE_MACHINE_ENABLED=false (default) → immediate no-op return
 */

import crypto from 'node:crypto';
import type { IMarketUniverseRepository, IPickCandidateRepository, PickCandidateUpsertInput, MarketUniverseRow, PickCandidateFilterDetails, EventRepository } from '@unit-talk/db';
import { evaluateProviderDataFreshness } from '@unit-talk/domain';

// ---------------------------------------------------------------------------
// Staleness threshold constants (UTV2-775)
// All threshold constants must live here — not scattered.
// ---------------------------------------------------------------------------

export const STALENESS_THRESHOLDS = {
  tiers: {
    pre: 6 * 60 * 60 * 1000,
    standard: 2 * 60 * 60 * 1000,
    game_day: 60 * 60 * 1000,
    pre_start: 20 * 60 * 1000,
  },
  sportModifiers: { nfl: 2.0, tennis: 0.75 },
  marketModifiers: { player_props: 1.5 },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoardScanResult {
  scanned: number;
  qualified: number;
  rejected: number;
  durationMs: number;
  scanRunId: string;
}

export interface BoardScanOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  /** Override the feature gate for testing. Defaults to env var SYNDICATE_MACHINE_ENABLED. */
  enabled?: boolean;
  /** Max rows to scan per run (safety cap). Default: 5000. */
  maxRows?: number;
}

// ---------------------------------------------------------------------------
// Feature gate helper
// ---------------------------------------------------------------------------

function isSyndicateMachineEnabled(override?: boolean): boolean {
  if (override !== undefined) return override;
  return process.env['SYNDICATE_MACHINE_ENABLED'] === 'true';
}

// ---------------------------------------------------------------------------
// Coarse filter logic (contract §5.5)
//
// Each filter returns true when the filter FIRES (i.e. the row fails that check).
// A row passes if all filters return false.
// ---------------------------------------------------------------------------

/**
 * Applies the 7 canonical coarse filters to a market_universe row.
 * Returns the filter_details object (all 7 booleans) and the first failing
 * filter key (for rejection_reason), or null if the row passes all filters.
 *
 * eventStartsAt: optional, resolved from event FK at scan time. When null,
 * Filter 7 (freshness_window_failed) cannot fire (proximity unknown).
 */
function applyCoarseFilters(row: MarketUniverseRow, eventStartsAt?: string | null): {
  filter_details: PickCandidateFilterDetails;
  firstFailingFilter: string | null;
} {
  // Filter 7: freshness_window_failed (UTV2-775)
  // Fires ONLY when:
  //   1. event_id is non-null AND event FK resolved (eventStartsAt provided)
  //   2. Proximity tier is game-day or pre-start
  //   3. snapshot age violates the computed threshold
  //   4. Filter 2 (stale_price_data) did NOT already fire (not globally stale)
  let freshness_window_failed = false;
  if (
    row.event_id != null &&
    eventStartsAt != null &&
    row.is_stale !== true
  ) {
    const freshness = evaluateProviderDataFreshness({
      snapshotAt: row.last_offer_snapshot_at,
      eventStartsAt,
      sportKey: row.sport_key,
      marketKey: row.canonical_market_key,
    });
    freshness_window_failed = freshness.freshnessWindowFailed;
  }

  const filter_details: PickCandidateFilterDetails = {
    // Filter 1: canonical_market_key is null/empty
    missing_canonical_identity:
      row.canonical_market_key == null || row.canonical_market_key.trim() === '',

    // Filter 2: is_stale = true (last offer snapshot older than 2 hours per §4.4)
    stale_price_data: row.is_stale === true,

    // Filter 3: market_type_id is null — no canonical market family mapping
    unsupported_market_family: row.market_type_id == null,

    // Filter 4: participant needed but participant_id is null
    // A market needs participant linkage when provider_participant_id is non-null
    // (i.e. it is a player-prop market, not a game-line market).
    missing_participant_linkage:
      row.provider_participant_id != null && row.participant_id == null,

    // Filter 5: current_over_odds or current_under_odds is null
    invalid_odds_structure:
      row.current_over_odds == null || row.current_under_odds == null,

    // Filter 6: duplicate_suppressed — always false in Phase 2 (no dedup logic yet)
    duplicate_suppressed: false,

    // Filter 7: freshness_window_failed — computed above (UTV2-775)
    freshness_window_failed,
  };

  // Find the first failing filter key (for rejection_reason)
  const firstFailingFilter = findFirstFailingFilter(filter_details);

  return { filter_details, firstFailingFilter };
}

function findFirstFailingFilter(details: PickCandidateFilterDetails): string | null {
  // Ordered scan: first true key wins as rejection_reason
  const keys = Object.keys(details) as (keyof PickCandidateFilterDetails)[];
  for (const key of keys) {
    if (details[key]) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// BoardScanService
// ---------------------------------------------------------------------------

export class BoardScanService {
  constructor(
    private readonly repos: {
      marketUniverse: IMarketUniverseRepository;
      pickCandidates: IPickCandidateRepository;
      events?: EventRepository;
    },
  ) {}

  async run(options: BoardScanOptions = {}): Promise<BoardScanResult> {
    const startMs = Date.now();
    const scanRunId = crypto.randomUUID();
    const logger = options.logger;
    const maxRows = options.maxRows ?? 5_000;

    // Feature gate — default off
    if (!isSyndicateMachineEnabled(options.enabled)) {
      logger?.info?.(
        JSON.stringify({
          service: 'board-scan',
          event: 'gate.skip',
          reason: 'SYNDICATE_MACHINE_ENABLED=false',
          scanRunId,
        }),
      );
      return { scanned: 0, qualified: 0, rejected: 0, durationMs: Date.now() - startMs, scanRunId };
    }

    // Fetch market_universe rows to scan via the IMarketUniverseRepository.listForScan method.
    // In Phase 2, the materializer always runs before board scan on the same 5-min interval.
    let universeRows: MarketUniverseRow[];
    try {
      universeRows = await this.repos.marketUniverse.listForScan(maxRows);
    } catch (err) {
      logger?.error?.(
        JSON.stringify({
          service: 'board-scan',
          event: 'fetch_universe_failed',
          error: err instanceof Error ? err.message : String(err),
          scanRunId,
        }),
      );
      return { scanned: 0, qualified: 0, rejected: 0, durationMs: Date.now() - startMs, scanRunId };
    }

    if (universeRows.length === 0) {
      logger?.info?.(
        JSON.stringify({
          service: 'board-scan',
          event: 'run.completed',
          scanned: 0,
          qualified: 0,
          rejected: 0,
          note: 'no market_universe rows to scan',
          scanRunId,
        }),
      );
      return { scanned: 0, qualified: 0, rejected: 0, durationMs: Date.now() - startMs, scanRunId };
    }

    const upsertBatch: PickCandidateUpsertInput[] = [];
    let qualifiedCount = 0;
    let rejectedCount = 0;

    const baseProvenance: Record<string, unknown> = {
      scanVersion: '1.0.0',
      filterVersion: '1.1.0',
      runAt: new Date().toISOString(),
    };
    // Keep `provenance` as an alias for backward compat with surrounding code
    const provenance = baseProvenance;

    // Pre-resolve event starts_at for all rows that have a non-null event_id.
    // This batch-loads events to avoid N+1 queries in the loop below.
    // Only performed when an EventRepository is available (optional dep for backward compat).
    const eventStartsAtMap = new Map<string, string | null>();
    if (this.repos.events) {
      const eventIds = [...new Set(
        universeRows
          .map((r) => r.event_id)
          .filter((id): id is string => id != null),
      )];
      for (const eventId of eventIds) {
        try {
          const event = await this.repos.events.findById(eventId);
          if (event) {
            const startsAt = typeof event.metadata?.['starts_at'] === 'string'
              ? event.metadata['starts_at']
              : null;
            eventStartsAtMap.set(eventId, startsAt);
          }
        } catch {
          // Fail open: if event fetch fails, proximity tier falls back to unknown
          eventStartsAtMap.set(eventId, null);
        }
      }
    }

    for (const universeRow of universeRows) {
      // Resolve event starts_at for Filter 7 (freshness_window_failed)
      const eventStartsAt = universeRow.event_id != null
        ? (eventStartsAtMap.get(universeRow.event_id) ?? null)
        : null;

      const { filter_details, firstFailingFilter } = applyCoarseFilters(universeRow, eventStartsAt);

      const passed = firstFailingFilter === null;
      const status = passed ? 'qualified' : 'rejected';
      const rejection_reason = passed ? null : firstFailingFilter;

      if (passed) {
        qualifiedCount++;
      } else {
        rejectedCount++;
      }

      // expires_at: use event starts_at when resolved
      const expires_at: string | null = eventStartsAt ?? null;

      // Compute provenance with staleness metadata (§9B of UTV2-775 contract)
      const freshnessInfo = evaluateProviderDataFreshness({
        snapshotAt: universeRow.last_offer_snapshot_at,
        eventStartsAt,
        sportKey: universeRow.sport_key,
        marketKey: universeRow.canonical_market_key,
      });

      const rowProvenance: Record<string, unknown> = {
        ...provenance,
        scan_run_id: scanRunId,
        snapshot_age_ms: freshnessInfo.snapshotAgeMs,
        event_starts_at: freshnessInfo.eventStartsAt,
        minutes_to_event: freshnessInfo.minutesToEvent,
        proximity_tier: freshnessInfo.proximityTier,
        freshness_threshold_ms: freshnessInfo.freshnessThresholdMs,
        stale_at_scan_time: false,
        stale_reason: null,
      };

      const candidate: PickCandidateUpsertInput = {
        universe_id: universeRow.id,
        status,
        rejection_reason,
        filter_details,
        scan_run_id: scanRunId,
        provenance: rowProvenance,
        expires_at,
        sport_key: universeRow.sport_key ?? null,
        // Phase 2 invariants — these fields must NEVER be set here:
        //   pick_id          → omitted (null in DB)
        //   shadow_mode      → omitted (true in DB)
        //   model_score      → omitted (null in DB)
        //   model_tier       → omitted (null in DB)
        //   model_confidence → omitted (null in DB)
      };

      upsertBatch.push(candidate);
    }

    if (upsertBatch.length > 0) {
      try {
        await this.repos.pickCandidates.upsertCandidates(upsertBatch);
      } catch (err) {
        logger?.error?.(
          JSON.stringify({
            service: 'board-scan',
            event: 'upsert_candidates_failed',
            error: err instanceof Error ? err.message : String(err),
            scanRunId,
          }),
        );
        return {
          scanned: universeRows.length,
          qualified: qualifiedCount,
          rejected: rejectedCount,
          durationMs: Date.now() - startMs,
          scanRunId,
        };
      }
    }

    const durationMs = Date.now() - startMs;

    logger?.info?.(
      JSON.stringify({
        service: 'board-scan',
        event: 'run.completed',
        scanned: universeRows.length,
        qualified: qualifiedCount,
        rejected: rejectedCount,
        durationMs,
        scanRunId,
      }),
    );

    return {
      scanned: universeRows.length,
      qualified: qualifiedCount,
      rejected: rejectedCount,
      durationMs,
      scanRunId,
    };
  }
}

// ---------------------------------------------------------------------------
// Top-level runner — used by index.ts
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper for use in index.ts scheduled job.
 *
 * Phase 2 invariant: this function ONLY writes to pick_candidates.
 * It does NOT write picks, does NOT call submissions, does NOT touch
 * promotion/settlement/distribution services.
 */
export async function runBoardScan(
  repos: {
    marketUniverse: IMarketUniverseRepository;
    pickCandidates: IPickCandidateRepository;
    events?: EventRepository;
  },
  options: BoardScanOptions = {},
): Promise<BoardScanResult> {
  return new BoardScanService(repos).run(options);
}
