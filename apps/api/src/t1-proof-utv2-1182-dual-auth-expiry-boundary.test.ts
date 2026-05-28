/**
 * T1 Proof — UTV2-1182 CR-3 — Normalize Dual-Authorization Expiry Boundary Semantics
 *
 * Adversarial assertions covering boundary normalization:
 *   EXP-1: dual-auth and approval-expiration use identical >= boundary semantics
 *   EXP-2: exact-boundary approval is expired (not valid) — fail-closed
 *   EXP-3: sub-boundary approval is valid
 *   EXP-4: post-boundary approval is expired
 *   EXP-5: replay reconstruction reproduces identical expiration decisions
 *   EXP-6: completeApproval() rejects at exact boundary (uses isDualAuthExpired internally)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createPendingApproval,
  completeApproval,
  isDualAuthExpired,
  replayApprovalChain,
  DualAuthViolationError,
} from '@unit-talk/contracts';

import {
  isApprovalExpired,
  assertApprovalNotExpired,
  ApprovalExpiredError,
  computeExpiresAt,
} from '@unit-talk/contracts';

const BASE = '2026-01-01T00:00:00.000Z';
const EXPIRES = '2026-01-01T01:00:00.000Z'; // BASE + 3600s

// ── EXP-1: boundary semantics are >= in both contracts ──────────────────────

test('EXP-1a: isDualAuthExpired returns true at exact boundary', () => {
  const pending = createPendingApproval({
    id: 'pa-1',
    action: 'picks:void',
    firstApproverId: 'alice',
    requestedAt: BASE,
  });
  assert.equal(isDualAuthExpired(pending, EXPIRES), true);
});

test('EXP-1b: isApprovalExpired returns true at exact boundary', () => {
  assert.equal(isApprovalExpired(EXPIRES, EXPIRES), true);
});

test('EXP-1c: both contracts agree — boundary is expired', () => {
  const pending = createPendingApproval({
    id: 'pa-1c',
    action: 'picks:void',
    firstApproverId: 'alice',
    requestedAt: BASE,
  });
  const dualResult = isDualAuthExpired(pending, EXPIRES);
  const expirationResult = isApprovalExpired(EXPIRES, EXPIRES);
  assert.equal(dualResult, expirationResult, 'dual-auth and approval-expiration must agree on boundary');
});

// ── EXP-2: exact-boundary approval is expired (fail-closed) ─────────────────

test('EXP-2: isDualAuthExpired — exact boundary is expired', () => {
  const pending = createPendingApproval({
    id: 'pa-2',
    action: 'settlement:correct',
    firstApproverId: 'bob',
    requestedAt: BASE,
  });
  assert.equal(pending.expiresAt, EXPIRES);
  assert.equal(isDualAuthExpired(pending, EXPIRES), true,
    'exact boundary must be considered expired (fail-closed)');
});

test('EXP-2b: isApprovalExpired — exact boundary is expired', () => {
  const expiresAt = computeExpiresAt(BASE, 'dual-auth');
  assert.equal(isApprovalExpired(expiresAt, expiresAt), true,
    'exact boundary must be considered expired (fail-closed)');
});

// ── EXP-3: sub-boundary approval is valid ───────────────────────────────────

test('EXP-3a: isDualAuthExpired — 1ms before boundary is valid', () => {
  const pending = createPendingApproval({
    id: 'pa-3a',
    action: 'picks:void',
    firstApproverId: 'alice',
    requestedAt: BASE,
  });
  const justBefore = new Date(new Date(EXPIRES).getTime() - 1).toISOString();
  assert.equal(isDualAuthExpired(pending, justBefore), false,
    '1ms before boundary must be valid');
});

test('EXP-3b: isApprovalExpired — 1ms before boundary is valid', () => {
  const justBefore = new Date(new Date(EXPIRES).getTime() - 1).toISOString();
  assert.equal(isApprovalExpired(EXPIRES, justBefore), false,
    '1ms before boundary must be valid');
});

// ── EXP-4: post-boundary approval is expired ────────────────────────────────

test('EXP-4a: isDualAuthExpired — 1ms after boundary is expired', () => {
  const pending = createPendingApproval({
    id: 'pa-4a',
    action: 'operator:admin',
    firstApproverId: 'carol',
    requestedAt: BASE,
  });
  const justAfter = new Date(new Date(EXPIRES).getTime() + 1).toISOString();
  assert.equal(isDualAuthExpired(pending, justAfter), true);
});

test('EXP-4b: isApprovalExpired — 1ms after boundary is expired', () => {
  const justAfter = new Date(new Date(EXPIRES).getTime() + 1).toISOString();
  assert.equal(isApprovalExpired(EXPIRES, justAfter), true);
});

// ── EXP-5: replay reconstruction reproduces identical expiration decisions ──

test('EXP-5: replayApprovalChain — replay reproduces same expiry rejection', () => {
  const pending = createPendingApproval({
    id: 'pa-5',
    action: 'picks:void',
    firstApproverId: 'alice',
    requestedAt: BASE,
  });
  // Both direct and replay paths must reject at boundary
  assert.throws(
    () => replayApprovalChain(pending, 'bob', EXPIRES),
    DualAuthViolationError,
    'replay at exact boundary must throw DualAuthViolationError',
  );
  const justBefore = new Date(new Date(EXPIRES).getTime() - 1).toISOString();
  const record = replayApprovalChain(pending, 'bob', justBefore);
  assert.equal(record.id, 'pa-5');
  assert.equal(record.firstApproverId, 'alice');
  assert.equal(record.secondApproverId, 'bob');
});

test('EXP-5b: replay expiration chain — deterministic from (issuedAt, kind)', () => {
  const expiresAt1 = computeExpiresAt(BASE, 'dual-auth');
  const expiresAt2 = computeExpiresAt(BASE, 'dual-auth');
  assert.equal(expiresAt1, expiresAt2, 'same inputs must produce same expiresAt');
  assert.equal(isApprovalExpired(expiresAt1, expiresAt1), true);
});

// ── EXP-6: completeApproval() rejects at exact boundary ─────────────────────

test('EXP-6a: completeApproval — throws at exact boundary', () => {
  const pending = createPendingApproval({
    id: 'pa-6a',
    action: 'member:write',
    firstApproverId: 'alice',
    requestedAt: BASE,
  });
  assert.throws(
    () => completeApproval({ pending, secondApproverId: 'bob', approvedAt: EXPIRES }),
    (err: unknown) => {
      assert.ok(err instanceof DualAuthViolationError);
      assert.equal(err.code, 'DUAL_AUTH_VIOLATION');
      return true;
    },
  );
});

test('EXP-6b: completeApproval — succeeds 1ms before boundary', () => {
  const pending = createPendingApproval({
    id: 'pa-6b',
    action: 'picks:override',
    firstApproverId: 'alice',
    requestedAt: BASE,
  });
  const justBefore = new Date(new Date(EXPIRES).getTime() - 1).toISOString();
  const record = completeApproval({ pending, secondApproverId: 'bob', approvedAt: justBefore });
  assert.equal(record.id, 'pa-6b');
  assert.ok(Object.isFrozen(record), 'approval record must be frozen');
});

test('EXP-6c: assertApprovalNotExpired — throws at exact boundary', () => {
  assert.throws(
    () => assertApprovalNotExpired(EXPIRES, EXPIRES, 'dual-auth'),
    (err: unknown) => {
      assert.ok(err instanceof ApprovalExpiredError);
      assert.equal(err.code, 'APPROVAL_EXPIRED');
      return true;
    },
  );
});
