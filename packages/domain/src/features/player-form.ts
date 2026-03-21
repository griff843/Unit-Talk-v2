/**
 * Player Form Feature Extractor
 *
 * Extracts player form indicators classified into:
 *   - Opportunity features (minutes projection, usage trends)
 *   - Efficiency features (stat-per-opportunity, production rates)
 *   - Variance features (volatility, consistency)
 *
 * NO market inputs. Pure player/team/stat data only.
 */

// ── Input Types ──────────────────────────────────────────────────────────────

export interface GameLog {
  game_date: string;
  minutes: number;
  stat_value: number;
  /** Usage rate if available (0-1 fraction of team possessions used) */
  usage_rate?: number;
  started: boolean;
}

// ── Output Contract ──────────────────────────────────────────────────────────

export interface PlayerFormFeatures {
  // Opportunity
  minutes_avg: number;
  minutes_trend: number;
  minutes_projection: number;
  minutes_uncertainty: number;

  // Efficiency
  stat_per_minute: number;
  stat_per_opportunity: number;
  stat_trend: number;

  // Variance
  player_base_volatility: number;
  consistency_score: number;

  // Metadata
  games_sampled: number;
  window_size: number;
}

export type PlayerFormResult =
  | { ok: true; data: PlayerFormFeatures }
  | { ok: false; reason: string };

// ── Configuration ────────────────────────────────────────────────────────────

export interface PlayerFormConfig {
  /** Number of recent games to sample (default: 10) */
  window_size?: number;
  /** Minimum games required to produce features (default: 3) */
  min_games?: number;
}

const DEFAULT_WINDOW = 10;
const DEFAULT_MIN_GAMES = 3;

// ── Core Computation ─────────────────────────────────────────────────────────

/**
 * Extract player form features from recent game logs.
 *
 * Game logs must be sorted most-recent-first. The function takes the
 * most recent `window_size` games and computes rolling averages,
 * trends, and variance components.
 */
export function extractPlayerFormFeatures(
  gameLogs: GameLog[],
  config: PlayerFormConfig = {},
): PlayerFormResult {
  const windowSize = config.window_size ?? DEFAULT_WINDOW;
  const minGames = config.min_games ?? DEFAULT_MIN_GAMES;

  // Sort by date descending (most recent first), take window
  const sorted = [...gameLogs]
    .sort((a, b) => b.game_date.localeCompare(a.game_date))
    .slice(0, windowSize);

  if (sorted.length < minGames) {
    return {
      ok: false,
      reason: `Insufficient games: ${sorted.length} < ${minGames} minimum`,
    };
  }

  const n = sorted.length;
  const minutes = sorted.map((g) => g.minutes);
  const stats = sorted.map((g) => g.stat_value);
  const usageRates = sorted
    .map((g) => g.usage_rate)
    .filter((u): u is number => u != null);

  // ── Opportunity Features ─────────────────────────────────────────────────

  const minutesAvg = mean(minutes);
  const minutesTrend = computeTrend(minutes);
  // Project minutes: average + half the trend slope (conservative)
  const minutesProjection = Math.max(
    0,
    minutesAvg + minutesTrend * (minutesAvg * 0.5),
  );
  const minutesUncertainty = variance(minutes);

  // ── Efficiency Features ──────────────────────────────────────────────────

  // Stat per minute: total stats / total minutes (avoids low-minute distortion)
  const totalMinutes = sum(minutes);
  const totalStats = sum(stats);
  const statPerMinute = totalMinutes > 0 ? totalStats / totalMinutes : 0;

  // Stat per opportunity: if usage data available, use it; otherwise fall back to per-minute
  let statPerOpportunity: number;
  if (usageRates.length >= minGames) {
    // Weighted: stats per (minutes × usage_rate)
    const opportunities = sorted
      .filter((g) => g.usage_rate != null)
      .map((g) => g.minutes * g.usage_rate!);
    const totalOpp = sum(opportunities);
    const statWithOpp = sorted
      .filter((g) => g.usage_rate != null)
      .map((g) => g.stat_value);
    statPerOpportunity =
      totalOpp > 0 ? sum(statWithOpp) / totalOpp : statPerMinute;
  } else {
    statPerOpportunity = statPerMinute;
  }

  const statTrend = computeTrend(stats);

  // ── Variance Features ────────────────────────────────────────────────────

  const playerBaseVolatility = variance(stats);
  const statMean = mean(stats);
  const statStd = Math.sqrt(playerBaseVolatility);
  // Consistency = inverse coefficient of variation (higher = more consistent)
  // Bounded [0, 1]: 1 when perfectly consistent, approaches 0 when volatile
  const cv = statMean > 0 ? statStd / statMean : Infinity;
  const consistencyScore =
    cv === Infinity ? 0 : Math.max(0, Math.min(1, 1 / (1 + cv)));

  return {
    ok: true,
    data: {
      minutes_avg: round4(minutesAvg),
      minutes_trend: round4(minutesTrend),
      minutes_projection: round4(minutesProjection),
      minutes_uncertainty: round4(minutesUncertainty),
      stat_per_minute: round4(statPerMinute),
      stat_per_opportunity: round4(statPerOpportunity),
      stat_trend: round4(statTrend),
      player_base_volatility: round4(playerBaseVolatility),
      consistency_score: round4(consistencyScore),
      games_sampled: n,
      window_size: windowSize,
    },
  };
}

// ── Math Utilities ───────────────────────────────────────────────────────────

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : sum(arr) / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

/**
 * Compute linear trend as normalized slope in [-1, +1].
 *
 * Array is ordered most-recent-first. We reverse for regression so index 0 = oldest.
 * Positive slope = increasing trend.
 * Normalized by dividing by mean to make cross-stat comparable.
 */
function computeTrend(values: number[]): number {
  if (values.length < 2) return 0;

  // Reverse so index 0 = oldest game
  const v = [...values].reverse();
  const n = v.length;
  const m = mean(v);
  if (m === 0) return 0;

  // Simple linear regression: slope of y = a + bx
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (v[i]! - m);
    den += (i - xMean) ** 2;
  }
  if (den === 0) return 0;

  const slope = num / den;
  // Normalize: slope relative to mean, clamped to [-1, +1]
  const normalized = slope / Math.abs(m);
  return Math.max(-1, Math.min(1, normalized));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
