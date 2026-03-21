import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveActualValue,
  hasStatMapping,
  getSupportedMarketKeys,
} from './stat-resolver.js';
import { generatePerformanceReport } from './performance-report.js';
import {
  bridgeOutcomeToEvaluation,
  bridgeBatchToEvaluation,
} from './outcome-bridge.js';
import type { ScoredOutcome } from './types.js';

// ── Stat Resolver ───────────────────────────────────────────────────────────

describe('resolveActualValue', () => {
  it('resolves simple stat', () => {
    const result = resolveActualValue('player_points_ou', { points: 25 });
    assert.equal(result.resolved, true);
    assert.equal(result.actual_value, 25);
  });

  it('resolves combo stat (PRA)', () => {
    const result = resolveActualValue('player_pra_ou', {
      points: 20,
      rebounds: 10,
      assists: 5,
    });
    assert.equal(result.resolved, true);
    assert.equal(result.actual_value, 35);
  });

  it('uses fallback for combo when individual stats missing', () => {
    const result = resolveActualValue('player_pra_ou', { pra: 35 });
    assert.equal(result.resolved, true);
    assert.equal(result.actual_value, 35);
  });

  it('returns unresolved for unknown market key', () => {
    const result = resolveActualValue('unknown_market', { points: 25 });
    assert.equal(result.resolved, false);
    assert.equal(result.actual_value, null);
  });

  it('returns unresolved when stats are missing', () => {
    const result = resolveActualValue('player_points_ou', {});
    assert.equal(result.resolved, false);
    assert.equal(result.missing_columns.length, 1);
  });
});

describe('hasStatMapping', () => {
  it('returns true for known market keys', () => {
    assert.equal(hasStatMapping('player_points_ou'), true);
    assert.equal(hasStatMapping('player_pra_ou'), true);
  });

  it('returns false for unknown', () => {
    assert.equal(hasStatMapping('unknown_key'), false);
  });
});

describe('getSupportedMarketKeys', () => {
  it('returns non-empty list', () => {
    const keys = getSupportedMarketKeys();
    assert.ok(keys.length > 0);
    assert.ok(keys.includes('player_points_ou'));
  });
});

// ── Outcome Bridge ──────────────────────────────────────────────────────────

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

describe('bridgeOutcomeToEvaluation', () => {
  it('converts WIN to binary 1', () => {
    const result = bridgeOutcomeToEvaluation(makeScoredOutcome({ outcome: 'WIN' }));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.outcome, 1);
      assert.equal(result.data.blend.blend_version, 'outcome-bridge-v1.0');
    }
  });

  it('converts LOSS to binary 0', () => {
    const result = bridgeOutcomeToEvaluation(makeScoredOutcome({ outcome: 'LOSS' }));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.outcome, 0);
    }
  });

  it('rejects PUSH', () => {
    const result = bridgeOutcomeToEvaluation(makeScoredOutcome({ outcome: 'PUSH' }));
    assert.equal(result.ok, false);
  });

  it('rejects invalid p_final', () => {
    const result = bridgeOutcomeToEvaluation(makeScoredOutcome({ p_final: 0 }));
    assert.equal(result.ok, false);
  });

  it('rejects invalid p_market_devig', () => {
    const result = bridgeOutcomeToEvaluation(makeScoredOutcome({ p_market_devig: 1 }));
    assert.equal(result.ok, false);
  });

  it('passes sport through options', () => {
    const result = bridgeOutcomeToEvaluation(makeScoredOutcome(), { sport: 'NBA' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.sport, 'NBA');
    }
  });
});

describe('bridgeBatchToEvaluation', () => {
  it('bridges valid records and skips PUSHes', () => {
    const batch = [
      makeScoredOutcome({ outcome: 'WIN' }),
      makeScoredOutcome({ outcome: 'PUSH' }),
      makeScoredOutcome({ outcome: 'LOSS' }),
    ];
    const result = bridgeBatchToEvaluation(batch);
    assert.equal(result.records.length, 2);
    assert.equal(result.skipped, 1);
    assert.equal(result.errors.length, 0);
  });
});

// ── Performance Report ──────────────────────────────────────────────────────

describe('generatePerformanceReport', () => {
  it('returns empty report for no records', () => {
    const report = generatePerformanceReport([]);
    assert.equal(report.overall.total, 0);
    assert.equal(report.overall.wins, 0);
  });

  it('computes hit rate correctly', () => {
    const records = [
      makeScoredOutcome({ outcome: 'WIN' }),
      makeScoredOutcome({ outcome: 'WIN' }),
      makeScoredOutcome({ outcome: 'LOSS' }),
    ];
    const report = generatePerformanceReport(records);
    assert.equal(report.overall.total, 3);
    assert.equal(report.overall.wins, 2);
    assert.equal(report.overall.losses, 1);
    // 2/3 ~ 66.67%
    assert.ok(report.overall.hit_rate_pct > 66 && report.overall.hit_rate_pct < 67);
  });

  it('groups by p_final bin', () => {
    const records = [
      makeScoredOutcome({ p_final: 0.52, outcome: 'WIN' }),
      makeScoredOutcome({ p_final: 0.58, outcome: 'LOSS' }),
      makeScoredOutcome({ p_final: 0.72, outcome: 'WIN' }),
    ];
    const report = generatePerformanceReport(records);
    assert.ok(report.by_p_final_bin.length > 0);
  });
});
