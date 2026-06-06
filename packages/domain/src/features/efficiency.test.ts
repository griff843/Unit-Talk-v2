import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractEfficiencyFeatures,
  MOCK_DEFENSE_FIXTURE as MOCK_FIXTURE,
  MOCK_DEFENSE_FIXTURE_STALE as MOCK_FIXTURE_STALE,
  MOCK_DEFENSE_FIXTURE_NO_DATE as MOCK_FIXTURE_NO_DATE,
} from './efficiency.js';
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

  it('clamps pace adjustment to [0.5, 1.3] (UTV2-1214: cap lowered from 1.5)', () => {
    const result = extractEfficiencyFeatures(baseForm, baseDefense, 2.0);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.pace_adjustment, 1.3);
    assert.equal(result.data.high_pace_flag, true);
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

  // ── UTV2-1209: Mock fixtures, max-age guard ───────────────────────────────

  it('UTV2-1209: MOCK_FIXTURE produces a valid result', () => {
    const result = extractEfficiencyFeatures(baseForm, MOCK_FIXTURE);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.efficiency_projection > 0);
    assert.equal(result.data.opponent_team_id, 'mock-team-1');
  });

  it('UTV2-1209: MOCK_FIXTURE has rating_date and stat_category', () => {
    assert.ok(MOCK_FIXTURE.opponent.rating_date !== undefined);
    assert.ok(MOCK_FIXTURE.stat_category !== undefined);
  });

  it('UTV2-1209: max-age guard fails closed for stale rating', () => {
    const result = extractEfficiencyFeatures(baseForm, MOCK_FIXTURE_STALE, 1.0, {
      reference_date: '2026-01-10',
      max_age_days: 7,  // 7-day window — 2025-06-01 is far outside
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.reason.includes('stale'),
      `Expected stale reason, got: ${result.reason}`,
    );
  });

  it('UTV2-1209: max-age guard fails closed when rating_date is absent', () => {
    const result = extractEfficiencyFeatures(baseForm, MOCK_FIXTURE_NO_DATE, 1.0, {
      reference_date: '2026-01-10',
      max_age_days: 7,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.reason.includes('no rating_date'),
      `Expected missing date reason, got: ${result.reason}`,
    );
  });

  it('UTV2-1209: max-age guard passes for fresh rating within window', () => {
    const result = extractEfficiencyFeatures(baseForm, MOCK_FIXTURE, 1.0, {
      reference_date: '2026-01-10',
      max_age_days: 7,  // 2026-01-08 is 2 days before reference — within 7d window
    });
    assert.equal(result.ok, true);
  });

  it('UTV2-1209: max-age guard is a no-op without reference_date', () => {
    // Stale fixture passes through when guard is not configured
    const result = extractEfficiencyFeatures(baseForm, MOCK_FIXTURE_STALE);
    assert.equal(result.ok, true);
  });

  it('UTV2-1209: max-age guard is a no-op without max_age_days', () => {
    // Guard requires both fields — partial config is treated as inactive
    const result = extractEfficiencyFeatures(baseForm, MOCK_FIXTURE_STALE, 1.0, {
      reference_date: '2026-01-10',
      // max_age_days absent — guard inactive
    });
    assert.equal(result.ok, true);
  });

  it('UTV2-1209: stat_category field enables multi-stat defensive keying', () => {
    // stat_category is optional but present on MOCK_FIXTURE — verify no effect on output
    const withCategory = { ...baseDefense, stat_category: 'rebounds' };
    const withoutCategory = { ...baseDefense };
    const r1 = extractEfficiencyFeatures(baseForm, withCategory);
    const r2 = extractEfficiencyFeatures(baseForm, withoutCategory);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    // stat_category doesn't affect computation — same output
    assert.equal(r1.data.efficiency_projection, r2.data.efficiency_projection);
  });

  it('UTV2-1209: max-age guard reason includes reference_date and max_age_days', () => {
    const result = extractEfficiencyFeatures(baseForm, MOCK_FIXTURE_STALE, 1.0, {
      reference_date: '2026-01-10',
      max_age_days: 7,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.reason.includes('2026-01-10'), `Missing reference_date in: ${result.reason}`);
    assert.ok(result.reason.includes('7'), `Missing max_age_days in: ${result.reason}`);
  });
});
