/**
 * Line Movement Detector
 *
 * Phase 2 — UTV2-462
 * Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md
 *
 * Reads market_universe rows and detects when current_line, current_over_odds,
 * or current_under_odds have moved materially relative to opening values.
 *
 * Phase 2 output is in-memory only:
 * - Emits to console log
 * - Emits `'movement'` events on exported `lineMovementEmitter`
 * - No DB writes — no `line_movements` table
 *
 * Hard boundaries (never violate):
 * - No writes to any DB table
 * - No calls to picks, pick_candidates, submission, promotion, settlement, or distribution
 * - system-pick-scanner is NOT modified or called
 * - No new migrations
 */

import { EventEmitter } from 'node:events';
import type { IMarketUniverseRepository, MarketUniverseRow } from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Minimum point movement on the line to count as significant.
 * Example: spread -3.5 → -4.0 = 0.5 delta → significant.
 */
const LINE_MOVEMENT_THRESHOLD = 0.5;

/**
 * Minimum American-odds movement to count as significant.
 * Example: -110 → -115 = 5 delta → significant.
 */
const ODDS_MOVEMENT_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LineMovement {
  universe_id: string;
  provider_key: string;
  provider_event_id: string;
  canonical_market_key: string;
  movement_type: 'line' | 'over_odds' | 'under_odds';
  from_value: number;
  to_value: number;
  delta: number;
  detected_at: string; // ISO timestamp
  is_stale: boolean;
}

