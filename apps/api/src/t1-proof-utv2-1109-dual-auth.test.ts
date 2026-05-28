/**
 * T1 proof test: UTV2-1109 — Dual-Authorization Runtime (INIT-2.4.2)
 *
 * Adversarial validation: single approvals do not progress dual-auth actions.
 * Same-operator second approvals are rejected. Expired pending approvals are rejected.
 *
 * Gap closed: #16 — dual authorization was convention only; now runtime-enforced.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DUAL_AUTH_ACTIONS,
  DUAL_AUTH_TTL_SECONDS,
  DualAuthViolationError,
  completeApproval,
  createPendingApproval,
  isDualAuthExpired,
  replayApprovalChain,
  requiresDualAuth,
} from '@unit-talk/contracts';

const NOW = '2026-05-28T08:00:00.000Z';
const LATER = '2026-05-28T08:30:00.000Z';
const AFTER_TTL = '2026-05-28T09:01:00.000Z';

test('UTV2-1109: DUAL_AUTH_ACTIONS contains all required governed actions', () => {
  assert.ok(DUAL_AUTH_ACTIONS.includes('picks:void'), 'picks:void required');
  assert.ok(
    DUAL_AUTH_ACTIONS.includes('picks:override'),
    'picks:override required',
  );
  assert.ok(
    DUAL_AUTH_ACTIONS.includes('member:write'),
    'member:write required',
  );
  assert.ok(
    DUAL_AUTH_ACTIONS.includes('operator:admin'),
    'operator:admin required',
  );
  assert.ok(
    DUAL_AUTH_ACTIONS.includes('settlement:correct'),
    'settlement:correct required',
  );
  assert.ok(
    DUAL_AUTH_ACTIONS.includes('promotion:override'),
    'promotion:override required',
  );
  assert.ok(
    DUAL_AUTH_ACTIONS.length >= 6,
    'at least 6 dual-auth actions required',
  );
});

test('UTV2-1109: DUAL_AUTH_TTL_SECONDS is 3600 (1 hour)', () => {
  assert.equal(DUAL_AUTH_TTL_SECONDS, 3600);
});

test('UTV2-1109: requiresDualAuth returns true for governed actions', () => {
  assert.equal(requiresDualAuth('picks:void'), true);
  assert.equal(requiresDualAuth('operator:admin'), true);
  assert.equal(requiresDualAuth('settlement:correct'), true);
});

test('UTV2-1109: requiresDualAuth returns false for non-governed actions', () => {
  assert.equal(requiresDualAuth('picks:submit'), false);
  assert.equal(requiresDualAuth('picks:read'), false);
  assert.equal(requiresDualAuth('outbox:deliver'), false);
  assert.equal(requiresDualAuth('service_role'), false);
});

test('UTV2-1109: createPendingApproval produces a frozen PendingApproval with correct TTL', () => {
  const pending = createPendingApproval({
    id: 'pa-001',
    action: 'picks:void',
    firstApproverId: 'alice',
    requestedAt: NOW,
  });

  assert.equal(pending.id, 'pa-001');
  assert.equal(pending.action, 'picks:void');
  assert.equal(pending.firstApproverId, 'alice');
  assert.equal(pending.requestedAt, NOW);
  const expectedExpiry = new Date(
    new Date(NOW).getTime() + 3600 * 1000,
  ).toISOString();
  assert.equal(pending.expiresAt, expectedExpiry);
  assert.ok(
    Object.isFrozen(pending),
    'PendingApproval must be frozen (immutable)',
  );
});

test('UTV2-1109: createPendingApproval respects custom TTL', () => {
  const pending = createPendingApproval({
    id: 'pa-002',
    action: 'operator:admin',
    firstApproverId: 'bob',
    requestedAt: NOW,
    ttlSeconds: 1800,
  });
  const expectedExpiry = new Date(
    new Date(NOW).getTime() + 1800 * 1000,
  ).toISOString();
  assert.equal(pending.expiresAt, expectedExpiry);
});

test('UTV2-1109: completeApproval succeeds with different operator', () => {
  const pending = createPendingApproval({
    id: 'pa-003',
    action: 'picks:override',
    firstApproverId: 'alice',
    requestedAt: NOW,
  });

  const record = completeApproval({
    pending,
    secondApproverId: 'bob',
    approvedAt: LATER,
  });

  assert.equal(record.id, 'pa-003');
  assert.equal(record.action, 'picks:override');
  assert.equal(record.firstApproverId, 'alice');
  assert.equal(record.secondApproverId, 'bob');
  assert.equal(record.approvedAt, LATER);
  assert.ok(
    Object.isFrozen(record),
    'ApprovalRecord must be frozen (immutable)',
  );
});

test('UTV2-1109: ADVERSARIAL same-operator second approval is rejected with DualAuthViolationError', () => {
  const pending = createPendingApproval({
    id: 'pa-004',
    action: 'picks:void',
    firstApproverId: 'alice',
    requestedAt: NOW,
  });

  let caught: unknown;
  try {
    completeApproval({ pending, secondApproverId: 'alice', approvedAt: LATER });
  } catch (e) {
    caught = e;
  }

  assert.ok(
    caught instanceof DualAuthViolationError,
    'must throw DualAuthViolationError',
  );
  assert.ok(
    caught.message.includes('DUAL_AUTH_VIOLATION'),
    'error must contain DUAL_AUTH_VIOLATION',
  );
  assert.ok(
    caught.message.includes('alice'),
    'error must name the offending operator',
  );
  assert.equal(caught.action, 'picks:void');
  assert.equal(caught.code, 'DUAL_AUTH_VIOLATION');
});

test('UTV2-1109: ADVERSARIAL same-operator approval on operator:admin is rejected', () => {
  const pending = createPendingApproval({
    id: 'pa-005',
    action: 'operator:admin',
    firstApproverId: 'carol',
    requestedAt: NOW,
  });

  assert.throws(
    () =>
      completeApproval({
        pending,
        secondApproverId: 'carol',
        approvedAt: LATER,
      }),
    DualAuthViolationError,
  );
});

test('UTV2-1109: ADVERSARIAL same-operator approval on member:write is rejected', () => {
  const pending = createPendingApproval({
    id: 'pa-006',
    action: 'member:write',
    firstApproverId: 'dave',
    requestedAt: NOW,
  });

  assert.throws(
    () =>
      completeApproval({
        pending,
        secondApproverId: 'dave',
        approvedAt: LATER,
      }),
    DualAuthViolationError,
  );
});

test('UTV2-1109: ADVERSARIAL expired pending approval is rejected', () => {
  const pending = createPendingApproval({
    id: 'pa-007',
    action: 'settlement:correct',
    firstApproverId: 'alice',
    requestedAt: NOW,
  });

  let caught: unknown;
  try {
    completeApproval({
      pending,
      secondApproverId: 'bob',
      approvedAt: AFTER_TTL,
    });
  } catch (e) {
    caught = e;
  }

  assert.ok(
    caught instanceof DualAuthViolationError,
    'must throw DualAuthViolationError',
  );
  assert.ok(caught.message.includes('expired'), 'error must indicate expiry');
  assert.equal(caught.action, 'settlement:correct');
  assert.equal(caught.code, 'DUAL_AUTH_VIOLATION');
});

test('UTV2-1109: ADVERSARIAL expired pending approval on promotion:override is rejected', () => {
  const pending = createPendingApproval({
    id: 'pa-008',
    action: 'promotion:override',
    firstApproverId: 'eve',
    requestedAt: NOW,
  });

  assert.throws(
    () =>
      completeApproval({
        pending,
        secondApproverId: 'frank',
        approvedAt: AFTER_TTL,
      }),
    DualAuthViolationError,
  );
});

test('UTV2-1109: isDualAuthExpired returns true when past TTL', () => {
  const pending = createPendingApproval({
    id: 'pa-009',
    action: 'picks:void',
    firstApproverId: 'alice',
    requestedAt: NOW,
  });

  assert.equal(isDualAuthExpired(pending, AFTER_TTL), true);
  assert.equal(isDualAuthExpired(pending, LATER), false);
  assert.equal(isDualAuthExpired(pending, NOW), false);
});

test('UTV2-1109: replayApprovalChain deterministically reconstructs the ApprovalRecord', () => {
  const pending = createPendingApproval({
    id: 'pa-010',
    action: 'picks:override',
    firstApproverId: 'alice',
    requestedAt: NOW,
  });

  const record1 = replayApprovalChain(pending, 'bob', LATER);
  const record2 = replayApprovalChain(pending, 'bob', LATER);

  assert.deepEqual(record1, record2, 'replay must be deterministic');
  assert.equal(record1.firstApproverId, 'alice');
  assert.equal(record1.secondApproverId, 'bob');
  assert.equal(record1.action, 'picks:override');
});

test('UTV2-1109: ApprovalRecord is immutable and mutations are rejected in strict mode', () => {
  const pending = createPendingApproval({
    id: 'pa-011',
    action: 'operator:admin',
    firstApproverId: 'alice',
    requestedAt: NOW,
  });

  const record = completeApproval({
    pending,
    secondApproverId: 'bob',
    approvedAt: LATER,
  });

  assert.ok(Object.isFrozen(record), 'ApprovalRecord must be frozen');
  assert.throws(() => {
    (record as { secondApproverId: string }).secondApproverId = 'eve';
  }, TypeError);
});

test('UTV2-1109: DualAuthViolationError has correct name and code', () => {
  const err = new DualAuthViolationError('test reason', 'picks:void');
  assert.equal(err.name, 'DualAuthViolationError');
  assert.equal(err.code, 'DUAL_AUTH_VIOLATION');
  assert.equal(err.action, 'picks:void');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof DualAuthViolationError);
});
