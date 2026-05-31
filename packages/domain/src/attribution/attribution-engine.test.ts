import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attributePick,
  decomposePerformance,
  reconstructAttribution,
  validateAttributionInput,
  type AttributionInput,
  type AttributionRecord,
} from './attribution-engine.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const FULL_INPUT: AttributionInput = {
  pick_id: 'pick-001',
  settled_at: '2026-05-31T00:00:00Z',
  result: 'win',
  ev_bps: 520,           // +5.20% EV
  clv_at_bet_bps: 480,   // +4.80% CLV at bet
  clv_at_close_bps: 600, // +6.00% CLV at close
  stake_units: 1,
  has_feature_snapshot: true,
};

const LOSS_INPUT: AttributionInput = {
  ...FULL_INPUT,
  pick_id: 'pick-002',
  result: 'loss',
};

const PUSH_INPUT: AttributionInput = {
  ...FULL_INPUT,
  pick_id: 'pick-003',
  result: 'push',
};

const NO_SNAPSHOT_INPUT: AttributionInput = {
  ...FULL_INPUT,
  pick_id: 'pick-004',
  has_feature_snapshot: false,
};

// ── validateAttributionInput ──────────────────────────────────────────────────

test('validateAttributionInput — passes with full valid input', () => {
  assert.deepEqual(validateAttributionInput(FULL_INPUT), []);
});

test('validateAttributionInput — rejects missing pick_id', () => {
  const errors = validateAttributionInput({ ...FULL_INPUT, pick_id: '' });
  assert.ok(errors.some((e) => e.includes('ATTRIBUTION_MISSING_PICK_ID')));
});

test('validateAttributionInput — rejects missing settled_at', () => {
  const errors = validateAttributionInput({ ...FULL_INPUT, settled_at: '' });
  assert.ok(errors.some((e) => e.includes('ATTRIBUTION_MISSING_SETTLED_AT')));
});

test('validateAttributionInput — rejects invalid result', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errors = validateAttributionInput({ ...FULL_INPUT, result: 'cancelled' as any });
  assert.ok(errors.some((e) => e.includes('ATTRIBUTION_INVALID_RESULT')));
});

test('validateAttributionInput — rejects non-finite EV', () => {
  const errors = validateAttributionInput({ ...FULL_INPUT, ev_bps: NaN });
  assert.ok(errors.some((e) => e.includes('ATTRIBUTION_INVALID_EV_BPS')));
});

// ── attributePick ─────────────────────────────────────────────────────────────

test('attributePick — win: components sum to realized PnL', () => {
  const result = attributePick(FULL_INPUT);
  assert.ok(result.ok);
  const { model_component_bps, execution_component_bps, luck_component_bps, realized_pnl_bps } =
    result.record;
  const componentSum = model_component_bps + execution_component_bps + luck_component_bps;
  assert.equal(Math.round(componentSum * 10000), Math.round(realized_pnl_bps * 10000));
});

test('attributePick — win: realized_pnl_bps = +10000', () => {
  const result = attributePick(FULL_INPUT);
  assert.ok(result.ok);
  assert.equal(result.record.realized_pnl_bps, 10000);
});

test('attributePick — loss: realized_pnl_bps = -10000', () => {
  const result = attributePick(LOSS_INPUT);
  assert.ok(result.ok);
  assert.equal(result.record.realized_pnl_bps, -10000);
});

test('attributePick — push: realized_pnl_bps = 0', () => {
  const result = attributePick(PUSH_INPUT);
  assert.ok(result.ok);
  assert.equal(result.record.realized_pnl_bps, 0);
});

test('attributePick — win: model_component = ev_bps', () => {
  const result = attributePick(FULL_INPUT);
  assert.ok(result.ok);
  assert.equal(result.record.model_component_bps, FULL_INPUT.ev_bps);
});

test('attributePick — execution_component = clv_at_close - clv_at_bet', () => {
  const result = attributePick(FULL_INPUT);
  assert.ok(result.ok);
  const expected = FULL_INPUT.clv_at_close_bps - FULL_INPUT.clv_at_bet_bps;
  assert.equal(result.record.execution_component_bps, expected);
});