export interface DetectorOptions {
  /** How far back (in minutes) to consider rows "recent" enough to evaluate. Default: 10 minutes. */
  lookbackMinutes?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface DetectorResult {
  scanned: number;
  movements: LineMovement[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Emitter — in-process pub/sub for downstream subscribers
// ---------------------------------------------------------------------------

/**
 * Singleton emitter. Phase 2 components subscribe with:
 *   lineMovementEmitter.on('movement', (m: LineMovement) => { ... })
 */
export const lineMovementEmitter = new EventEmitter();

// ---------------------------------------------------------------------------
// Core detector — pure, stateless
// ---------------------------------------------------------------------------

/**
 * LineMovementDetector
 *
 * Detects line and odds movement against opening values.
 * Compares:
 *   - current_line vs opening_line (threshold: 0.5 points)
 *   - current_over_odds vs opening_over_odds (threshold: 5 American odds points)
 *   - current_under_odds vs opening_under_odds (threshold: 5 American odds points)
 *
 * Only rows that have both a current value AND an opening value for the relevant
 * field are evaluated. Rows missing either are skipped (not a detector error).
 */
export class LineMovementDetector {
  /**
   * Evaluate a batch of market_universe rows and return all significant movements.
   *
   * @param rows - MarketUniverseRow array (as returned by a DB/in-memory fetch)
   * @returns Array of LineMovement records, one per significant field movement per row.
   */
  detect(rows: MarketUniverseRow[]): LineMovement[] {
    const detectedAt = new Date().toISOString();
    const movements: LineMovement[] = [];

    for (const row of rows) {
      // Line movement
      if (
        row.current_line !== null &&
        row.opening_line !== null &&
        Math.abs(row.current_line - row.opening_line) >= LINE_MOVEMENT_THRESHOLD
      ) {
        const delta = row.current_line - row.opening_line;
        movements.push({
          universe_id: row.id,
          provider_key: row.provider_key,
          provider_event_id: row.provider_event_id,
          canonical_market_key: row.canonical_market_key,
          movement_type: 'line',
          from_value: row.opening_line,
          to_value: row.current_line,
          delta,
          detected_at: detectedAt,
          is_stale: row.is_stale,
        });
      }

      // Over-odds movement
      if (
        row.current_over_odds !== null &&
        row.opening_over_odds !== null &&
        Math.abs(row.current_over_odds - row.opening_over_odds) >= ODDS_MOVEMENT_THRESHOLD
      ) {
        const delta = row.current_over_odds - row.opening_over_odds;
        movements.push({
          universe_id: row.id,
          provider_key: row.provider_key,
          provider_event_id: row.provider_event_id,
          canonical_market_key: row.canonical_market_key,
          movement_type: 'over_odds',
          from_value: row.opening_over_odds,
          to_value: row.current_over_odds,
          delta,
          detected_at: detectedAt,
          is_stale: row.is_stale,
        });
      }

      // Under-odds movement
      if (
        row.current_under_odds !== null &&
        row.opening_under_odds !== null &&
        Math.abs(row.current_under_odds - row.opening_under_odds) >= ODDS_MOVEMENT_THRESHOLD
      ) {
        const delta = row.current_under_odds - row.opening_under_odds;
        movements.push({
          universe_id: row.id,
          provider_key: row.provider_key,
          provider_event_id: row.provider_event_id,
          canonical_market_key: row.canonical_market_key,
          movement_type: 'under_odds',
          from_value: row.opening_under_odds,
          to_value: row.current_under_odds,
          delta,
          detected_at: detectedAt,
          is_stale: row.is_stale,
        });
      }
    }

    return movements;
  }
}

// ---------------------------------------------------------------------------
// Repository extension — fetch rows for detection
// ---------------------------------------------------------------------------

/**
 * ILineMovementDetectorRepository
 *
 * Phase 2 uses a narrow read-only slice: fetch recently-refreshed rows.
 * The interface is intentionally minimal — Phase 2 only needs one method.
 */
export interface ILineMovementDetectorRepository {
  /**
   * Return market_universe rows whose `refreshed_at` is >= `since`.
   * Returns full MarketUniverseRow objects (all columns needed for comparison).
   */
  listRecentlyRefreshed(since: string): Promise<MarketUniverseRow[]>;
}

// ---------------------------------------------------------------------------
// Top-level runner
// ---------------------------------------------------------------------------

/**
 * runLineMovementDetection
 *
 * Scheduled runner that:
 * 1. Fetches recently-refreshed market_universe rows (last N minutes)
 * 2. Runs detector.detect() against them
 * 3. Emits each movement via lineMovementEmitter
 * 4. Logs a structured summary
 *
 * Called from index.ts on the same 5-minute interval as the materializer.
 * In Phase 2 the repo param must provide `listRecentlyRefreshed`.
 * InMemoryMarketUniverseRepository does not implement this interface;
 * the integration is via DatabaseLineMovementRepository (or a test stub).
 */
export async function runLineMovementDetection(
  repo: ILineMovementDetectorRepository,
  options: DetectorOptions = {},
): Promise<DetectorResult> {
  const startMs = Date.now();
  const lookbackMinutes = options.lookbackMinutes ?? 10;
  const logger = options.logger;

  const since = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();

  let rows: MarketUniverseRow[];
  try {
    rows = await repo.listRecentlyRefreshed(since);
  } catch (err) {
    logger?.error?.(
      JSON.stringify({
        service: 'line-movement-detector',
        event: 'fetch_rows_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { scanned: 0, movements: [], durationMs: Date.now() - startMs };
  }

  const detector = new LineMovementDetector();
  const movements = detector.detect(rows);

  for (const movement of movements) {
    lineMovementEmitter.emit('movement', movement);
  }

  const durationMs = Date.now() - startMs;

  logger?.info?.(
    JSON.stringify({
      service: 'line-movement-detector',
      event: 'run.completed',
      scanned: rows.length,
      movements: movements.length,
      durationMs,
      runAt: new Date(startMs).toISOString(),
    }),
  );

  return { scanned: rows.length, movements, durationMs };
}

// ---------------------------------------------------------------------------
// DatabaseLineMovementRepository
// ---------------------------------------------------------------------------

/**
 * DatabaseLineMovementRepository
 *
 * Wraps IMarketUniverseRepository to provide the listRecentlyRefreshed query.
 * Uses the Supabase client directly (no new repo interface in @unit-talk/db required).
 *
 * Phase 2: reads market_universe rows refreshed in the last N minutes.
 * Compares current vs opening values to detect movement.
 */
export class DatabaseLineMovementRepository implements ILineMovementDetectorRepository {
  constructor(
    private readonly marketUniverseRepo: IMarketUniverseRepository & {
      listRecentlyRefreshed?: (since: string) => Promise<MarketUniverseRow[]>;
    },
  ) {}

  async listRecentlyRefreshed(since: string): Promise<MarketUniverseRow[]> {
    if (typeof this.marketUniverseRepo.listRecentlyRefreshed === 'function') {
      return this.marketUniverseRepo.listRecentlyRefreshed(since);
    }
    // Fallback: no-op for in-memory repo (tests use stubs instead)
    return [];
  }
}
