import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPerformanceCohort,
  reconstructCohort,
  validateCohortInput,
  type CohortInput,
  type CohortWindow,
} from './performance-cohort.js';
import type { AttributionInput } from '../attribution/attribution-engine.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WINDOW: CohortWindow = {
  from: '2026-05-01T00:00:00Z',
  to: '2026-05-07T23:59:59Z',
  label: '2026-W18',
};

const PICK_WIN: AttributionInput = {
  pick_id: 'pick-w01',
  settled_at: '2026-05-03T12:00:00Z',
  result: 'win',
  ev_bps: 520,
  clv_at_bet_bps: 480,
  clv_at_close_bps: 600,
  stake_units: 1,
  has_feature_snapshot: true,
};

const PICK_LOSS: AttributionInput = {
  pick_id: 'pick-w02',
  settled_at: '2026-05-04T18:00:00Z',
  result: 'loss',
  ev_bps: 300,
  clv_at_bet_bps: 250,
  clv_at_close_bps: 350,
  stake_units: 1,
  has_feature_snapshot: true,
};

const PICK_PUSH: AttributionInput = {
  pick_id: 'pick-w03',
  settled_at: '2026-05-05T20:00:00Z',
  result: 'push',
  ev_bps: 100,
  clv_at_bet_bps: 90,
  clv_at_close_bps: 110,
  stake_units: 1,
  has_feature_snapshot: true,
};

const VALID_INPUT: CohortInput = {
  cohort_id: 'cohort-2026-W18',
  window: WINDOW,
  picks: [PICK_WIN, PICK_LOSS, PICK_PUSH],
};

// ── validateCohortInput ───────────────────────────────────────────────────────

test('validateCohortInput — passes with full valid input', () => {
  assert.deepEqual(validateCohortInput(VALID_INPUT), []);
});

test('validateCohortInput — rejects missing cohort_id', () => {
  const errors = validateCohortInput({ ...VALID_INPUT, cohort_id: '' });
  assert.ok(errors.some((e) => e.includes('COHORT_MISSING_ID')));
});

test('validateCohortInput — rejects missing window.from', () => {
  const errors = validateCohortInput({
    ...VALID_INPUT,
    window: { ...WINDOW, from: '' },
  });
  assert.ok(errors.some((e) => e.includes('COHORT_MISSING_WINDOW_FROM')));
});

test('validateCohortInput — rejects missing window.to', () => {
  const errors = validateCohortInput({
    ...VALID_INPUT,
    window: { ...WINDOW, to: '' },
  });
  assert.ok(errors.some((e) => e.includes('COHORT_MISSING_WINDOW_TO')));
});

test('validateCohortInput — rejects window.from after window.to', () => {
  const errors = validateCohortInput({
    ...VALID_INPUT,
    window: { from: '2026-05-08T00:00:00Z', to: '2026-05-01T00:00:00Z' },
  });
  assert.ok(errors.some((e) => e.includes('COHORT_WINDOW_FROM_AFTER_TO')));
});

test('validateCohortInput — rejects empty picks array', () => {
  const errors = validateCohortInput({ ...VALID_INPUT, picks: [] });
  assert.ok(errors.some((e) => e.includes('COHORT_EMPTY_PICKS')));
});

test('validateCohortInput — rejects duplicate pick_ids', () => {
  const errors = validateCohortInput({
    ...VALID_INPUT,
    picks: [PICK_WIN, { ...PICK_WIN, result: 'loss' as const }],
  });
  assert.ok(errors.some((e) => e.includes('COHORT_DUPLICATE_PICK_IDS')));
});

// ── buildPerformanceCohort ────────────────────────────────────────────────────

test('buildPerformanceCohort — returns ok:true with valid input', () => {
  const result = buildPerformanceCohort(VALID_INPUT);
  assert.ok(result.ok);
});

test('buildPerformanceCohort — cohort_id matches input', () => {
  const result = buildPerformanceCohort(VALID_INPUT);
  assert.ok(result.ok);
  assert.equal(result.cohort.cohort_id, VALID_INPUT.cohort_id);
});

test('buildPerformanceCohort — pick_count equals input length', () => {
  const result = buildPerformanceCohort(VALID_INPUT);
  assert.ok(result.ok);
  assert.equal(result.cohort.pick_count, VALID_INPUT.picks.length);
});