test('attributePick — confidence is high with full data', () => {
  const result = attributePick(FULL_INPUT);
  assert.ok(result.ok);
  assert.equal(result.record.confidence, 'high');
});

test('attributePick — confidence is insufficient_data without feature snapshot', () => {
  const result = attributePick(NO_SNAPSHOT_INPUT);
  assert.ok(result.ok);
  assert.equal(result.record.confidence, 'insufficient_data');
  assert.equal(result.record.is_reproducible, false);
});

test('attributePick — insufficient_data: entire PnL assigned to luck', () => {
  const result = attributePick(NO_SNAPSHOT_INPUT);
  assert.ok(result.ok);
  assert.equal(result.record.luck_component_bps, result.record.realized_pnl_bps);
  assert.equal(result.record.model_component_bps, 0);
  assert.equal(result.record.execution_component_bps, 0);
});

test('attributePick — stake_units scales all bps values', () => {
  const result = attributePick({ ...FULL_INPUT, stake_units: 2 });
  assert.ok(result.ok);
  assert.equal(result.record.realized_pnl_bps, 20000);
  assert.equal(result.record.model_component_bps, FULL_INPUT.ev_bps * 2);
});

test('attributePick — is_reproducible true when confidence is not insufficient_data', () => {
  const result = attributePick(FULL_INPUT);
  assert.ok(result.ok);
  assert.equal(result.record.is_reproducible, true);
});

test('attributePick — fails closed on invalid input', () => {
  const result = attributePick({ ...FULL_INPUT, pick_id: '' });
  assert.ok(!result.ok);
  assert.ok(result.reason.includes('ATTRIBUTION_MISSING_PICK_ID'));
});

// ── reconstructAttribution ────────────────────────────────────────────────────

test('reconstructAttribution — deterministic: same inputs produce same record', () => {
  const r1 = attributePick(FULL_INPUT);
  const r2 = reconstructAttribution(FULL_INPUT);
  assert.ok(r1.ok && r2.ok);
  assert.deepEqual(r1.record, r2.record);
});

// ── decomposePerformance ──────────────────────────────────────────────────────

function toRecord(input: AttributionInput): AttributionRecord {
  const r = attributePick(input);
  if (!r.ok) throw new Error(r.reason);
  return r.record;
}

test('decomposePerformance — empty input returns zero decomposition', () => {
  const d = decomposePerformance([]);
  assert.equal(d.total_records, 0);
  assert.equal(d.total_realized_pnl_bps, 0);
  assert.equal(d.is_reproducible, false);
});

test('decomposePerformance — total_realized_pnl_bps sums all records', () => {
  const records = [FULL_INPUT, LOSS_INPUT, PUSH_INPUT].map(toRecord);
  const d = decomposePerformance(records);
  // win (10000) + loss (-10000) + push (0) = 0
  assert.equal(d.total_realized_pnl_bps, 0);
  assert.equal(d.total_records, 3);
});

test('decomposePerformance — excludes insufficient_data from component totals', () => {
  const records = [FULL_INPUT, NO_SNAPSHOT_INPUT].map(toRecord);
  const d = decomposePerformance(records);
  assert.equal(d.attributed_records, 1);
  assert.equal(d.excluded_insufficient_data, 1);
  // model and execution only from attributed record
  assert.equal(d.components.model_alpha_bps, FULL_INPUT.ev_bps);
});

test('decomposePerformance — version is set', () => {
  const d = decomposePerformance([toRecord(FULL_INPUT)]);
  assert.ok(d.version.length > 0);
});

test('decomposePerformance — by_confidence counts match', () => {
  const records = [FULL_INPUT, NO_SNAPSHOT_INPUT].map(toRecord);
  const d = decomposePerformance(records);
  assert.equal(d.by_confidence.high, 1);
  assert.equal(d.by_confidence.insufficient_data, 1);
});
