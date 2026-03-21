/**
 * Stat Distribution Engine
 *
 * Core pipeline:
 *   features → opportunity × efficiency → expected_value → variance → distribution → p_over/p_under
 *
 * Invariants:
 *   1. expected_stat = opportunity_projection × efficiency_projection
 *   2. variance = player_volatility + minutes_uncertainty + role_uncertainty + matchup_variance
 *   3. NO market inputs — line is comparison target only, never a model feature
 *   4. Fail-closed on insufficient data
 */

import { createHash } from 'node:crypto';

import type { EfficiencyFeatures } from '../features/efficiency.js';
import type { OpportunityFeatures } from '../features/opportunity.js';
import type { PlayerFormFeatures } from '../features/player-form.js';

// ── Output Contract ──────────────────────────────────────────────────────────

export interface StatProjectionOutput {
  player_id: string;
  stat_type: string;

  // Pipeline components
  opportunity_projection: number;
  efficiency_projection: number;

  // Core projection
  expected_value: number;
  variance: number;
  distribution_type: 'normal' | 'poisson';
  params_json: Record<string, number>;

  // Probabilities (vs line)
  p_over: number;
  p_under: number;

  // Uncertainty
  confidence: number;

  // Reproducibility
  feature_vector_hash: string;
  feature_set_version: string;
}

export type StatProjectionResult =
  | { ok: true; data: StatProjectionOutput }
  | { ok: false; reason: string };

// ── Input Aggregation ────────────────────────────────────────────────────────

export interface ProjectionInput {
  player_id: string;
  stat_type: string;
  line: number;

  playerForm: PlayerFormFeatures;
  opportunity: OpportunityFeatures;
  efficiency: EfficiencyFeatures;

  /** Distribution override (default: auto-select based on stat_type) */
  distribution_type?: 'normal' | 'poisson';
}

// ── Distribution Type Selection ──────────────────────────────────────────────

const POISSON_STAT_TYPES = new Set([
  'three_pointers_made',
  'blocks',
  'steals',
  'turnovers',
  'home_runs',
  'goals',
]);

function selectDistributionType(
  statType: string,
  override?: 'normal' | 'poisson',
): 'normal' | 'poisson' {
  if (override) return override;
  return POISSON_STAT_TYPES.has(statType) ? 'poisson' : 'normal';
}

// ── Core Engine ──────────────────────────────────────────────────────────────

export const FEATURE_SET_VERSION = 'stat-proj-v2.0';

/**
 * Compute stat projection from feature extractors.
 *
 * Pipeline:
 *   1. expected_stat = opportunity_projection × efficiency_projection
 *   2. variance = 4-component non-constant model
 *   3. Fit distribution (Normal or Poisson)
 *   4. Derive p_over / p_under vs line
 */