test('buildPerformanceCohort — attribution_records length equals pick_count', () => {
  const result = buildPerformanceCohort(VALID_INPUT);
  assert.ok(result.ok);
  assert.equal(result.cohort.attribution_records.length, result.cohort.pick_count);
});

test('buildPerformanceCohort — decomposition total_records equals pick_count', () => {
  const result = buildPerformanceCohort(VALID_INPUT);
  assert.ok(result.ok);
  assert.equal(result.cohort.decomposition.total_records, result.cohort.pick_count);
});

test('buildPerformanceCohort — win+loss+push: total_realized_pnl_bps = 0', () => {
  const result = buildPerformanceCohort(VALID_INPUT);
  assert.ok(result.ok);
  // win(10000) + loss(-10000) + push(0) = 0
  assert.equal(result.cohort.decomposition.total_realized_pnl_bps, 0);
});

test('buildPerformanceCohort — is_reproducible true when all picks have feature snapshots', () => {
  const result = buildPerformanceCohort(VALID_INPUT);
  assert.ok(result.ok);
  assert.equal(result.cohort.is_reproducible, true);
});

test('buildPerformanceCohort — is_reproducible false when any pick lacks feature snapshot', () => {
  const input: CohortInput = {
    ...VALID_INPUT,
    picks: [PICK_WIN, { ...PICK_LOSS, has_feature_snapshot: false }],
  };
  const result = buildPerformanceCohort(input);
  assert.ok(result.ok);
  assert.equal(result.cohort.is_reproducible, false);
});

test('buildPerformanceCohort — version is set', () => {
  const result = buildPerformanceCohort(VALID_INPUT);
  assert.ok(result.ok);
  assert.ok(result.cohort.version.length > 0);
});

test('buildPerformanceCohort — rejects pick settled_at outside window', () => {
  const outsidePick: AttributionInput = {
    ...PICK_WIN,
    pick_id: 'pick-outside',
    settled_at: '2026-05-10T00:00:00Z', // after window.to
  };
  const result = buildPerformanceCohort({
    ...VALID_INPUT,
    picks: [outsidePick],
  });
  assert.ok(!result.ok);
  assert.ok(result.reason.includes('COHORT_PICKS_OUTSIDE_WINDOW'));
});

test('buildPerformanceCohort — fails closed on invalid cohort input', () => {
  const result = buildPerformanceCohort({ ...VALID_INPUT, cohort_id: '' });
  assert.ok(!result.ok);
  assert.ok(result.reason.includes('COHORT_MISSING_ID'));
});

test('buildPerformanceCohort — deterministic: same inputs produce same cohort', () => {
  const r1 = buildPerformanceCohort(VALID_INPUT);
  const r2 = buildPerformanceCohort(VALID_INPUT);
  assert.ok(r1.ok && r2.ok);
  assert.deepEqual(r1.cohort, r2.cohort);
});

// ── reconstructCohort ─────────────────────────────────────────────────────────

test('reconstructCohort — matches original build exactly', () => {
  const original = buildPerformanceCohort(VALID_INPUT);
  const reconstructed = reconstructCohort(VALID_INPUT);
  assert.ok(original.ok && reconstructed.ok);
  assert.deepEqual(original.cohort, reconstructed.cohort);
});

test('reconstructCohort — deterministic replay: multiple reconstructions match', () => {
  const r1 = reconstructCohort(VALID_INPUT);
  const r2 = reconstructCohort(VALID_INPUT);
  assert.ok(r1.ok && r2.ok);
  assert.deepEqual(r1.cohort, r2.cohort);
});

// ── Attribution compatibility ─────────────────────────────────────────────────

test('cohort decomposition is compatible with attribution engine', () => {
  // Cohort model_alpha_bps should equal sum of ev_bps for attributed (non-push) picks
  const result = buildPerformanceCohort({
    cohort_id: 'compat-test',
    window: WINDOW,
    picks: [PICK_WIN, PICK_LOSS],
  });
  assert.ok(result.ok);
  // Both wins and losses are attributed (has_feature_snapshot=true), so:
  // model_alpha = ev_bps(win) + ev_bps(loss) * stake (loss bps are negative in realized, not in model)
  // Actually model_component = ev_bps * stake for each pick regardless of result
  const expectedModelAlpha = PICK_WIN.ev_bps + PICK_LOSS.ev_bps;
  assert.equal(result.cohort.decomposition.components.model_alpha_bps, expectedModelAlpha);
});
