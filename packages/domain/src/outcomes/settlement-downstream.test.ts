import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEffectiveSettlement,
  computeSettlementSummary,
} from './settlement-downstream.js';
import type {
  SettlementInput,
  EffectiveSettlement,
} from './settlement-downstream.js';

describe('resolveEffectiveSettlement', () => {
  it('returns error for empty records', () => {
    const result = resolveEffectiveSettlement([]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'NO_RECORDS');
  });

  it('resolves single record with depth 0', () => {
    const record: SettlementInput = {
      id: 'sr-1',
      pick_id: 'pick-1',
      status: 'settled',
      result: 'win',
      confidence: 'confirmed',
      corrects_id: null,
      settled_at: '2026-03-20T12:00:00Z',
    };
    const result = resolveEffectiveSettlement([record]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.settlement.correction_depth, 0);
      assert.equal(result.settlement.result, 'win');
      assert.equal(result.settlement.is_final, true);
    }
  });

  it('resolves correction chain depth 1', () => {
    const records: SettlementInput[] = [
      {
        id: 'sr-1',
        pick_id: 'pick-1',
        status: 'settled',
        result: 'win',
        confidence: 'confirmed',
        corrects_id: null,
        settled_at: '2026-03-20T12:00:00Z',
      },
      {
        id: 'sr-2',
        pick_id: 'pick-1',
        status: 'settled',
        result: 'loss',
        confidence: 'confirmed',
        corrects_id: 'sr-1',
        settled_at: '2026-03-20T13:00:00Z',
      },
    ];
    const result = resolveEffectiveSettlement(records);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.settlement.effective_record_id, 'sr-2');
      assert.equal(result.settlement.result, 'loss');
      assert.equal(result.settlement.correction_depth, 1);
    }
  });

  it('resolves three-record correction chain', () => {
    const records: SettlementInput[] = [
      {
        id: 'sr-1',
        pick_id: 'pick-1',
        status: 'settled',
        result: 'win',
        confidence: 'estimated',
        corrects_id: null,
        settled_at: '2026-03-20T12:00:00Z',
      },
      {
        id: 'sr-2',
        pick_id: 'pick-1',
        status: 'settled',
        result: 'loss',
        confidence: 'estimated',
        corrects_id: 'sr-1',
        settled_at: '2026-03-20T13:00:00Z',
      },
      {
        id: 'sr-3',
        pick_id: 'pick-1',
        status: 'settled',
        result: 'push',
        confidence: 'confirmed',
        corrects_id: 'sr-2',
        settled_at: '2026-03-20T14:00:00Z',
      },
    ];
    const result = resolveEffectiveSettlement(records);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.settlement.effective_record_id, 'sr-3');
      assert.equal(result.settlement.result, 'push');
      assert.equal(result.settlement.correction_depth, 2);
      assert.equal(result.settlement.is_final, true);
    }
  });

  it('returns error for multiple root records', () => {
    const records: SettlementInput[] = [
      {
        id: 'sr-1',
        pick_id: 'pick-1',
        status: 'settled',
        result: 'win',
        confidence: 'confirmed',
        corrects_id: null,
        settled_at: '2026-03-20T12:00:00Z',
      },
      {
        id: 'sr-2',
        pick_id: 'pick-1',
        status: 'settled',
        result: 'loss',
        confidence: 'confirmed',
        corrects_id: null,
        settled_at: '2026-03-20T13:00:00Z',
      },
    ];
    const result = resolveEffectiveSettlement(records);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'MULTIPLE_ROOT_RECORDS');
  });

  it('marks manual_review as not final', () => {
    const record: SettlementInput = {
      id: 'sr-1',
      pick_id: 'pick-1',
      status: 'manual_review',
      result: null,
      confidence: 'pending',
      corrects_id: null,
      settled_at: '2026-03-20T12:00:00Z',
    };
    const result = resolveEffectiveSettlement([record]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.settlement.is_final, false);
      assert.equal(result.settlement.status, 'manual_review');
    }
  });

  it('marks estimated confidence as not final', () => {
    const record: SettlementInput = {
      id: 'sr-1',
      pick_id: 'pick-1',
      status: 'settled',
      result: 'win',
      confidence: 'estimated',
      corrects_id: null,
      settled_at: '2026-03-20T12:00:00Z',
    };
    const result = resolveEffectiveSettlement([record]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.settlement.is_final, false);
  });
});

