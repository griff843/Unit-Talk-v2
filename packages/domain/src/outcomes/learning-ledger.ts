/**
 * Closed-Loop Learning Ledger
 *
 * Ties prediction context (model probability, market probability, stat alpha)
 * to CLV outcomes and settlement results, then auto-classifies systematic
 * error patterns.
 *
 * Pure computation — no I/O, no DB, no HTTP, no env reads.
 */

// ---------------------------------------------------------------------------
// Miss taxonomy
// ---------------------------------------------------------------------------

export type MissCategory =
  | 'bad_price'              // Line moved against us before close
  | 'wrong_matchup_read'     // Model underweighted opponent strength
  | 'bad_injury_assumption'  // Key player was out/limited (not yet auto-detected)
  | 'stale_line'             // Captured stale line, market had moved
  | 'thin_data'              // Insufficient sample to be confident
  | 'noise'                  // No identifiable systematic error
  | 'unknown';

/** All recognised miss categories — ordered for deterministic iteration. */
export const ALL_MISS_CATEGORIES: MissCategory[] = [
  'bad_price',
  'wrong_matchup_read',
  'bad_injury_assumption',
  'stale_line',
  'thin_data',
  'noise',
  'unknown',
];

// ---------------------------------------------------------------------------
// Entry and summary types
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  pickId: string;
  sport: string;
  marketFamily: string;
  // Prediction context at pick time
  modelProbability: number;
  marketProbability: number | null;
  /** |p_stat - p_market| — model divergence from market at pick time */
  statAlpha: number | null;
  // CLV result
  clvPercent: number | null;
  clvStatus: string | null;     // 'computed' | 'missing_*' | etc.
  isOpeningLineFallback: boolean;
  // Settlement result
  outcome: 'WIN' | 'LOSS' | 'PUSH' | null;
  pnlUnits: number | null;
  // Error taxonomy (populated for losses with an identifiable cause)
  missCategory: MissCategory | null;
  missReason: string | null;
}

export interface LedgerSummary {
  totalPicks: number;
  settledPicks: number;
  winRate: number | null;
  avgCLVPercent: number | null;
  /** Fraction of entries for which CLV was computed */
  clvCoverageRate: number;
  missCategoryBreakdown: Record<MissCategory, number>;
  /** Highest-frequency actionable miss category (excludes 'unknown' and 'noise') */
  topMissCategory: MissCategory | null;
  topMissCount: number;
}

// ---------------------------------------------------------------------------
// Auto-classification
// ---------------------------------------------------------------------------

/** CLV threshold below which a loss is classified as bad_price */
const BAD_PRICE_CLV_THRESHOLD = -2.0;

/** stat_alpha threshold above which a loss hints at wrong_matchup_read */
const WRONG_MATCHUP_ALPHA_THRESHOLD = 0.08;

/**
 * Auto-classify the miss category for an entry using available signals.
 *
 * Priority:
 *   1. Not a loss → unknown (no miss)
 *   2. Opening-line fallback used → stale_line
 *   3. CLV < -2% → bad_price
 *   4. CLV missing → thin_data
 *   5. Strong stat_alpha → wrong_matchup_read
 *   6. Fallback → noise
 */
export function classifyMiss(
  entry: Omit<LedgerEntry, 'missCategory' | 'missReason'>,
): { category: MissCategory; reason: string } {
  if (entry.outcome !== 'LOSS') {
    return { category: 'unknown', reason: 'not_a_loss' };
  }

  if (entry.isOpeningLineFallback) {
    return { category: 'stale_line', reason: 'opening_line_fallback_used' };
  }

  if (entry.clvPercent != null && entry.clvPercent < BAD_PRICE_CLV_THRESHOLD) {
    return { category: 'bad_price', reason: `clv_${entry.clvPercent.toFixed(1)}pct` };
  }

  if (entry.clvPercent == null) {
    return { category: 'thin_data', reason: `clv_${entry.clvStatus ?? 'missing'}` };
  }

  if (entry.statAlpha != null && entry.statAlpha > WRONG_MATCHUP_ALPHA_THRESHOLD) {
    return {
      category: 'wrong_matchup_read',
      reason: `stat_alpha_${entry.statAlpha.toFixed(3)}`,
    };
  }

  return { category: 'noise', reason: 'no_systematic_cause' };
}

// ---------------------------------------------------------------------------
// Ledger summarisation
// ---------------------------------------------------------------------------

/**
 * Summarise an array of ledger entries into aggregate metrics and error taxonomy.
 */
export function summarizeLedger(entries: LedgerEntry[]): LedgerSummary {
  const settled = entries.filter(
    e => e.outcome === 'WIN' || e.outcome === 'LOSS',
  );
  const wins = settled.filter(e => e.outcome === 'WIN');
  const clvEntries = entries.filter(e => e.clvPercent != null);

  const missCategoryBreakdown = Object.fromEntries(
    ALL_MISS_CATEGORIES.map(cat => [
      cat,
      entries.filter(e => e.missCategory === cat).length,
    ]),
  ) as Record<MissCategory, number>;

  // Top actionable category — excludes noise and unknown, only if count > 0
  const actionable = (Object.entries(missCategoryBreakdown) as [MissCategory, number][])
    .filter(([cat, count]) => cat !== 'unknown' && cat !== 'noise' && count > 0)
    .sort(([, a], [, b]) => b - a);

  const topEntry = actionable[0];

  return {
    totalPicks: entries.length,
    settledPicks: settled.length,
    winRate: settled.length > 0 ? wins.length / settled.length : null,
    avgCLVPercent:
      clvEntries.length > 0
        ? clvEntries.reduce((s, e) => s + (e.clvPercent ?? 0), 0) / clvEntries.length
        : null,
    clvCoverageRate: clvEntries.length / (entries.length || 1),
    missCategoryBreakdown,
    topMissCategory: topEntry ? topEntry[0] : null,
    topMissCount: topEntry ? topEntry[1] : 0,
  };
}
