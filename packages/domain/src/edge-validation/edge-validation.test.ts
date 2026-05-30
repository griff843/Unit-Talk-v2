import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

import { computeConfidenceInterval } from './edge-calibrator.js';
import { analyzeCLV, assertClosingSourcePresent, type WithClosingSource } from './clv-analyzer.js';
import {
  validateEdge,
  MIN_EDGE_SAMPLE_SIZE,
  DEFAULT_ALPHA,
  type EdgeValidationRecord,
} from './edge-validator.js';
import { createDecisionRecord, verifyDecisionIntegrity } from '../models/decision-record.js';
import { evaluateEdgePriceFreshness } from '../stale-data.js';

const NOW_MS = Date.parse('2026-05-01T12:00:00Z');
const FRESH_EDGE_PRICE_SNAPSHOT_AT = '2026-05-01T11:50:00Z';

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
  overrides: Partial<EdgeValidationRecord> = {},
): EdgeValidationRecord {
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
    edgePriceSnapshotAt: FRESH_EDGE_PRICE_SNAPSHOT_AT,
    edgePriceProviderKey: 'draftkings',
    eventStartsAt: '2026-05-01T18:00:00Z',
    sportKey: 'nba',
    ...overrides,
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
    const result = validateEdge(records, DEFAULT_ALPHA, { nowMs: NOW_MS });
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
    const result = validateEdge(records, DEFAULT_ALPHA, { nowMs: NOW_MS });
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
    const result = validateEdge(records, DEFAULT_ALPHA, { nowMs: NOW_MS });
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

// ── Edge-Price Freshness Enforcement ────────────────────────────────────────

test('evaluateEdgePriceFreshness: accepts a fresh priced edge at the boundary', () => {
  const result = evaluateEdgePriceFreshness({
    priceSnapshotAt: '2026-05-01T11:00:00Z',
    priceProviderKey: 'draftkings',
    eventStartsAt: '2026-05-01T18:00:00Z',
    sportKey: 'nba',
    marketKey: 'game_total_ou',
    nowMs: NOW_MS,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshotAgeMs, result.freshnessThresholdMs);
    assert.equal(result.proximityTier, 'game-day');
  }
});

test('validateEdge: fails closed when edge-price freshness evidence is missing', () => {
  const records = Array.from({ length: 40 }, (_, i) =>
    makeScoredOutcome(0.6 + (i % 5) * 0.01, 0.55, 1, { edgePriceSnapshotAt: null }),
  );

  const result = validateEdge(records, DEFAULT_ALPHA, { nowMs: NOW_MS });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'MISSING_EDGE_PRICE_FRESHNESS');
    assert.match(result.reasonDetail, /missing_price_snapshot_at/);
  }
});

test('validateEdge: rejects stale edge-price snapshots before CLV significance', () => {
  const records = Array.from({ length: 40 }, (_, i) =>
    makeScoredOutcome(0.6 + (i % 5) * 0.01, 0.55, 1, {
      edgePriceSnapshotAt: '2026-05-01T10:59:59Z',
      eventStartsAt: '2026-05-01T18:00:00Z',
      market_type_key: 'game_total_ou',
    }),
  );

  const result = validateEdge(records, DEFAULT_ALPHA, { nowMs: NOW_MS });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'STALE_EDGE_PRICE');
    assert.match(result.reasonDetail, /stale_price_snapshot/);
  }
});

test('DecisionRecord: stores frozen replay-visible edge-price freshness evidence', () => {
  const rec = createDecisionRecord({
    record_id: 'freshness-decision-1',
    decision_type: 'block',
    entity_id: 'pick-1',
    entity_type: 'pick',
    decided_at_ms: NOW_MS,
    outcome: 'blocked',
    reason: 'STALE_EDGE_PRICE',
    inputs_hash: 'abc123',
    provenance: {
      authority: 'system',
      policy_version: 'edge-price-freshness:v1',
      evaluator_version: 'edge-validator:v1',
    },
    evidence: {
      edge_price_freshness: {
        price_snapshot_at: '2026-05-01T10:59:59Z',
        price_provider_key: 'draftkings',
        event_starts_at: '2026-05-01T18:00:00Z',
        snapshot_age_ms: 3_601_000,
        freshness_threshold_ms: 3_600_000,
        freshness_result: 'stale',
      },
    },
    preceding_record_id: null,
  });

  assert.ok(Object.isFrozen(rec));
  assert.ok(Object.isFrozen(rec.evidence));
  assert.ok(Object.isFrozen(rec.evidence?.edge_price_freshness));
  assert.deepEqual(verifyDecisionIntegrity(rec), []);
  assert.equal(rec.evidence?.edge_price_freshness?.freshness_result, 'stale');
});

// ── assertClosingSourcePresent ───────────────────────────────────────────────

describe('assertClosingSourcePresent', () => {
  it('does not throw when all records have closing-line provenance', () => {
    const records: WithClosingSource[] = [
      { closingSnapshotAt: '2026-01-01T00:00:00Z', closingProviderKey: 'draftkings' },
      { closingSnapshotAt: '2026-01-02T00:00:00Z', closingProviderKey: 'fanduel' },
    ];
    assert.doesNotThrow(() => assertClosingSourcePresent(records));
  });

  it('throws when any record has null closingSnapshotAt', () => {
    const records: WithClosingSource[] = [
      { closingSnapshotAt: '2026-01-01T00:00:00Z', closingProviderKey: 'draftkings' },
      { closingSnapshotAt: null, closingProviderKey: 'fanduel' },
    ];
    assert.throws(
      () => assertClosingSourcePresent(records),
      /1 record\(s\) have null closingSnapshotAt or closingProviderKey/,
    );
  });

  it('throws when any record has null closingProviderKey', () => {
    const records: WithClosingSource[] = [
      { closingSnapshotAt: '2026-01-01T00:00:00Z', closingProviderKey: null },
    ];
    assert.throws(() => assertClosingSourcePresent(records), /CLV analysis requires closing-line source/);
  });

  it('throws listing the correct count when multiple records are missing', () => {
    const records: WithClosingSource[] = Array.from({ length: 5 }, (_, i) => ({
      closingSnapshotAt: i < 2 ? null : '2026-01-01T00:00:00Z',
      closingProviderKey: 'draftkings',
    }));
    assert.throws(
      () => assertClosingSourcePresent(records),
      /2 record\(s\) have null/,
    );
  });

  it('does not throw for an empty array', () => {
    assert.doesNotThrow(() => assertClosingSourcePresent([]));
  });
});
