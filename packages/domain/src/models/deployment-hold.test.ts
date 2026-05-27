import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildDeploymentHold,
  evaluateBreachHold,
  type DeploymentHoldInput,
  type BreachEvaluationInput,
} from './deployment-hold.js';

const BASE_INPUT: DeploymentHoldInput = {
  hold_id: 'hold-001',
  model_name: 'nba-spread-v3',
  model_version: '3.1.0',
  artifact_sha: 'deadbeef',
  trigger: 'calibration_breach',
  breach: {
    metric: 'brier_score',
    threshold: 0.25,
    actual_value: 0.31,
    direction: 'above',
  },
  initiated_at_ms: 1_000_000,
};

describe('buildDeploymentHold', () => {
  it('transitions active → held on first breach', () => {
    const hold = buildDeploymentHold(BASE_INPUT);
    assert.equal(hold.deployment_state, 'held');
    assert.equal(hold.previous_state, 'active');
    assert.equal(hold.blocks_scoring, true);
  });

  it('transitions held → quarantined on repeat breach', () => {
    const hold = buildDeploymentHold({ ...BASE_INPUT, previous_state: 'held' });
    assert.equal(hold.deployment_state, 'quarantined');
    assert.equal(hold.previous_state, 'held');
    assert.equal(hold.blocks_scoring, true);
  });

  it('quarantined stays quarantined', () => {
    const hold = buildDeploymentHold({ ...BASE_INPUT, previous_state: 'quarantined' });
    assert.equal(hold.deployment_state, 'quarantined');
    assert.equal(hold.blocks_scoring, true);
  });

  it('retired stays retired', () => {
    const hold = buildDeploymentHold({ ...BASE_INPUT, previous_state: 'retired' });
    assert.equal(hold.deployment_state, 'retired');
    assert.equal(hold.blocks_scoring, false);
  });

  it('defaults previous_state to active when not provided', () => {
    const hold = buildDeploymentHold(BASE_INPUT);
    assert.equal(hold.previous_state, 'active');
    assert.equal(hold.deployment_state, 'held');
  });

  it('emits a deployment_hold_triggered audit event', () => {
    const hold = buildDeploymentHold(BASE_INPUT);
    assert.equal(hold.audit_event.event_type, 'deployment_hold_triggered');
    assert.equal(hold.audit_event.entity_type, 'model_version');
    assert.equal(hold.audit_event.entity_id, 'nba-spread-v3@3.1.0');
    assert.equal(hold.audit_event.previous_state, 'active');
    assert.equal(hold.audit_event.new_state, 'held');
    assert.equal(hold.audit_event.triggered_at_ms, 1_000_000);
    assert.equal(hold.audit_event.trigger, 'calibration_breach');
  });

  it('audit event entity_id uses model_name@model_version format', () => {
    const hold = buildDeploymentHold({
      ...BASE_INPUT,
      model_name: 'mlb-total',
      model_version: '1.0.5',
    });
    assert.equal(hold.audit_event.entity_id, 'mlb-total@1.0.5');
  });

  it('passes through all trigger types', () => {
    const triggers = [
      'calibration_breach',
      'sha_mismatch',
      'divergence_threshold',
      'rollback_failed',
    ] as const;
    for (const trigger of triggers) {
      const hold = buildDeploymentHold({ ...BASE_INPUT, trigger });
      assert.equal(hold.trigger, trigger);
      assert.equal(hold.audit_event.trigger, trigger);
    }
  });

  it('coerces undefined artifact_sha to null', () => {
    const hold = buildDeploymentHold({ ...BASE_INPUT, artifact_sha: undefined });
    assert.equal(hold.artifact_sha, null);
  });

  it('coerces undefined breach to null', () => {
    const hold = buildDeploymentHold({ ...BASE_INPUT, breach: undefined });
    assert.equal(hold.breach, null);
  });

  it('is deterministic — same input produces identical result', () => {
    const h1 = buildDeploymentHold(BASE_INPUT);
    const h2 = buildDeploymentHold(BASE_INPUT);
    assert.deepEqual(h1, h2);
  });
});

// ADVERSARIAL VALIDATION — INIT-3.3.1 requirement: "Inject a breach; the hold must fire"
describe('evaluateBreachHold — adversarial validation', () => {
  const BASE_EVAL: BreachEvaluationInput = {
    model_name: 'nba-spread-v3',
    model_version: '3.1.0',
    thresholds: [
      { metric: 'brier_score', threshold: 0.25, direction: 'above' },
      { metric: 'hit_rate', threshold: 0.45, direction: 'below' },
    ],
    metrics: {
      brier_score: 0.20,
      hit_rate: 0.52,
    },
  };

  it('[ADVERSARIAL] injected brier_score breach — hold fires automatically', () => {
    const result = evaluateBreachHold({
      ...BASE_EVAL,
      metrics: { ...BASE_EVAL.metrics, brier_score: 0.31 }, // inject above threshold
    });
    assert.equal(result.breached, true, 'breach must fire when brier_score > 0.25');
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]?.metric, 'brier_score');
    assert.equal(result.violations[0]?.actual_value, 0.31);
    assert.equal(result.violations[0]?.direction, 'above');

    // Confirm the hold would block scoring
    const hold = buildDeploymentHold({
      hold_id: 'adv-001',
      model_name: result.model_name,
      model_version: result.model_version,
      trigger: 'calibration_breach',
      breach: result.violations[0] ?? null,
      initiated_at_ms: 2_000_000,
    });
    assert.equal(hold.blocks_scoring, true, 'hold must block scoring');
    assert.equal(hold.deployment_state, 'held');
  });

  it('[ADVERSARIAL] injected hit_rate breach — hold fires automatically', () => {
    const result = evaluateBreachHold({
      ...BASE_EVAL,
      metrics: { ...BASE_EVAL.metrics, hit_rate: 0.41 }, // inject below threshold
    });
    assert.equal(result.breached, true, 'breach must fire when hit_rate < 0.45');
    assert.equal(result.violations[0]?.metric, 'hit_rate');
    assert.equal(result.violations[0]?.direction, 'below');
  });

  it('[ADVERSARIAL] simultaneous multi-metric breach — all violations captured', () => {
    const result = evaluateBreachHold({
      ...BASE_EVAL,
      metrics: { brier_score: 0.40, hit_rate: 0.30 },
    });
    assert.equal(result.breached, true);
    assert.equal(result.violations.length, 2);
  });

  it('no breach when all metrics are within bounds', () => {
    const result = evaluateBreachHold(BASE_EVAL);
    assert.equal(result.breached, false);
    assert.equal(result.violations.length, 0);
  });

  it('exactly at threshold is not a breach (strictly greater/less than)', () => {
    const result = evaluateBreachHold({
      ...BASE_EVAL,
      metrics: { brier_score: 0.25, hit_rate: 0.45 },
    });
    assert.equal(result.breached, false, 'threshold boundary is not a breach');
  });

  it('unknown metric is silently skipped — no false-positive breach', () => {
    const result = evaluateBreachHold({
      ...BASE_EVAL,
      metrics: { unknown_metric: 999 },
    });
    assert.equal(result.breached, false);
  });

  it('is deterministic — same input produces identical result', () => {
    const r1 = evaluateBreachHold(BASE_EVAL);
    const r2 = evaluateBreachHold(BASE_EVAL);
    assert.deepEqual(r1, r2);
  });
});
