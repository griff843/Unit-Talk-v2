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
  /** Provenance: player identifier for traceability. UTV2-1208. */
  player_id?: string;
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
  /**
   * How usage_rate_projection was derived. INIT-3.1.3 — explicit provenance,
   * no silent imputation.
   *
   * 'direct'     — computed from observed usage_rate data (≥ min_games samples)
   * 'snap_share' — fallback: minutes ÷ team_minutes when usage_rate unavailable
   */
  usage_rate_source: 'direct' | 'snap_share';
  /** Number of games with direct usage_rate observations (vs snap_share proxy). */
  usage_rates_sampled: number;
  /**
   * True when usage_rate_projection was derived from snap_share proxy (not direct
   * observation). Callers must not treat snap_share-derived usage as equivalent
   * to direct usage — flag for suppression or manual review. UTV2-1208.
   */
  snap_share_suppressed: boolean;
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
  /**
   * ISO date string used as the reference point for staleness checks.
   * Role logs with game_date older than reference_date - max_age_hours are filtered.
   * Requires max_age_hours to be set; both must be present to activate the guard.
   */
  reference_date?: string;
  /**
   * Maximum age in hours a role log may be relative to reference_date.
   * If all logs are filtered by this guard, the function fails closed.
   */
  max_age_hours?: number;
}

const DEFAULT_WINDOW = 10;
const DEFAULT_MIN_GAMES = 3;
const DEFAULT_TEAM_MINUTES = 240; // NBA 5 players × 48 min

// ── Mock Fixture ─────────────────────────────────────────────────────────────

/**
 * Canonical mock fixture for role_logs tests. UTV2-1208.
 * All entries use direct usage_rate observations for a single mock player.
 */
export const MOCK_FIXTURE: RoleLog[] = [
  { game_date: '2026-01-10', started: true,  minutes: 32, usage_rate: 0.28, player_id: 'mock-player-1' },
  { game_date: '2026-01-08', started: true,  minutes: 30, usage_rate: 0.25, player_id: 'mock-player-1' },
  { game_date: '2026-01-06', started: false, minutes: 22, usage_rate: 0.18, player_id: 'mock-player-1' },
  { game_date: '2026-01-04', started: true,  minutes: 31, usage_rate: 0.27, player_id: 'mock-player-1' },
  { game_date: '2026-01-02', started: true,  minutes: 28, usage_rate: 0.24, player_id: 'mock-player-1' },
];

/**
 * Snap-share mock fixture for testing snap_share provenance path.
 * All entries have null usage_rate — forces snap_share fallback. UTV2-1208.
 */
export const MOCK_FIXTURE_SNAP_SHARE: RoleLog[] = [
  { game_date: '2026-01-10', started: true,  minutes: 32, usage_rate: null, player_id: 'mock-player-2' },
  { game_date: '2026-01-08', started: true,  minutes: 30, usage_rate: null, player_id: 'mock-player-2' },
  { game_date: '2026-01-06', started: false, minutes: 22, usage_rate: null, player_id: 'mock-player-2' },
];

// ── Core Computation ─────────────────────────────────────────────────────────

/**
 * Extract opportunity features from role logs and player form features.
 *
 * minutes_projection comes from PlayerFormFeatures.
 * Role stability and usage projections come from role logs.
 *
 * Fail-closed: returns ok:false when insufficient logs, when the staleness
 * guard filters all logs, or when insufficient logs remain after filtering.
 */
export function extractOpportunityFeatures(
  roleLogs: RoleLog[],
  playerForm: PlayerFormFeatures,
  config: OpportunityConfig = {},
): OpportunityResult {
  const windowSize = config.window_size ?? DEFAULT_WINDOW;
  const minGames = config.min_games ?? DEFAULT_MIN_GAMES;
  const teamMinutes = config.default_team_minutes ?? DEFAULT_TEAM_MINUTES;

  // ── Staleness Guard ────────────────────────────────────────────────────────
  // Fail-closed: logs older than reference_date - max_age_hours are stale.
  // If both reference_date and max_age_hours are provided, apply the guard.
  let filtered = roleLogs;
  if (config.reference_date !== undefined && config.max_age_hours !== undefined) {
    const cutoffMs =
      new Date(config.reference_date).getTime() - config.max_age_hours * 3_600_000;
    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
    filtered = roleLogs.filter((g) => g.game_date >= cutoffDate);
    if (filtered.length === 0) {
      return {
        ok: false,
        reason: `All role logs filtered by staleness guard (reference_date=${config.reference_date}, max_age_hours=${config.max_age_hours})`,
      };
    }
  }

  const sorted = [...filtered]
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

  // INIT-3.1.3: explicit provenance — no silent imputation.
  // 'direct' when we have enough usage_rate observations; 'snap_share' (fallback)
  // when we do not, using minutes ÷ team_minutes as a documented proxy.
  let usageRateProjection: number;
  let usageRateSource: 'direct' | 'snap_share';
  if (usageRates.length >= minGames) {
    usageRateProjection = mean(usageRates);
    usageRateSource = 'direct';
  } else {
    // Documented fallback: snap share = minutes / team_minutes.
    // Caller can inspect usage_rate_source === 'snap_share' to detect this path.
    const snapShares = sorted.map(
      (g) => g.minutes / (g.team_minutes ?? teamMinutes),
    );
    usageRateProjection = mean(snapShares);
    usageRateSource = 'snap_share';
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
      usage_rate_source: usageRateSource,
      usage_rates_sampled: usageRates.length,
      snap_share_suppressed: usageRateSource === 'snap_share',
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
