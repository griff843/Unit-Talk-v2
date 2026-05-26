/**
 * ProofValidator tests (UTV2-1101 / INIT-2.2.2)
 *
 * Adversarial test suite. Uses node:test + tsx --test + node:assert/strict.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProofBundle,
  ProofValidationGateError,
  ProofValidatorCertificationGate,
} from './proof-validator.js';
import { createProofBundle } from './proof-bundle.js';
import type { ProofArtifact, ProofBundleInput } from './proof-bundle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_MERGE_SHA = 'b'.repeat(40);

function makeArtifact(overrides: Partial<ProofArtifact> = {}): ProofArtifact {
  return {
    kind: 'test-output',
    path: 'packages/invariants/src/proof-validator.test.ts',
    sha: 'aabbccdd1122',
    generatedAt: new Date().toISOString(),
    reproducible: true,
    lineage: 'tsx --test',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ProofBundleInput> = {}): ProofBundleInput {
  return {
    issueId: 'UTV2-1101',
    mergeSha: VALID_MERGE_SHA,
    artifacts: [makeArtifact()],
    auditRef: 'audit-ref-1101',
    ...overrides,
  };
}

function makeValidBundle() {
  return createProofBundle(makeInput()).bundle;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateProofBundle', () => {
  it('test-1: valid bundle → result.valid=true, failures=[]', () => {
    const bundle = makeValidBundle();
    const { result } = validateProofBundle(bundle);

    assert.equal(result.valid, true);
    assert.deepEqual(result.failures, []);
    assert.ok(typeof result.validatedAt === 'string');
    assert.ok(typeof result.auditRef === 'string');
  });

  it('test-2: valid bundle → auditEvent emitted with immutable=true', () => {
    const bundle = makeValidBundle();
    const { auditEvent } = validateProofBundle(bundle);

    assert.equal(auditEvent.immutable, true);
    assert.ok(typeof auditEvent.id === 'string' && auditEvent.id.length > 0);
    assert.ok(typeof auditEvent.recorded_at === 'string');
    const payload = auditEvent.payload as Record<string, unknown>;
    assert.equal(payload['entity_type'], 'proof_validation_result');
    assert.equal(payload['action'], 'validated');
  });

  it('test-3: null input → valid=false, missing-field failure', () => {
    const { result } = validateProofBundle(null);
    assert.equal(result.valid, false);
    assert.ok(result.failures.length > 0);
    assert.ok(result.failures.some((f) => f.kind === 'missing-field' && f.field === 'bundle'));
  });

  it('test-4: markdown string input → valid=false (not accepted as ProofBundle)', () => {
    const { result } = validateProofBundle('# Proof document\nThis is markdown');
    assert.equal(result.valid, false);
    assert.ok(result.failures.length > 0);
    assert.ok(result.failures.some((f) => f.field === 'bundle'));
  });

  it('test-5: mergeSha "set-by-ci" → valid=false, invalid-merge-sha', () => {
    const bundle = { ...makeValidBundle(), mergeSha: 'set-by-ci' };
    const { result } = validateProofBundle(bundle);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'invalid-merge-sha' && f.field === 'mergeSha'));
  });

  it('test-6: short mergeSha → valid=false, invalid-merge-sha', () => {
    const bundle = { ...makeValidBundle(), mergeSha: 'abc123' };
    const { result } = validateProofBundle(bundle);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'invalid-merge-sha'));
  });

  it('test-7: empty artifacts → valid=false, empty-artifacts', () => {
    const bundle = { ...makeValidBundle(), artifacts: [] };
    const { result } = validateProofBundle(bundle);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'empty-artifacts'));
  });

  it('test-8: tampered artifact sha → valid=false, hash-mismatch', () => {
    const orig = makeValidBundle();
    const tampered = {
      ...orig,
      artifacts: [{ ...orig.artifacts[0], sha: 'tampered-sha-value' }],
    };
    const { result } = validateProofBundle(tampered);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'hash-mismatch'));
  });

  it('test-9: wrong validationHash → valid=false, hash-mismatch', () => {
    const bundle = { ...makeValidBundle(), validationHash: 'totally-wrong' };
    const { result } = validateProofBundle(bundle);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'hash-mismatch'));
  });

  it('test-10: missing issueId → valid=false, missing-field', () => {
    const bundle = { ...makeValidBundle(), issueId: '' };
    const { result } = validateProofBundle(bundle);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.field === 'issueId'));
  });

  it('test-11: stale bundle (maxAgeMs=0) → valid=false, stale-bundle', () => {
    const bundle = makeValidBundle();
    const { result } = validateProofBundle(bundle, { maxAgeMs: 0 });
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'stale-bundle'));
  });

  it('test-12: fresh bundle within maxAgeMs → valid=true', () => {
    const bundle = makeValidBundle();
    const { result } = validateProofBundle(bundle, { maxAgeMs: 60_000 });
    assert.equal(result.valid, true);
  });

  it('test-13: createdAt with invalid ISO-8601 → valid=false, missing-field', () => {
    const bundle = { ...makeValidBundle(), createdAt: 'not-a-date' };
    const { result } = validateProofBundle(bundle);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.field === 'createdAt'));
  });

  it('test-14: schemaVersion != 1 → valid=false, invalid-schema-version', () => {
    const bundle = { ...makeValidBundle(), schemaVersion: 2 };
    const { result } = validateProofBundle(bundle);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'invalid-schema-version'));
  });

  it('test-15: rejected bundle → auditEvent payload.action="rejected"', () => {
    const bundle = { ...makeValidBundle(), mergeSha: 'set-by-ci' };
    const { auditEvent } = validateProofBundle(bundle);
    const payload = auditEvent.payload as Record<string, unknown>;
    assert.equal(payload['action'], 'rejected');
    assert.equal(payload['valid'], false);
    assert.ok((payload['failure_count'] as number) > 0);
  });
});

describe('ProofValidatorCertificationGate', () => {
  it('test-16: assertValid on valid bundle → returns result without throwing', () => {
    const gate = new ProofValidatorCertificationGate();
    const bundle = makeValidBundle();
    const result = gate.assertValid(bundle);
    assert.equal(result.valid, true);
  });

  it('test-17: assertValid on rejected bundle → throws ProofValidationGateError', () => {
    const gate = new ProofValidatorCertificationGate();
    const bundle = { ...makeValidBundle(), mergeSha: 'set-by-ci' };
    assert.throws(
      () => gate.assertValid(bundle),
      (err: unknown) => {
        assert.ok(err instanceof ProofValidationGateError);
        assert.ok(err.result.valid === false);
        assert.ok(err.message.includes('rejected'));
        return true;
      },
    );
  });

  it('test-18: ProofValidationGateError carries result with failures', () => {
    const gate = new ProofValidatorCertificationGate({ maxAgeMs: 0 });
    const bundle = makeValidBundle();
    try {
      gate.assertValid(bundle);
      assert.fail('expected ProofValidationGateError to be thrown');
    } catch (err) {
      assert.ok(err instanceof ProofValidationGateError);
      assert.ok(err.result.failures.length > 0);
      assert.ok(err.result.failures.some((f) => f.kind === 'stale-bundle'));
    }
  });
});
