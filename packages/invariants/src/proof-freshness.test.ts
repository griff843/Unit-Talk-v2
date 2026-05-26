import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkProofFreshness,
  checkBundleFreshness,
  requireFreshProof,
  ProofFreshnessGateError,
  FRESHNESS_WINDOWS_MS,
} from './proof-freshness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function isoAhead(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function freshBundle(createdAt: string) {
  return { id: 'b-1', createdAt };
}

// ---------------------------------------------------------------------------
// checkProofFreshness — direct createdAt checks
// ---------------------------------------------------------------------------

describe('checkProofFreshness', () => {
  it('returns valid=true for a bundle within the governance window', () => {
    const { result } = checkProofFreshness(isoAgo(1000), 'governance');
    assert.equal(result.valid, true);
    assert.equal(result.fresh, true);
    assert.equal(result.failures.length, 0);
    assert.equal(result.freshnessClass, 'governance');
  });

  it('returns valid=false for a stale bundle (ageMs >= windowMs)', () => {
    const windowMs = FRESHNESS_WINDOWS_MS.governance;
    const { result } = checkProofFreshness(isoAgo(windowMs + 1000), 'governance');
    assert.equal(result.valid, false);
    assert.equal(result.fresh, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]!.kind, 'stale-bundle');
  });

  it('rejects exactly at windowMs boundary (>= semantics)', () => {
    const windowMs = FRESHNESS_WINDOWS_MS.t1;
    const { result } = checkProofFreshness(isoAgo(windowMs), 't1');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'stale-bundle');
  });

  it('returns valid=false for null createdAt', () => {
    const { result } = checkProofFreshness(null, 'governance');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'missing-created-at');
  });

  it('returns valid=false for undefined createdAt', () => {
    const { result } = checkProofFreshness(undefined, 'governance');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'missing-created-at');
  });

  it('returns valid=false for empty string createdAt', () => {
    const { result } = checkProofFreshness('', 'governance');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'invalid-created-at');
  });

  it('returns valid=false for non-string createdAt', () => {
    const { result } = checkProofFreshness(12345, 'governance');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'invalid-created-at');
  });

  it('returns valid=false for unparseable ISO string', () => {
    const { result } = checkProofFreshness('not-a-date', 'governance');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'invalid-created-at');
  });

  it('returns valid=false for future createdAt (clock skew / tampered)', () => {
    const { result } = checkProofFreshness(isoAhead(60_000), 'governance');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'future-created-at');
  });

  it('emits an AuditEvent on every check (valid case)', () => {
    const { auditEvent } = checkProofFreshness(isoAgo(1000), 'governance');
    assert.ok(auditEvent.id);
    assert.equal(auditEvent.event_type, 'invariant_violation');
    assert.equal(auditEvent.immutable, true);
  });

  it('emits an AuditEvent on every check (invalid case)', () => {
    const { auditEvent } = checkProofFreshness(null, 'governance');
    assert.ok(auditEvent.id);
    assert.equal(auditEvent.quarantine_behavior, 'fail-closed');
  });
});

// ---------------------------------------------------------------------------
// Freshness class windows
// ---------------------------------------------------------------------------

describe('FRESHNESS_WINDOWS_MS', () => {
  it('t1 window is 24 hours', () => {
    assert.equal(FRESHNESS_WINDOWS_MS.t1, 24 * 60 * 60 * 1000);
  });

  it('governance window is 7 days', () => {
    assert.equal(FRESHNESS_WINDOWS_MS.governance, 7 * 24 * 60 * 60 * 1000);
  });

  it('certification window is 90 days', () => {
    assert.equal(FRESHNESS_WINDOWS_MS.certification, 90 * 24 * 60 * 60 * 1000);
  });

  it('valid=true for t2 bundle within 7-day window', () => {
    const { result } = checkProofFreshness(isoAgo(1_000), 't2');
    assert.equal(result.valid, true);
    assert.equal(result.freshnessClass, 't2');
    assert.equal(result.windowMs, FRESHNESS_WINDOWS_MS.t2);
  });

  it('valid=false for t1 bundle older than 24 hours', () => {
    const { result } = checkProofFreshness(isoAgo(FRESHNESS_WINDOWS_MS.t1 + 1), 't1');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'stale-bundle');
  });
});

// ---------------------------------------------------------------------------
// checkBundleFreshness — bundle-level checks
// ---------------------------------------------------------------------------

describe('checkBundleFreshness', () => {
  it('returns valid=true for a fresh bundle object', () => {
    const { result } = checkBundleFreshness(freshBundle(isoAgo(500)), 'governance');
    assert.equal(result.valid, true);
  });

  it('returns valid=false for non-object bundle', () => {
    const { result } = checkBundleFreshness('not-an-object', 'governance');
    assert.equal(result.valid, false);
    assert.equal(result.failures[0]!.kind, 'missing-created-at');
  });

  it('returns valid=false for null bundle', () => {
    const { result } = checkBundleFreshness(null, 'governance');
    assert.equal(result.valid, false);
  });

  it('propagates bundleId from bundle.id into result context', () => {
    const { auditEvent } = checkBundleFreshness({ id: 'test-bundle-id', createdAt: isoAgo(100) }, 'governance');
    assert.equal((auditEvent.payload as { bundleId: string }).bundleId, 'test-bundle-id');
  });
});

// ---------------------------------------------------------------------------
// requireFreshProof — gate / throw behavior
// ---------------------------------------------------------------------------

describe('requireFreshProof', () => {
  it('returns FreshnessResult without throwing for a fresh bundle', () => {
    const result = requireFreshProof(freshBundle(isoAgo(1000)), 'governance');
    assert.equal(result.valid, true);
  });

  it('throws ProofFreshnessGateError for a stale bundle', () => {
    assert.throws(
      () => requireFreshProof(freshBundle(isoAgo(FRESHNESS_WINDOWS_MS.governance + 1000)), 'governance'),
      ProofFreshnessGateError,
    );
  });

  it('thrown error carries the FreshnessResult', () => {
    try {
      requireFreshProof(freshBundle(isoAgo(FRESHNESS_WINDOWS_MS.t1 + 1)), 't1');
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof ProofFreshnessGateError);
      assert.equal(err.result.valid, false);
      assert.equal(err.result.failures[0]!.kind, 'stale-bundle');
    }
  });

  it('throws for a null bundle (fail-closed)', () => {
    assert.throws(() => requireFreshProof(null, 'governance'), ProofFreshnessGateError);
  });
});
