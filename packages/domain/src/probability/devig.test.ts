import assert from 'node:assert/strict';
import test from 'node:test';

import {
  americanToImplied,
  applyDevig,
  calculateBookWeight,
  calculateCLVProb,
  calculateEdge,
  calculateOverround,
  computeConsensus,
  MIN_BOOKS_FOR_CONSENSUS,
  powerDevig,
  proportionalDevig,
  roundTo,
  type BookOffer
} from './devig.js';

function makeBook(
  id: string,
  overOdds: number,
  underOdds: number,
  profile: BookOffer['bookProfile'] = 'sharp',
  liquidity: BookOffer['liquidityTier'] = 'high',
  quality: BookOffer['dataQuality'] = 'good'
): BookOffer {
  return {
    bookId: id,
    bookName: id,
    overOdds,
    underOdds,
    bookProfile: profile,
    liquidityTier: liquidity,
    dataQuality: quality
  };
}

test('americanToImplied converts negative odds deterministically', () => {
  assert.equal(americanToImplied(-110), 0.52381);
});

test('americanToImplied converts positive odds deterministically', () => {
  assert.equal(americanToImplied(110), 0.47619);
});

test('calculateOverround returns expected symmetric vig', () => {
  assert.equal(calculateOverround(0.52381, 0.52381), 1.04762);
});

test('proportionalDevig returns fair probabilities summing to one', () => {
  const result = proportionalDevig(0.52381, 0.52381);
  assert.ok(result);
  assert.equal(roundTo(result.overFair + result.underFair, 6), 1);
  assert.equal(result.overFair, 0.5);
});

test('powerDevig with k=1 matches proportionalDevig', () => {
  const proportional = proportionalDevig(0.52381, 0.52381);
  const power = powerDevig(0.52381, 0.52381, 1);
  assert.ok(proportional && power);
  assert.equal(power.overFair, proportional.overFair);
  assert.equal(power.underFair, proportional.underFair);
});

test('applyDevig returns non-null for supported methods', () => {
  assert.ok(applyDevig(0.52381, 0.52381, 'proportional'));
  assert.ok(applyDevig(0.52381, 0.52381, 'power'));
  assert.ok(applyDevig(0.52381, 0.52381, 'shin'));
  assert.ok(applyDevig(0.52381, 0.52381, 'logit'));
});

test('calculateBookWeight favors sharp high-liquidity books', () => {
  const sharp = calculateBookWeight('sharp', 'high', 'good');
  const retail = calculateBookWeight('retail', 'low', 'suspect');
  assert.equal(sharp.rawWeight, 2.25);
  assert.equal(retail.rawWeight, 0.15);
  assert.ok(sharp.rawWeight > retail.rawWeight);
});

test('computeConsensus fails closed with fewer than minimum books', () => {
  const result = computeConsensus([makeBook('one', -110, -110)]);
  assert.equal(MIN_BOOKS_FOR_CONSENSUS, 2);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'INSUFFICIENT_BOOKS');
  }
});

test('computeConsensus returns deterministic weighted result for mixed books', () => {
  const offers = [
    makeBook('pinnacle', -120, 100, 'sharp', 'high', 'good'),
    makeBook('fanduel', -115, 105, 'market_maker', 'high', 'good'),
    makeBook('betmgm', -110, -110, 'retail', 'medium', 'good')
  ];
  const result = computeConsensus(offers);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.booksUsed, 3);
    assert.ok(
      Math.abs(roundTo(result.overConsensus + result.underConsensus, 6) - 1) <=
        0.000001
    );
    const pinnacle = result.consensusWeights.pinnacle;
    const betmgm = result.consensusWeights.betmgm;
    assert.ok(pinnacle);
    assert.ok(betmgm);
    assert.ok(
      pinnacle.normalizedWeight > betmgm.normalizedWeight
    );
  }
});

test('computeConsensus is order-independent for the same offers', () => {
  const offersA = [
    makeBook('pinnacle', -115, 105, 'sharp', 'high', 'good'),
    makeBook('fanduel', -110, -110, 'market_maker', 'high', 'good')
  ];
  const offersB = [...offersA].reverse();
  const resultA = computeConsensus(offersA);
  const resultB = computeConsensus(offersB);
  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  if (resultA.ok && resultB.ok) {
    assert.equal(resultA.overConsensus, resultB.overConsensus);
    assert.equal(resultA.underConsensus, resultB.underConsensus);
  }
});

test('calculateEdge returns expected edge and EV', () => {
  const result = calculateEdge(0.55, 0.5, 2);
  assert.equal(result.edge, 0.05);
  assert.equal(result.ev, 0.1);
  assert.equal(result.evPercent, 10);
});

test('calculateCLVProb returns closing minus entry probability', () => {
  assert.equal(calculateCLVProb(0.52, 0.56), 0.04);
});
