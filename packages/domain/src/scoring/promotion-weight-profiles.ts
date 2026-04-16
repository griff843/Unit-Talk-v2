/**
 * UTV2-623: Market-family-aware promotion weight modifiers.
 *
 * Unknown market families and unsupported sports receive score caps that prevent
 * them from reaching the elite promotion band. Known market families receive
 * per-family multipliers that adjust which score components matter most.
 *
 * Pure module — no I/O, no DB, no env.
 */

// ─── Market Family ────────────────────────────────────────────────────────────

export type MarketFamily = 'game-line' | 'player-prop' | 'team-prop' | 'unknown';

export interface PromotionWeightModifiers {
  /** Multiplier applied to the edge score component. 1.0 = no change. */
  edgeMultiplier: number;
  /** Multiplier applied to the trust score component. */
  trustMultiplier: number;
  /** Multiplier applied to the readiness score component. */
  readinessMultiplier: number;
  /** Multiplier applied to the uniqueness score component. */
  uniquenessMultiplier: number;
  /** Multiplier applied to the boardFit score component. */
  boardFitMultiplier: number;
  /**
   * Maximum total score (0–100) after modifiers are applied.
   * Unknown market family gets a hard cap below the elite band (90+).
   */
  maxScoreCap: number;
}

/**
 * Per-market-family multipliers applied to promotion score components before
 * capping. Multipliers shift emphasis toward the most reliable signal for that
 * market type without fundamentally changing the scoring architecture.
 */
export const MARKET_FAMILY_PROMOTION_MODIFIERS: Record<MarketFamily, PromotionWeightModifiers> = {
  'game-line': {
    edgeMultiplier: 1.1,       // Game lines: edge is well-measured by CLV
    trustMultiplier: 1.0,
    readinessMultiplier: 1.0,
    uniquenessMultiplier: 0.9, // Game lines are less unique (everyone sees moneylines)
    boardFitMultiplier: 1.0,
    maxScoreCap: 100,
  },
  'player-prop': {
    edgeMultiplier: 1.0,
    trustMultiplier: 1.1,      // Player props: trust matters more (thinner markets)
    readinessMultiplier: 1.0,
    uniquenessMultiplier: 1.1, // Player props can be more unique/differentiated
    boardFitMultiplier: 1.0,
    maxScoreCap: 100,
  },
  'team-prop': {
    edgeMultiplier: 1.0,
    trustMultiplier: 1.0,
    readinessMultiplier: 0.9,
    uniquenessMultiplier: 1.0,
    boardFitMultiplier: 1.0,
    maxScoreCap: 100,
  },
  'unknown': {
    edgeMultiplier: 0.85,      // Unknown market family: penalize all components
    trustMultiplier: 0.85,
    readinessMultiplier: 0.85,
    uniquenessMultiplier: 0.85,
    boardFitMultiplier: 0.85,
    maxScoreCap: 72,           // Hard cap: unknown slice cannot reach elite band (90+)
  },
};

/**
 * Classify a market key string into a MarketFamily.
 *
 * Uses the canonical normalized market key format produced by normalizeMarketKey()
 * in market-key.ts, but also handles raw submission strings as a fallback.
 */
export function classifyMarketFamily(marketKey: string): MarketFamily {
  if (!marketKey) return 'unknown';
  const key = marketKey.toLowerCase().trim();

  // Game lines — moneyline, spread, game total, team total
  if (
    key === 'moneyline' ||
    key === 'spread' ||
    key === 'game_spread' ||
    key === 'game-spread' ||
    key.includes('game_total') ||
    key.includes('game-total') ||
    key === 'total'
  ) {
    return 'game-line';
  }

  // Team-prop — team total (must be checked before player-prop to avoid overlap)
  if (key === 'team_total' || key === 'team_total_ou' || key === 'team-total' || key === 'team-total-ou') {
    return 'team-prop';
  }

  // Player props — player.* prefix, canonical prop suffixes, sport-specific prop keys
  if (
    key.startsWith('player.') ||
    key.includes('-all-game-ou') ||
    key.includes('batting-') ||
    key.includes('pitching-') ||
    key.includes('-game-ou')
  ) {
    return 'player-prop';
  }

  // Team props — team-related markets not captured above
  if (key.includes('team') || key.includes('team-total')) {
    return 'team-prop';
  }

  return 'unknown';
}

