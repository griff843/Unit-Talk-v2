import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeAlphaEvaluation } from './alpha-evaluation.js';
import type { EvaluationRecord } from './alpha-evaluation.js';
import { generateBandEvaluation } from './band-evaluation.js';
import type { BandedOutcome } from './band-evaluation.js';
import {
  buildDowngradeRecord,
  analyzeDowngradeEffectiveness,
} from './downgrade-effectiveness.js';
import { analyzeRegimeStability } from './regime-stability.js';
import type { RegimeRecord } from './regime-stability.js';
import type { BlendOutput } from '../models/stat-market-blend.js';
import type { ScoredOutcome } from '../outcomes/types.js';
import type { BandOutput } from '../bands/types.js';

function makeBlend(overrides: Partial<BlendOutput> = {}): BlendOutput {
  return {
    p_final: 0.6,
    p_stat: 0.62,
    p_market: 0.55,
    stat_weight: 0.4,
    market_weight: 0.6,
    stat_alpha: 0.07,
    divergence: 0.07,
    divergence_direction: 1,
    edge_vs_market: 0.05,
    blend_version: 'test-v1',
    ...overrides,
  };
}

function makeEvalRecord(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    blend: makeBlend(),
    outcome: 1,
    sport: 'NBA',
    market_type: 'player_points_ou',
    ...overrides,
  };
}

function makeScoredOutcome(overrides: Partial<ScoredOutcome> = {}): ScoredOutcome {
  return {
    market_key: 'player_points_ou',
    event_id: 'evt-1',
    market_type_id: 1,
    participant_id: 'p-1',
    p_final: 0.6,
    p_market_devig: 0.55,
    edge_final: 0.05,
    score: 80,
    tier: 'A',
    book_count: 5,
    line: 22.5,
    actual_value: 25,
    outcome: 'WIN',
    ...overrides,
  };
}

function makeBandOutput(overrides: Partial<BandOutput> = {}): BandOutput {
  return {
    initialBand: 'A',
    finalBand: 'A',
    downgradeReasons: [],
    suppressionReasons: [],
    thresholdVersion: 'test-v1',
    ...overrides,
  };
}

// ── Alpha Evaluation ────────────────────────────────────────────────────────

describe('computeAlphaEvaluation', () => {
  it('returns zeros for empty input', () => {
    const report = computeAlphaEvaluation([]);
    assert.equal(report.sample_size, 0);
    assert.equal(report.brier_score, 0);
    assert.equal(report.log_loss, 0);
  });

  it('computes brier score', () => {
    const records = [
      makeEvalRecord({ blend: makeBlend({ p_final: 0.9 }), outcome: 1 }),
      makeEvalRecord({ blend: makeBlend({ p_final: 0.1 }), outcome: 0 }),
    ];
    const report = computeAlphaEvaluation(records);
    assert.equal(report.sample_size, 2);
    assert.ok(report.brier_score < 0.05); // good predictions
  });

  it('groups by sport', () => {
    const records = [
      makeEvalRecord({ sport: 'NBA', outcome: 1 }),
      makeEvalRecord({ sport: 'NBA', outcome: 0 }),
      makeEvalRecord({ sport: 'NFL', outcome: 1 }),
    ];
    const report = computeAlphaEvaluation(records);
    assert.ok('NBA' in report.by_sport);
    assert.ok('NFL' in report.by_sport);
    assert.equal(report.by_sport['NBA']!.sample_size, 2);
  });

  it('computes confidence buckets', () => {
    const records = [
      makeEvalRecord({ blend: makeBlend({ p_final: 0.3 }), outcome: 0 }),
      makeEvalRecord({ blend: makeBlend({ p_final: 0.7 }), outcome: 1 }),
    ];
    const report = computeAlphaEvaluation(records);
    assert.ok(report.confidence_buckets.length > 0);
    assert.ok(report.ece >= 0);
  });

  it('computes alpha buckets', () => {
    const records = [
      makeEvalRecord({
        blend: makeBlend({ stat_alpha: 0.08 }),
        outcome: 1,
      }),
      makeEvalRecord({
        blend: makeBlend({ stat_alpha: -0.03 }),
        outcome: 0,
      }),
    ];
    const report = computeAlphaEvaluation(records);
    assert.ok(report.alpha_buckets.length > 0);
  });
});

// ── Band Evaluation ─────────────────────────────────────────────────────────

