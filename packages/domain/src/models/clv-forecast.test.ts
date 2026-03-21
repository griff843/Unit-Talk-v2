import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeCLVForecastV2 } from './clv-forecast.js';

describe('computeCLVForecastV2', () => {
  it('computes CLV forecast with correct component weights', () => {
    const result = computeCLVForecastV2(0.1, 0.2, 0.3, 1, 0.1);
    // 0.5*0.1 + 0.2*0.2 + 0.15*0.3*1 + 0.15*(1-0.1)
    // = 0.05 + 0.04 + 0.045 + 0.135 = 0.27
    assert.ok(Math.abs(result.clv_forecast - 0.27) < 0.001);
  });

  it('clamps result to [-1, +1]', () => {
    const result = computeCLVForecastV2(3, 1, 1, 1, 0);
    assert.equal(result.clv_forecast, 1);
  });

  it('negative edge produces negative CLV', () => {
    const result = computeCLVForecastV2(-0.5, 0, 0, 0, 1);
    assert.ok(result.clv_forecast < 0);
  });

  it('returns component breakdown', () => {
    const result = computeCLVForecastV2(0.1, 0.2, 0.3, 1, 0.1);
    assert.equal(result.components.edge_component, 0.05);
    assert.ok(Math.abs(result.components.movement_component - 0.04) < 0.001);
    assert.ok(Math.abs(result.components.sharp_component - 0.045) < 0.001);
  });
});
