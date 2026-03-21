import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeBookDispersion } from './book-dispersion.js';
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

describe('computeBookDispersion', () => {
  it('returns zero dispersion for single offer', () => {
    const result = computeBookDispersion([makeOffer()]);
    assert.equal(result.dispersion_score, 0);
    assert.equal(result.range, 0);
    assert.equal(result.books_count, 1);
  });

  it('returns non-zero dispersion when books disagree', () => {
    const offers = [
      makeOffer({ provider: 'pinnacle', over_odds: -130, under_odds: 110 }),
      makeOffer({ provider: 'betmgm', over_odds: 110, under_odds: -130 }),
    ];
    const result = computeBookDispersion(offers);
    assert.ok(result.dispersion_score > 0);
    assert.ok(result.range > 0);
    assert.equal(result.books_count, 2);
  });

  it('counts sharp books correctly', () => {
    const offers = [
      makeOffer({ provider: 'pinnacle' }),
      makeOffer({ provider: 'circa' }),
      makeOffer({ provider: 'betmgm' }),
    ];
    const result = computeBookDispersion(offers);
    assert.equal(result.sharp_count, 2);
  });

  it('skips offers with null odds', () => {
    const offers = [
      makeOffer({ over_odds: null }),
      makeOffer({ provider: 'pinnacle' }),
    ];
    const result = computeBookDispersion(offers);
    assert.equal(result.books_count, 1);
  });
});
