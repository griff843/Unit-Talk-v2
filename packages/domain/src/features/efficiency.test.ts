import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractEfficiencyFeatures } from './efficiency.js';
import type { PlayerFormFeatures } from './player-form.js';
import type { OpponentDefenseInput } from './efficiency.js';

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

const baseDefense: OpponentDefenseInput = {
  opponent: { stat_allowed_per_game: 25, games_sampled: 20 },
  league: { stat_per_game: 24, stat_allowed_std: 3 },
  opponent_team_id: 'opp-1',
  stat_allowed_rank: 15,
};

describe('extractEfficiencyFeatures', () => {
  it('returns ok:false for insufficient opponent data', () => {
    const defense = { ...baseDefense, opponent: { stat_allowed_per_game: 25, games_sampled: 1 } };
    const result = extractEfficiencyFeatures(baseForm, defense);
    assert.equal(result.ok, false);
  });

  it('returns ok:false for invalid league average', () => {
    const defense = { ...baseDefense, league: { stat_per_game: 0, stat_allowed_std: 3 } };
    const result = extractEfficiencyFeatures(baseForm, defense);
    assert.equal(result.ok, false);
  });

  it('computes opponent defensive adjustment as ratio', () => {
    const result = extractEfficiencyFeatures(baseForm, baseDefense);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // 25/24 ≈ 1.0417
    assert.ok(Math.abs(result.data.opponent_defensive_adjustment - 1.0417) < 0.001);
  });

  it('clamps pace adjustment to [0.5, 1.5]', () => {
    const result = extractEfficiencyFeatures(baseForm, baseDefense, 2.0);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.pace_adjustment, 1.5);
  });

  it('efficiency = skill × defense × pace', () => {
    const result = extractEfficiencyFeatures(baseForm, baseDefense, 1.0);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const expected = baseForm.stat_per_opportunity * (25 / 24) * 1.0;
    assert.ok(Math.abs(result.data.efficiency_projection - Math.round(expected * 10000) / 10000) < 0.001);
  });

  it('matchup_volatility increases for extreme defenses', () => {
    const easyDefense: OpponentDefenseInput = {
      ...baseDefense,
      opponent: { stat_allowed_per_game: 30, games_sampled: 20 },
    };
    const result = extractEfficiencyFeatures(baseForm, easyDefense);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.matchup_volatility > 0);
  });
});
