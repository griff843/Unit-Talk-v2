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
import type { IMarketUniverseRepository, IPickCandidateRepository, PickCandidateUpsertInput, MarketUniverseRow, PickCandidateFilterDetails } from '@unit-talk/db';

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
 */
function applyCoarseFilters(row: MarketUniverseRow): {
  filter_details: PickCandidateFilterDetails;
  firstFailingFilter: string | null;
} {
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

    // Filter 7: freshness_window_failed — always false in Phase 2
    freshness_window_failed: false,
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

    const provenance: Record<string, unknown> = {
      scanVersion: '1.0.0',
      filterVersion: '1.0.0',
      runAt: new Date().toISOString(),
    };

    for (const universeRow of universeRows) {
      const { filter_details, firstFailingFilter } = applyCoarseFilters(universeRow);

      const passed = firstFailingFilter === null;
      const status = passed ? 'qualified' : 'rejected';
      const rejection_reason = passed ? null : firstFailingFilter;

      if (passed) {
        qualifiedCount++;
      } else {
        rejectedCount++;
      }

      // expires_at: use event starts_at if event_id is linked (Phase 2: event FK not yet resolved,
      // so event_id is null in materializer output — expires_at will be null per contract §5.6)
      // If in the future event_id is populated, board scan would need an events lookup.
      // For now: expires_at = null (event linkage not resolved in Phase 2 materializer).
      const expires_at: string | null = null;

      const candidate: PickCandidateUpsertInput = {
        universe_id: universeRow.id,
        status,
        rejection_reason,
        filter_details,
        scan_run_id: scanRunId,
        provenance,
        expires_at,
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
  },
  options: BoardScanOptions = {},
): Promise<BoardScanResult> {
  return new BoardScanService(repos).run(options);
}
