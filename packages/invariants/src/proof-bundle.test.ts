/**
 * ProofBundle tests (UTV2-1100 / INIT-2.2.1)
 *
 * Adversarial test suite for createProofBundle and validateProofBundle.
 * Uses node:test + tsx --test + node:assert/strict.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createProofBundle,
  validateProofBundle,
  ProofBundleValidationError,
} from './proof-bundle.js';
import type { ProofArtifact, ProofBundleInput } from './proof-bundle.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_MERGE_SHA = 'a'.repeat(40);

function makeArtifact(overrides: Partial<ProofArtifact> = {}): ProofArtifact {
  return {
    kind: 'test-output',
    path: 'packages/invariants/src/proof-bundle.test.ts',
    sha: 'abc123def456',
    generatedAt: '2026-05-25T00:00:00.000Z',
    reproducible: true,
    lineage: 'tsx --test',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ProofBundleInput> = {}): ProofBundleInput {
  return {
    issueId: 'UTV2-1100',
    mergeSha: VALID_MERGE_SHA,
    artifacts: [makeArtifact()],
    auditRef: 'audit-ref-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createProofBundle', () => {
  it('test-1: valid bundle has id, schemaVersion=1, and correctly computed validationHash', () => {
    const { bundle } = createProofBundle(makeInput());

    assert.ok(typeof bundle.id === 'string' && bundle.id.length > 0, 'id must be non-empty string');
    assert.equal(bundle.schemaVersion, 1);
    assert.ok(typeof bundle.validationHash === 'string' && bundle.validationHash.length > 0);

    // Verify validationHash is sha256 of sorted artifact SHAs joined by ','
    const artifact = bundle.artifacts[0]!;
    const expectedHash = createHash('sha256').update(artifact.sha).digest('hex');
    assert.equal(bundle.validationHash, expectedHash);
  });

  it('test-2: valid bundle creation emits an auditEvent', () => {
    const { auditEvent } = createProofBundle(makeInput());

    assert.ok(typeof auditEvent.id === 'string' && auditEvent.id.length > 0);
    assert.equal(auditEvent.immutable, true);
    assert.ok(typeof auditEvent.recorded_at === 'string');
    assert.equal(typeof auditEvent.payload, 'object');
    const payload = auditEvent.payload as Record<string, unknown>;
    assert.equal(payload['entity_type'], 'proof_bundle');
    assert.equal(payload['action'], 'created');
  });

  it('test-3: validationHash is deterministic (same inputs → same hash)', () => {
    const input = makeInput();
    const { bundle: b1 } = createProofBundle(input);
    const { bundle: b2 } = createProofBundle(input);

    assert.equal(b1.validationHash, b2.validationHash);
    // IDs are different (random) but hashes are the same
    assert.notEqual(b1.id, b2.id);
  });

  it('test-6: missing issueId throws ProofBundleValidationError', () => {
    assert.throws(
      () => createProofBundle(makeInput({ issueId: '' })),
      (err: unknown) => {
        assert.ok(err instanceof ProofBundleValidationError);
        assert.equal(err.field, 'issueId');
        return true;
      },
    );
  });

  it('test-7: mergeSha "set-by-ci" throws ProofBundleValidationError', () => {
    assert.throws(
      () => createProofBundle(makeInput({ mergeSha: 'set-by-ci' })),
      (err: unknown) => {
        assert.ok(err instanceof ProofBundleValidationError);
        assert.equal(err.field, 'mergeSha');
        return true;
      },
    );
  });

  it('test-8: mergeSha shorter than 40 chars throws ProofBundleValidationError', () => {
    assert.throws(
      () => createProofBundle(makeInput({ mergeSha: 'abc123' })),
      (err: unknown) => {
        assert.ok(err instanceof ProofBundleValidationError);
        assert.equal(err.field, 'mergeSha');
        return true;
      },
    );
  });

  it('test-9: empty artifacts array throws ProofBundleValidationError', () => {
    assert.throws(
      () => createProofBundle(makeInput({ artifacts: [] })),
      (err: unknown) => {
        assert.ok(err instanceof ProofBundleValidationError);
        assert.equal(err.field, 'artifacts');
        return true;
      },
    );
  });

  it('test-10: artifact missing sha throws ProofBundleValidationError', () => {
    const artifact = makeArtifact({ sha: '' });
    assert.throws(
      () => createProofBundle(makeInput({ artifacts: [artifact] })),
      (err: unknown) => {
        assert.ok(err instanceof ProofBundleValidationError);
        assert.ok(err.field.includes('sha'));
        return true;
      },
    );
  });

  it('test-11: artifact missing kind throws ProofBundleValidationError', () => {
    // @ts-expect-error intentionally invalid
    const artifact = makeArtifact({ kind: '' });
    assert.throws(
      () => createProofBundle(makeInput({ artifacts: [artifact] })),
      (err: unknown) => {
        assert.ok(err instanceof ProofBundleValidationError);
        assert.ok(err.field.includes('kind'));
        return true;
      },
    );
  });

  it('test-12: artifact missing path throws ProofBundleValidationError', () => {
    const artifact = makeArtifact({ path: '' });
    assert.throws(
      () => createProofBundle(makeInput({ artifacts: [artifact] })),
      (err: unknown) => {
        assert.ok(err instanceof ProofBundleValidationError);
        assert.ok(err.field.includes('path'));
        return true;
      },
    );
  });

  it('test-14: a markdown string passed as input throws (not accepted as ProofBundle)', () => {
    assert.throws(
      // @ts-expect-error intentionally invalid input
      () => createProofBundle('# Proof\nThis is a markdown document'),
      (err: unknown) => {
        // Should throw since string input lacks required object fields
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  it('test-15: bundle with multiple artifacts validationHash covers all of them', () => {
    const art1 = makeArtifact({ sha: 'sha-alpha', kind: 'test-output' });
    const art2 = makeArtifact({ sha: 'sha-beta', kind: 'type-check' });
    const art3 = makeArtifact({ sha: 'sha-gamma', kind: 'runtime-db' });

    const { bundle } = createProofBundle(
      makeInput({ artifacts: [art1, art2, art3] }),
    );

    // Manually compute expected hash: sort ['sha-alpha','sha-beta','sha-gamma'] then join + hash
    const sortedShas = ['sha-alpha', 'sha-beta', 'sha-gamma'].sort();
    const expectedHash = createHash('sha256').update(sortedShas.join(',')).digest('hex');
    assert.equal(bundle.validationHash, expectedHash);
  });
});

describe('validateProofBundle', () => {
  it('test-4: validateProofBundle recomputes hash correctly → valid=true', () => {
    const { bundle } = createProofBundle(makeInput());
    const result = validateProofBundle(bundle);

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('test-5: tampered artifact SHA → validateProofBundle returns valid=false', () => {
    const { bundle } = createProofBundle(makeInput());

    // Tamper the first artifact SHA
    const tampered = {
      ...bundle,
      artifacts: [
        { ...bundle.artifacts[0], sha: 'tampered-sha-value' },
      ],
    };

    const result = validateProofBundle(tampered);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.includes('validationHash mismatch')));
  });

  it('test-13: malformed bundle (wrong validationHash) → valid=false, errors populated', () => {
    const { bundle } = createProofBundle(makeInput());
    const malformed = { ...bundle, validationHash: 'totally-wrong-hash' };

    const result = validateProofBundle(malformed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.includes('validationHash mismatch')));
  });

  it('a markdown string passed to validateProofBundle → valid=false', () => {
    const result = validateProofBundle('# Proof document\nThis is markdown');
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('bundle with short mergeSha → valid=false', () => {
    const { bundle } = createProofBundle(makeInput());
    const bad = { ...bundle, mergeSha: 'short' };

    const result = validateProofBundle(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('mergeSha')));
  });

  it('bundle with empty artifacts → valid=false', () => {
    const { bundle } = createProofBundle(makeInput());
    const bad = { ...bundle, artifacts: [] };

    const result = validateProofBundle(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('artifacts')));
  });
});