export function computeStatProjection(
  input: ProjectionInput,
): StatProjectionResult {
  const { player_id, stat_type, line, playerForm, opportunity, efficiency } =
    input;

  // ── Validate inputs ────────────────────────────────────────────────────
  if (opportunity.opportunity_projection <= 0) {
    return { ok: false, reason: 'Opportunity projection must be positive' };
  }
  if (efficiency.efficiency_projection <= 0) {
    return { ok: false, reason: 'Efficiency projection must be positive' };
  }
  if (line < 0) {
    return { ok: false, reason: 'Line must be non-negative' };
  }

  // ── Step 1: Expected Value ─────────────────────────────────────────────
  const expectedValue = round4(
    opportunity.opportunity_projection * efficiency.efficiency_projection,
  );

  // ── Step 2: Non-Constant Variance ──────────────────────────────────────
  const playerVolatility = playerForm.player_base_volatility;
  const minutesUncertainty = playerForm.minutes_uncertainty;
  const roleUncertainty = opportunity.role_uncertainty;
  const matchupVariance = efficiency.matchup_variance;

  const totalVariance = round4(
    playerVolatility + minutesUncertainty + roleUncertainty + matchupVariance,
  );

  // ── Step 3: Distribution Fitting ───────────────────────────────────────
  const distType = selectDistributionType(stat_type, input.distribution_type);

  let params_json: Record<string, number>;
  let pOver: number;
  let pUnder: number;

  if (distType === 'normal') {
    const mu = expectedValue;
    const sigma = Math.sqrt(Math.max(totalVariance, 0.0001));
    params_json = { mu: round4(mu), sigma: round4(sigma) };
    const z = (line - mu) / sigma;
    pUnder = normalCDF(z);
    pOver = 1 - pUnder;
  } else {
    const lambda = Math.max(expectedValue, 0.01);
    params_json = { lambda: round4(lambda) };
    const floorLine = Math.floor(line);
    pUnder = poissonCDF(floorLine, lambda);
    pOver = 1 - pUnder;
  }

  pOver = round4(clamp(pOver, 0.001, 0.999));
  pUnder = round4(clamp(pUnder, 0.001, 0.999));

  // ── Step 4: Uncertainty Score ──────────────────────────────────────────
  const cv =
    expectedValue > 0 ? Math.sqrt(totalVariance) / expectedValue : 1;
  const confidence = round4(clamp(1 / (1 + cv), 0, 1));

  // ── Step 5: Feature Vector Hash ────────────────────────────────────────
  const featureVector = buildFeatureVector(input);
  const featureVectorHash = hashFeatureVector(featureVector);

  return {
    ok: true,
    data: {
      player_id,
      stat_type,
      opportunity_projection: round4(opportunity.opportunity_projection),
      efficiency_projection: round4(efficiency.efficiency_projection),
      expected_value: expectedValue,
      variance: totalVariance,
      distribution_type: distType,
      params_json,
      p_over: pOver,
      p_under: pUnder,
      confidence,
      feature_vector_hash: featureVectorHash,
      feature_set_version: FEATURE_SET_VERSION,
    },
  };
}

// ── Distribution Math ────────────────────────────────────────────────────────

/**
 * Standard normal CDF using Abramowitz & Stegun approximation.
 * Accurate to ~1.5e-7.
 */
export function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1.0 / (1.0 + 0.2316419 * z);
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
  const p =
    d *
    Math.exp(-0.5 * z * z) *
    (t *
      (0.31938153 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));

  return sign === 1 ? 1 - p : p;
}

/**
 * Poisson CDF: P(X <= k) for X ~ Poi(lambda).
 * Uses direct summation (sufficient for typical stat ranges k < 100).
 */
export function poissonCDF(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return 1;

  let sum = 0;
  let term = Math.exp(-lambda); // P(X=0)
  sum += term;

  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    sum += term;
    if (sum >= 1) return 1;
  }

  return Math.min(sum, 1);
}

// ── Feature Vector Hashing ───────────────────────────────────────────────────

function buildFeatureVector(
  input: ProjectionInput,
): Record<string, number> {
  return {
    minutes_projection: input.opportunity.minutes_projection,
    usage_rate_projection: input.opportunity.usage_rate_projection,
    starter_probability: input.opportunity.starter_probability,
    role_stability: input.opportunity.role_stability,
    opportunity_projection: input.opportunity.opportunity_projection,
    stat_per_minute: input.playerForm.stat_per_minute,
    stat_per_opportunity: input.playerForm.stat_per_opportunity,
    player_base_volatility: input.playerForm.player_base_volatility,
    minutes_uncertainty: input.playerForm.minutes_uncertainty,
    opponent_defensive_adjustment:
      input.efficiency.opponent_defensive_adjustment,
    pace_adjustment: input.efficiency.pace_adjustment,
    efficiency_projection: input.efficiency.efficiency_projection,
    matchup_variance: input.efficiency.matchup_variance,
    role_uncertainty: input.opportunity.role_uncertainty,
  };
}

function hashFeatureVector(vector: Record<string, number>): string {
  const sorted = Object.entries(vector)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('|');

  return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
