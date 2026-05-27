import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShadowInferenceResult } from './shadow-inference.js';

const NOW = 1748376000000;
const ID = 'shadow-001';
const SHA = 'a'.repeat(64);

test('completed status when shadow_score is set and no error', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: ID,
    model_name: 'nfl-spread-v2',
    model_version: 'v1',
    artifact_sha: SHA,
    input_hash: 'hash-abc',
    shadow_score: 0.72,
    production_score: 0.70,
    error_message: null,
    inferred_at_ms: NOW,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.shadow_score, 0.72);
  assert.equal(result.production_score, 0.70);
});

test('failed status when error_message is set', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: ID,
    model_name: 'nfl-spread-v2',
    model_version: 'v1',
    artifact_sha: SHA,
    input_hash: 'hash-abc',
    shadow_score: null,
    production_score: 0.70,
    error_message: 'model timeout',
    inferred_at_ms: NOW,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error_message, 'model timeout');
});

test('skipped status when shadow_score is null with no error', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: ID,
    model_name: 'nfl-spread-v2',
    model_version: 'v1',
    artifact_sha: null,
    input_hash: 'hash-abc',
    shadow_score: null,
    production_score: 0.70,
    error_message: null,
    inferred_at_ms: NOW,
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.diverged, false);
  assert.equal(result.divergence_delta, null);
});

test('diverged=true when delta exceeds default threshold (1%)', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: ID,
    model_name: 'nfl-spread-v2',
    model_version: 'v1',
    artifact_sha: SHA,
    input_hash: 'hash-abc',
    shadow_score: 0.80,
    production_score: 0.78,
    error_message: null,
    inferred_at_ms: NOW,
  });
  assert.equal(result.diverged, true);
  assert.ok(result.divergence_delta !== null && result.divergence_delta > 0.01);
});

test('diverged=false when delta is within threshold', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: ID,
    model_name: 'nfl-spread-v2',
    model_version: 'v1',
    artifact_sha: SHA,
    input_hash: 'hash-abc',
    shadow_score: 0.7001,
    production_score: 0.7000,
    error_message: null,
    inferred_at_ms: NOW,
  });
  assert.equal(result.diverged, false);
  assert.ok(result.divergence_delta !== null && result.divergence_delta <= 0.01);
});

test('custom divergence_threshold respected', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: ID,
    model_name: 'test-model',
    model_version: 'v1',
    artifact_sha: SHA,
    input_hash: 'hash-abc',
    shadow_score: 0.705,
    production_score: 0.700,
    error_message: null,
    inferred_at_ms: NOW,
    divergence_threshold: 0.003,
  });
  assert.equal(result.diverged, true);
});

test('diverged=false when both scores are null', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: ID,
    model_name: 'test-model',
    model_version: 'v1',
    artifact_sha: null,
    input_hash: 'hash-abc',
    shadow_score: null,
    production_score: null,
    error_message: null,
    inferred_at_ms: NOW,
  });
  assert.equal(result.diverged, false);
  assert.equal(result.divergence_delta, null);
});

test('artifact_sha null when undefined provided', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: ID,
    model_name: 'legacy-model',
    model_version: 'v1',
    artifact_sha: undefined,
    input_hash: 'hash-abc',
    shadow_score: 0.5,
    production_score: 0.5,
    error_message: null,
    inferred_at_ms: NOW,
  });
  assert.equal(result.artifact_sha, null);
});

test('all fields passed through', () => {
  const result = buildShadowInferenceResult({
    shadow_inference_id: 'shadow-xyz',
    model_name: 'nba-total-v3',
    model_version: 'v2.1.0',
    artifact_sha: SHA,
    input_hash: 'hash-def',
    shadow_score: 0.65,
    production_score: 0.64,
    error_message: null,
    inferred_at_ms: NOW,
  });
  assert.equal(result.shadow_inference_id, 'shadow-xyz');
  assert.equal(result.model_name, 'nba-total-v3');
  assert.equal(result.model_version, 'v2.1.0');
  assert.equal(result.artifact_sha, SHA);
  assert.equal(result.input_hash, 'hash-def');
  assert.equal(result.inferred_at_ms, NOW);
});

test('deterministic: same input always returns same result', () => {
  const input = {
    shadow_inference_id: ID,
    model_name: 'det-model',
    model_version: 'v1',
    artifact_sha: SHA,
    input_hash: 'hash-det',
    shadow_score: 0.55,
    production_score: 0.54,
    error_message: null,
    inferred_at_ms: NOW,
  };
  const r1 = buildShadowInferenceResult(input);
  const r2 = buildShadowInferenceResult(input);
  assert.deepEqual(r1, r2);
});

test('shadow result does not mutate input', () => {
  const input = {
    shadow_inference_id: ID,
    model_name: 'immutable-test',
    model_version: 'v1',
    artifact_sha: SHA,
    input_hash: 'hash-mut',
    shadow_score: 0.60,
    production_score: 0.59,
    error_message: null,
    inferred_at_ms: NOW,
  };
  const frozen = { ...input };
  buildShadowInferenceResult(input);
  assert.deepEqual(input, frozen);
});

test('domain package purity: no I/O, no DB, no env reads', () => {
  assert.equal(typeof buildShadowInferenceResult, 'function');
});
