import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeStatMarketBlend } from './stat-market-blend.js';
import type { StatProjectionOutput } from './stat-distribution.js';

function makeProjection(overrides: Partial<StatProjectionOutput> = {}): StatProjectionOutput {
  return {
    player_id: 'p1',
    stat_type: 'points',
    opportunity_projection: 8,
    efficiency_projection: 2.5,
    expected_value: 20,
    variance: 14,
    distribution_type: 'normal',
    params_json: { mu: 20, sigma: 3.74 },
    p_over: 0.55,
    p_under: 0.45,
    confidence: 0.6,
    feature_vector_hash: 'abc123',
    feature_set_version: 'stat-proj-v2.0',
    ...overrides,
  };
}

describe('computeStatMarketBlend', () => {
  it('returns ok:false for invalid p_market_devig', () => {
    const result = computeStatMarketBlend(makeProjection(), 0);
    assert.equal(result.ok, false);
  });

  it('blends stat and market probabilities', () => {
    const result = computeStatMarketBlend(makeProjection(), 0.5);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.p_final > 0 && result.data.p_final < 1);
  });

  it('stat_weight adjusts with confidence', () => {
    const lowConf = computeStatMarketBlend(makeProjection({ confidence: 0.2 }), 0.5);
    const highConf = computeStatMarketBlend(makeProjection({ confidence: 0.9 }), 0.5);
    assert.equal(lowConf.ok, true);
    assert.equal(highConf.ok, true);
    if (!lowConf.ok || !highConf.ok) return;
    assert.ok(highConf.data.stat_weight > lowConf.data.stat_weight);
  });

  it('uses sport-specific defaults when provided', () => {
    const result = computeStatMarketBlend(makeProjection(), 0.5, { sport: 'nhl' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.sport, 'nhl');
  });

  it('divergence = |p_stat - p_market|', () => {
    const result = computeStatMarketBlend(makeProjection({ p_over: 0.6 }), 0.5);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(Math.abs(result.data.divergence - 0.1) < 0.001);
  });

  it('edge_vs_market = p_final - p_market', () => {
    const result = computeStatMarketBlend(makeProjection(), 0.5);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const expected = result.data.p_final - result.data.p_market;
    assert.ok(Math.abs(result.data.edge_vs_market - Math.round(expected * 10000) / 10000) < 0.001);
  });
});
