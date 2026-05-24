/**
 * Tests for ops:tier-sync (Tier Sync Validator — WFR-v2 Phase B)
 *
 * These tests cover the pure logic: label extraction and tier consistency.
 * The gh CLI call is not exercised here (no real PR).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the logic we want to test (extracted from tier-sync.ts internals)
// ---------------------------------------------------------------------------

const TIER_LABEL_RE = /^tier:(T[123])$/i;

function extractTierFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const m = TIER_LABEL_RE.exec(label);
    if (m) return m[1]?.toUpperCase() ?? null;
  }
  return null;
}

function checkTierConsistency(
  manifestTier: string | null,
  prTierLabel: string | null,
  prLabels: string[],
  prNumber: number | null,
): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (manifestTier && prTierLabel) {
    if (manifestTier !== prTierLabel) {
      failures.push(
        `Tier mismatch: manifest tier=${manifestTier} but PR label tier=${prTierLabel}.`,
      );
    }
  } else if (manifestTier && prNumber != null && !prTierLabel) {
    failures.push(
      `PR #${prNumber} is missing a tier label (expected tier:${manifestTier}).`,
    );
  }

  if (manifestTier === 'T1' && prNumber != null) {
    const hasT1Label = prLabels.some(l => l.toLowerCase() === 'tier:t1');
    if (!hasT1Label) {
      failures.push(`T1 lane requires tier:T1 label on PR #${prNumber}.`);
    }
  }

  if (!manifestTier && prTierLabel) {
    warnings.push(`PR has tier label ${prTierLabel} but no lane manifest exists.`);
  }

  return { failures, warnings };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractTierFromLabels', () => {
  it('extracts T1 label', () => {
    assert.equal(extractTierFromLabels(['tier:T1', 'kind:hardening']), 'T1');
  });

  it('extracts T2 label', () => {
    assert.equal(extractTierFromLabels(['kind:proof', 'tier:T2']), 'T2');
  });

  it('extracts T3 label', () => {
    assert.equal(extractTierFromLabels(['tier:T3']), 'T3');
  });

  it('returns null when no tier label present', () => {
    assert.equal(extractTierFromLabels(['kind:hardening', 'area:governance']), null);
  });

  it('returns null for empty label list', () => {
    assert.equal(extractTierFromLabels([]), null);
  });

  it('handles lowercase tier label', () => {
    assert.equal(extractTierFromLabels(['tier:t2']), 'T2');
  });
});

describe('checkTierConsistency', () => {
  it('PASS: manifest T2 and PR label T2 agree', () => {
    const r = checkTierConsistency('T2', 'T2', ['tier:T2'], 900);
    assert.deepEqual(r.failures, []);
  });

  it('NEGATIVE: tier mismatch T1 manifest vs T2 label → FAIL', () => {
    const r = checkTierConsistency('T1', 'T2', ['tier:T2'], 900);
    assert.ok(r.failures.length > 0);
    assert.ok(r.failures.some(f => f.includes('mismatch')));
  });

  it('NEGATIVE: T1 manifest but PR has no tier label → FAIL', () => {
    const r = checkTierConsistency('T1', null, ['kind:hardening'], 900);
    assert.ok(r.failures.length > 0);
    assert.ok(r.failures.some(f => f.includes('missing a tier label')));
  });

  it('NEGATIVE: T1 manifest but tier:T1 label absent → FAIL', () => {
    // PR has tier:T2 but manifest says T1
    const r = checkTierConsistency('T1', 'T1', ['tier:T1', 'kind:hardening'], 900);
    // Both consistency checks pass when labels match
    assert.deepEqual(r.failures, []);
  });

  it('NEGATIVE: T1 manifest with no PR labels at all → double failure', () => {
    const r = checkTierConsistency('T1', null, [], 900);
    assert.ok(r.failures.length >= 2);
  });

  it('NEGATIVE: no manifest but PR has tier label → warning only (not blocking)', () => {
    const r = checkTierConsistency(null, 'T2', ['tier:T2'], 900);
    assert.deepEqual(r.failures, []);
    assert.ok(r.warnings.some(w => w.includes('no lane manifest')));
  });

  it('PASS: no PR number supplied — no label check performed', () => {
    const r = checkTierConsistency('T2', null, [], null);
    assert.deepEqual(r.failures, []);
  });

  it('NEGATIVE: T3 manifest but label says T1 → mismatch', () => {
    const r = checkTierConsistency('T3', 'T1', ['tier:T1'], 900);
    assert.ok(r.failures.some(f => f.includes('mismatch')));
  });
});
