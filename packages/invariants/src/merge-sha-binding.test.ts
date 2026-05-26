/**
 * MergeShaBinding tests (UTV2-1102 / INIT-2.2.3)
 *
 * Adversarial test suite. Uses node:test + tsx --test + node:assert/strict.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMergeShaBinding,
  assertShaBindingBlock,
  requireMergeShaBinding,
  ShaBindingGateError,
} from './merge-sha-binding.js';

const VALID_SHA = 'c'.repeat(40);

describe('assertMergeShaBinding', () => {
  it('test-1: valid 40-char hex SHA → valid=true', () => {
    const { result, auditEvent } = assertMergeShaBinding(VALID_SHA);
    assert.equal(result.valid, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.mergeSha, VALID_SHA);
    assert.equal(auditEvent.immutable, true);
  });

  it('test-2: valid SHA → auditEvent action="binding-verified"', () => {
    const { auditEvent } = assertMergeShaBinding(VALID_SHA);
    const payload = auditEvent.payload as Record<string, unknown>;
    assert.equal(payload['action'], 'binding-verified');
    assert.equal(payload['valid'], true);
  });

  it('test-3: sentinel "set-by-ci" → valid=false, sentinel-sha', () => {
    const { result } = assertMergeShaBinding('set-by-ci');
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'sentinel-sha'));
  });

  it('test-4: sentinel "pending" → valid=false, sentinel-sha', () => {
    const { result } = assertMergeShaBinding('pending');
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'sentinel-sha'));
  });

  it('test-5: empty string → valid=false, sentinel-sha', () => {
    const { result } = assertMergeShaBinding('');
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'sentinel-sha'));
  });

  it('test-6: short SHA 8 chars (branch HEAD abbreviation) → valid=false, short-sha', () => {
    const { result } = assertMergeShaBinding('a1b2c3d4');
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'short-sha'));
    assert.ok(result.failures[0]!.message.includes('8 chars'));
  });

  it('test-7: short SHA 39 chars → valid=false, short-sha', () => {
    const { result } = assertMergeShaBinding('a'.repeat(39));
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'short-sha'));
  });

  it('test-8: null → valid=false, missing-sha', () => {
    const { result } = assertMergeShaBinding(null);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'missing-sha'));
  });

  it('test-9: undefined → valid=false, missing-sha', () => {
    const { result } = assertMergeShaBinding(undefined);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'missing-sha'));
  });

  it('test-10: 40-char string with non-hex chars → valid=false, invalid-format', () => {
    const { result } = assertMergeShaBinding('z'.repeat(40));
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'invalid-format'));
  });

  it('test-11: rejected binding → auditEvent action="binding-rejected"', () => {
    const { auditEvent } = assertMergeShaBinding('set-by-ci');
    const payload = auditEvent.payload as Record<string, unknown>;
    assert.equal(payload['action'], 'binding-rejected');
    assert.equal(payload['valid'], false);
    assert.ok((payload['failure_count'] as number) > 0);
  });

  it('test-12: context issueId propagated to auditEvent', () => {
    const { auditEvent } = assertMergeShaBinding(VALID_SHA, { issueId: 'UTV2-1102' });
    const payload = auditEvent.payload as Record<string, unknown>;
    assert.equal(payload['issueId'], 'UTV2-1102');
    assert.ok(auditEvent.invariant_id.includes('UTV2-1102'));
  });
});

describe('assertShaBindingBlock', () => {
  it('test-13: valid sha_binding block → valid=true', () => {
    const { result } = assertShaBindingBlock({ merge_sha: VALID_SHA });
    assert.equal(result.valid, true);
    assert.equal(result.mergeSha, VALID_SHA);
  });

  it('test-14: sha_binding block with sentinel merge_sha → valid=false', () => {
    const { result } = assertShaBindingBlock({ merge_sha: 'set-by-ci' });
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.kind === 'sentinel-sha'));
  });

  it('test-15: null block → valid=false, missing-sha', () => {
    const { result } = assertShaBindingBlock(null);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((f) => f.field === 'sha_binding'));
  });
});

describe('requireMergeShaBinding', () => {
  it('test-16: valid SHA → returns SHA string', () => {
    const sha = requireMergeShaBinding(VALID_SHA);
    assert.equal(sha, VALID_SHA);
  });

  it('test-17: sentinel SHA → throws ShaBindingGateError', () => {
    assert.throws(
      () => requireMergeShaBinding('set-by-ci'),
      (err: unknown) => {
        assert.ok(err instanceof ShaBindingGateError);
        assert.equal(err.result.valid, false);
        assert.ok(err.message.includes('rejected'));
        return true;
      },
    );
  });

  it('test-18: short SHA → throws ShaBindingGateError with short-sha failure', () => {
    assert.throws(
      () => requireMergeShaBinding('abc123'),
      (err: unknown) => {
        assert.ok(err instanceof ShaBindingGateError);
        assert.ok(err.result.failures.some((f) => f.kind === 'short-sha'));
        return true;
      },
    );
  });
});
