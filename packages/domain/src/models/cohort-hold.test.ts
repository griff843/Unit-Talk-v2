import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  evaluateCohortHolds,
  isCohortHeld,
  cohortKeyString,
  type CohortHoldEvaluationInput,
  type CohortKey,
} from './cohort-hold.js';

const NBA_SPREAD: CohortKey = { sport: 'nba', market_type: 'spread' };
const NBA_TOTAL: CohortKey = { sport: 'nba', market_type: 'total' };
const MLB_MONEYLINE: CohortKey = { sport: 'mlb', market_type: 'moneyline' };

const THRESHOLDS = [
  { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
  { metric: 'hit_rate', threshold: 0.45, direction: 'below' as const },
];

const BASE_INPUT: CohortHoldEvaluationInput = {
  model_name: 'nba-spread-v3',
  model_version: '3.1.0',
  thresholds: THRESHOLDS,
  cohort_metrics: [
    { cohort: NBA_SPREAD, metrics: { brier_score: 0.20, hit_rate: 0.52 } },
    { cohort: NBA_TOTAL,  metrics: { brier_score: 0.22, hit_rate: 0.55 } },
    { cohort: MLB_MONEYLINE, metrics: { brier_score: 0.19, hit_rate: 0.60 } },
  ],
  evaluated_at_ms: 1_000_000,
};

// ── cohortKeyString ───────────────────────────────────────────────────────────

describe('cohortKeyString', () => {
  it('returns sport:market_type format', () => {
    assert.equal(cohortKeyString(NBA_SPREAD), 'nba:spread');
    assert.equal(cohortKeyString(MLB_MONEYLINE), 'mlb:moneyline');
  });
});

// ── evaluateCohortHolds — normal paths ────────────────────────────────────────

describe('evaluateCohortHolds', () => {
  it('no holds when all cohorts pass', () => {
    const result = evaluateCohortHolds(BASE_INPUT);
    assert.equal(result.any_held, false);
    assert.equal(result.held_cohorts.length, 0);
    assert.equal(result.passing_cohort_keys.length, 3);
  });

  it('holds only the breaching cohort — others remain active', () => {
    const result = evaluateCohortHolds({
      ...BASE_INPUT,
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: { brier_score: 0.32, hit_rate: 0.52 } }, // breach
        { cohort: NBA_TOTAL,  metrics: { brier_score: 0.22, hit_rate: 0.55 } }, // pass
        { cohort: MLB_MONEYLINE, metrics: { brier_score: 0.19, hit_rate: 0.60 } }, // pass
      ],
    });
    assert.equal(result.any_held, true);
    assert.equal(result.held_cohorts.length, 1);
    assert.equal(result.held_cohorts[0]?.cohort_key, 'nba:spread');
    assert.equal(result.passing_cohort_keys.length, 2);
    assert.ok(result.passing_cohort_keys.includes('nba:total'));
    assert.ok(result.passing_cohort_keys.includes('mlb:moneyline'));
  });

  it('holds multiple cohorts when multiple breach', () => {
    const result = evaluateCohortHolds({
      ...BASE_INPUT,
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: { brier_score: 0.31, hit_rate: 0.52 } }, // breach brier
        { cohort: NBA_TOTAL,  metrics: { brier_score: 0.22, hit_rate: 0.38 } }, // breach hit_rate
        { cohort: MLB_MONEYLINE, metrics: { brier_score: 0.19, hit_rate: 0.60 } }, // pass
      ],
    });
    assert.equal(result.held_cohorts.length, 2);
    assert.equal(result.passing_cohort_keys.length, 1);
    assert.equal(result.passing_cohort_keys[0], 'mlb:moneyline');
  });

  it('cohort hold has correct hold_id format', () => {
    const result = evaluateCohortHolds({
      ...BASE_INPUT,
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: { brier_score: 0.30, hit_rate: 0.52 } },
      ],
    });
    const hold = result.held_cohorts[0];
    assert.ok(hold?.hold_id.includes('nba-spread-v3@3.1.0:nba:spread'));
    assert.ok(hold?.hold_id.includes('1000000'));
  });

  it('blocks_scoring_for_cohort is always true on a hold', () => {
    const result = evaluateCohortHolds({
      ...BASE_INPUT,
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: { brier_score: 0.30, hit_rate: 0.52 } },
      ],
    });
    assert.equal(result.held_cohorts[0]?.blocks_scoring_for_cohort, true);
  });

  it('cohort hold captures all violations in the cohort', () => {
    const result = evaluateCohortHolds({
      ...BASE_INPUT,
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: { brier_score: 0.35, hit_rate: 0.40 } }, // both breach
      ],
    });
    const hold = result.held_cohorts[0];
    assert.equal(hold?.violations.length, 2);
  });

  it('exactly at threshold does not trigger hold', () => {
    const result = evaluateCohortHolds({
      ...BASE_INPUT,
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: { brier_score: 0.25, hit_rate: 0.45 } },
      ],
    });
    assert.equal(result.any_held, false);
  });

  it('emits cohort_hold_triggered audit event with correct entity_id', () => {
    const result = evaluateCohortHolds({
      ...BASE_INPUT,
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: { brier_score: 0.30, hit_rate: 0.52 } },
      ],
    });
    const event = result.held_cohorts[0]?.audit_event;
    assert.equal(event?.event_type, 'cohort_hold_triggered');
    assert.equal(event?.entity_type, 'model_version_cohort');
    assert.equal(event?.entity_id, 'nba-spread-v3@3.1.0:nba:spread');
    assert.equal(event?.cohort_key, 'nba:spread');
    assert.equal(event?.triggered_at_ms, 1_000_000);
  });

  it('empty cohort_metrics produces no holds and no passing keys', () => {
    const result = evaluateCohortHolds({ ...BASE_INPUT, cohort_metrics: [] });
    assert.equal(result.any_held, false);
    assert.equal(result.held_cohorts.length, 0);
    assert.equal(result.passing_cohort_keys.length, 0);
  });

  it('is deterministic — same input produces identical result', () => {
    const r1 = evaluateCohortHolds(BASE_INPUT);
    const r2 = evaluateCohortHolds(BASE_INPUT);
    assert.deepEqual(r1, r2);
  });
});

