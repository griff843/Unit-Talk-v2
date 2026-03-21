import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeSignalQuality } from './signal-quality.js';
import type { BlendOutput } from '../models/stat-market-blend.js';
import type { StatContext } from './signal-quality.js';

const baseBlend: BlendOutput = {
  p_final: 0.55,
  p_stat: 0.58,
  p_market: 0.50,
  stat_weight: 0.3,
  market_weight: 0.7,
  stat_alpha: 0.08,
  divergence: 0.08,
  divergence_direction: 1,
  edge_vs_market: 0.05,
  blend_version: 'stat-market-blend-v1.0',
};

const baseStat: StatContext = {
  expected_value: 22,
  variance: 16,
  line: 20.5,
  confidence: 0.65,
};

describe('computeSignalQuality', () => {
  it('returns ok:false for non-positive variance', () => {
    const result = computeSignalQuality(baseBlend, { ...baseStat, variance: 0 });
    assert.equal(result.ok, false);
  });

  it('returns ok:false for invalid confidence', () => {
    const result = computeSignalQuality(baseBlend, { ...baseStat, confidence: 1.5 });
    assert.equal(result.ok, false);
  });

  it('returns ok:false for invalid p_final', () => {
    const result = computeSignalQuality({ ...baseBlend, p_final: 0 }, baseStat);
    assert.equal(result.ok, false);
  });

  it('returns ok:false for invalid kelly_fraction', () => {
    const result = computeSignalQuality(baseBlend, baseStat, { kelly_fraction: -1 });
    assert.equal(result.ok, false);
  });

  it('computes edge as p_final - p_market', () => {
    const result = computeSignalQuality(baseBlend, baseStat);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const expected = Math.round((baseBlend.p_final - baseBlend.p_market) * 10000) / 10000;
    assert.equal(result.data.edge, expected);
  });

  it('z_score = (expected_value - line) / sigma', () => {
    const result = computeSignalQuality(baseBlend, baseStat);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const sigma = Math.sqrt(baseStat.variance);
    const expected = Math.round(((baseStat.expected_value - baseStat.line) / sigma) * 10000) / 10000;
    assert.equal(result.data.z_score, expected);
  });

  it('recommended_bet_size is 0 when edge < min_edge', () => {
    const lowEdgeBlend = { ...baseBlend, p_final: 0.51, p_market: 0.50 };
    const result = computeSignalQuality(lowEdgeBlend, baseStat);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.recommended_bet_size, 0);
  });

  it('recommended_bet_size is bounded by max_bet_size', () => {
    const result = computeSignalQuality(baseBlend, baseStat, { max_bet_size: 0.01 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.recommended_bet_size <= 0.01);
  });

  it('signal_quality_score is in [0, 1]', () => {
    const result = computeSignalQuality(baseBlend, baseStat);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.signal_quality_score >= 0 && result.data.signal_quality_score <= 1);
  });
});
