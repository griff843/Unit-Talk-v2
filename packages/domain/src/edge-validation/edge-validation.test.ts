import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeConfidenceInterval } from './edge-calibrator.js';
import { analyzeCLV } from './clv-analyzer.js';
import {
  validateEdge,
  MIN_EDGE_SAMPLE_SIZE,
  DEFAULT_ALPHA,
} from './edge-validator.js';
import type { ScoredOutcome } from '../outcomes/types.js';

// ── Edge Calibrator ─────────────────────────────────────────────────────────

describe('computeConfidenceInterval', () => {
  it('returns EMPTY_INPUT for empty array', () => {
    const result = computeConfidenceInterval([]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'EMPTY_INPUT');
    }
  });

  it('returns INSUFFICIENT_SAMPLE for small array', () => {
    const result = computeConfidenceInterval([1, 2, 3]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'INSUFFICIENT_SAMPLE');
    }
  });

  it('returns ZERO_VARIANCE for identical values', () => {
    const values = Array(30).fill(5);
    const result = computeConfidenceInterval(values);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'ZERO_VARIANCE');
    }
  });

  it('computes valid CI for sufficient sample', () => {
    const values = Array.from({ length: 50 }, (_, i) => i / 10);
    const result = computeConfidenceInterval(values);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.ci.n, 50);
      assert.equal(result.ci.confidenceLevel, 0.95);
      assert.ok(result.ci.lower < result.ci.mean);
      assert.ok(result.ci.upper > result.ci.mean);
      assert.ok(result.ci.stdErr > 0);
    }
  });

  it('wider CI at higher confidence', () => {
    const values = Array.from({ length: 50 }, (_, i) => i / 10);
    const ci95 = computeConfidenceInterval(values, 0.95);
    const ci99 = computeConfidenceInterval(values, 0.99);
    assert.equal(ci95.ok, true);
    assert.equal(ci99.ok, true);
    if (ci95.ok && ci99.ok) {
      const width95 = ci95.ci.upper - ci95.ci.lower;
      const width99 = ci99.ci.upper - ci99.ci.lower;
      assert.ok(width99 > width95);
    }
  });
});

// ── CLV Analyzer ────────────────────────────────────────────────────────────

function makeScoredOutcome(
  p_final: number,
  p_market_devig: number,
  mtid: number = 1,
): ScoredOutcome {
  return {
    market_key: `key_${mtid}`,
    event_id: 'evt-1',
    market_type_id: mtid,
    participant_id: 'p-1',
    p_final,
    p_market_devig,
    edge_final: p_final - p_market_devig,
    score: 80,
    tier: 'A',
    book_count: 5,
    line: 22.5,
    actual_value: 25,
    outcome: 'WIN',
  };
}

describe('analyzeCLV', () => {
  it('returns EMPTY_INPUT for empty array', () => {
    const result = analyzeCLV([]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'EMPTY_INPUT');
    }
  });

  it('returns insufficient for small array', () => {
    const records = [makeScoredOutcome(0.6, 0.55)];
    const result = analyzeCLV(records);
    assert.equal(result.ok, false);
  });

  it('computes CLV for valid records', () => {
    const records = Array.from({ length: 15 }, (_, i) =>
      makeScoredOutcome(0.6 + i * 0.01, 0.55),
    );
    const result = analyzeCLV(records);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.summary.n, 15);
      assert.ok(result.summary.meanCLV > 0); // all p_final > p_market
      assert.ok(result.summary.positiveCLVPct > 0);
    }
  });

  it('groups by market type', () => {
    const records = [
      ...Array.from({ length: 8 }, () => makeScoredOutcome(0.6, 0.55, 1)),
      ...Array.from({ length: 7 }, () => makeScoredOutcome(0.55, 0.5, 2)),
    ];
    const result = analyzeCLV(records);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok('mt_1' in result.summary.byMarketType);
      assert.ok('mt_2' in result.summary.byMarketType);
    }
  });
});

// ── Edge Validator ──────────────────────────────────────────────────────────

describe('validateEdge', () => {
  it('returns INSUFFICIENT_SAMPLE for small input', () => {
    const records = [makeScoredOutcome(0.6, 0.55)];
    const result = validateEdge(records);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'INSUFFICIENT_SAMPLE');
    }
  });

  it('detects significant positive edge', () => {
    // All records have p_final > p_market_devig by ~0.05
    const records = Array.from({ length: 40 }, (_, i) =>
      makeScoredOutcome(0.6 + (i % 5) * 0.01, 0.55),
    );
    const result = validateEdge(records);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.meanCLV > 0);
      assert.ok(result.tStat > 0);
      assert.equal(result.significanceLevel, DEFAULT_ALPHA);
    }
  });

  it('detects non-significant edge when CLV is noisy', () => {
    // Alternate between positive and negative CLV to create noise
    const records = Array.from({ length: 40 }, (_, i) =>
      makeScoredOutcome(
        i % 2 === 0 ? 0.6 : 0.4,
        0.5,
      ),
    );
    const result = validateEdge(records);
    assert.equal(result.ok, true);
    if (result.ok) {
      // Mean CLV ~ 0, should not be significant
      assert.ok(Math.abs(result.meanCLV) < 0.01);
    }
  });

  it('exports MIN_EDGE_SAMPLE_SIZE', () => {
    assert.equal(MIN_EDGE_SAMPLE_SIZE, 30);
  });
});
