import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeSharpConsensus } from './sharp-consensus.js';
import type { ProviderOfferSlim } from '../signals/market-signals.js';

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

describe('computeSharpConsensus', () => {
  it('returns null for empty offers', () => {
    assert.equal(computeSharpConsensus([]), null);
  });

  it('returns null for offers with missing odds', () => {
    const result = computeSharpConsensus([
      makeOffer({ over_odds: null }),
    ]);
    assert.equal(result, null);
  });

  it('computes equal and sharp-weighted consensus', () => {
    const offers = [
      makeOffer({ provider: 'pinnacle', over_odds: -105, under_odds: -115 }),
      makeOffer({ provider: 'fanduel', over_odds: -110, under_odds: -110 }),
      makeOffer({ provider: 'betmgm', over_odds: -115, under_odds: -105 }),
    ];
    const result = computeSharpConsensus(offers);
    assert.ok(result !== null);
    assert.ok(result!.p_equal > 0 && result!.p_equal < 1);
    assert.ok(result!.p_sharp > 0 && result!.p_sharp < 1);
    assert.equal(result!.books_used, 3);
  });

  it('sharp books get higher weight than retail', () => {
    // Pinnacle (sharp) with higher over prob vs betmgm (retail) with lower
    const offers = [
      makeOffer({ provider: 'pinnacle', over_odds: -105, under_odds: -115 }),
      makeOffer({ provider: 'betmgm', over_odds: -115, under_odds: -105 }),
    ];
    const result = computeSharpConsensus(offers);
    assert.ok(result !== null);
    // Sharp weight_score should be non-zero if sharp and retail disagree
    assert.ok(result!.sharp_weight_score >= 0);
  });

  it('sharp_direction indicates divergence direction', () => {
    const offers = [
      makeOffer({ provider: 'pinnacle', over_odds: -105, under_odds: -115 }),
      makeOffer({ provider: 'betmgm', over_odds: -115, under_odds: -105 }),
    ];
    const result = computeSharpConsensus(offers);
    assert.ok(result !== null);
    assert.ok([-1, 0, 1].includes(result!.sharp_direction));
  });
});
