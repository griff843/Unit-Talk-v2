import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMovementScore,
  computeDisagreementScore,
  computeSharpRetailDelta,
  computeSignalVector,
} from './market-signals.js';
import type { ProviderOfferSlim } from './market-signals.js';

function makeOffer(overrides: Partial<ProviderOfferSlim> = {}): ProviderOfferSlim {
  return {
    provider: 'fanduel',
    line: 20.5,
    over_odds: -110,
    under_odds: -110,
    snapshot_at: '2026-01-01T00:00:00Z',
    is_opening: false,
    is_closing: true,
    ...overrides,
  };
}

describe('computeMovementScore', () => {
  it('returns 0 when no opening offers', () => {
    assert.equal(computeMovementScore([], [makeOffer()]), 0);
  });

  it('returns positive for line moving up', () => {
    const opening = [makeOffer({ line: 20, is_opening: true })];
    const closing = [makeOffer({ line: 22, is_closing: true })];
    const score = computeMovementScore(opening, closing);
    assert.ok(score > 0);
  });

  it('returns negative for line moving down', () => {
    const opening = [makeOffer({ line: 22, is_opening: true })];
    const closing = [makeOffer({ line: 20, is_closing: true })];
    const score = computeMovementScore(opening, closing);
    assert.ok(score < 0);
  });

  it('is clamped to [-1, +1]', () => {
    const opening = [makeOffer({ line: 10, is_opening: true })];
    const closing = [makeOffer({ line: 100, is_closing: true })];
    const score = computeMovementScore(opening, closing);
    assert.ok(score <= 1);
  });
});

describe('computeDisagreementScore', () => {
  it('returns 0 for single offer', () => {
    assert.equal(computeDisagreementScore([makeOffer()]), 0);
  });

  it('returns > 0 when books disagree', () => {
    const offers = [
      makeOffer({ over_odds: -130, under_odds: 110 }),
      makeOffer({ over_odds: 110, under_odds: -130 }),
    ];
    const score = computeDisagreementScore(offers);
    assert.ok(score > 0);
  });
});

describe('computeSharpRetailDelta', () => {
  it('returns 0 when no sharp or retail books', () => {
    const offers = [makeOffer({ provider: 'fanduel' })]; // market_maker
    assert.equal(computeSharpRetailDelta(offers), 0);
  });

  it('returns positive when sharps are higher than retail', () => {
    // Pinnacle (sharp) has higher over-implied prob; betmgm (retail) has lower
    const offers = [
      makeOffer({ provider: 'pinnacle', over_odds: -120, under_odds: -100 }),
      makeOffer({ provider: 'betmgm', over_odds: -100, under_odds: -120 }),
    ];
    const delta = computeSharpRetailDelta(offers);
    assert.ok(delta > 0);
  });
});

describe('computeSignalVector', () => {
  it('returns all four signal components', () => {
    const offers = [
      makeOffer({ provider: 'pinnacle', is_opening: true, is_closing: false }),
      makeOffer({ provider: 'fanduel', is_opening: false, is_closing: true }),
    ];
    const vector = computeSignalVector(
      offers.filter((o) => o.is_opening),
      offers.filter((o) => o.is_closing),
      offers,
    );
    assert.ok('weighted_prob' in vector);
    assert.ok('movement_score' in vector);
    assert.ok('disagreement_score' in vector);
    assert.ok('sharp_retail_delta' in vector);
  });
});
