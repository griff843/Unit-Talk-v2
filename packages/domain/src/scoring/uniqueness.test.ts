import assert from 'node:assert/strict';
import test from 'node:test';

import { computeUniquenessScore } from './uniqueness.js';

test('computeUniquenessScore returns 50 when market count is undefined', () => {
  assert.equal(computeUniquenessScore({}), 50);
});

test('computeUniquenessScore returns 100 when count is 0', () => {
  assert.equal(computeUniquenessScore({ activeSameSportMarketCount: 0 }), 100);
});

test('computeUniquenessScore returns 50 when count is 5', () => {
  assert.equal(computeUniquenessScore({ activeSameSportMarketCount: 5 }), 50);
});

test('computeUniquenessScore returns 20 when count is 10 or higher', () => {
  assert.equal(computeUniquenessScore({ activeSameSportMarketCount: 10 }), 20);
  assert.equal(computeUniquenessScore({ activeSameSportMarketCount: 12 }), 20);
});

test('computeUniquenessScore caps deviation bonus at 40', () => {
  const baseScore = computeUniquenessScore({ activeSameSportMarketCount: 10 });
  const boostedScore = computeUniquenessScore({
    activeSameSportMarketCount: 10,
    lineDeviationPoints: 3,
  });

  assert.equal(boostedScore - baseScore, 40);
});

test('computeUniquenessScore combines saturation and deviation bonus', () => {
  assert.equal(
    computeUniquenessScore({ activeSameSportMarketCount: 5, lineDeviationPoints: 2 }),
    90,
  );
});

test('computeUniquenessScore caps combined total at 100', () => {
  assert.equal(
    computeUniquenessScore({ activeSameSportMarketCount: 0, lineDeviationPoints: 3 }),
    100,
  );
});
