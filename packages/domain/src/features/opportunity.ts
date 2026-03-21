/**
 * Opportunity Feature Extractor
 *
 * Generates opportunity projection features:
 *   - minutes_projection
 *   - starter_probability
 *   - usage_rate_projection
 *   - role_stability / role_uncertainty
 *
 * Consumes PlayerFormFeatures and role context signals.
 * NO market inputs allowed.
 */

import type { PlayerFormFeatures } from './player-form.js';

// ── Input Types ──────────────────────────────────────────────────────────────

export interface RoleLog {
  game_date: string;
  started: boolean;
  minutes: number;
  usage_rate: number | null;
  /** Team total minutes available per game (e.g. 240 for NBA) */
  team_minutes?: number;
}

// ── Output Contract ──────────────────────────────────────────────────────────

export interface OpportunityFeatures {
  // Core opportunity projection
  minutes_projection: number;
  starter_probability: number;
  usage_rate_projection: number;

  // Role context
  role_stability: number;
  role_uncertainty: number;
  role_change_detected: boolean;

  // Combined opportunity score (minutes × usage)
  opportunity_projection: number;

  // Metadata
  games_sampled: number;
}

export type OpportunityResult =
  | { ok: true; data: OpportunityFeatures }
  | { ok: false; reason: string };

// ── Configuration ────────────────────────────────────────────────────────────

export interface OpportunityConfig {
  window_size?: number;
  min_games?: number;
  /** Default team minutes per game (NBA=240, NFL=varies) */
  default_team_minutes?: number;
}

const DEFAULT_WINDOW = 10;
const DEFAULT_MIN_GAMES = 3;
const DEFAULT_TEAM_MINUTES = 240; // NBA 5 players × 48 min

// ── Core Computation ─────────────────────────────────────────────────────────

/**
 * Extract opportunity features from role logs and player form features.
 *
 * minutes_projection comes from PlayerFormFeatures.
 * Role stability and usage projections come from role logs.
 */
export function extractOpportunityFeatures(
  roleLogs: RoleLog[],
  playerForm: PlayerFormFeatures,
  config: OpportunityConfig = {},
): OpportunityResult {
  const windowSize = config.window_size ?? DEFAULT_WINDOW;
  const minGames = config.min_games ?? DEFAULT_MIN_GAMES;
  const teamMinutes = config.default_team_minutes ?? DEFAULT_TEAM_MINUTES;

  const sorted = [...roleLogs]
    .sort((a, b) => b.game_date.localeCompare(a.game_date))
    .slice(0, windowSize);

  if (sorted.length < minGames) {
    return {
      ok: false,
      reason: `Insufficient role logs: ${sorted.length} < ${minGames} minimum`,
    };
  }

  const n = sorted.length;

  // ── Starter Probability ────────────────────────────────────────────────
  const startsCount = sorted.filter((g) => g.started).length;
  const starterProbability = startsCount / n;

  // ── Usage Rate Projection ──────────────────────────────────────────────
  const usageRates = sorted
    .map((g) => g.usage_rate)
    .filter((u): u is number => u != null);

  let usageRateProjection: number;
  if (usageRates.length >= minGames) {
    usageRateProjection = mean(usageRates);
  } else {
    // Fall back to snap share (minutes / team_minutes)
    const snapShares = sorted.map(
      (g) => g.minutes / (g.team_minutes ?? teamMinutes),
    );
    usageRateProjection = mean(snapShares);
  }

  // ── Role Stability ─────────────────────────────────────────────────────
  const minutesCv = coefficientOfVariation(sorted.map((g) => g.minutes));
  const startConsistency =
    Math.min(starterProbability, 1 - starterProbability) * 2;
  const startStability = 1 - startConsistency;

  const minutesStability = 1 / (1 + minutesCv);
  const roleStability = round4(
    0.6 * minutesStability + 0.4 * startStability,
  );

  // ── Role Change Detection ──────────────────────────────────────────────
  const roleChangeDetected = detectRoleChange(sorted);

  // ── Role Uncertainty (variance contribution) ───────────────────────────
  const roleUncertainty = round4(
    playerForm.minutes_uncertainty * (1 - roleStability),
  );

  // ── Combined Opportunity Projection ────────────────────────────────────
  const opportunityProjection = round4(
    playerForm.minutes_projection * usageRateProjection,
  );

  return {
    ok: true,
    data: {
      minutes_projection: playerForm.minutes_projection,
      starter_probability: round4(starterProbability),
      usage_rate_projection: round4(usageRateProjection),
      role_stability: roleStability,
      role_uncertainty: roleUncertainty,
      role_change_detected: roleChangeDetected,
      opportunity_projection: opportunityProjection,
      games_sampled: n,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect role change: compare first half vs second half of window.
 * If minutes differ by > 30% of mean, flag as change.
 */
function detectRoleChange(sorted: RoleLog[]): boolean {
  if (sorted.length < 4) return false;

  const mid = Math.floor(sorted.length / 2);
  const recentMinutes = sorted.slice(0, mid).map((g) => g.minutes);
  const olderMinutes = sorted.slice(mid).map((g) => g.minutes);

  const recentMean = mean(recentMinutes);
  const olderMean = mean(olderMinutes);
  const overallMean = mean(sorted.map((g) => g.minutes));

  if (overallMean === 0) return false;
  const relativeDelta = Math.abs(recentMean - olderMean) / overallMean;
  return relativeDelta > 0.3;
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function coefficientOfVariation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  if (m === 0) return 0;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v) / Math.abs(m);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
