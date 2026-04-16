/**
 * Matchup Context Feature Extractor — UTV2-633
 *
 * Computes matchup-specific context factors:
 *   - Opponent defensive rating / rank vs position
 *   - Head-to-head historical record
 *   - Rest differential
 *   - Pace multiplier (NBA)
 *   - Home advantage
 *
 * Pure — no I/O, no DB, no env reads.
 */

// ── Input Types ──────────────────────────────────────────────────────────────

export interface MatchupContextInput {
  sport: string;
  /** Opponent defensive metrics (sport-specific raw values):
   *  NBA: DRTG; NFL: yards allowed per game */
  opponentDefensiveRating?: number | null;
  /** 1 = best defense, 30 = worst */
  opponentRankVsPosition?: number | null;
  headToHeadRecord?: { wins: number; losses: number } | null;
  /** Positive = candidate team has more rest days */
  restDifferential?: number;
  /** NBA: relative pace (1.0 = league avg) */
  paceMultiplier?: number | null;
  isHomeTeam?: boolean;
}

// ── Output Types ─────────────────────────────────────────────────────────────

export interface MatchupContextFactors {
  /** 0.8 = tough opponent, 1.2 = weak opponent */
  opponentStrengthFactor: number;
  /** 0.9–1.1 for NBA pace; 1.0 for others */
  paceAdjustment: number;
  /** -0.05 to +0.05 probability shift */
  restAdvantage: number;
  /** 0.0 to +0.03 probability shift */
  homeAdvantage: number;
  /** 0.95–1.05 based on historical H2H */
  headToHeadFactor: number;
  /** 0–1 normalized summary */
  compositeContextScore: number;
}

export interface MatchupContextExplanation {
  factors: MatchupContextFactors;
  /** Human-readable factor explanations */
  reasoning: string[];
  /** Which factor had the most impact */
  dominantFactor: string;
}

// ── Core Computation ─────────────────────────────────────────────────────────

export function computeMatchupContext(
  input: MatchupContextInput,
): MatchupContextExplanation {
  const reasoning: string[] = [];

  // ── Opponent strength ────────────────────────────────────────────────────
  let opponentStrengthFactor = 1.0;
  if (input.opponentRankVsPosition != null) {
    // rank 1–10 (tough): factors toward 0.85–0.95
    // rank 21–30 (weak): factors toward 1.05–1.15
    opponentStrengthFactor = 1.0 + (input.opponentRankVsPosition - 15) * 0.01;
    opponentStrengthFactor = Math.max(0.80, Math.min(1.20, opponentStrengthFactor));
    if (input.opponentRankVsPosition <= 5) {
      reasoning.push(`elite_defense_rank_${input.opponentRankVsPosition}`);
    } else if (input.opponentRankVsPosition >= 25) {
      reasoning.push(`weak_defense_rank_${input.opponentRankVsPosition}`);
    }
  }

  // ── Pace adjustment (NBA only) ───────────────────────────────────────────
  let paceAdjustment = 1.0;
  if (input.sport === 'NBA' && input.paceMultiplier != null) {
    paceAdjustment = 0.9 + input.paceMultiplier * 0.1;
    paceAdjustment = Math.max(0.90, Math.min(1.10, paceAdjustment));
    if (input.paceMultiplier > 1.1) {
      reasoning.push('high_pace_game');
    } else if (input.paceMultiplier < 0.9) {
      reasoning.push('low_pace_game');
    }
  }

  // ── Rest differential ────────────────────────────────────────────────────
  const restAdvantage = Math.max(
    -0.05,
    Math.min(0.05, (input.restDifferential ?? 0) * 0.01),
  );
  if (Math.abs(restAdvantage) > 0.02) {
    reasoning.push(`rest_edge_${restAdvantage > 0 ? 'positive' : 'negative'}`);
  }

  // ── Home advantage ───────────────────────────────────────────────────────
  const homeAdvantage = input.isHomeTeam ? 0.025 : 0.0;
  if (input.isHomeTeam) {
    reasoning.push('home_court');
  }

  // ── Head-to-head ─────────────────────────────────────────────────────────
  let headToHeadFactor = 1.0;
  if (input.headToHeadRecord) {
    const total =
      input.headToHeadRecord.wins + input.headToHeadRecord.losses;
    if (total >= 3) {
      const winRate = input.headToHeadRecord.wins / total;
      headToHeadFactor = 0.95 + winRate * 0.10;
      if (winRate > 0.7) {
        reasoning.push('strong_h2h_advantage');
      } else if (winRate < 0.3) {
        reasoning.push('poor_h2h_history');
      }
    }
  }

  // ── Composite score ──────────────────────────────────────────────────────
  const compositeContextScore = Math.max(
    0,
    Math.min(
      1,
      (opponentStrengthFactor - 0.8) / 0.4 * 0.4 +
        paceAdjustment * 0.2 +
        (restAdvantage + 0.05) / 0.1 * 0.2 +
        headToHeadFactor * 0.2,
    ),
  );

  const factors: MatchupContextFactors = {
    opponentStrengthFactor,
    paceAdjustment,
    restAdvantage,
    homeAdvantage,
    headToHeadFactor,
    compositeContextScore,
  };

  // ── Dominant factor ──────────────────────────────────────────────────────
  const factorDeviations: Record<string, number> = {
    opponent: Math.abs(opponentStrengthFactor - 1.0),
    pace: Math.abs(paceAdjustment - 1.0),
    rest: Math.abs(restAdvantage),
    homeAdvantage,
    h2h: Math.abs(headToHeadFactor - 1.0),
  };
  const dominantFactor = Object.entries(factorDeviations).sort(
    ([, a], [, b]) => b - a,
  )[0]![0];

  return { factors, reasoning, dominantFactor };
}

// ── Probability Adjustment ───────────────────────────────────────────────────

/**
 * Apply matchup context factors to adjust a base probability.
 * Result is clamped to [0.01, 0.99].
 */
export function applyMatchupContextToProbability(
  baseProbability: number,
  context: MatchupContextExplanation,
): number {
  const { factors } = context;
  let adjusted =
    baseProbability * factors.opponentStrengthFactor * factors.paceAdjustment;
  adjusted += factors.restAdvantage + factors.homeAdvantage;
  adjusted = Math.max(0.01, Math.min(0.99, adjusted));
  return Math.round(adjusted * 1e6) / 1e6;
}
