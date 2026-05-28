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
import { describe, it } from 'node:test';
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
const ONE_HOUR_LATER = new Date(new Date(ISSUED_AT).getTime() + ONE_HOUR_MS).toISOString();
const ONE_SECOND_PAST = new Date(new Date(ONE_HOUR_LATER).getTime() + 1).toISOString();
const ONE_SECOND_BEFORE = new Date(new Date(ONE_HOUR_LATER).getTime() - 1).toISOString();

describe('UTV2-1110 — Approval Expiration', () => {
  it('APPROVAL_WINDOW_SECONDS includes all required window kinds', () => {
    assert.ok(APPROVAL_WINDOW_KINDS.includes('dual-auth'));
    assert.ok(APPROVAL_WINDOW_KINDS.includes('operator-action'));
    assert.ok(APPROVAL_WINDOW_KINDS.includes('member-promotion'));
    assert.equal(APPROVAL_WINDOW_SECONDS['dual-auth'], 3600);
    assert.equal(APPROVAL_WINDOW_SECONDS['operator-action'], 1800);
    assert.equal(APPROVAL_WINDOW_SECONDS['member-promotion'], 86400);
  });

  it('computeExpiresAt produces correct future timestamp for dual-auth', () => {
    const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
    assert.equal(expiresAt, ONE_HOUR_LATER);
  });

  it('computeExpiresAt is deterministic — same inputs produce equal outputs', () => {
    const a = computeExpiresAt(ISSUED_AT, 'operator-action');
    const b = computeExpiresAt(ISSUED_AT, 'operator-action');
    assert.equal(a, b);
  });

  it('isApprovalExpired returns false when within window', () => {
    const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
    assert.equal(isApprovalExpired(expiresAt, ONE_SECOND_BEFORE), false);
  });

  it('isApprovalExpired returns true when past expiry', () => {
    const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
    assert.equal(isApprovalExpired(expiresAt, ONE_SECOND_PAST), true);
  });

  it('BOUNDARY: isApprovalExpired returns true at exactly expiry time', () => {
    const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
    assert.equal(isApprovalExpired(expiresAt, ONE_HOUR_LATER), true);
  });

  it('assertApprovalNotExpired passes when within window', () => {
    const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
    assert.doesNotThrow(() => assertApprovalNotExpired(expiresAt, ONE_SECOND_BEFORE, 'dual-auth'));
  });

  it('ADVERSARIAL: assertApprovalNotExpired throws ApprovalExpiredError when expired (dual-auth)', () => {
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

  it('ADVERSARIAL: assertApprovalNotExpired throws for operator-action when expired', () => {
    const issuedAt = '2026-05-28T10:00:00.000Z';
    const expiresAt = computeExpiresAt(issuedAt, 'operator-action');
    const pastExpiry = new Date(new Date(expiresAt).getTime() + 1).toISOString();
    assert.throws(
      () => assertApprovalNotExpired(expiresAt, pastExpiry, 'operator-action'),
      ApprovalExpiredError,
    );
  });

  it('ADVERSARIAL: assertApprovalNotExpired throws for member-promotion when expired', () => {
    const issuedAt = '2026-05-28T10:00:00.000Z';
    const expiresAt = computeExpiresAt(issuedAt, 'member-promotion');
    const pastExpiry = new Date(new Date(expiresAt).getTime() + 1000).toISOString();
    assert.throws(
      () => assertApprovalNotExpired(expiresAt, pastExpiry, 'member-promotion'),
      ApprovalExpiredError,
    );
  });

  it('ADVERSARIAL: assertApprovalNotExpired throws at exactly expiry time (boundary fail-closed)', () => {
    const expiresAt = computeExpiresAt(ISSUED_AT, 'dual-auth');
    assert.throws(
      () => assertApprovalNotExpired(expiresAt, ONE_HOUR_LATER, 'dual-auth'),
      ApprovalExpiredError,
    );
  });

  it('createExpirationRecord produces a frozen ExpirationRecord with correct fields', () => {
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

  it('createExpirationRecord captures expiredAt when approval was recorded as expired', () => {
    const record = createExpirationRecord({
      id: 'rec-002',
      kind: 'operator-action',
      issuedAt: ISSUED_AT,
      expiredAt: ONE_SECOND_PAST,
      reason: 'timeout-sweep',
    });
    assert.equal(record.expiredAt, ONE_SECOND_PAST);
  });

  it('ExpirationRecord is frozen — mutations throw TypeError in strict mode', () => {
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

  it('replayExpirationChain is deterministic — same inputs produce equal ExpirationRecords', () => {
    const records = [
      createExpirationRecord({ id: 'r1', kind: 'dual-auth', issuedAt: ISSUED_AT, expiredAt: null, reason: 'open' }),
      createExpirationRecord({ id: 'r2', kind: 'operator-action', issuedAt: ISSUED_AT, expiredAt: ONE_SECOND_PAST, reason: 'expired' }),
    ];
    const replayed = replayExpirationChain(records);
    assert.deepEqual(replayed[0], records[0]);
    assert.deepEqual(replayed[1], records[1]);
  });

  it('ApprovalExpiredError has correct name, code, kind, and expiresAt', () => {
    const err = new ApprovalExpiredError('dual-auth', ONE_HOUR_LATER);
    assert.equal(err.name, 'ApprovalExpiredError');
    assert.equal(err.code, 'APPROVAL_EXPIRED');
    assert.equal(err.kind, 'dual-auth');
    assert.equal(err.expiresAt, ONE_HOUR_LATER);
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes('ERRCODE=APPROVAL_EXPIRED'));
  });
});
