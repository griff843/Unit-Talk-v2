import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveOutcome,
  isDirectionallyCorrect,
  computeFlatBetROI,
} from './outcome-resolver.js';

describe('resolveOutcome', () => {
  it('returns WIN when actual > line', () => {
    assert.equal(resolveOutcome(25.5, 24.5), 'WIN');
  });

  it('returns LOSS when actual < line', () => {
    assert.equal(resolveOutcome(20, 24.5), 'LOSS');
  });

  it('returns PUSH when actual == line', () => {
    assert.equal(resolveOutcome(24.5, 24.5), 'PUSH');
  });

  it('handles zero line', () => {
    assert.equal(resolveOutcome(1, 0), 'WIN');
    assert.equal(resolveOutcome(-1, 0), 'LOSS');
    assert.equal(resolveOutcome(0, 0), 'PUSH');
  });
});

describe('isDirectionallyCorrect', () => {
  it('returns true when model predicted over and actual was over', () => {
    assert.equal(isDirectionallyCorrect(0.65, 'WIN'), true);
  });

  it('returns false when model predicted over but actual was under', () => {
    assert.equal(isDirectionallyCorrect(0.65, 'LOSS'), false);
  });

  it('returns true when model predicted under and actual was under', () => {
    assert.equal(isDirectionallyCorrect(0.35, 'LOSS'), true);
  });

  it('returns false when model predicted under but actual was over', () => {
    assert.equal(isDirectionallyCorrect(0.35, 'WIN'), false);
  });

  it('returns null for PUSH', () => {
    assert.equal(isDirectionallyCorrect(0.55, 'PUSH'), null);
  });

  it('treats p=0.5 as predicting over', () => {
    assert.equal(isDirectionallyCorrect(0.5, 'WIN'), true);
    assert.equal(isDirectionallyCorrect(0.5, 'LOSS'), false);
  });
});

describe('computeFlatBetROI', () => {
  it('returns zero for empty outcomes', () => {
    const result = computeFlatBetROI([]);
    assert.equal(result.roi_pct, 0);
    assert.equal(result.total_wagered, 0);
    assert.equal(result.total_profit, 0);
  });

  it('returns zero for all pushes', () => {
    const result = computeFlatBetROI(['PUSH', 'PUSH']);
    assert.equal(result.roi_pct, 0);
    assert.equal(result.total_wagered, 0);
  });

  it('computes positive ROI for all wins', () => {
    const result = computeFlatBetROI(['WIN', 'WIN']);
    assert.equal(result.total_wagered, 220);
    assert.equal(result.total_profit, 200);
    assert.ok(result.roi_pct > 0);
  });

  it('computes negative ROI for all losses', () => {
    const result = computeFlatBetROI(['LOSS', 'LOSS']);
    assert.equal(result.total_wagered, 220);
    assert.equal(result.total_profit, -220);
    assert.ok(result.roi_pct < 0);
  });

  it('excludes pushes from wager calculation', () => {
    const result = computeFlatBetROI(['WIN', 'PUSH', 'LOSS']);
    // Only 2 non-push bets: wagered 220, profit = 100 - 110 = -10
    assert.equal(result.total_wagered, 220);
    assert.equal(result.total_profit, -10);
  });
});
