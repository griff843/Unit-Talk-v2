import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initialBandAssignment } from './assignment.js';
import { applyBandDowngrades } from './downgrade.js';
import {
  compareBands,
  lowerBand,
  downgradeOneStep,
  THRESHOLD_VERSION,
} from './thresholds.js';
import type { BandInput } from './types.js';

function makeInput(overrides: Partial<BandInput> = {}): BandInput {
  return {
    edge: 0.10,
    uncertainty: 0.05,
    clvForecast: 0.10,
    liquidityTier: 'high',
    selectionDecision: 'select',
    selectionScore: 90,
    ...overrides,
  };
}

describe('compareBands', () => {
  it('returns negative when a is higher tier', () => {
    assert.ok(compareBands('A+', 'B') < 0);
  });

  it('returns positive when a is lower tier', () => {
    assert.ok(compareBands('C', 'A') > 0);
  });

  it('returns 0 for same band', () => {
    assert.equal(compareBands('B', 'B'), 0);
  });
});

describe('lowerBand', () => {
  it('returns the lower of two bands', () => {
    assert.equal(lowerBand('A+', 'B'), 'B');
    assert.equal(lowerBand('C', 'A'), 'C');
  });
});

describe('downgradeOneStep', () => {
  it('downgrades A+ to A', () => {
    assert.equal(downgradeOneStep('A+'), 'A');
  });

  it('downgrades C to SUPPRESS', () => {
    assert.equal(downgradeOneStep('C'), 'SUPPRESS');
  });

  it('SUPPRESS stays SUPPRESS', () => {
    assert.equal(downgradeOneStep('SUPPRESS'), 'SUPPRESS');
  });
});

describe('initialBandAssignment', () => {
  it('assigns A+ for high edge and high score', () => {
    const result = initialBandAssignment(makeInput({ edge: 0.10, selectionScore: 90 }));
    assert.equal(result.band, 'A+');
    assert.equal(result.thresholdVersion, THRESHOLD_VERSION);
  });

  it('assigns A for moderate edge', () => {
    const result = initialBandAssignment(makeInput({ edge: 0.06, selectionScore: 75 }));
    assert.equal(result.band, 'A');
  });

  it('assigns B for lower edge', () => {
    const result = initialBandAssignment(makeInput({ edge: 0.04, selectionScore: 55 }));
    assert.equal(result.band, 'B');
  });

  it('assigns C for marginal edge with no score requirement', () => {
    const result = initialBandAssignment(makeInput({ edge: 0.02, selectionScore: null }));
    assert.equal(result.band, 'C');
  });

  it('suppresses when selection is not select', () => {
    const result = initialBandAssignment(makeInput({ selectionDecision: 'hold' }));
    assert.equal(result.band, 'SUPPRESS');
  });

  it('suppresses when edge is below all thresholds', () => {
    const result = initialBandAssignment(makeInput({ edge: 0.005 }));
    assert.equal(result.band, 'SUPPRESS');
  });

  it('score threshold blocks A+ without sufficient score', () => {
    const result = initialBandAssignment(makeInput({ edge: 0.10, selectionScore: 60 }));
    // Edge qualifies for A+ but score < 85, so falls through to A (score 60 < 70 too), then B (60 >= 50)
    assert.equal(result.band, 'B');
  });
});

describe('applyBandDowngrades', () => {
  it('returns unchanged for low-risk input', () => {
    const result = applyBandDowngrades(makeInput(), 'A+');
    assert.equal(result.finalBand, 'A+');
    assert.equal(result.initialBand, 'A+');
    assert.equal(result.downgradeReasons.length, 0);
    assert.equal(result.suppressionReasons.length, 0);
  });

  it('already-SUPPRESS passes through', () => {
    const result = applyBandDowngrades(makeInput(), 'SUPPRESS');
    assert.equal(result.finalBand, 'SUPPRESS');
    assert.deepEqual(result.suppressionReasons, ['initial_assignment_suppressed']);
  });

  it('high uncertainty downgrades', () => {
    const result = applyBandDowngrades(makeInput({ uncertainty: 0.12 }), 'A+');
    assert.equal(result.finalBand, 'A');
    assert.ok(result.downgradeReasons.length > 0);
  });

  it('extreme uncertainty suppresses', () => {
    const result = applyBandDowngrades(makeInput({ uncertainty: 0.50 }), 'A+');
    assert.equal(result.finalBand, 'SUPPRESS');
    assert.ok(result.suppressionReasons.length > 0);
  });

  it('negative CLV downgrades', () => {
    const result = applyBandDowngrades(makeInput({ clvForecast: -0.08 }), 'A');
    assert.equal(result.finalBand, 'B');
  });

  it('strongly negative CLV suppresses', () => {
    const result = applyBandDowngrades(makeInput({ clvForecast: -0.20 }), 'A');
    assert.equal(result.finalBand, 'SUPPRESS');
  });

  it('low liquidity caps band', () => {
    const result = applyBandDowngrades(makeInput({ liquidityTier: 'low' }), 'A+');
    assert.equal(result.finalBand, 'B');
  });

  it('unknown liquidity caps band at C', () => {
    const result = applyBandDowngrades(makeInput({ liquidityTier: 'unknown' }), 'A+');
    assert.equal(result.finalBand, 'C');
  });

  it('high market resistance downgrades', () => {
    const result = applyBandDowngrades(makeInput({ marketResistance: 0.75 }), 'A');
    assert.equal(result.finalBand, 'B');
  });

  it('extreme market resistance suppresses', () => {
    const result = applyBandDowngrades(makeInput({ marketResistance: 0.95 }), 'A');
    assert.equal(result.finalBand, 'SUPPRESS');
  });

  it('risk reject suppresses', () => {
    const result = applyBandDowngrades(makeInput({ riskDecision: 'reject' }), 'A+');
    assert.equal(result.finalBand, 'SUPPRESS');
  });

  it('risk reduce downgrades', () => {
    const result = applyBandDowngrades(makeInput({ riskDecision: 'reduce' }), 'A');
    assert.equal(result.finalBand, 'B');
  });
});
