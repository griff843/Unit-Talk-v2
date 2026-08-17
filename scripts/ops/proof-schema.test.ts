import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProofSchema,
  isProofStale,
  PROOF_SCHEMA_VERSION,
  validateEvidenceBundleContract,
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

function migrationEvidence() {
  return {
    schema_version: 2,
    issue_id: 'UTV2-9000',
    sha_binding: {
      verified_source_sha: VALID_SHA,
      evidence_commit_sha: 'set-by-ci',
      current_pr_head_sha: 'set-by-ci',
    },
    static_proof: { type_check: { status: 'PASS' } },
    runtime_proof: {
      head: VALID_SHA,
      precondition_drill: {
        result: 'PASS',
        run: 100,
        job: 101,
        cases: ['refuses when a declared relation exists', 'applies on an empty scratch schema'],
      },
      schema_roundtrip_drill: { result: 'PASS', run: 100, job: 102 },
      live_schema_parity: { result: 'PASS', run: 100, job: 103 },
      writable_db_proof_staging: { result: 'PASS', run: 100, job: 104 },
    },
  };
}

test('version-aware evidence contract accepts supported schema-v1 bundles', () => {
  const result = validateEvidenceBundleContract({ schema_version: 1 });
  assert.equal(result.valid, true);
  assert.equal(result.profile, 'legacy-v1');
});

test('schema-v2 migration profile accepts executed receipts without queries or row_counts', () => {
  const result = validateEvidenceBundleContract(migrationEvidence(), { laneType: 'migration', tier: 'T1' });
  assert.equal(result.valid, true, JSON.stringify(result.failures));
  assert.equal(result.profile, 'migration');
});

test('schema-v2 evidence fails without valid sha_binding', () => {
  const evidence = migrationEvidence();
  Reflect.deleteProperty(evidence, 'sha_binding');
  const result = validateEvidenceBundleContract(evidence, { laneType: 'migration', tier: 'T1' });
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.code === 'sha_binding_missing'));
});

test('app-runtime profile fails closed without queries and row_counts', () => {
  const evidence = {
    ...migrationEvidence(),
    static_proof: { type_check: { status: 'PASS' } },
    runtime_proof: { queries: [], row_counts: [] },
  };
  const result = validateEvidenceBundleContract(evidence, { laneType: 'runtime', tier: 'T1' });
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.code === 'runtime_queries_missing'));
  assert.ok(result.failures.some((failure) => failure.code === 'runtime_row_counts_missing'));
});

test('schema-v2 proof profiles reject unknown, undeclared, mismatched, and author-verifier input', () => {
  const undeclared = validateEvidenceBundleContract({
    ...migrationEvidence(),
    proof_profile: undefined,
  });
  assert.ok(undeclared.failures.some((failure) => failure.code === 'proof_profile_missing'));

  const unknown = validateEvidenceBundleContract({ ...migrationEvidence(), proof_profile: 'weakest' });
  assert.ok(unknown.failures.some((failure) => failure.code === 'proof_profile_unknown'));

  const mismatch = validateEvidenceBundleContract(
    { ...migrationEvidence(), proof_profile: 'static' },
    { laneType: 'runtime', tier: 'T1' },
  );
  assert.ok(mismatch.failures.some((failure) => failure.code === 'proof_profile_mismatch'));

  const selfCertified = validateEvidenceBundleContract(
    { ...migrationEvidence(), verifier: { identity: 'implementer' } },
    { laneType: 'migration', tier: 'T1' },
  );
  assert.ok(selfCertified.failures.some((failure) => failure.code === 'author_verifier_forbidden'));
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
