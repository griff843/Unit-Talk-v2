import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMarketReaction,
  summarizeMarketReactions,
} from './market-reaction.js';
import type { MarketReactionOutput } from './market-reaction.js';

describe('computeMarketReaction', () => {
  it('computes aligned reaction when model and market agree', () => {
    const result = computeMarketReaction({
      player_id: 'p1',
      stat_type: 'points',
      open_line: 20,
      close_line: 22,
      model_projection: 25,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.model_direction, 1); // model > open
      assert.equal(result.data.market_direction, 1); // close > open
      assert.equal(result.data.reaction_alignment, true);
    }
  });

  it('computes misaligned reaction', () => {
    const result = computeMarketReaction({
      player_id: 'p1',
      stat_type: 'points',
      open_line: 20,
      close_line: 18,
      model_projection: 25,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.model_direction, 1);
      assert.equal(result.data.market_direction, -1);
      assert.equal(result.data.reaction_alignment, false);
    }
  });

  it('computes CLV relative to bet_line', () => {
    const result = computeMarketReaction({
      player_id: 'p1',
      stat_type: 'points',
      open_line: 20,
      close_line: 22,
      model_projection: 25,
      bet_line: 20,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.clv_value, 2);
      assert.equal(result.data.clv_percent, 0.1);
    }
  });

  it('rejects negative open_line', () => {
    const result = computeMarketReaction({
      player_id: 'p1',
      stat_type: 'points',
      open_line: -1,
      close_line: 22,
      model_projection: 25,
    });
    assert.equal(result.ok, false);
  });

  it('rejects zero model_projection', () => {
    const result = computeMarketReaction({
      player_id: 'p1',
      stat_type: 'points',
      open_line: 20,
      close_line: 22,
      model_projection: 0,
    });
    assert.equal(result.ok, false);
  });

  it('rejects zero bet_line', () => {
    const result = computeMarketReaction({
      player_id: 'p1',
      stat_type: 'points',
      open_line: 0,
      close_line: 22,
      model_projection: 25,
      bet_line: 0,
    });
    assert.equal(result.ok, false);
  });
});

describe('summarizeMarketReactions', () => {
  it('returns zeros for empty input', () => {
    const summary = summarizeMarketReactions([]);
    assert.equal(summary.total, 0);
    assert.equal(summary.alignment_rate, 0);
  });

  it('computes summary for multiple reactions', () => {
    const reactions: MarketReactionOutput[] = [
      {
        player_id: 'p1',
        stat_type: 'points',
        open_line: 20,
        close_line: 22,
        model_projection: 25,
        model_direction: 1,
        market_direction: 1,
        reaction_alignment: true,
        clv_value: 2,
        clv_percent: 0.1,
        reaction_strength: 2,
      },
      {
        player_id: 'p2',
        stat_type: 'rebounds',
        open_line: 10,
        close_line: 9,
        model_projection: 12,
        model_direction: 1,
        market_direction: -1,
        reaction_alignment: false,
        clv_value: -1,
        clv_percent: -0.1,
        reaction_strength: 1,
      },
    ];
    const summary = summarizeMarketReactions(reactions);
    assert.equal(summary.total, 2);
    assert.equal(summary.aligned_count, 1);
    assert.equal(summary.alignment_rate, 0.5);
    assert.equal(summary.positive_clv_count, 1);
    assert.equal(summary.negative_clv_count, 1);
  });
});
