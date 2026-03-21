import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeCLVForecast,
  computeConfidenceFactor,
  computeDynamicCap,
  computePFinal,
  computeProbabilityLayer,
  computeUncertainty,
  type ProbabilityInput
} from './probability-layer.js';
import type { BookOffer } from './devig.js';

function createBookOffers(count: number): BookOffer[] {
  const books: Array<{
    id: string;
    profile: BookOffer['bookProfile'];
    liquidity: BookOffer['liquidityTier'];
  }> = [
    { id: 'pinnacle', profile: 'sharp', liquidity: 'high' },
    { id: 'fanduel', profile: 'market_maker', liquidity: 'high' },
    { id: 'draftkings', profile: 'market_maker', liquidity: 'high' },
    { id: 'betmgm', profile: 'retail', liquidity: 'medium' }
  ];

  return books.slice(0, count).map(book => ({
    bookId: book.id,
    bookName: book.id,
    overOdds: -110,
    underOdds: -110,
    bookProfile: book.profile,
    liquidityTier: book.liquidity,
    dataQuality: 'good'
  }));
}

function createInput(overrides: Partial<ProbabilityInput> = {}): ProbabilityInput {
  return {
    confidenceScore: 5,
    bookOffers: createBookOffers(3),
    side: 'over',
    entryOdds: -110,
    sport: 'NBA',
    marketType: 'points',
    hoursToStart: null,
    featureCompleteness: 0.8,
    ...overrides
  };
}

test('computeUncertainty returns zero-ish for strong inputs', () => {
  const result = computeUncertainty({
    booksAvailable: 3,
    bookSpread: 0,
    dataQualityScore: 1,
    hoursToStart: 0,
    historicalAccuracy: null,
    featureCompleteness: 1
  });
  assert.equal(result, 0);
});

test('computeConfidenceFactor increases with more books and lower spread', () => {
  const weaker = computeConfidenceFactor(2, 0.05, 0.5);
  const stronger = computeConfidenceFactor(5, 0.01, 0.9);
  assert.ok(stronger > weaker);
});

test('computeDynamicCap stays within hard bounds', () => {
  const low = computeDynamicCap(1, 0.1);
  const high = computeDynamicCap(10, 0);
  assert.ok(low.cap >= 0.01);
  assert.ok(high.cap <= 0.06);
});

test('computePFinal stays anchored to market at neutral confidence', () => {
  const result = computePFinal(5, 0.55, 0.1, 0.8, 0.04);
  assert.equal(result.pFinal, 0.55);
  assert.equal(result.adjustmentRaw, 0);
});

test('computePFinal clips into closed interval when extreme', () => {
  const low = computePFinal(0, 0.005, 0, 1, 0.04);
  const high = computePFinal(10, 0.995, 0, 1, 0.04);
  assert.equal(low.pFinal, 0.01);
  assert.equal(high.pFinal, 0.99);
});

test('computeCLVForecast is positive for positive edge and high-CLV markets', () => {
  const result = computeCLVForecast(0.04, 'points', 12);
  assert.ok(result > 0);
});

test('computeProbabilityLayer fails closed for insufficient books', () => {
  const result = computeProbabilityLayer(createInput({ bookOffers: createBookOffers(1) }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'INSUFFICIENT_BOOKS');
  }
});

test('computeProbabilityLayer fails closed for invalid numeric input', () => {
  const result = computeProbabilityLayer(createInput({ confidenceScore: Number.NaN }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'INVALID_INPUT');
  }
});

test('computeProbabilityLayer returns deterministic explanation payload', () => {
  const result = computeProbabilityLayer(createInput({ confidenceScore: 7 }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.explain.p_final, result.pFinal);
    assert.equal(result.explain.edge_final, result.edgeFinal);
    assert.equal(result.booksUsed, 3);
    assert.ok(result.explain.cap_value > 0);
  }
});
