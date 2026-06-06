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
  /**
   * ISO date string when this rating was computed. Required when max-age guard
   * is active; absent entries fail closed. UTV2-1209.
   */
  rating_date?: string;
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
  /**
   * Stat category this rating applies to (e.g. 'points', 'rebounds', 'assists').
   * Used for keying when building multi-stat defensive profiles. UTV2-1209.
   */
  stat_category?: string;
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

  // Pace flag — set when raw input pace > 1.25 (before clamping). UTV2-1214.
  high_pace_flag: boolean;
}

export type EfficiencyResult =
  | { ok: true; data: EfficiencyFeatures }
  | { ok: false; reason: string };

// ── Configuration ────────────────────────────────────────────────────────────

export interface EfficiencyConfig {
  /**
   * ISO date used as the reference point for max-age staleness checks.
   * Requires max_age_days to be set; both must be present to activate the guard.
   */
  reference_date?: string;
  /**
   * Maximum age in days a defensive rating may be relative to reference_date.
   * Ratings older than reference_date - max_age_days are stale — fail closed.
   * Ratings without a rating_date also fail closed when the guard is active.
   */
  max_age_days?: number;
}

// ── Mock Fixtures ─────────────────────────────────────────────────────────────

/**
 * Canonical mock fixture for opponent defensive stats tests — fresh rating. UTV2-1209.
 */
export const MOCK_DEFENSE_FIXTURE: OpponentDefenseInput = {
  opponent: {
    stat_allowed_per_game: 25.2,
    games_sampled: 20,
    rating_date: '2026-01-08',
  },
  league: { stat_per_game: 24.0, stat_allowed_std: 3.0 },
  opponent_team_id: 'mock-team-1',
  stat_allowed_rank: 14,
  stat_category: 'points',
};

/**
 * Stale mock fixture — rating_date far in the past. UTV2-1209.
 * Use with max-age guard to verify fail-closed behavior.
 */
export const MOCK_DEFENSE_FIXTURE_STALE: OpponentDefenseInput = {
  opponent: {
    stat_allowed_per_game: 23.5,
    games_sampled: 20,
    rating_date: '2025-06-01',
  },
  league: { stat_per_game: 24.0, stat_allowed_std: 3.0 },
  opponent_team_id: 'mock-team-2',
  stat_allowed_rank: 20,
  stat_category: 'points',
};

/**
 * No-date mock fixture — rating_date absent. UTV2-1209.
 * Use with max-age guard to verify that missing provenance fails closed.
 */
export const MOCK_DEFENSE_FIXTURE_NO_DATE: OpponentDefenseInput = {
  opponent: {
    stat_allowed_per_game: 24.8,
    games_sampled: 15,
  },
  league: { stat_per_game: 24.0, stat_allowed_std: 3.0 },
  opponent_team_id: 'mock-team-3',
  stat_allowed_rank: 16,
  stat_category: 'rebounds',
};

// ── Core Computation ─────────────────────────────────────────────────────────

/**
 * Extract efficiency features.
 *
 * efficiency_projection = player_skill_rate × opponent_defensive_adjustment × pace_adjustment
 *
 * Fail-closed: returns ok:false when opponent data is insufficient, when
 * league average is invalid, or when the max-age guard rejects a stale rating.
 */
export function extractEfficiencyFeatures(
  playerForm: PlayerFormFeatures,
  defense: OpponentDefenseInput,
  paceAdjustment: number = 1.0,
  config: EfficiencyConfig = {},
): EfficiencyResult {
  // ── Max-Age Guard ──────────────────────────────────────────────────────────
  // Fail-closed: stale or undated defensive ratings are rejected when the guard
  // is configured. Both reference_date and max_age_days must be set to activate.
  if (config.reference_date !== undefined && config.max_age_days !== undefined) {
    const cutoffMs =
      new Date(config.reference_date).getTime() - config.max_age_days * 86_400_000;
    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

    if (!defense.opponent.rating_date) {
      return {
        ok: false,
        reason: `Max-age guard active but opponent rating has no rating_date — fail closed (reference_date=${config.reference_date}, max_age_days=${config.max_age_days})`,
      };
    }
    if (defense.opponent.rating_date < cutoffDate) {
      return {
        ok: false,
        reason: `Opponent defensive rating is stale: rating_date=${defense.opponent.rating_date} < cutoff=${cutoffDate} (reference_date=${config.reference_date}, max_age_days=${config.max_age_days})`,
      };
    }
  }

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
  // UTV2-1214: cap lowered from 1.5 → 1.3; flag set on raw input before clamping.
  const highPaceFlag = paceAdjustment > 1.25;
  const clampedPace = Math.max(0.5, Math.min(1.3, paceAdjustment));

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
      high_pace_flag: highPaceFlag,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
