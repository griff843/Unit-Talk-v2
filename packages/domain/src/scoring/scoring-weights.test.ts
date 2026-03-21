import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateWeightsV2, CORE_WEIGHT_KEYS, ENHANCED_FEATURE_KEYS, TIME_WEIGHT_KEYS } from './types.js';
import { NBA_WEIGHTS, NBA_CONFIG } from './nba.js';
import { MLB_WEIGHTS, MLB_CONFIG } from './mlb.js';
import { NFL_WEIGHTS, NFL_CONFIG } from './nfl.js';
import { NHL_WEIGHTS, NHL_CONFIG } from './nhl.js';

describe('weight key lists', () => {
  it('CORE_WEIGHT_KEYS has 30 keys', () => {
    assert.equal(CORE_WEIGHT_KEYS.length, 30);
  });

  it('ENHANCED_FEATURE_KEYS has 6 keys', () => {
    assert.equal(ENHANCED_FEATURE_KEYS.length, 6);
  });

  it('TIME_WEIGHT_KEYS has 5 keys', () => {
    assert.equal(TIME_WEIGHT_KEYS.length, 5);
  });
});

describe('validateWeightsV2', () => {
  it('NBA weights are valid', () => {
    const result = validateWeightsV2(NBA_WEIGHTS);
    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
    assert.ok(result.total > 0);
  });

  it('MLB weights are valid', () => {
    const result = validateWeightsV2(MLB_WEIGHTS);
    assert.equal(result.valid, true);
    assert.ok(result.total > 0);
  });

  it('NFL weights are valid', () => {
    const result = validateWeightsV2(NFL_WEIGHTS);
    assert.equal(result.valid, true);
    assert.ok(result.total > 0);
  });

  it('NHL weights are valid', () => {
    const result = validateWeightsV2(NHL_WEIGHTS);
    assert.equal(result.valid, true);
    assert.ok(result.total > 0);
  });

  it('all weights are non-negative', () => {
    for (const weights of [NBA_WEIGHTS, MLB_WEIGHTS, NFL_WEIGHTS, NHL_WEIGHTS]) {
      const result = validateWeightsV2(weights);
      assert.equal(result.valid, true, `${weights.sport} has invalid weights: ${result.issues.join(', ')}`);
    }
  });
});

describe('sport configs', () => {
  it('NBA config has all components', () => {
    assert.ok(NBA_CONFIG.weights);
    assert.ok(NBA_CONFIG.tiers);
    assert.ok(NBA_CONFIG.risk);
    assert.equal(NBA_CONFIG.weights.sport, 'NBA');
  });

  it('MLB config has all components', () => {
    assert.ok(MLB_CONFIG.weights);
    assert.ok(MLB_CONFIG.tiers);
    assert.ok(MLB_CONFIG.risk);
    assert.equal(MLB_CONFIG.weights.sport, 'MLB');
  });

  it('NFL config has all components', () => {
    assert.ok(NFL_CONFIG.weights);
    assert.ok(NFL_CONFIG.tiers);
    assert.ok(NFL_CONFIG.risk);
    assert.equal(NFL_CONFIG.weights.sport, 'NFL');
  });

  it('NHL config has all components', () => {
    assert.ok(NHL_CONFIG.weights);
    assert.ok(NHL_CONFIG.tiers);
    assert.ok(NHL_CONFIG.risk);
    assert.equal(NHL_CONFIG.weights.sport, 'NHL');
  });

  it('tier thresholds are progressively ordered', () => {
    for (const config of [NBA_CONFIG, MLB_CONFIG, NFL_CONFIG, NHL_CONFIG]) {
      assert.ok(config.tiers.S_TIER.minScore > config.tiers.A_TIER.minScore);
      assert.ok(config.tiers.A_TIER.minScore > config.tiers.B_TIER.minScore);
      assert.ok(config.tiers.B_TIER.minScore > config.tiers.C_TIER.minScore);
    }
  });

  it('risk configs have positive limits', () => {
    for (const config of [NBA_CONFIG, MLB_CONFIG, NFL_CONFIG, NHL_CONFIG]) {
      assert.ok(config.risk.maxPositionSize > 0);
      assert.ok(config.risk.kellyMultiplier > 0);
      assert.ok(config.risk.maxDrawdown > 0);
    }
  });
});
