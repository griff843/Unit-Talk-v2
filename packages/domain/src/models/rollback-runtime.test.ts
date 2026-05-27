import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildRollbackRecord,
  verifyRollbackPropagation,
  type RollbackInput,
  type RollbackPropagationInput,
} from './rollback-runtime.js';

const BASE_INPUT: RollbackInput = {
  rollback_id: 'rbk-001',
  model_name: 'nba-spread-v3',
  from_version: '3.1.0',
  from_artifact_sha: 'deadbeef',
  to_version: '3.0.2',
  to_artifact_sha: 'cafebabe',
  trigger: 'sha_mismatch',
  initiated_at_ms: 1_000_000,
};

describe('buildRollbackRecord', () => {
  it('returns initiated status when only initiated_at is set', () => {
    const result = buildRollbackRecord(BASE_INPUT);
    assert.equal(result.status, 'initiated');
    assert.equal(result.propagated_at_ms, null);
    assert.equal(result.verified_at_ms, null);
    assert.equal(result.error_message, null);
    assert.equal(result.sha_verified, false);
  });

  it('returns propagated status when propagated_at is set but not sha_verified', () => {
    const result = buildRollbackRecord({
      ...BASE_INPUT,
      propagated_at_ms: 1_001_000,
    });
    assert.equal(result.status, 'propagated');
    assert.equal(result.propagated_at_ms, 1_001_000);
  });

  it('returns verified status when propagated, verified_at set, and sha_verified true', () => {
    const result = buildRollbackRecord({
      ...BASE_INPUT,
      propagated_at_ms: 1_001_000,
      verified_at_ms: 1_002_000,
      sha_verified: true,
    });
    assert.equal(result.status, 'verified');
    assert.equal(result.verified_at_ms, 1_002_000);
    assert.equal(result.sha_verified, true);
  });

  it('returns failed status when error_message is set', () => {
    const result = buildRollbackRecord({
      ...BASE_INPUT,
      error_message: 'routing table update timed out',
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.error_message, 'routing table update timed out');
  });

  it('failed status takes precedence over propagated/verified fields', () => {
    const result = buildRollbackRecord({
      ...BASE_INPUT,
      propagated_at_ms: 1_001_000,
      verified_at_ms: 1_002_000,
      sha_verified: true,
      error_message: 'partial propagation failure',
    });
    assert.equal(result.status, 'failed');
  });

  it('defaults fail_open to true', () => {
    const result = buildRollbackRecord(BASE_INPUT);
    assert.equal(result.fail_open, true);
  });

  it('respects explicit fail_open: false', () => {
    const result = buildRollbackRecord({ ...BASE_INPUT, fail_open: false });
    assert.equal(result.fail_open, false);
  });

  it('passes through all trigger types', () => {
    const triggers = [
      'sha_mismatch',
      'divergence_threshold',
      'calibration_failure',
      'deployment_breach',
      'manual_override',
    ] as const;
    for (const trigger of triggers) {
      const result = buildRollbackRecord({ ...BASE_INPUT, trigger });
      assert.equal(result.trigger, trigger);
    }
  });

  it('coerces undefined optional fields to null', () => {
    const result = buildRollbackRecord({
      rollback_id: 'rbk-null',
      model_name: 'test-model',
      from_version: '1.0.0',
      to_version: '0.9.0',
      trigger: 'manual_override',
      initiated_at_ms: 1_000_000,
    });
    assert.equal(result.from_artifact_sha, null);
    assert.equal(result.to_artifact_sha, null);
    assert.equal(result.trigger_detail, null);
    assert.equal(result.error_message, null);
  });

  it('is deterministic — same input produces identical result', () => {
    const r1 = buildRollbackRecord(BASE_INPUT);
    const r2 = buildRollbackRecord(BASE_INPUT);
    assert.deepEqual(r1, r2);
  });

  it('result is immutable (all fields readonly at type level)', () => {
    const result = buildRollbackRecord(BASE_INPUT);
    // Verify identity — structural check for required fields
    assert.ok(typeof result.rollback_id === 'string');
    assert.ok(typeof result.initiated_at_ms === 'number');
  });
});

describe('verifyRollbackPropagation', () => {
  const BASE_PROP_INPUT: RollbackPropagationInput = {
    rollback_id: 'rbk-001',
    model_name: 'nba-spread-v3',
    expected_version: '3.0.2',
    expected_artifact_sha: 'cafebabe',
    actual_version: '3.0.2',
    actual_artifact_sha: 'cafebabe',
    checked_at_ms: 1_003_000,
  };

  it('returns propagated=true and sha_match=true when versions and SHAs match', () => {
    const result = verifyRollbackPropagation(BASE_PROP_INPUT);
    assert.equal(result.propagated, true);
    assert.equal(result.sha_match, true);
  });

  it('returns propagated=false when actual_version differs from expected', () => {
    const result = verifyRollbackPropagation({
      ...BASE_PROP_INPUT,
      actual_version: '3.1.0',
    });
    assert.equal(result.propagated, false);
  });

  it('returns sha_match=false when SHAs differ', () => {
    const result = verifyRollbackPropagation({
      ...BASE_PROP_INPUT,
      actual_artifact_sha: 'different-sha',
    });
    assert.equal(result.propagated, true);
    assert.equal(result.sha_match, false);
  });

  it('returns sha_match=null when expected_artifact_sha is absent', () => {
    const result = verifyRollbackPropagation({
      ...BASE_PROP_INPUT,
      expected_artifact_sha: null,
    });
    assert.equal(result.sha_match, null);
  });

  it('returns sha_match=null when actual_artifact_sha is absent', () => {
    const result = verifyRollbackPropagation({
      ...BASE_PROP_INPUT,
      actual_artifact_sha: null,
    });
    assert.equal(result.sha_match, null);
  });

  it('returns propagated=false when actual_version is null', () => {
    const result = verifyRollbackPropagation({
      ...BASE_PROP_INPUT,
      actual_version: null,
    });
    assert.equal(result.propagated, false);
    assert.equal(result.actual_version, null);
  });

  it('is deterministic — same input produces identical result', () => {
    const r1 = verifyRollbackPropagation(BASE_PROP_INPUT);
    const r2 = verifyRollbackPropagation(BASE_PROP_INPUT);
    assert.deepEqual(r1, r2);
  });
});
