import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeModelBlend } from './model-blend.js';

describe('computeModelBlend', () => {
  it('blends with correct weights (60/30/10)', () => {
    const result = computeModelBlend(0.5, 0.5, 0, 0);
    // 0.6*0.5 + 0.3*0.5 + 0.1*0 = 0.45
    assert.ok(Math.abs(result.p_final_v2 - 0.45) < 0.001);
  });

  it('clamps signal adjustment to [-0.05, +0.05]', () => {
    const result = computeModelBlend(0.5, 0.5, 1.0, 0);
    assert.equal(result.signal_adjustment, 0.05);
  });

  it('applies disagreement penalty', () => {
    const result = computeModelBlend(0.5, 0.5, 0, 0.5);
    // disagreement_penalty = -0.5 * 0.5 = -0.25
    // signal_raw = 0 + (-0.25) = -0.25, clamped to -0.05
    assert.equal(result.signal_adjustment, -0.05);
  });

  it('edge_v2 = p_final_v2 - p_market_devig', () => {
    const result = computeModelBlend(0.5, 0.6, 0, 0);
    const expectedEdge = result.p_final_v2 - 0.5;
    assert.ok(Math.abs(result.edge_v2 - expectedEdge) < 0.0001);
  });

  it('is pure — same inputs produce same output', () => {
    const r1 = computeModelBlend(0.5, 0.55, 0.1, 0.02);
    const r2 = computeModelBlend(0.5, 0.55, 0.1, 0.02);
    assert.deepEqual(r1, r2);
  });
});
