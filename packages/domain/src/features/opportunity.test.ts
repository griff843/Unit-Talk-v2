import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractOpportunityFeatures } from './opportunity.js';
import type { PlayerFormFeatures } from './player-form.js';
import type { RoleLog } from './opportunity.js';

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

function makeRole(overrides: Partial<RoleLog> & { game_date: string }): RoleLog {
  return {
    started: true,
    minutes: 30,
    usage_rate: 0.25,
    ...overrides,
  };
}

describe('extractOpportunityFeatures', () => {
  it('returns ok:false when insufficient role logs', () => {
    const result = extractOpportunityFeatures(
      [makeRole({ game_date: '2026-01-01' })],
      baseForm,
    );
    assert.equal(result.ok, false);
  });

  it('computes starter probability', () => {
    const logs = [
      makeRole({ game_date: '2026-01-03', started: true }),
      makeRole({ game_date: '2026-01-02', started: false }),
      makeRole({ game_date: '2026-01-01', started: true }),
    ];
    const result = extractOpportunityFeatures(logs, baseForm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(
      Math.abs(result.data.starter_probability - 0.6667) < 0.01,
      `Expected ~0.667, got ${result.data.starter_probability}`,
    );
  });

  it('computes opportunity_projection as minutes × usage', () => {
    const logs = [
      makeRole({ game_date: '2026-01-03' }),
      makeRole({ game_date: '2026-01-02' }),
      makeRole({ game_date: '2026-01-01' }),
    ];
    const result = extractOpportunityFeatures(logs, baseForm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.opportunity_projection > 0);
  });

  it('role_stability is in [0, 1]', () => {
    const logs = [
      makeRole({ game_date: '2026-01-03', minutes: 32 }),
      makeRole({ game_date: '2026-01-02', minutes: 28 }),
      makeRole({ game_date: '2026-01-01', minutes: 30 }),
    ];
    const result = extractOpportunityFeatures(logs, baseForm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.role_stability >= 0 && result.data.role_stability <= 1);
  });

  it('detects role change with significant minutes shift', () => {
    const logs = [
      makeRole({ game_date: '2026-01-04', minutes: 35 }),
      makeRole({ game_date: '2026-01-03', minutes: 34 }),
      makeRole({ game_date: '2026-01-02', minutes: 15 }),
      makeRole({ game_date: '2026-01-01', minutes: 14 }),
    ];
    const result = extractOpportunityFeatures(logs, baseForm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.role_change_detected, true);
  });
});
