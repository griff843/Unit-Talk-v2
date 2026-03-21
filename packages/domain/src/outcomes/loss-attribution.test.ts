import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyLoss,
  summarizeLossAttributions,
} from './loss-attribution.js';
import type { LossAttributionOutput } from './loss-attribution.js';

describe('classifyLoss', () => {
  it('returns UNKNOWN when no feature snapshot', () => {
    const result = classifyLoss({
      ev: 5,
      clv_at_bet: 1,
      clv_at_close: 1,
      has_feature_snapshot: false,
    });
    assert.equal(result.classification, 'UNKNOWN');
    assert.ok(result.notes.includes('no_feature_snapshot_available'));
  });

  it('returns PRICE_MISS when clv_at_close < -3%', () => {
    const result = classifyLoss({
      ev: 5,
      clv_at_bet: 0,
      clv_at_close: -4,
      has_feature_snapshot: true,
    });
    assert.equal(result.classification, 'PRICE_MISS');
  });

  it('returns PRICE_MISS when clv_at_bet < -3%', () => {
    const result = classifyLoss({
      ev: 5,
      clv_at_bet: -5,
      clv_at_close: 0,
      has_feature_snapshot: true,
    });
    assert.equal(result.classification, 'PRICE_MISS');
  });

  it('returns VARIANCE when |EV| < 3%', () => {
    const result = classifyLoss({
      ev: 2.5,
      clv_at_bet: 0,
      clv_at_close: 0,
      has_feature_snapshot: true,
    });
    assert.equal(result.classification, 'VARIANCE');
  });

  it('returns VARIANCE for negative EV within bounds', () => {
    const result = classifyLoss({
      ev: -1.5,
      clv_at_bet: 0,
      clv_at_close: 0,
      has_feature_snapshot: true,
    });
    assert.equal(result.classification, 'VARIANCE');
  });

  it('returns PROJECTION_MISS for positive EV above threshold', () => {
    const result = classifyLoss({
      ev: 5.2,
      clv_at_bet: 0,
      clv_at_close: 0,
      has_feature_snapshot: true,
    });
    assert.equal(result.classification, 'PROJECTION_MISS');
  });

  it('returns PROJECTION_MISS for negative EV below threshold', () => {
    const result = classifyLoss({
      ev: -4,
      clv_at_bet: 0,
      clv_at_close: 0,
      has_feature_snapshot: true,
    });
    assert.equal(result.classification, 'PROJECTION_MISS');
  });

  it('PRICE_MISS takes priority over VARIANCE', () => {
    const result = classifyLoss({
      ev: 1,
      clv_at_bet: -4,
      clv_at_close: -4,
      has_feature_snapshot: true,
    });
    assert.equal(result.classification, 'PRICE_MISS');
  });
});

describe('summarizeLossAttributions', () => {
  it('returns empty summary for no attributions', () => {
    const result = summarizeLossAttributions([]);
    assert.equal(result.total_losses, 0);
    assert.equal(result.by_category.length, 0);
    assert.equal(result.top_category, 'UNKNOWN');
    assert.equal(result.version, 'loss-attribution-v1.0');
  });

  it('computes correct counts and percentages', () => {
    const attributions: LossAttributionOutput[] = [
      { classification: 'VARIANCE', notes: [] },
      { classification: 'VARIANCE', notes: [] },
      { classification: 'PRICE_MISS', notes: [] },
    ];
    const result = summarizeLossAttributions(attributions);
    assert.equal(result.total_losses, 3);
    assert.equal(result.top_category, 'VARIANCE');

    const varianceBucket = result.by_category.find(
      (c) => c.category === 'VARIANCE',
    );
    assert.ok(varianceBucket);
    assert.equal(varianceBucket.count, 2);
    // 2/3 * 100 = 66.6667
    assert.ok(Math.abs(varianceBucket.pct - 66.6667) < 0.001);
  });

  it('sorts by_category descending by count', () => {
    const attributions: LossAttributionOutput[] = [
      { classification: 'PRICE_MISS', notes: [] },
      { classification: 'VARIANCE', notes: [] },
      { classification: 'VARIANCE', notes: [] },
      { classification: 'VARIANCE', notes: [] },
    ];
    const result = summarizeLossAttributions(attributions);
    assert.equal(result.by_category[0]!.category, 'VARIANCE');
    assert.equal(result.by_category[1]!.category, 'PRICE_MISS');
  });

  it('includes recommendations in actionable insights', () => {
    const attributions: LossAttributionOutput[] = [
      { classification: 'PROJECTION_MISS', notes: [] },
    ];
    const result = summarizeLossAttributions(attributions);
    assert.equal(result.actionable_insights.length, 1);
    assert.ok(
      result.actionable_insights[0]!.recommendation.includes('projection'),
    );
  });
});