// ── isCohortHeld ──────────────────────────────────────────────────────────────

describe('isCohortHeld', () => {
  it('returns true for a held cohort', () => {
    const result = evaluateCohortHolds({
      ...BASE_INPUT,
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: { brier_score: 0.30, hit_rate: 0.52 } },
        { cohort: NBA_TOTAL,  metrics: { brier_score: 0.22, hit_rate: 0.55 } },
      ],
    });
    assert.equal(isCohortHeld(result, NBA_SPREAD), true);
    assert.equal(isCohortHeld(result, NBA_TOTAL), false);
  });

  it('returns false for a cohort not in the evaluation', () => {
    const result = evaluateCohortHolds(BASE_INPUT);
    assert.equal(isCohortHeld(result, { sport: 'nfl', market_type: 'spread' }), false);
  });
});

// ── ADVERSARIAL VALIDATION — INIT-3.3.3 requirement: cohort-only breach must fire ──

describe('evaluateCohortHolds — adversarial validation', () => {
  it('[ADVERSARIAL] cohort-only degradation fires cohort hold while aggregate passes', () => {
    // Aggregate: 3 cohorts, 2 pass cleanly, 1 breaches (nba:spread).
    // Aggregate average brier would be ~0.26 which is marginal, but
    // cohort-level enforcement must fire regardless of aggregate.
    const result = evaluateCohortHolds({
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      thresholds: [
        { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
      ],
      cohort_metrics: [
        { cohort: NBA_SPREAD,    metrics: { brier_score: 0.38 } }, // inject: NBA spread degraded
        { cohort: NBA_TOTAL,     metrics: { brier_score: 0.18 } }, // healthy
        { cohort: MLB_MONEYLINE, metrics: { brier_score: 0.16 } }, // healthy
      ],
      evaluated_at_ms: 2_000_000,
    });

    // NBA spread cohort must be held
    assert.equal(result.any_held, true, 'cohort hold must fire for degraded cohort');
    assert.equal(result.held_cohorts.length, 1, 'only the degraded cohort should be held');
    assert.equal(result.held_cohorts[0]?.cohort_key, 'nba:spread', 'correct cohort held');

    // Other cohorts must remain active
    assert.equal(isCohortHeld(result, NBA_TOTAL), false, 'nba:total must remain active');
    assert.equal(isCohortHeld(result, MLB_MONEYLINE), false, 'mlb:moneyline must remain active');

    // Verify the hold blocks scoring for the held cohort
    assert.equal(result.held_cohorts[0]?.blocks_scoring_for_cohort, true);
  });

  it('[ADVERSARIAL] multi-cohort degradation — each breaching cohort fires independently', () => {
    const result = evaluateCohortHolds({
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      thresholds: [
        { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
        { metric: 'hit_rate',    threshold: 0.45, direction: 'below' as const },
      ],
      cohort_metrics: [
        { cohort: NBA_SPREAD,    metrics: { brier_score: 0.35, hit_rate: 0.50 } }, // brier breach
        { cohort: NBA_TOTAL,     metrics: { brier_score: 0.20, hit_rate: 0.40 } }, // hit_rate breach
        { cohort: MLB_MONEYLINE, metrics: { brier_score: 0.18, hit_rate: 0.60 } }, // clean
      ],
      evaluated_at_ms: 2_000_000,
    });

    assert.equal(result.held_cohorts.length, 2, 'both degraded cohorts must be held');
    assert.equal(result.passing_cohort_keys.length, 1);
    assert.equal(result.passing_cohort_keys[0], 'mlb:moneyline');

    const spreadHold = result.held_cohorts.find((h) => h.cohort_key === 'nba:spread');
    const totalHold  = result.held_cohorts.find((h) => h.cohort_key === 'nba:total');

    assert.ok(spreadHold, 'nba:spread hold must exist');
    assert.ok(totalHold,  'nba:total hold must exist');
    assert.equal(spreadHold?.violations[0]?.metric, 'brier_score');
    assert.equal(totalHold?.violations[0]?.metric, 'hit_rate');
  });

  it('[ADVERSARIAL] missing cohort metric fails closed — hold fires', () => {
    // A cohort that has no data for a configured threshold must fail-closed.
    const result = evaluateCohortHolds({
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      thresholds: [
        { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
      ],
      cohort_metrics: [
        { cohort: NBA_SPREAD, metrics: {} }, // brier_score absent — fail closed
      ],
      evaluated_at_ms: 2_000_000,
    });

    assert.equal(result.any_held, true, 'missing metric must fail closed — hold must fire');
    assert.equal(result.held_cohorts[0]?.cohort_key, 'nba:spread');
  });
});