describe('generateBandEvaluation', () => {
  it('returns report for empty input', () => {
    const report = generateBandEvaluation([], '2026-01-01T00:00:00Z');
    assert.equal(report.total_sample_size, 0);
    assert.equal(report.by_band.length, 5); // all tiers present
  });

  it('computes metrics per band', () => {
    const records: BandedOutcome[] = [
      {
        outcome: makeScoredOutcome({ outcome: 'WIN' }),
        band: makeBandOutput({ finalBand: 'A+' }),
      },
      {
        outcome: makeScoredOutcome({ outcome: 'LOSS' }),
        band: makeBandOutput({ finalBand: 'A+' }),
      },
      {
        outcome: makeScoredOutcome({ outcome: 'WIN' }),
        band: makeBandOutput({ finalBand: 'B' }),
      },
    ];
    const report = generateBandEvaluation(records, '2026-01-01T00:00:00Z');
    assert.equal(report.total_sample_size, 3);

    const aPlusBand = report.by_band.find((b) => b.band === 'A+');
    assert.ok(aPlusBand);
    assert.equal(aPlusBand.sample_size, 2);
    assert.equal(aPlusBand.wins, 1);
    assert.equal(aPlusBand.losses, 1);
  });

  it('tracks band distribution', () => {
    const records: BandedOutcome[] = [
      {
        outcome: makeScoredOutcome({ outcome: 'WIN' }),
        band: makeBandOutput({ finalBand: 'A' }),
      },
      {
        outcome: makeScoredOutcome({ outcome: 'WIN' }),
        band: makeBandOutput({ finalBand: 'A' }),
      },
      {
        outcome: makeScoredOutcome({ outcome: 'WIN' }),
        band: makeBandOutput({ finalBand: 'B' }),
      },
    ];
    const report = generateBandEvaluation(records, '2026-01-01T00:00:00Z');
    assert.equal(report.band_distribution['A'], 2);
    assert.equal(report.band_distribution['B'], 1);
  });
});

// ── Downgrade Effectiveness ─────────────────────────────────────────────────

describe('buildDowngradeRecord', () => {
  it('detects downgrade', () => {
    const record = buildDowngradeRecord('A+', 'B', ['uncertainty'], [], 'LOSS');
    assert.equal(record.wasDowngraded, true);
    assert.equal(record.wasSuppressed, false);
    assert.equal(record.flatBetResult, -110);
  });

  it('detects suppression', () => {
    const record = buildDowngradeRecord('A', 'SUPPRESS', [], ['risk:reject'], 'WIN');
    assert.equal(record.wasDowngraded, false);
    assert.equal(record.wasSuppressed, true);
    assert.equal(record.flatBetResult, 100);
  });

  it('detects unchanged', () => {
    const record = buildDowngradeRecord('B', 'B', [], [], 'WIN');
    assert.equal(record.wasDowngraded, false);
    assert.equal(record.wasSuppressed, false);
  });
});

describe('analyzeDowngradeEffectiveness', () => {
  it('handles empty input', () => {
    const report = analyzeDowngradeEffectiveness([]);
    assert.equal(report.total_records, 0);
  });

  it('separates downgraded/suppressed/unchanged', () => {
    const records = [
      buildDowngradeRecord('A+', 'B', ['uncertainty'], [], 'LOSS'),
      buildDowngradeRecord('A', 'SUPPRESS', [], ['risk:reject'], 'LOSS'),
      buildDowngradeRecord('B', 'B', [], [], 'WIN'),
    ];
    const report = analyzeDowngradeEffectiveness(records);
    assert.equal(report.downgraded.total, 1);
    assert.equal(report.suppressed.total, 1);
    assert.equal(report.unchanged.total, 1);
  });

  it('computes diagnostics', () => {
    const records = [
      buildDowngradeRecord('A+', 'B', ['uncertainty'], [], 'LOSS'),
      buildDowngradeRecord('A+', 'SUPPRESS', [], ['risk:reject'], 'LOSS'),
      buildDowngradeRecord('B', 'B', [], [], 'WIN'),
      buildDowngradeRecord('A', 'A', [], [], 'WIN'),
    ];
    const report = analyzeDowngradeEffectiveness(records);
    assert.equal(typeof report.diagnostics.suppression_effective, 'boolean');
    assert.equal(typeof report.diagnostics.downgrade_effective, 'boolean');
  });
});

// ── Regime Stability ────────────────────────────────────────────────────────

describe('analyzeRegimeStability', () => {
  it('handles empty input', () => {
    const report = analyzeRegimeStability([]);
    assert.equal(report.window_count, 0);
    assert.equal(report.regime.stable, true);
  });

  it('analyzes multiple windows', () => {
    const records: RegimeRecord[] = [];
    for (let w = 0; w < 3; w++) {
      for (let i = 0; i < 10; i++) {
        records.push({
          finalBand: i < 3 ? 'A+' : i < 6 ? 'A' : 'B',
          outcome: i % 2 === 0 ? 'WIN' : 'LOSS',
          flatBetResult: i % 2 === 0 ? 100 : -110,
          windowLabel: `week-${w}`,
        });
      }
    }
    const report = analyzeRegimeStability(records);
    assert.equal(report.window_count, 3);
    assert.ok(report.distribution_stability.length > 0);
  });

  it('detects unstable regime', () => {
    const records: RegimeRecord[] = [];
    // Window 1: all A+
    for (let i = 0; i < 10; i++) {
      records.push({
        finalBand: 'A+',
        outcome: 'WIN',
        flatBetResult: 100,
        windowLabel: 'w1',
      });
    }
    // Window 2: all C
    for (let i = 0; i < 10; i++) {
      records.push({
        finalBand: 'C',
        outcome: 'LOSS',
        flatBetResult: -110,
        windowLabel: 'w2',
      });
    }
    const report = analyzeRegimeStability(records);
    assert.equal(report.window_count, 2);
    // Distribution should be unstable since one window is all A+ and other is all C
    assert.ok(report.regime.unstable_count > 0);
  });
});
