import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStatProjection,
  normalCDF,
  poissonCDF,
  FEATURE_SET_VERSION,
} from './stat-distribution.js';
import type { ProjectionInput } from './stat-distribution.js';
import type { PlayerFormFeatures } from '../features/player-form.js';
import type { OpportunityFeatures } from '../features/opportunity.js';
import type { EfficiencyFeatures } from '../features/efficiency.js';

const baseForm: PlayerFormFeatures = {
  minutes_avg: 30,
  minutes_trend: 0.1,
  minutes_projection: 31,
  minutes_uncertainty: 4,
  stat_per_minute: 0.7,
  stat_per_opportunity: 2.5,
  stat_trend: 0.05,
  player_base_volatility: 9,
  consistency_score: 0.65,
  games_sampled: 10,
  window_size: 10,
};

const baseOpportunity: OpportunityFeatures = {
  minutes_projection: 31,
  starter_probability: 0.8,
  usage_rate_projection: 0.25,
  role_stability: 0.85,
  role_uncertainty: 0.6,
  role_change_detected: false,
  opportunity_projection: 7.75,
  games_sampled: 10,
};

const baseEfficiency: EfficiencyFeatures = {
  player_skill_rate: 2.5,
  opponent_defensive_adjustment: 1.05,
  pace_adjustment: 1.0,
  efficiency_projection: 2.625,
  matchup_volatility: 0.15,
  matchup_variance: 0.675,
  opponent_team_id: 'opp-1',
  stat_allowed_rank: 10,
};

function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    player_id: 'player-1',
    stat_type: 'points',
    line: 20.5,
    playerForm: baseForm,
    opportunity: baseOpportunity,
    efficiency: baseEfficiency,
    ...overrides,
  };
}

describe('computeStatProjection', () => {
  it('returns ok:false for non-positive opportunity', () => {
    const result = computeStatProjection(makeInput({
      opportunity: { ...baseOpportunity, opportunity_projection: 0 },
    }));
    assert.equal(result.ok, false);
  });

  it('returns ok:false for negative line', () => {
    const result = computeStatProjection(makeInput({ line: -1 }));
    assert.equal(result.ok, false);
  });

  it('computes expected_value = opportunity × efficiency', () => {
    const result = computeStatProjection(makeInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const expected = Math.round(7.75 * 2.625 * 10000) / 10000;
    assert.equal(result.data.expected_value, expected);
  });

  it('p_over + p_under ≈ 1 (within rounding)', () => {
    const result = computeStatProjection(makeInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const sum = result.data.p_over + result.data.p_under;
    assert.ok(Math.abs(sum - 1) < 0.01);
  });

  it('selects poisson for three_pointers_made', () => {
    const result = computeStatProjection(makeInput({ stat_type: 'three_pointers_made' }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.distribution_type, 'poisson');
  });

  it('selects normal for points', () => {
    const result = computeStatProjection(makeInput({ stat_type: 'points' }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.distribution_type, 'normal');
  });

  it('produces deterministic feature_vector_hash', () => {
    const r1 = computeStatProjection(makeInput());
    const r2 = computeStatProjection(makeInput());
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    assert.equal(r1.data.feature_vector_hash, r2.data.feature_vector_hash);
  });

  it('includes FEATURE_SET_VERSION', () => {
    const result = computeStatProjection(makeInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.feature_set_version, FEATURE_SET_VERSION);
  });
});

describe('normalCDF', () => {
  it('returns 0.5 at z=0', () => {
    assert.ok(Math.abs(normalCDF(0) - 0.5) < 0.001);
  });

  it('returns ~0.8413 at z=1', () => {
    assert.ok(Math.abs(normalCDF(1) - 0.8413) < 0.001);
  });

  it('returns ~0 for very negative z', () => {
    assert.equal(normalCDF(-10), 0);
  });

  it('returns ~1 for very positive z', () => {
    assert.equal(normalCDF(10), 1);
  });
});

describe('poissonCDF', () => {
  it('returns P(X<=0) = e^(-lambda)', () => {
    const result = poissonCDF(0, 3);
    assert.ok(Math.abs(result - Math.exp(-3)) < 0.001);
  });

  it('returns 1 for very large k', () => {
    assert.equal(poissonCDF(100, 5), 1);
  });

  it('returns 0 for negative k', () => {
    assert.equal(poissonCDF(-1, 5), 0);
  });
});