// ─── Sport Support ────────────────────────────────────────────────────────────

/**
 * Sports with full scoring model support. Picks from unsupported sports receive
 * an additional score cap (UNSUPPORTED_SPORT_SCORE_CAP) on top of any
 * market-family cap.
 */
export const SUPPORTED_SPORTS = new Set(['NBA', 'NFL', 'MLB', 'NHL']);

/**
 * Check whether a sport string has a supported scoring model.
 */
export function isSupportedSport(sport: string | null | undefined): boolean {
  if (!sport) return false;
  return SUPPORTED_SPORTS.has(sport.toUpperCase());
}

/**
 * Maximum promotion score for picks from unsupported sports.
 * Applied as a hard cap on top of any market-family cap.
 * Set below the best-bets minimumScore (70) + margin, ensuring unsupported
 * sports cannot reach even the lowest elite band without explicit override.
 */
export const UNSUPPORTED_SPORT_SCORE_CAP = 60;

// ─── Score Provenance ─────────────────────────────────────────────────────────

/**
 * Provenance record attached to a promotion score breakdown to explain which
 * modifiers were applied and why the total may be capped.
 */
export interface ScoreProvenance {
  /** Market family classified from the pick's market key. */
  marketFamily: MarketFamily;
  /** Sport from the pick's metadata (raw string, may be empty). */
  sport: string;
  /** True when market-family multipliers were applied (always true for known families too). */
  modifiersApplied: boolean;
  /**
   * True when the pick's sport is not in SUPPORTED_SPORTS, triggering
   * UNSUPPORTED_SPORT_SCORE_CAP.
   */
  unsupportedSlice: boolean;
  /** True when any cap (market-family or sport) reduced the raw total. */
  capApplied: boolean;
  /** The cap value that was binding, or null if no cap was applied. */
  capValue: number | null;
}

// ─── Modifier Application ─────────────────────────────────────────────────────

export interface ModifiedScoreComponents {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
  /** Raw total before capping. */
  rawTotal: number;
  /** Final total after capping. */
  total: number;
  provenance: ScoreProvenance;
}

/**
 * Apply market-family multipliers and sport/market caps to weighted score components.
 *
 * @param weighted - Already-weighted score components (edge * weight, etc.) that sum to the raw total.
 * @param marketKey - The pick's market string (from CanonicalPick.market).
 * @param sport     - The pick's sport string (from CanonicalPick.metadata.sport), may be absent.
 */
export function applyPromotionModifiers(
  weighted: { edge: number; trust: number; readiness: number; uniqueness: number; boardFit: number },
  marketKey: string,
  sport: string | null | undefined,
): ModifiedScoreComponents {
  const marketFamily = classifyMarketFamily(marketKey);
  const mods = MARKET_FAMILY_PROMOTION_MODIFIERS[marketFamily];
  const sportStr = sport ?? '';
  const unsupportedSlice = !isSupportedSport(sportStr);

  // Apply per-component multipliers
  const edge = weighted.edge * mods.edgeMultiplier;
  const trust = weighted.trust * mods.trustMultiplier;
  const readiness = weighted.readiness * mods.readinessMultiplier;
  const uniqueness = weighted.uniqueness * mods.uniquenessMultiplier;
  const boardFit = weighted.boardFit * mods.boardFitMultiplier;

  const rawTotal = edge + trust + readiness + uniqueness + boardFit;

  // Determine effective cap (most restrictive wins)
  let effectiveCap = mods.maxScoreCap;
  if (unsupportedSlice && UNSUPPORTED_SPORT_SCORE_CAP < effectiveCap) {
    effectiveCap = UNSUPPORTED_SPORT_SCORE_CAP;
  }

  const cappedTotal = Math.min(rawTotal, effectiveCap);
  const capApplied = cappedTotal < rawTotal;

  const provenance: ScoreProvenance = {
    marketFamily,
    sport: sportStr,
    modifiersApplied: true,
    unsupportedSlice,
    capApplied,
    capValue: capApplied ? effectiveCap : null,
  };

  return {
    edge,
    trust,
    readiness,
    uniqueness,
    boardFit,
    rawTotal,
    total: cappedTotal,
    provenance,
  };
}
