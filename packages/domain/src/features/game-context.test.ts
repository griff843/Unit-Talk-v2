import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractGameContextFeatures } from './game-context.js';
import type { GameContextInput } from './game-context.js';

function makeInput(overrides: Partial<GameContextInput> = {}): GameContextInput {
  return {
    pace: {
      team_pace: 100,
      opponent_pace: 100,
      league_avg_pace: 100,
      team_off_rating: 110,
      opponent_def_rating: 105,
      league_avg_ppg: 220,
    },
    schedule: {
      game_date: '2026-01-05',
      prev_game_date: '2026-01-03',
      is_home: true,
    },
    team_id: 'team-a',
    opponent_team_id: 'team-b',
    ...overrides,
  };
}

describe('extractGameContextFeatures', () => {
  it('returns ok:false for invalid league averages', () => {
    const input = makeInput({
      pace: { ...makeInput().pace, league_avg_pace: 0 },
    });
    const result = extractGameContextFeatures(input);
    assert.equal(result.ok, false);
  });

  it('computes pace_factor relative to league average', () => {
    const input = makeInput({
      pace: { ...makeInput().pace, team_pace: 105, opponent_pace: 95 },
    });
    const result = extractGameContextFeatures(input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.pace_factor, 1.0);
  });

  it('home team gets home advantage factor', () => {
    const result = extractGameContextFeatures(makeInput({ schedule: { game_date: '2026-01-05', prev_game_date: null, is_home: true } }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.home_away_factor, 1.012);
  });

  it('away team gets away disadvantage factor', () => {
    const result = extractGameContextFeatures(makeInput({ schedule: { game_date: '2026-01-05', prev_game_date: null, is_home: false } }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.home_away_factor, 0.988);
  });

  it('computes rest days correctly', () => {
    const result = extractGameContextFeatures(makeInput({
      schedule: { game_date: '2026-01-05', prev_game_date: '2026-01-03', is_home: true },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.rest_days, 2);
    assert.equal(result.data.is_back_to_back, false);
  });

  it('detects back-to-back', () => {
    const result = extractGameContextFeatures(makeInput({
      schedule: { game_date: '2026-01-05', prev_game_date: '2026-01-04', is_home: true },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.rest_days, 1);
    assert.equal(result.data.is_back_to_back, true);
  });

  it('defaults rest_days to 2 when prev_game_date is null', () => {
    const result = extractGameContextFeatures(makeInput({
      schedule: { game_date: '2026-01-05', prev_game_date: null, is_home: true },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.rest_days, 2);
  });
});
