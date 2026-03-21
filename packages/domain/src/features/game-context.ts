/**
 * Game Context Feature Extractor
 *
 * Computes game environment features:
 *   - Team pace factor (relative to league average)
 *   - Projected game total (from team ratings, NOT market lines)
 *   - Rest days / back-to-back
 *   - Home/away adjustment
 *
 * NO market inputs allowed. projected_game_total derived from team data only.
 */

// ── Input Types ──────────────────────────────────────────────────────────────

export interface TeamPaceData {
  /** Team possessions per 48 minutes (or equivalent pace metric) */
  team_pace: number;
  /** Opponent possessions per 48 minutes */
  opponent_pace: number;
  /** League average pace */
  league_avg_pace: number;
  /** Team offensive rating (points per 100 possessions) */
  team_off_rating: number;
  /** Opponent defensive rating (points allowed per 100 possessions) */
  opponent_def_rating: number;
  /** League average points per game */
  league_avg_ppg: number;
}

export interface GameScheduleData {
  /** Date of this game (ISO string) */
  game_date: string;
  /** Date of team's previous game (ISO string, null if unknown) */
  prev_game_date: string | null;
  /** Is the team playing at home? */
  is_home: boolean;
}

export interface GameContextInput {
  pace: TeamPaceData;
  schedule: GameScheduleData;
  team_id: string;
  opponent_team_id: string;
}

// ── Output Contract ──────────────────────────────────────────────────────────

export interface GameContextFeatures {
  // Efficiency modifiers
  pace_factor: number;
  projected_game_total: number;
  pace_environment_adjustment: number;

  // Opportunity modifiers
  rest_days: number;
  is_back_to_back: boolean;
  home_away_factor: number;

  // Metadata
  team_id: string;
  opponent_team_id: string;
}

export type GameContextResult =
  | { ok: true; data: GameContextFeatures }
  | { ok: false; reason: string };

// ── Constants ────────────────────────────────────────────────────────────────

/** Home court advantage factor (from NBA research: ~2-3 pts, ~1-2% in performance) */
const HOME_ADVANTAGE = 1.012;
const AWAY_DISADVANTAGE = 0.988;

// ── Core Computation ─────────────────────────────────────────────────────────

export function extractGameContextFeatures(
  input: GameContextInput,
): GameContextResult {
  const { pace, schedule, team_id, opponent_team_id } = input;

  if (pace.league_avg_pace <= 0 || pace.league_avg_ppg <= 0) {
    return {
      ok: false,
      reason: 'Invalid league averages: pace and ppg must be positive',
    };
  }

  // ── Pace Factor ────────────────────────────────────────────────────────
  // Average of team and opponent pace, relative to league average
  const matchupPace = (pace.team_pace + pace.opponent_pace) / 2;
  const paceFactor = round4(matchupPace / pace.league_avg_pace);

  // ── Projected Game Total ───────────────────────────────────────────────
  // Derived from team ratings, NOT from market over/under lines.
  const teamExpectedPts =
    (pace.team_off_rating / 100) *
    (matchupPace / pace.league_avg_pace) *
    (pace.league_avg_ppg / 2);
  const oppExpectedPts =
    ((200 - pace.opponent_def_rating) / 100) *
    (matchupPace / pace.league_avg_pace) *
    (pace.league_avg_ppg / 2);
  const projectedGameTotal = round4(teamExpectedPts + oppExpectedPts);

  // ── Pace Environment Adjustment ────────────────────────────────────────
  const paceEnvironmentAdjustment = round4(paceFactor);

  // ── Rest Days ──────────────────────────────────────────────────────────
  let restDays = 2; // default if unknown
  if (schedule.prev_game_date) {
    const current = new Date(schedule.game_date);
    const prev = new Date(schedule.prev_game_date);
    const diffMs = current.getTime() - prev.getTime();
    restDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }
  const isBackToBack = restDays <= 1;

  // ── Home/Away Factor ───────────────────────────────────────────────────
  const homeAwayFactor = schedule.is_home ? HOME_ADVANTAGE : AWAY_DISADVANTAGE;

  return {
    ok: true,
    data: {
      pace_factor: paceFactor,
      projected_game_total: projectedGameTotal,
      pace_environment_adjustment: paceEnvironmentAdjustment,
      rest_days: restDays,
      is_back_to_back: isBackToBack,
      home_away_factor: round4(homeAwayFactor),
      team_id,
      opponent_team_id,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
