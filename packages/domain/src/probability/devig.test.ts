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
  logitDevig,
  MIN_BOOKS_FOR_CONSENSUS,
  powerDevig,
  proportionalDevig,
  roundTo,
  shinDevig,
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

test('powerDevig with explicit k=1 matches proportionalDevig', () => {
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

// ---------------------------------------------------------------------------
// Real devig method tests — UTV2-225
// ---------------------------------------------------------------------------

test('shinDevig returns fair probabilities summing to 1', () => {
  const result = shinDevig(0.52381, 0.52381);
  assert.ok(result);
  assert.ok(
    Math.abs(result.overFair + result.underFair - 1) < 0.0001,
    `sum = ${result.overFair + result.underFair}`
  );
});

test('shinDevig produces different output than proportional on asymmetric market', () => {
  // Heavy favorite: -200 / +170 → implied ~0.6667 / ~0.3704
  const overImp = americanToImplied(-200);
  const underImp = americanToImplied(170);
  const prop = proportionalDevig(overImp, underImp);
  const shin = shinDevig(overImp, underImp);
  assert.ok(prop && shin);
  // Shin must differ from proportional
  assert.notEqual(shin.overFair, prop.overFair, 'Shin should differ from proportional');
  assert.notEqual(shin.underFair, prop.underFair, 'Shin should differ from proportional');
  // Both must sum to 1
  assert.ok(Math.abs(shin.overFair + shin.underFair - 1) < 0.0001);
});

test('powerDevig (solved k) returns fair probabilities summing to 1', () => {
  const result = powerDevig(0.52381, 0.52381);
  assert.ok(result);
  assert.ok(
    Math.abs(result.overFair + result.underFair - 1) < 0.0001,
    `sum = ${result.overFair + result.underFair}`
  );
});

test('powerDevig (solved k) produces different output than proportional on asymmetric market', () => {
  const overImp = americanToImplied(-200);
  const underImp = americanToImplied(170);
  const prop = proportionalDevig(overImp, underImp);
  const power = powerDevig(overImp, underImp); // no explicit k — solves
  assert.ok(prop && power);
  assert.notEqual(power.overFair, prop.overFair, 'Power should differ from proportional');
});

test('powerDevig with explicit k=1 matches proportionalDevig (backward compat)', () => {
  const proportional = proportionalDevig(0.52381, 0.52381);
  const power = powerDevig(0.52381, 0.52381, 1);
  assert.ok(proportional && power);
  assert.equal(power.overFair, proportional.overFair);
  assert.equal(power.underFair, proportional.underFair);
});

test('logitDevig returns fair probabilities summing to 1', () => {
  const result = logitDevig(0.52381, 0.52381);
  assert.ok(result);
  assert.ok(
    Math.abs(result.overFair + result.underFair - 1) < 0.0001,
    `sum = ${result.overFair + result.underFair}`
  );
});

test('logitDevig produces different output than proportional on asymmetric market', () => {
  const overImp = americanToImplied(-200);
  const underImp = americanToImplied(170);
  const prop = proportionalDevig(overImp, underImp);
  const logit = logitDevig(overImp, underImp);
  assert.ok(prop && logit);
  assert.notEqual(logit.overFair, prop.overFair, 'Logit should differ from proportional');
});

test('all four methods produce distinct outputs on -200/+170 spread', () => {
  const overImp = americanToImplied(-200);
  const underImp = americanToImplied(170);

  const prop = applyDevig(overImp, underImp, 'proportional');
  const shin = applyDevig(overImp, underImp, 'shin');
  const power = applyDevig(overImp, underImp, 'power');
  const logit = applyDevig(overImp, underImp, 'logit');

  assert.ok(prop && shin && power && logit);

  // All sum to ~1
  for (const r of [prop, shin, power, logit]) {
    assert.ok(
      Math.abs(r.overFair + r.underFair - 1) < 0.001,
      `sum = ${r.overFair + r.underFair}`
    );
  }

  // All four overFair values must be distinct
  const overFairs = [prop.overFair, shin.overFair, power.overFair, logit.overFair];
  const unique = new Set(overFairs);
  assert.equal(
    unique.size,
    4,
    `Expected 4 distinct overFair values, got ${unique.size}: ${JSON.stringify(overFairs)}`
  );
});

test('all methods produce valid results on symmetric -110/-110 spread', () => {
  const imp = americanToImplied(-110);
  for (const method of ['proportional', 'shin', 'power', 'logit'] as const) {
    const result = applyDevig(imp, imp, method);
    assert.ok(result, `${method} returned null`);
    // Symmetric input must produce symmetric fair probs (both 0.5)
    assert.ok(
      Math.abs(result.overFair - 0.5) < 0.001,
      `${method} overFair=${result.overFair}, expected ~0.5`
    );
    assert.ok(
      Math.abs(result.underFair - 0.5) < 0.001,
      `${method} underFair=${result.underFair}, expected ~0.5`
    );
  }
});

test('all methods produce valid results on heavy 3-leg-style asymmetry', () => {
  // Simulating a very lopsided 2-way: -500 / +400
  const overImp = americanToImplied(-500);
  const underImp = americanToImplied(400);

  for (const method of ['proportional', 'shin', 'power', 'logit'] as const) {
    const result = applyDevig(overImp, underImp, method);
    assert.ok(result, `${method} returned null for -500/+400`);
    assert.ok(result.overFair > 0 && result.overFair < 1, `${method} overFair out of range`);
    assert.ok(result.underFair > 0 && result.underFair < 1, `${method} underFair out of range`);
    assert.ok(
      Math.abs(result.overFair + result.underFair - 1) < 0.001,
      `${method} sum = ${result.overFair + result.underFair}`
    );
  }
});

test('shin allocates more margin to the longshot than proportional', () => {
  // Shin method models margin as coming from insider trading, which
  // disproportionately affects longshots (favorite-longshot bias).
  // The longshot's fair probability should be lower under Shin than proportional.
  const overImp = americanToImplied(-300); // favorite
  const underImp = americanToImplied(250); // longshot
  const prop = proportionalDevig(overImp, underImp);
  const shin = shinDevig(overImp, underImp);
  assert.ok(prop && shin);
  // Shin should give the longshot a lower fair probability than proportional
  assert.ok(
    shin.underFair < prop.underFair,
    `Shin longshot (${shin.underFair}) should be < proportional longshot (${prop.underFair})`
  );
});

test('computeConsensus works with non-proportional methods', () => {
  const offers = [
    makeBook('pinnacle', -120, 100, 'sharp', 'high', 'good'),
    makeBook('fanduel', -115, 105, 'market_maker', 'high', 'good')
  ];

  const resultProp = computeConsensus(offers, 'proportional');
  const resultShin = computeConsensus(offers, 'shin');
  const resultPower = computeConsensus(offers, 'power');
  const resultLogit = computeConsensus(offers, 'logit');

  assert.equal(resultProp.ok, true);
  assert.equal(resultShin.ok, true);
  assert.equal(resultPower.ok, true);
  assert.equal(resultLogit.ok, true);

  // Consensus values should differ across methods
  if (resultProp.ok && resultShin.ok && resultPower.ok && resultLogit.ok) {
    const overValues = new Set([
      resultProp.overConsensus,
      resultShin.overConsensus,
      resultPower.overConsensus,
      resultLogit.overConsensus
    ]);
    assert.ok(
      overValues.size >= 3,
      `Expected at least 3 distinct consensus values, got ${overValues.size}: ${JSON.stringify([...overValues])}`
    );
  }
});
