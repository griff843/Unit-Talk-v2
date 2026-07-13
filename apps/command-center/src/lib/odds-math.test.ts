import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToDecimal,
  decimalToAmerican,
  impliedProbability,
  devigTwoWay,
  consensusFairProbability,
  evPercent,
  arbPercent,
  arbStakeSplit,
  middleWindow,
} from './odds-math';

test('americanToDecimal converts positive and negative American odds', () => {
  assert.equal(americanToDecimal(100), 2);
  assert.equal(americanToDecimal(-100), 2);
  assert.equal(americanToDecimal(150), 2.5);
  assert.equal(americanToDecimal(-200), 1.5);
  assert.ok(Math.abs(americanToDecimal(-110) - 1.9090909) < 1e-6);
  assert.throws(() => americanToDecimal(0));
  assert.throws(() => americanToDecimal(NaN));
});

test('decimalToAmerican round-trips', () => {
  assert.equal(decimalToAmerican(2.5), 150);
  assert.equal(decimalToAmerican(1.5), -200);
  assert.equal(decimalToAmerican(2), 100);
  assert.equal(decimalToAmerican(americanToDecimal(-110)), -110);
  assert.throws(() => decimalToAmerican(1));
  assert.throws(() => decimalToAmerican(0.5));
});

test('impliedProbability', () => {
  assert.equal(impliedProbability(100), 0.5);
  assert.ok(Math.abs(impliedProbability(-110) - 110 / 210) < 1e-9);
  assert.ok(Math.abs(impliedProbability(200) - 1 / 3) < 1e-9);
});

test('devigTwoWay proportional de-vig sums to 1 and preserves ratio', () => {
  const { overProb, underProb, overround } = devigTwoWay(-110, -110);
  assert.ok(Math.abs(overProb - 0.5) < 1e-9);
  assert.ok(Math.abs(underProb - 0.5) < 1e-9);
  assert.ok(overround > 1); // vigged market
  const skew = devigTwoWay(-150, 130);
  assert.ok(Math.abs(skew.overProb + skew.underProb - 1) < 1e-12);
  assert.ok(skew.overProb > skew.underProb);
});

test('consensusFairProbability averages de-vigged probs, skips one-sided quotes', () => {
  const c = consensusFairProbability([
    { overOdds: -110, underOdds: -110 },
    { overOdds: -150, underOdds: 130 },
    { overOdds: -120 }, // one-sided, skipped
  ]);
  assert.ok(c);
  assert.equal(c.bookCount, 2);
  const expected = (0.5 + devigTwoWay(-150, 130).overProb) / 2;
  assert.ok(Math.abs(c.overProb - expected) < 1e-12);
  assert.ok(Math.abs(c.overProb + c.underProb - 1) < 1e-12);
  assert.equal(consensusFairProbability([{ overOdds: -110 }]), null);
  assert.equal(consensusFairProbability([]), null);
});

test('evPercent', () => {
  // fair coin at even money => 0 EV
  assert.ok(Math.abs(evPercent(2.0, 0.5)) < 1e-12);
  // +110 (2.1 dec) at 50% fair => +5%
  assert.ok(Math.abs(evPercent(2.1, 0.5) - 5) < 1e-9);
  // -110 at 50% fair => negative EV
  assert.ok(evPercent(americanToDecimal(-110), 0.5) < 0);
  assert.throws(() => evPercent(1, 0.5));
  assert.throws(() => evPercent(2, 0));
});

test('arbPercent and arbStakeSplit', () => {
  // 2.1 / 2.1 => 1/2.1*2 = 0.952..., arb margin ~4.76%
  const margin = arbPercent(2.1, 2.1);
  assert.ok(Math.abs(margin - (1 - 2 / 2.1) * 100) < 1e-9);
  assert.ok(arbPercent(1.9, 1.9) < 0); // no arb

  const split = arbStakeSplit(1000, 2.1, 2.1);
  assert.ok(Math.abs(split.stakeA - 500) < 1e-9);
  assert.ok(Math.abs(split.stakeB - 500) < 1e-9);
  assert.ok(Math.abs(split.guaranteedReturn - 1050) < 1e-9);

  // Uneven legs equalize returns
  const s2 = arbStakeSplit(1000, 2.5, 1.8);
  assert.ok(Math.abs(s2.stakeA * 2.5 - s2.stakeB * 1.8) < 1e-6);
  assert.ok(Math.abs(s2.stakeA + s2.stakeB - 1000) < 1e-9);
  assert.throws(() => arbStakeSplit(0, 2, 2));
});

test('middleWindow', () => {
  const w = middleWindow(7.5, 9.5);
  assert.ok(w);
  assert.equal(w.low, 7.5);
  assert.equal(w.high, 9.5);
  assert.equal(w.width, 2);
  // order-insensitive
  assert.deepEqual(middleWindow(9.5, 7.5), w);
  assert.equal(middleWindow(7.5, 7.5), null);
  assert.equal(middleWindow(NaN, 7.5), null);
});
