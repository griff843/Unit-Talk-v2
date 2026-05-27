import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildCalibrationProof, type CalibrationProofInput } from './calibration-proof.js';

const THRESHOLDS = [
  { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
  { metric: 'hit_rate',    threshold: 0.45, direction: 'below' as const },
];

const BASE_INPUT: CalibrationProofInput = {
  proof_id: 'proof-001',
  model_name: 'nba-spread-v3',
  model_version: '3.1.0',
  evaluated_at_ms: 1_000_000,
  thresholds: THRESHOLDS,
  aggregate_metrics: { brier_score: 0.20, hit_rate: 0.52 },
  cohort_metrics: [
    { cohort: { sport: 'nba', market_type: 'spread' }, metrics: { brier_score: 0.20, hit_rate: 0.52 } },
    { cohort: { sport: 'nba', market_type: 'total' },  metrics: { brier_score: 0.22, hit_rate: 0.55 } },
  ],
};

// ── Normal paths ──────────────────────────────────────────────────────────────

describe('buildCalibrationProof', () => {
  it('returns approved with no hold when all metrics pass', () => {
    const proof = buildCalibrationProof(BASE_INPUT);
    assert.equal(proof.calibration_report.status, 'pass');
    assert.equal(proof.gate_result.decision, 'approved');
    assert.equal(proof.deployment_hold, null);
    assert.equal(proof.any_enforcement_fired, false);
  });

  it('produces a deployment hold when aggregate report fails', () => {
    const proof = buildCalibrationProof({
      ...BASE_INPUT,
      aggregate_metrics: { brier_score: 0.30, hit_rate: 0.52 }, // breach
    });
    assert.equal(proof.calibration_report.status, 'fail');
    assert.equal(proof.gate_result.decision, 'blocked');
    assert.ok(proof.deployment_hold, 'deployment hold must be placed');
    assert.equal(proof.deployment_hold?.deployment_state, 'held');
    assert.equal(proof.deployment_hold?.blocks_scoring, true);
    assert.equal(proof.any_enforcement_fired, true);
  });

  it('detects cohort holds independently of aggregate gate', () => {
    // Aggregate passes; one cohort breaches
    const proof = buildCalibrationProof({
      ...BASE_INPUT,
      aggregate_metrics: { brier_score: 0.20, hit_rate: 0.52 }, // aggregate pass
      cohort_metrics: [
        { cohort: { sport: 'nba', market_type: 'spread' }, metrics: { brier_score: 0.30, hit_rate: 0.52 } }, // breach
        { cohort: { sport: 'nba', market_type: 'total' },  metrics: { brier_score: 0.22, hit_rate: 0.55 } }, // pass
      ],
    });
    assert.equal(proof.gate_result.decision, 'approved');
    assert.equal(proof.deployment_hold, null);
    assert.equal(proof.cohort_hold_result.any_held, true);
    assert.equal(proof.cohort_hold_result.held_cohorts.length, 1);
    assert.equal(proof.any_enforcement_fired, true);
  });

  it('hold uses prior_deployment_state when provided', () => {
    const proof = buildCalibrationProof({
      ...BASE_INPUT,
      aggregate_metrics: { brier_score: 0.30, hit_rate: 0.52 },
      prior_deployment_state: 'held',
    });
    assert.equal(proof.deployment_hold?.deployment_state, 'quarantined');
    assert.equal(proof.deployment_hold?.previous_state, 'held');
  });

  it('defaults prior_deployment_state to active', () => {
    const proof = buildCalibrationProof({
      ...BASE_INPUT,
      aggregate_metrics: { brier_score: 0.30, hit_rate: 0.52 },
    });
    assert.equal(proof.deployment_hold?.previous_state, 'active');
    assert.equal(proof.deployment_hold?.deployment_state, 'held');
  });

  it('empty cohort_metrics yields no cohort holds', () => {
    const proof = buildCalibrationProof({ ...BASE_INPUT, cohort_metrics: [] });
    assert.equal(proof.cohort_hold_result.any_held, false);
    assert.equal(proof.cohort_hold_result.held_cohorts.length, 0);
  });

  it('is deterministic — same input produces identical result', () => {
    const p1 = buildCalibrationProof(BASE_INPUT);
    const p2 = buildCalibrationProof(BASE_INPUT);
    assert.deepEqual(p1, p2);
  });
});

// ── ADVERSARIAL VALIDATION — INIT-3.3.4 proof bundle correctness ──────────────

describe('buildCalibrationProof — adversarial validation', () => {
  it('[ADVERSARIAL] injected breach holds model — full chain fires correctly', () => {
    // Reproduce: inject breach → calibration report fails → gate blocks → hold placed
    const proof = buildCalibrationProof({
      proof_id: 'adv-001',
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      evaluated_at_ms: 2_000_000,
      thresholds: [
        { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
      ],
      aggregate_metrics: { brier_score: 0.38 }, // inject: above threshold
      cohort_metrics: [],
    });

    // Step 1: report must fail
    assert.equal(proof.calibration_report.status, 'fail', 'report must fail on injected breach');

    // Step 2: gate must block
    assert.equal(proof.gate_result.decision, 'blocked', 'gate must block failed model');
    assert.equal(proof.gate_result.block_reason, 'calibration_failed');

    // Step 3: hold must fire
    assert.ok(proof.deployment_hold, 'deployment hold must be placed');
    assert.equal(proof.deployment_hold?.blocks_scoring, true, 'hold must block scoring');
    assert.equal(proof.deployment_hold?.trigger, 'calibration_breach');
    assert.equal(proof.deployment_hold?.breach?.metric, 'brier_score');
    assert.equal(proof.deployment_hold?.breach?.actual_value, 0.38);

    // Enforcement fired
    assert.equal(proof.any_enforcement_fired, true);
  });

  it('[ADVERSARIAL] cohort-only degradation — cohort hold fires, no model-level hold', () => {
    // Aggregate passes; NBA spread cohort breaches — cohort hold fires, model not held
    const proof = buildCalibrationProof({
      proof_id: 'adv-002',
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      evaluated_at_ms: 2_000_000,
      thresholds: [
        { metric: 'brier_score', threshold: 0.25, direction: 'above' as const },
      ],
      aggregate_metrics: { brier_score: 0.18 }, // aggregate passes
      cohort_metrics: [
        { cohort: { sport: 'nba', market_type: 'spread' }, metrics: { brier_score: 0.40 } }, // cohort fails
        { cohort: { sport: 'nba', market_type: 'total' },  metrics: { brier_score: 0.15 } }, // cohort passes
      ],
    });

    // Aggregate gate approves
    assert.equal(proof.gate_result.decision, 'approved', 'aggregate gate must approve passing model');
    assert.equal(proof.deployment_hold, null, 'no model-level hold when aggregate passes');

    // Cohort hold fires for the degraded cohort
    assert.equal(proof.cohort_hold_result.any_held, true, 'cohort hold must fire');
    assert.equal(proof.cohort_hold_result.held_cohorts.length, 1);
    assert.equal(proof.cohort_hold_result.held_cohorts[0]?.cohort_key, 'nba:spread');

    // Other cohort unaffected
    assert.equal(proof.cohort_hold_result.passing_cohort_keys.length, 1);
    assert.equal(proof.cohort_hold_result.passing_cohort_keys[0], 'nba:total');

    assert.equal(proof.any_enforcement_fired, true, 'enforcement fired via cohort hold');
  });

  it('[ADVERSARIAL] reproduced metrics are identical on replay', () => {
    // Confirm reproducibility: two independent runs with same inputs give same proof
    const input: CalibrationProofInput = {
      proof_id: 'adv-replay',
      model_name: 'nba-spread-v3',
      model_version: '3.1.0',
      evaluated_at_ms: 3_000_000,
      thresholds: THRESHOLDS,
      aggregate_metrics: { brier_score: 0.28, hit_rate: 0.50 },
      cohort_metrics: [
        { cohort: { sport: 'nba', market_type: 'spread' }, metrics: { brier_score: 0.28, hit_rate: 0.50 } },
      ],
    };

    const run1 = buildCalibrationProof(input);
    const run2 = buildCalibrationProof(input);

    assert.deepEqual(run1, run2, 'calibration proof must be reproducible from stored inputs');
  });
});
