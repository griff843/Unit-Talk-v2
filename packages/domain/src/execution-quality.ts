/**
 * Execution quality measurement — measures the gap between pick submission
 * and Discord delivery, detects stale posts, and evaluates line freshness.
 *
 * Pure computation — no DB queries.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Freshness classification for line movement between submission and delivery */
export type LineFreshness = 'fresh' | 'stale' | 'unknown';

/** Computed execution quality metrics for a delivered pick */
export interface ExecutionQualityMetrics {
  /** Milliseconds between pick submission and delivery receipt */
  submissionToDeliveryMs: number;
  /** True if the pick was delivered before the game started */
  deliveredBeforeGameStart: boolean | null;
  /**
   * Absolute line movement in American odds points between submission odds
   * and delivery-time odds. Null when odds comparison is unavailable.
   */
  lineMovement: number | null;
  /** Freshness classification based on delivery timing and line movement */
  freshness: LineFreshness;
}

/** Minimal pick shape needed for execution quality computation */
export interface ExecutionQualityPick {
  /** ISO-8601 timestamp of pick creation (submission time) */
  created_at: string;
  /** American odds at submission time (e.g. -110, +150) */
  odds?: number | null;
}

/** Minimal delivery receipt shape */
export interface ExecutionQualityReceipt {
  /** ISO-8601 timestamp when delivery was recorded */
  recorded_at: string;
}

/** Optional context for richer quality measurement */
export interface ExecutionQualityContext {
  /** ISO-8601 game start time */
  gameStartTime?: string | null;
  /** American odds at (or near) delivery time */
  deliveryTimeOdds?: number | null;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Delivery latency above this (ms) is considered stale regardless of line movement */
const STALE_LATENCY_MS = 15 * 60 * 1000; // 15 minutes

/** Line movement above this (absolute American odds points) degrades freshness */
const STALE_LINE_MOVEMENT_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Compute execution quality metrics for a delivered pick.
 *
 * @param pick        - The pick with its submission timestamp and optional odds
 * @param receipt     - The delivery receipt with its recorded timestamp
 * @param context     - Optional game-start time and delivery-time odds
 * @returns ExecutionQualityMetrics
 */
export function computeExecutionQuality(
  pick: ExecutionQualityPick,
  receipt: ExecutionQualityReceipt,
  context?: ExecutionQualityContext,
): ExecutionQualityMetrics {
  const submissionTime = new Date(pick.created_at).getTime();
  const deliveryTime = new Date(receipt.recorded_at).getTime();
  const submissionToDeliveryMs = deliveryTime - submissionTime;

  // Game-start comparison
  let deliveredBeforeGameStart: boolean | null = null;
  if (context?.gameStartTime) {
    const gameStart = new Date(context.gameStartTime).getTime();
    deliveredBeforeGameStart = deliveryTime < gameStart;
  }

  // Line movement
  let lineMovement: number | null = null;
  if (
    pick.odds != null &&
    context?.deliveryTimeOdds != null
  ) {
    lineMovement = Math.abs(context.deliveryTimeOdds - pick.odds);
  }

  // Freshness classification
  const freshness = classifyFreshness(
    submissionToDeliveryMs,
    deliveredBeforeGameStart,
    lineMovement,
  );

  return {
    submissionToDeliveryMs,
    deliveredBeforeGameStart,
    lineMovement,
    freshness,
  };
}

/**
 * Classify freshness based on latency, game-start, and line movement.
 *
 * Rules:
 * 1. If delivered after game start -> stale
 * 2. If latency > STALE_LATENCY_MS -> stale
 * 3. If line movement > STALE_LINE_MOVEMENT_THRESHOLD -> stale
 * 4. If we have enough data to judge -> fresh
 * 5. Otherwise -> unknown
 */
function classifyFreshness(
  latencyMs: number,
  deliveredBeforeGameStart: boolean | null,
  lineMovement: number | null,
): LineFreshness {
  // Delivered after game start is always stale
  if (deliveredBeforeGameStart === false) {
    return 'stale';
  }

  // High latency is stale
  if (latencyMs > STALE_LATENCY_MS) {
    return 'stale';
  }

  // Large line movement is stale
  if (lineMovement !== null && lineMovement > STALE_LINE_MOVEMENT_THRESHOLD) {
    return 'stale';
  }

  // Negative latency (delivery before submission) is anomalous -> unknown
  if (latencyMs < 0) {
    return 'unknown';
  }

  // If we have at least latency and it's within bounds, call it fresh
  // (line movement being null just means we can't measure it, not that it's bad)
  return 'fresh';
}
