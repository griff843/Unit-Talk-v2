import assert from 'node:assert/strict';
import test from 'node:test';

import { computeUniquenessScore, computeUniquenessWithMeta } from './uniqueness.js';

// ── computeUniquenessScore (backward-compat number return) ────────────────

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

// ── computeUniquenessWithMeta (explicit fallback reason + dimensions) ─────

test('computeUniquenessWithMeta returns fallback reason when no open-picks data', () => {
  const result = computeUniquenessWithMeta({});
  assert.equal(result.score, 50);
  assert.equal(result.fallbackReason, 'no-open-picks-data');
  assert.equal(result.dimensions, null);
});

test('computeUniquenessWithMeta returns real dimensions when data available', () => {
  const result = computeUniquenessWithMeta({ activeSameSportMarketCount: 3 });
  assert.equal(result.score, 70);
  assert.equal(result.fallbackReason, undefined);
  assert.ok(result.dimensions !== null);
  assert.equal(result.dimensions.sameSportMarketCount, 3);
  assert.equal(result.dimensions.selectionOverlapCount, 0);
});

test('computeUniquenessWithMeta applies selection overlap penalty', () => {
  const noOverlap = computeUniquenessWithMeta({ activeSameSportMarketCount: 2 });
  const withOverlap = computeUniquenessWithMeta({
    activeSameSportMarketCount: 2,
    activeSelectionOverlapCount: 2,
  });
  // Selection overlap of 2 reduces score by min(2*15, 30) = 30
  assert.equal(noOverlap.score - withOverlap.score, 30);
  assert.equal(withOverlap.dimensions?.selectionOverlapCount, 2);
});

test('computeUniquenessWithMeta selection overlap is capped at 30 penalty', () => {
  const result = computeUniquenessWithMeta({
    activeSameSportMarketCount: 0,
    activeSelectionOverlapCount: 5,
  });
  // 100 - min(5*15, 30) = 100 - 30 = 70
  assert.equal(result.score, 70);
});

test('computeUniquenessWithMeta score cannot go below 0', () => {
  const result = computeUniquenessWithMeta({
    activeSameSportMarketCount: 10,
    activeSelectionOverlapCount: 5,
  });
  // (100 - 80) - 30 = -10 → clamped to 0
  assert.equal(result.score, 0);
});
