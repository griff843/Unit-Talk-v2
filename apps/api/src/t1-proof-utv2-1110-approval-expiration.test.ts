/**
 * T1 Proof Test — UTV2-1110 INIT-2.4.3 Approval Expiration
 *
 * Adversarial assertions covering:
 * - APPROVAL_WINDOW_SECONDS registry completeness
 * - computeExpiresAt determinism
 * - isApprovalExpired boundary semantics (boundary = expired)
 * - assertApprovalNotExpired fail-closed enforcement
 * - createExpirationRecord immutability
 * - replayExpirationChain determinism
 * - ApprovalExpiredError shape
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APPROVAL_WINDOW_KINDS,
  APPROVAL_WINDOW_SECONDS,
  ApprovalExpiredError,
  assertApprovalNotExpired,
  computeExpiresAt,
  createExpirationRecord,
  isApprovalExpired,
  replayExpirationChain,
} from '@unit-talk/contracts';

const ISSUED_AT = '2026-05-28T10:00:00.000Z';
const ONE_HOUR_MS = 3600 * 1000;
const ONE_HOUR_LATER = new Date(
  new Date(ISSUED_AT).getTime() + ONE_HOUR_MS,
).toISOString();
const ONE_SECOND_PAST = new Date(
  new Date(ONE_HOUR_LATER).getTime() + 1,
).toISOString();
const ONE_SECOND_BEFORE = new Date(
  new Date(ONE_HOUR_LATER).getTime() - 1,
).toISOString();

test('UTV2-1110: APPROVAL_WINDOW_SECONDS includes all required window kinds', () => {
  assert.ok(APPROVAL_WINDOW_KINDS.includes('dual-auth'));
  assert.ok(APPROVAL_WINDOW_KINDS.includes('operator-action'));
  assert.ok(APPROVAL_WINDOW_KINDS.includes('member-promotion'));
  assert.equal(APPROVAL_WINDOW_SECONDS['dual-auth'], 3600);
  assert.equal(APPROVAL_WINDOW_SECONDS['operator-action'], 1800);
  assert.equal(APPROVAL_WINDOW_SECONDS['member-promotion'], 86400);
});

test('UTV2-1110: computeExpiresAt produces correct future timestamp for dual-auth', () => {
  const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
  assert.equal(expiresAt, ONE_HOUR_LATER);
});

test('UTV2-1110: computeExpiresAt is deterministic with equal inputs', () => {
  const a = computeExpiresAt(ISSUED_AT, 'operator-action');
  const b = computeExpiresAt(ISSUED_AT, 'operator-action');
  assert.equal(a, b);
});

test('UTV2-1110: isApprovalExpired returns false when within window', () => {
  const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
  assert.equal(isApprovalExpired(expiresAt, ONE_SECOND_BEFORE), false);
});

test('UTV2-1110: isApprovalExpired returns true when past expiry', () => {
  const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
  assert.equal(isApprovalExpired(expiresAt, ONE_SECOND_PAST), true);
});

test('UTV2-1110: BOUNDARY isApprovalExpired returns true at exactly expiry time', () => {
  const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
  assert.equal(isApprovalExpired(expiresAt, ONE_HOUR_LATER), true);
});

test('UTV2-1110: assertApprovalNotExpired passes when within window', () => {
  const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
  assert.doesNotThrow(() =>
    assertApprovalNotExpired(expiresAt, ONE_SECOND_BEFORE, 'dual-auth'),
  );
});

test('UTV2-1110: ADVERSARIAL assertApprovalNotExpired throws ApprovalExpiredError when dual-auth expired', () => {
  const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
  assert.throws(
    () => assertApprovalNotExpired(expiresAt, ONE_SECOND_PAST, 'dual-auth'),
    (err) => {
      assert.ok(err instanceof ApprovalExpiredError);
      assert.equal(err.code, 'APPROVAL_EXPIRED');
      assert.equal(err.kind, 'dual-auth');
      assert.equal(err.name, 'ApprovalExpiredError');
      return true;
    },
  );
});

test('UTV2-1110: ADVERSARIAL assertApprovalNotExpired throws for expired operator-action', () => {
  const issuedAt = '2026-05-28T10:00:00.000Z';
  const expiresAt = computeExpiresAt(issuedAt, 'operator-action');
  const pastExpiry = new Date(new Date(expiresAt).getTime() + 1).toISOString();
  assert.throws(
    () => assertApprovalNotExpired(expiresAt, pastExpiry, 'operator-action'),
    ApprovalExpiredError,
  );
});

test('UTV2-1110: ADVERSARIAL assertApprovalNotExpired throws for expired member-promotion', () => {
  const issuedAt = '2026-05-28T10:00:00.000Z';
  const expiresAt = computeExpiresAt(issuedAt, 'member-promotion');
  const pastExpiry = new Date(
    new Date(expiresAt).getTime() + 1000,
  ).toISOString();
  assert.throws(
    () => assertApprovalNotExpired(expiresAt, pastExpiry, 'member-promotion'),
    ApprovalExpiredError,
  );
});

test('UTV2-1110: ADVERSARIAL assertApprovalNotExpired throws at exactly expiry time', () => {
  const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
  assert.throws(
    () => assertApprovalNotExpired(expiresAt, ONE_HOUR_LATER, 'dual-auth'),
    ApprovalExpiredError,
  );
});

test('UTV2-1110: createExpirationRecord produces a frozen ExpirationRecord with correct fields', () => {
  const record = createExpirationRecord({
    id: 'rec-001',
    kind: 'dual-auth',
    issuedAt: ISSUED_AT,
    expiredAt: null,
    reason: 'approval-window-opened',
  });
  assert.equal(record.id, 'rec-001');
  assert.equal(record.kind, 'dual-auth');
  assert.equal(record.issuedAt, ISSUED_AT);
  assert.equal(record.expiresAt, ONE_HOUR_LATER);
  assert.equal(record.expiredAt, null);
  assert.equal(record.reason, 'approval-window-opened');
  assert.ok(Object.isFrozen(record));
});

test('UTV2-1110: createExpirationRecord captures expiredAt when approval was recorded as expired', () => {
  const record = createExpirationRecord({
    id: 'rec-002',
    kind: 'operator-action',
    issuedAt: ISSUED_AT,
    expiredAt: ONE_SECOND_PAST,
    reason: 'timeout-sweep',
  });
  assert.equal(record.expiredAt, ONE_SECOND_PAST);
});

test('UTV2-1110: ExpirationRecord is frozen and mutations throw TypeError in strict mode', () => {
  const record = createExpirationRecord({
    id: 'rec-003',
    kind: 'dual-auth',
    issuedAt: ISSUED_AT,
    expiredAt: null,
    reason: 'test',
  });
  assert.throws(() => {
    (record as unknown as Record<string, unknown>)['expiredAt'] = 'tampered';
  }, TypeError);
});

test('UTV2-1110: replayExpirationChain is deterministic with equal inputs', () => {
  const records = [
    createExpirationRecord({
      id: 'r1',
      kind: 'dual-auth',
      issuedAt: ISSUED_AT,
      expiredAt: null,
      reason: 'open',
    }),
    createExpirationRecord({
      id: 'r2',
      kind: 'operator-action',
      issuedAt: ISSUED_AT,
      expiredAt: ONE_SECOND_PAST,
      reason: 'expired',
    }),
  ];
  const replayed = replayExpirationChain(records);
  assert.deepEqual(replayed[0], records[0]);
  assert.deepEqual(replayed[1], records[1]);
});

test('UTV2-1110: ApprovalExpiredError has correct name, code, kind, and expiresAt', () => {
  const err = new ApprovalExpiredError('dual-auth', ONE_HOUR_LATER);
  assert.equal(err.name, 'ApprovalExpiredError');
  assert.equal(err.code, 'APPROVAL_EXPIRED');
  assert.equal(err.kind, 'dual-auth');
  assert.equal(err.expiresAt, ONE_HOUR_LATER);
  assert.ok(err instanceof Error);
  assert.ok(err.message.includes('ERRCODE=APPROVAL_EXPIRED'));
});
