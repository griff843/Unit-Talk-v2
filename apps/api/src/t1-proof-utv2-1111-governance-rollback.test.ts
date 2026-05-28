/**
 * T1 Proof — UTV2-1111 INIT-2.4.4 Emergency Governance Rollback
 *
 * 18 adversarial assertions covering all five invariants:
 *   ERB-1: dual-authorized rollback authority
 *   ERB-2: replay-visible events
 *   ERB-3: append-only immutability
 *   ERB-4: deterministic reconstruction
 *   ERB-5: fail-closed frozen domain guard
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ROLLBACK_AUTHORIZATION_WINDOW_SECONDS,
  assertDomainNotFrozen,
  assertRollbackAuthorized,
  assertRollbackNotExpired,
  authorizeRollback,
  computeRollbackExpiresAt,
  createRollbackEvent,
  isFrozenDomain,
  isRollbackExpired,
  replayRollbackChain,
  reconstructRollbackChain,
  RollbackDomainFrozenError,
  RollbackExpiredError,
  type RollbackEvent,
  type RollbackTarget,
} from '@unit-talk/contracts';
import {
  DualAuthViolationError,
  createPendingApproval,
  completeApproval,
} from '@unit-talk/contracts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApproval(
  overrides: Partial<{
    id: string;
    firstApproverId: string;
    secondApproverId: string;
    requestedAt: string;
    approvedAt: string;
  }> = {},
) {
  const requestedAt = overrides.requestedAt ?? '2026-01-01T00:00:00.000Z';
  const approvedAt = overrides.approvedAt ?? '2026-01-01T00:01:00.000Z';
  const pending = createPendingApproval({
    id: overrides.id ?? 'apr-test-1',
    action: 'operator:admin',
    firstApproverId: overrides.firstApproverId ?? 'operator-A',
    requestedAt,
  });
  return completeApproval({
    pending,
    secondApproverId: overrides.secondApproverId ?? 'operator-B',
    approvedAt,
  });
}

const VALID_TARGET: RollbackTarget = {
  domain: 'governance',
  issueId: 'UTV2-1111',
  reason: 'emergency constitutional rollback',
};

// ---------------------------------------------------------------------------
// ERB-5: Frozen domain fail-closed guard
// ---------------------------------------------------------------------------

test('ERB-5: isFrozenDomain returns true for capital, scaling, ws-3.5', () => {
  assert.equal(isFrozenDomain('capital'), true);
  assert.equal(isFrozenDomain('scaling'), true);
  assert.equal(isFrozenDomain('ws-3.5'), true);
});

test('ERB-5: isFrozenDomain returns false for non-frozen domains', () => {
  assert.equal(isFrozenDomain('governance'), false);
  assert.equal(isFrozenDomain('picks'), false);
  assert.equal(isFrozenDomain('distribution'), false);
});

test('ERB-5: assertDomainNotFrozen throws RollbackDomainFrozenError for frozen domain', () => {
  for (const domain of ['capital', 'scaling', 'ws-3.5']) {
    assert.throws(
      () => assertDomainNotFrozen(domain),
      (err: unknown) => {
        assert.ok(err instanceof RollbackDomainFrozenError);
        assert.equal(err.code, 'ROLLBACK_DOMAIN_FROZEN');
        assert.ok(err.message.includes('ERRCODE=ROLLBACK_DOMAIN_FROZEN'));
        assert.equal(err.domain, domain);
        return true;
      },
    );
  }
});

test('ERB-5: assertDomainNotFrozen does not throw for valid domains', () => {
  assert.doesNotThrow(() => assertDomainNotFrozen('governance'));
  assert.doesNotThrow(() => assertDomainNotFrozen('picks'));
});

// ---------------------------------------------------------------------------
// ERB-1: Dual-authorized rollback authority
// ---------------------------------------------------------------------------

test('ERB-1: authorizeRollback rejects same-operator dual-auth', () => {
  assert.throws(
    () =>
      authorizeRollback({
        id: 'rb-1',
        action: 'operator:admin',
        firstApproverId: 'operator-A',
        secondApproverId: 'operator-A',
        requestedAt: '2026-01-01T00:00:00.000Z',
        approvedAt: '2026-01-01T00:01:00.000Z',
        target: VALID_TARGET,
      }),
    DualAuthViolationError,
  );
});

test('ERB-1: authorizeRollback succeeds with two distinct operators', () => {
  const approval = authorizeRollback({
    id: 'rb-2',
    action: 'operator:admin',
    firstApproverId: 'operator-A',
    secondApproverId: 'operator-B',
    requestedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:01:00.000Z',
    target: VALID_TARGET,
  });
  assert.equal(approval.firstApproverId, 'operator-A');
  assert.equal(approval.secondApproverId, 'operator-B');
});

test('ERB-1: authorizeRollback rejects frozen domain before dual-auth', () => {
  assert.throws(
    () =>
      authorizeRollback({
        id: 'rb-3',
        action: 'operator:admin',
        firstApproverId: 'operator-A',
        secondApproverId: 'operator-B',
        requestedAt: '2026-01-01T00:00:00.000Z',
        approvedAt: '2026-01-01T00:01:00.000Z',
        target: { domain: 'capital', issueId: 'UTV2-999', reason: 'test' },
      }),
    RollbackDomainFrozenError,
  );
});

// ---------------------------------------------------------------------------
// Expiry semantics
// ---------------------------------------------------------------------------

test('computeRollbackExpiresAt is deterministic', () => {
  const base = '2026-01-01T00:00:00.000Z';
  const result1 = computeRollbackExpiresAt(base);
  const result2 = computeRollbackExpiresAt(base);
  assert.equal(result1, result2);
  assert.equal(
    result1,
    new Date(
      new Date(base).getTime() + ROLLBACK_AUTHORIZATION_WINDOW_SECONDS * 1000,
    ).toISOString(),
  );
});

test('isRollbackExpired: exactly at expiry boundary = expired (fail-closed)', () => {
  const approval = makeApproval({
    requestedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
  });
  const atExpiry = approval.expiresAt;
  assert.equal(isRollbackExpired(approval, atExpiry), true);
});

test('assertRollbackNotExpired throws RollbackExpiredError when expired', () => {
  const approval = makeApproval({
    requestedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.throws(
    () => assertRollbackNotExpired(approval, '2030-01-01T00:00:00.000Z'),
    (err: unknown) => {
      assert.ok(err instanceof RollbackExpiredError);
      assert.equal(err.code, 'ROLLBACK_EXPIRED');
      assert.ok(err.message.includes('ERRCODE=ROLLBACK_EXPIRED'));
      return true;
    },
  );
});

test('assertRollbackAuthorized throws for frozen domain regardless of valid dual-auth', () => {
  const approval = makeApproval();
  assert.throws(
    () =>
      assertRollbackAuthorized(
        { domain: 'ws-3.5', issueId: 'UTV2-999', reason: 'freeze test' },
        approval,
        '2026-01-01T00:01:00.000Z',
      ),
    RollbackDomainFrozenError,
  );
});

// ---------------------------------------------------------------------------
// ERB-3: Append-only immutability
// ---------------------------------------------------------------------------

test('ERB-3: createRollbackEvent returns frozen object', () => {
  const approval = makeApproval();
  const event = createRollbackEvent({
    id: 'evt-1',
    kind: 'rollback_initiated',
    target: VALID_TARGET,
    approval,
    occurredAt: '2026-01-01T00:01:00.000Z',
  });
  assert.ok(Object.isFrozen(event));
  assert.ok(Object.isFrozen(event.target));
  assert.ok(Object.isFrozen(event.approval));
});

test('ERB-3: createRollbackEvent nulls default for optional fields', () => {
  const approval = makeApproval();
  const event = createRollbackEvent({
    id: 'evt-2',
    kind: 'rollback_authorized',
    target: VALID_TARGET,
    approval,
    occurredAt: '2026-01-01T00:01:00.000Z',
  });
  assert.equal(event.appliedAt, null);
  assert.equal(event.rejectedAt, null);
  assert.equal(event.rejectionReason, null);
});

// ---------------------------------------------------------------------------
// ERB-2 + ERB-4: Replay-visible and deterministic
// ---------------------------------------------------------------------------

test('ERB-4: replayRollbackChain produces deterministic final status for applied', () => {
  const approval = makeApproval();
  const base = '2026-01-01T00:01:00.000Z';

  const events: RollbackEvent[] = [
    createRollbackEvent({
      id: 'e1',
      kind: 'rollback_initiated',
      target: VALID_TARGET,
      approval,
      occurredAt: base,
    }),
    createRollbackEvent({
      id: 'e2',
      kind: 'rollback_authorized',
      target: VALID_TARGET,
      approval,
      occurredAt: '2026-01-01T00:02:00.000Z',
    }),
    createRollbackEvent({
      id: 'e3',
      kind: 'rollback_applied',
      target: VALID_TARGET,
      approval,
      occurredAt: '2026-01-01T00:03:00.000Z',
      appliedAt: '2026-01-01T00:03:00.000Z',
    }),
  ];

  const chain1 = replayRollbackChain(events);
  const chain2 = replayRollbackChain([...events].reverse());

  assert.equal(chain1.finalStatus, 'applied');
  assert.equal(chain2.finalStatus, 'applied');
  assert.equal(chain1.events.length, 3);
});

test('ERB-4: replayRollbackChain produces deterministic final status for rejected', () => {
  const approval = makeApproval();
  const events: RollbackEvent[] = [
    createRollbackEvent({
      id: 'e1',
      kind: 'rollback_initiated',
      target: VALID_TARGET,
      approval,
      occurredAt: '2026-01-01T00:01:00.000Z',
    }),
    createRollbackEvent({
      id: 'e2',
      kind: 'rollback_rejected',
      target: VALID_TARGET,
      approval,
      occurredAt: '2026-01-01T00:02:00.000Z',
      rejectedAt: '2026-01-01T00:02:00.000Z',
      rejectionReason: 'veto',
    }),
  ];

  const chain = replayRollbackChain(events);
  assert.equal(chain.finalStatus, 'rejected');
});

test('ERB-2 + ERB-4: reconstructRollbackChain is idempotent and replay-visible', () => {
  const approval = makeApproval();
  const events: RollbackEvent[] = [
    createRollbackEvent({
      id: 'e1',
      kind: 'rollback_initiated',
      target: VALID_TARGET,
      approval,
      occurredAt: '2026-01-01T00:01:00.000Z',
    }),
    createRollbackEvent({
      id: 'e2',
      kind: 'rollback_applied',
      target: VALID_TARGET,
      approval,
      occurredAt: '2026-01-01T00:02:00.000Z',
      appliedAt: '2026-01-01T00:02:00.000Z',
    }),
  ];

  const chain1 = reconstructRollbackChain(events);
  const chain2 = reconstructRollbackChain(chain1.events as RollbackEvent[]);

  assert.equal(chain1.finalStatus, chain2.finalStatus);
  assert.equal(chain1.events.length, chain2.events.length);
  assert.ok(chain1.events[0] !== undefined && chain2.events[0] !== undefined);
  assert.equal(chain1.events[0]!.id, chain2.events[0]!.id);
});

test('ERB-4: empty event chain yields pending status', () => {
  const chain = replayRollbackChain([]);
  assert.equal(chain.finalStatus, 'pending');
  assert.equal(chain.events.length, 0);
});
