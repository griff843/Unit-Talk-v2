/**
 * Efficiency Feature Extractor
 *
 * Computes efficiency adjustments:
 *   - Opponent defensive adjustment (matchup modifier)
 *   - Player skill multiplier (stat-per-opportunity from form)
 *   - Pace adjustment (from game context)
 *
 * Feeds into: expected_stat = opportunity × efficiency
 * NO market inputs allowed.
 */

import type { PlayerFormFeatures } from './player-form.js';

// ── Input Types ──────────────────────────────────────────────────────────────

export interface OpponentDefenseLog {
  /** Stat allowed per game at this position (e.g., points allowed to PG) */
  stat_allowed_per_game: number;
  /** Games sampled for this opponent defense metric */
  games_sampled: number;
}

export interface LeagueAverages {
  /** League average of the stat per game at this position */
  stat_per_game: number;
  /** Standard deviation of stat allowed across all teams */
  stat_allowed_std: number;
}

export interface OpponentDefenseInput {
  /** Opponent's stat allowed for this stat type at this position */
  opponent: OpponentDefenseLog;
  /** League-wide averages for normalization */
  league: LeagueAverages;
  /** Opponent team identifier */
  opponent_team_id: string;
  /** Rank of opponent in stat allowed (1=most allowed, 30=least) */
  stat_allowed_rank: number;
}

// ── Output Contract ──────────────────────────────────────────────────────────

export interface EfficiencyFeatures {
  // Core efficiency
  player_skill_rate: number;
  opponent_defensive_adjustment: number;
  pace_adjustment: number;

  // Combined efficiency projection
  efficiency_projection: number;

  // Variance contributions
  matchup_volatility: number;
  matchup_variance: number;

  // Metadata
  opponent_team_id: string;
  stat_allowed_rank: number;
}

export type EfficiencyResult =
  | { ok: true; data: EfficiencyFeatures }
  | { ok: false; reason: string };

// ── Core Computation ─────────────────────────────────────────────────────────

/**
 * Extract efficiency features.
 *
 * efficiency_projection = player_skill_rate × opponent_defensive_adjustment × pace_adjustment
 */
export function extractEfficiencyFeatures(
  playerForm: PlayerFormFeatures,
  defense: OpponentDefenseInput,
  paceAdjustment: number = 1.0,
): EfficiencyResult {
  if (defense.opponent.games_sampled < 3) {
    return {
      ok: false,
      reason: `Insufficient opponent defense data: ${defense.opponent.games_sampled} games`,
    };
  }

  if (defense.league.stat_per_game <= 0) {
    return {
      ok: false,
      reason: 'Invalid league average: stat_per_game must be positive',
    };
  }

  // ── Player Skill Rate ──────────────────────────────────────────────────
  const playerSkillRate = playerForm.stat_per_opportunity;

  // ── Opponent Defensive Adjustment ──────────────────────────────────────
  const opponentDefensiveAdjustment = round4(
    defense.opponent.stat_allowed_per_game / defense.league.stat_per_game,
  );

  // ── Pace Adjustment ────────────────────────────────────────────────────
  const clampedPace = Math.max(0.5, Math.min(1.5, paceAdjustment));

  // ── Combined Efficiency Projection ─────────────────────────────────────
  const efficiencyProjection = round4(
    playerSkillRate * opponentDefensiveAdjustment * clampedPace,
  );

  // ── Matchup Variance ───────────────────────────────────────────────────
  const leagueStd = defense.league.stat_allowed_std;
  const zDefense =
    leagueStd > 0
      ? Math.abs(
          defense.opponent.stat_allowed_per_game -
            defense.league.stat_per_game,
        ) / leagueStd
      : 0;

  const matchupVolatility = round4(Math.min(1, zDefense / 2));
  const matchupVariance = round4(
    playerForm.player_base_volatility * matchupVolatility * 0.5,
  );

  return {
    ok: true,
    data: {
      player_skill_rate: round4(playerSkillRate),
      opponent_defensive_adjustment: opponentDefensiveAdjustment,
      pace_adjustment: round4(clampedPace),
      efficiency_projection: efficiencyProjection,
      matchup_volatility: matchupVolatility,
      matchup_variance: matchupVariance,
      opponent_team_id: defense.opponent_team_id,
      stat_allowed_rank: defense.stat_allowed_rank,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