describe('computeSettlementSummary', () => {
  it('returns zeroed summary for empty input', () => {
    const result = computeSettlementSummary([]);
    assert.equal(result.total_picks, 0);
    assert.equal(result.hit_rate_pct, 0);
    assert.equal(result.flat_bet_roi.roi_pct, 0);
  });

  it('computes correct hit rate for wins and losses', () => {
    const settlements: EffectiveSettlement[] = [
      makeSettlement('pick-1', 'win'),
      makeSettlement('pick-2', 'win'),
      makeSettlement('pick-3', 'loss'),
    ];
    const result = computeSettlementSummary(settlements);
    assert.equal(result.total_picks, 3);
    // hit rate = 2 / (2 + 1) * 100 = 66.6667
    assert.ok(Math.abs(result.hit_rate_pct - 66.6667) < 0.001);
    assert.equal(result.by_result['win'], 2);
    assert.equal(result.by_result['loss'], 1);
  });

  it('excludes void/cancelled from hit rate and ROI', () => {
    const settlements: EffectiveSettlement[] = [
      makeSettlement('pick-1', 'win'),
      makeSettlement('pick-2', 'void'),
      makeSettlement('pick-3', 'cancelled'),
    ];
    const result = computeSettlementSummary(settlements);
    // Only 1 win, 0 losses → hit rate = 100%
    assert.equal(result.hit_rate_pct, 100);
    // ROI only includes 1 win: profit=100, wagered=110
    assert.ok(result.flat_bet_roi.roi_pct > 0);
    assert.equal(result.flat_bet_roi.total_wagered, 110);
  });

  it('counts corrections correctly', () => {
    const settlements: EffectiveSettlement[] = [
      makeSettlement('pick-1', 'win', { correction_depth: 0 }),
      makeSettlement('pick-2', 'loss', { correction_depth: 1 }),
      makeSettlement('pick-3', 'win', { correction_depth: 2 }),
    ];
    const result = computeSettlementSummary(settlements);
    assert.equal(result.correction_count, 2);
    // total_records = (1+0) + (1+1) + (1+2) = 6
    assert.equal(result.total_records, 6);
  });

  it('counts pending reviews', () => {
    const settlements: EffectiveSettlement[] = [
      makeSettlement('pick-1', 'win'),
      {
        pick_id: 'pick-2',
        effective_record_id: 'sr-2',
        result: null,
        status: 'manual_review',
        confidence: 'pending',
        settled_at: '2026-03-20T12:00:00Z',
        correction_depth: 0,
        is_final: false,
      },
    ];
    const result = computeSettlementSummary(settlements);
    assert.equal(result.pending_review_count, 1);
    assert.equal(result.by_status['manual_review'], 1);
    assert.equal(result.by_status['settled'], 1);
  });

  it('computes negative ROI for all losses', () => {
    const settlements: EffectiveSettlement[] = [
      makeSettlement('pick-1', 'loss'),
      makeSettlement('pick-2', 'loss'),
    ];
    const result = computeSettlementSummary(settlements);
    assert.ok(result.flat_bet_roi.roi_pct < 0);
    assert.equal(result.hit_rate_pct, 0);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSettlement(
  pickId: string,
  result: string,
  overrides: Partial<EffectiveSettlement> = {},
): EffectiveSettlement {
  return {
    pick_id: pickId,
    effective_record_id: `sr-${pickId}`,
    result,
    status: 'settled',
    confidence: 'confirmed',
    settled_at: '2026-03-20T12:00:00Z',
    correction_depth: 0,
    is_final: true,
    ...overrides,
  };
}
