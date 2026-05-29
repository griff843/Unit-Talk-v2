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

  // ── INIT-3.1.3: Imputation Removal — explicit provenance tests ────────────

  it('INIT-3.1.3: usage_rate_source is "direct" when sufficient usage_rate data', () => {
    const logs = [
      makeRole({ game_date: '2026-01-03', usage_rate: 0.3 }),
      makeRole({ game_date: '2026-01-02', usage_rate: 0.25 }),
      makeRole({ game_date: '2026-01-01', usage_rate: 0.28 }),
    ];
    const result = extractOpportunityFeatures(logs, baseForm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.usage_rate_source, 'direct');
    assert.equal(result.data.usage_rates_sampled, 3);
  });

  it('INIT-3.1.3: usage_rate_source is "snap_share" when usage_rate data insufficient', () => {
    // Fewer than minGames (3) games have usage_rate — fallback path is documented
    const logs = [
      makeRole({ game_date: '2026-01-03', usage_rate: 0.3 }), // only 1 direct
      makeRole({ game_date: '2026-01-02', usage_rate: null }),
      makeRole({ game_date: '2026-01-01', usage_rate: null }),
    ];
    const result = extractOpportunityFeatures(logs, baseForm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Fallback is now explicit — caller can detect and handle
    assert.equal(result.data.usage_rate_source, 'snap_share');
    assert.equal(result.data.usage_rates_sampled, 1);
  });

  it('INIT-3.1.3: snap_share fallback is replay-safe — same inputs produce same source', () => {
    const logs = [
      makeRole({ game_date: '2026-01-03', usage_rate: null }),
      makeRole({ game_date: '2026-01-02', usage_rate: null }),
      makeRole({ game_date: '2026-01-01', usage_rate: null }),
    ];
    const r1 = extractOpportunityFeatures(logs, baseForm);
    const r2 = extractOpportunityFeatures(logs, baseForm);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    // Deterministic: same inputs → same source, same projection
    assert.equal(r1.data.usage_rate_source, r2.data.usage_rate_source);
    assert.equal(r1.data.usage_rate_projection, r2.data.usage_rate_projection);
    assert.equal(r1.data.usage_rates_sampled, r2.data.usage_rates_sampled);
  });

  it('INIT-3.1.3: usage_rates_sampled counts only direct observations', () => {
    const logs = [
      makeRole({ game_date: '2026-01-04', usage_rate: 0.28 }),
      makeRole({ game_date: '2026-01-03', usage_rate: 0.25 }),
      makeRole({ game_date: '2026-01-02', usage_rate: null }),
      makeRole({ game_date: '2026-01-01', usage_rate: null }),
    ];
    const result = extractOpportunityFeatures(logs, baseForm);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Only 2 direct usage_rate observations, below default min_games=3
    assert.equal(result.data.usage_rates_sampled, 2);
    assert.equal(result.data.usage_rate_source, 'snap_share');
  });

  it('INIT-3.1.3: feature vector provenance is deterministic from same inputs', () => {
    const logs = Array.from({ length: 5 }, (_, i) =>
      makeRole({ game_date: `2026-01-0${5 - i}`, usage_rate: 0.25 }),
    );
    const r1 = extractOpportunityFeatures(logs, baseForm);
    const r2 = extractOpportunityFeatures([...logs].reverse(), baseForm);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    // Sorted internally by date — order-independent, deterministic
    assert.equal(r1.data.usage_rate_source, r2.data.usage_rate_source);
    assert.equal(r1.data.usage_rates_sampled, r2.data.usage_rates_sampled);
    assert.equal(r1.data.usage_rate_projection, r2.data.usage_rate_projection);
  });
});
