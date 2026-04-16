import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyContrarianism,
  evaluateContraryVerdict,
  CONTRARIAN_THRESHOLDS,
  type ContrarySignal,
} from './contrarian.js';

// ── classifyContrarianism ────────────────────────────────────────────────────

test('classifyContrarianism: divergence > 8pp against market → strongly-contrarian', () => {
  const signal = classifyContrarianism(0.6, 0.5, 'pinnacle');
  assert.equal(signal.contrarianism, 'strongly-contrarian');
  assert.ok(Math.abs(signal.divergence - 0.1) < 1e-9, `expected divergence ~0.1, got ${signal.divergence}`);
  assert.equal(signal.direction, 'against-market');
  assert.equal(signal.marketSource, 'pinnacle');
  assert.equal(signal.threshold, CONTRARIAN_THRESHOLDS.strong);
});

test('classifyContrarianism: divergence > 8pp with market → consensus-fade', () => {
  // model lower than market → with-market direction
  const signal = classifyContrarianism(0.4, 0.5, 'pinnacle');
  assert.equal(signal.contrarianism, 'consensus-fade');
  assert.equal(signal.direction, 'with-market');
  assert.equal(signal.threshold, CONTRARIAN_THRESHOLDS.strong);
});

test('classifyContrarianism: divergence 4–8pp → mildly-contrarian', () => {
  const signal = classifyContrarianism(0.55, 0.5, 'consensus');
  assert.equal(signal.contrarianism, 'mildly-contrarian');
  assert.ok(Math.abs(signal.divergence - 0.05) < 1e-9, `expected divergence ~0.05, got ${signal.divergence}`);
  assert.equal(signal.direction, 'against-market');
  assert.equal(signal.marketSource, 'consensus');
  assert.equal(signal.threshold, CONTRARIAN_THRESHOLDS.mild);
});

test('classifyContrarianism: divergence 4–8pp with-market → mildly-contrarian', () => {
  // below strong threshold regardless of direction
  const signal = classifyContrarianism(0.45, 0.5, 'sgo');
  assert.equal(signal.contrarianism, 'mildly-contrarian');
  assert.equal(signal.direction, 'with-market');
});

test('classifyContrarianism: divergence < 4pp → aligned', () => {
  const signal = classifyContrarianism(0.51, 0.5, 'sgo');
  assert.equal(signal.contrarianism, 'aligned');
  assert.ok(Math.abs(signal.divergence - 0.01) < 1e-9, `expected divergence ~0.01, got ${signal.divergence}`);
  assert.equal(signal.threshold, 0);
});

test('classifyContrarianism: exact equality → aligned', () => {
  const signal = classifyContrarianism(0.5, 0.5, 'confidence-delta');
  assert.equal(signal.contrarianism, 'aligned');
  assert.equal(signal.divergence, 0);
  assert.equal(signal.threshold, 0);
});

test('classifyContrarianism: divergence just above strong threshold → strongly-contrarian', () => {
  // 0.6 - 0.5 = 0.1 (IEEE 754-exact), which is > 0.08 threshold
  const signal = classifyContrarianism(0.6, 0.5, 'pinnacle');
  assert.equal(signal.contrarianism, 'strongly-contrarian');
  assert.equal(signal.threshold, CONTRARIAN_THRESHOLDS.strong);
});

test('classifyContrarianism: divergence just above mild threshold, below strong → mildly-contrarian', () => {
  // 0.56 - 0.5 = 0.06 (IEEE 754-exact), which is > 0.04 and < 0.08
  const signal = classifyContrarianism(0.56, 0.5, 'pinnacle');
  assert.equal(signal.contrarianism, 'mildly-contrarian');
  assert.equal(signal.threshold, CONTRARIAN_THRESHOLDS.mild);
});

// ── evaluateContraryVerdict ──────────────────────────────────────────────────

function makeStrongSignal(): ContrarySignal {
  return {
    contrarianism: 'strongly-contrarian',
    divergence: 0.12,
    direction: 'against-market',
    marketSource: 'pinnacle',
    threshold: CONTRARIAN_THRESHOLDS.strong,
  };
}

function makeMildSignal(): ContrarySignal {
  return {
    contrarianism: 'mildly-contrarian',
    divergence: 0.05,
    direction: 'against-market',
    marketSource: 'consensus',
    threshold: CONTRARIAN_THRESHOLDS.mild,
  };
}

test('evaluateContraryVerdict: positive CLV + WIN → justified', () => {
  assert.equal(evaluateContraryVerdict(makeStrongSignal(), 2.5, 'WIN'), 'justified');
});

test('evaluateContraryVerdict: positive CLV + WIN (mild signal) → justified', () => {
  assert.equal(evaluateContraryVerdict(makeMildSignal(), 1.0, 'WIN'), 'justified');
});

test('evaluateContraryVerdict: strongly-contrarian + negative CLV + LOSS → overconfident', () => {
  assert.equal(evaluateContraryVerdict(makeStrongSignal(), -3.0, 'LOSS'), 'overconfident');
});

test('evaluateContraryVerdict: mildly-contrarian + negative CLV + LOSS → inconclusive (not strong enough)', () => {
  // Only strongly-contrarian triggers overconfident
  assert.equal(evaluateContraryVerdict(makeMildSignal(), -3.0, 'LOSS'), 'inconclusive');
});

test('evaluateContraryVerdict: null CLV → inconclusive', () => {
  assert.equal(evaluateContraryVerdict(makeStrongSignal(), null, 'WIN'), 'inconclusive');
});

test('evaluateContraryVerdict: null outcome → inconclusive', () => {
  assert.equal(evaluateContraryVerdict(makeStrongSignal(), 2.5, null), 'inconclusive');
});

test('evaluateContraryVerdict: PUSH → inconclusive', () => {
  assert.equal(evaluateContraryVerdict(makeStrongSignal(), 2.5, 'PUSH'), 'inconclusive');
});

test('evaluateContraryVerdict: negative CLV + WIN → inconclusive (beat the line but wrong CLV direction)', () => {
  // positive CLV is required for 'justified'
  assert.equal(evaluateContraryVerdict(makeStrongSignal(), -1.0, 'WIN'), 'inconclusive');
});

test('evaluateContraryVerdict: positive CLV + LOSS → inconclusive (CLV positive but lost)', () => {
  assert.equal(evaluateContraryVerdict(makeStrongSignal(), 2.5, 'LOSS'), 'inconclusive');
});
