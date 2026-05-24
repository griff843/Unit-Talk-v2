import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProofSchema,
  isProofStale,
  PROOF_SCHEMA_VERSION,
  type ProofSchemaV2,
} from './proof-schema.js';

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function makeValid(): ProofSchemaV2 {
  return {
    schema_version: PROOF_SCHEMA_VERSION,
    issue_id: 'UTV2-1156',
    pr_number: 900,
    source_sha: VALID_SHA,
    reviewed_head_sha: VALID_SHA,
    evidence_commit_sha: null,
    current_head_sha: null,
    merge_sha: null,
    gate_results: [{ gate: 'ci', verdict: 'PASS', detail: 'All checks green' }],
    reviewer_verdict: null,
    pm_verdict: null,
    generated_at: new Date().toISOString(),
  };
}

describe('validateProofSchema', () => {
  it('accepts a valid minimal proof', () => {
    const result = validateProofSchema(makeValid());
    assert.ok(result.valid, `Unexpected failures: ${JSON.stringify(result.failures)}`);
    assert.deepEqual(result.failures, []);
  });

  it('rejects null', () => {
    const result = validateProofSchema(null);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'root'));
  });

  it('rejects wrong schema_version', () => {
    const candidate = { ...makeValid(), schema_version: 1 };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'schema_version'));
  });

  it('rejects missing issue_id', () => {
    const candidate = { ...makeValid(), issue_id: '' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'issue_id'));
  });

  it('rejects non-integer pr_number', () => {
    const candidate = { ...makeValid(), pr_number: 0 };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'pr_number'));
  });

  it('rejects malformed source_sha', () => {
    const candidate = { ...makeValid(), source_sha: 'not-a-sha' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'source_sha'));
  });

  it('rejects malformed reviewed_head_sha', () => {
    const candidate = { ...makeValid(), reviewed_head_sha: 'short' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'reviewed_head_sha'));
  });

  it('accepts null evidence_commit_sha (pre-merge)', () => {
    const candidate = { ...makeValid(), evidence_commit_sha: null };
    const result = validateProofSchema(candidate);
    assert.ok(result.valid, JSON.stringify(result.failures));
  });

  it('rejects malformed evidence_commit_sha when non-null', () => {
    const candidate = { ...makeValid(), evidence_commit_sha: 'bad' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'evidence_commit_sha'));
  });

  it('accepts null merge_sha (pre-merge)', () => {
    const candidate = { ...makeValid(), merge_sha: null };
    const result = validateProofSchema(candidate);
    assert.ok(result.valid, JSON.stringify(result.failures));
  });

  it('rejects invalid gate_results entry', () => {
    const candidate = {
      ...makeValid(),
      gate_results: [{ gate: 'ci', verdict: 'UNKNOWN', detail: 'x' }],
    };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field.startsWith('gate_results[0]')));
  });

  it('rejects gate_results not an array', () => {
    const candidate = { ...makeValid(), gate_results: 'bad' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'gate_results'));
  });

  it('rejects missing generated_at', () => {
    const candidate = { ...makeValid(), generated_at: '' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'generated_at'));
  });

  it('accumulates multiple failures', () => {
    const candidate = { schema_version: 1, issue_id: '', pr_number: -1 };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.length >= 3);
  });
});

describe('isProofStale', () => {
  it('returns false when source_sha matches current head', () => {
    const proof = { ...makeValid(), source_sha: VALID_SHA };
    assert.equal(isProofStale(proof, VALID_SHA), false);
  });

  it('returns true when source_sha differs from current head', () => {
    const proof = { ...makeValid(), source_sha: VALID_SHA };
    assert.equal(isProofStale(proof, OTHER_SHA), true);
  });

  it('returns false when currentHeadSha is malformed', () => {
    const proof = { ...makeValid(), source_sha: VALID_SHA };
    assert.equal(isProofStale(proof, 'bad-sha'), false);
  });

  it('returns true when source_sha is malformed', () => {
    const proof = { ...makeValid(), source_sha: 'bad' };
    assert.equal(isProofStale(proof, VALID_SHA), true);
  });
});
