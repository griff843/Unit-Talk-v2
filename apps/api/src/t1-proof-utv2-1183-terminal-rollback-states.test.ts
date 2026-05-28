/**
 * T1 Proof — UTV2-1183 CR-4 — Enforce Terminal Rollback Replay States
 *
 * Adversarial assertions covering terminal state immutability:
 *   TRS-1: TERMINAL_ROLLBACK_STATUSES covers applied, rejected, expired
 *   TRS-2: isTerminalRollbackStatus correctly classifies states
 *   TRS-3: assertRollbackStateNotTerminal throws for terminal states
 *   TRS-4: applied state cannot be overwritten by expired in replay
 *   TRS-5: applied state cannot be overwritten by rejected in replay
 *   TRS-6: rejected state cannot be overwritten by expired in replay
 *   TRS-7: expired state cannot be overwritten by applied in replay
 *   TRS-8: replay reconstruction is deterministic from same input
 *   TRS-9: append-only — events before terminal are preserved unchanged
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TERMINAL_ROLLBACK_STATUSES,
  isTerminalRollbackStatus,
  assertRollbackStateNotTerminal,
  RollbackTerminalStateError,
  replayRollbackChain,
  reconstructRollbackChain,
  createRollbackEvent,
  authorizeRollback,
  type RollbackEvent,
} from '@unit-talk/contracts';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE = '2026-01-01T00:00:00.000Z';
const APPROVED = '2026-01-01T00:01:00.000Z';
const LATER = '2026-01-01T00:30:00.000Z';
const EVEN_LATER = '2026-01-01T01:00:00.000Z';

const TARGET = { domain: 'picks', issueId: 'UTV2-test', reason: 'test rollback' };

function makeApproval() {
  return authorizeRollback({
    id: 'rba-test',
    action: 'picks:void',
    firstApproverId: 'alice',
    secondApproverId: 'bob',
    requestedAt: BASE,
    approvedAt: APPROVED,
    target: TARGET,
  });
}

function makeEvent(kind: Parameters<typeof createRollbackEvent>[0]['kind'], at: string, extra: Partial<Parameters<typeof createRollbackEvent>[0]> = {}): RollbackEvent {
  return createRollbackEvent({
    id: `evt-${kind}-${at}`,
    kind,
    target: TARGET,
    approval: makeApproval(),
    occurredAt: at,
    ...extra,
  });
}

// ── TRS-1: TERMINAL_ROLLBACK_STATUSES constant ───────────────────────────────

test('TRS-1a: TERMINAL_ROLLBACK_STATUSES includes applied', () => {
  assert.ok((TERMINAL_ROLLBACK_STATUSES as readonly string[]).includes('applied'));
});

test('TRS-1b: TERMINAL_ROLLBACK_STATUSES includes rejected', () => {
  assert.ok((TERMINAL_ROLLBACK_STATUSES as readonly string[]).includes('rejected'));
});

test('TRS-1c: TERMINAL_ROLLBACK_STATUSES includes expired', () => {
  assert.ok((TERMINAL_ROLLBACK_STATUSES as readonly string[]).includes('expired'));
});

test('TRS-1d: TERMINAL_ROLLBACK_STATUSES does not include pending', () => {
  assert.ok(!(TERMINAL_ROLLBACK_STATUSES as readonly string[]).includes('pending'));
});

// ── TRS-2: isTerminalRollbackStatus ─────────────────────────────────────────

test('TRS-2a: isTerminalRollbackStatus(applied) === true', () => {
  assert.equal(isTerminalRollbackStatus('applied'), true);
});

test('TRS-2b: isTerminalRollbackStatus(rejected) === true', () => {
  assert.equal(isTerminalRollbackStatus('rejected'), true);
});

test('TRS-2c: isTerminalRollbackStatus(expired) === true', () => {
  assert.equal(isTerminalRollbackStatus('expired'), true);
});

test('TRS-2d: isTerminalRollbackStatus(pending) === false', () => {
  assert.equal(isTerminalRollbackStatus('pending'), false);
});

// ── TRS-3: assertRollbackStateNotTerminal ────────────────────────────────────

test('TRS-3a: assertRollbackStateNotTerminal throws for applied', () => {
  assert.throws(
    () => assertRollbackStateNotTerminal('applied'),
    (err: unknown) => {
      assert.ok(err instanceof RollbackTerminalStateError);
      assert.equal(err.code, 'ROLLBACK_TERMINAL_STATE');
      assert.equal(err.status, 'applied');
      return true;
    },
  );
});

test('TRS-3b: assertRollbackStateNotTerminal throws for rejected', () => {
  assert.throws(
    () => assertRollbackStateNotTerminal('rejected'),
    RollbackTerminalStateError,
  );
});

test('TRS-3c: assertRollbackStateNotTerminal throws for expired', () => {
  assert.throws(
    () => assertRollbackStateNotTerminal('expired'),
    RollbackTerminalStateError,
  );
});

test('TRS-3d: assertRollbackStateNotTerminal passes for pending', () => {
  assert.doesNotThrow(() => assertRollbackStateNotTerminal('pending'));
});

// ── TRS-4: applied cannot be overwritten by expired ──────────────────────────

test('TRS-4: applied state not overwritten by later expired event', () => {
  const events = [
    makeEvent('rollback_applied', LATER),
    makeEvent('rollback_expired', EVEN_LATER),
  ];
  const chain = replayRollbackChain(events);
  assert.equal(chain.finalStatus, 'applied', 'applied must survive subsequent expired event');
});

// ── TRS-5: applied cannot be overwritten by rejected ────────────────────────

test('TRS-5: applied state not overwritten by later rejected event', () => {
  const events = [
    makeEvent('rollback_applied', LATER),
    makeEvent('rollback_rejected', EVEN_LATER, { rejectedAt: EVEN_LATER, rejectionReason: 'late rejection' }),
  ];
  const chain = replayRollbackChain(events);
  assert.equal(chain.finalStatus, 'applied', 'applied must survive subsequent rejected event');
});

// ── TRS-6: rejected cannot be overwritten by expired ────────────────────────

test('TRS-6: rejected state not overwritten by later expired event', () => {
  const events = [
    makeEvent('rollback_rejected', LATER, { rejectedAt: LATER, rejectionReason: 'rejected' }),
    makeEvent('rollback_expired', EVEN_LATER),
  ];
  const chain = replayRollbackChain(events);
  assert.equal(chain.finalStatus, 'rejected', 'rejected must survive subsequent expired event');
});

// ── TRS-7: expired cannot be overwritten by applied ─────────────────────────

test('TRS-7: expired state not overwritten by later applied event', () => {
  const events = [
    makeEvent('rollback_expired', LATER),
    makeEvent('rollback_applied', EVEN_LATER, { appliedAt: EVEN_LATER }),
  ];
  const chain = replayRollbackChain(events);
  assert.equal(chain.finalStatus, 'expired', 'expired must survive subsequent applied event');
});

// ── TRS-8: replay is deterministic ──────────────────────────────────────────

test('TRS-8a: same events produce same final status (applied case)', () => {
  const events = [makeEvent('rollback_applied', LATER)];
  assert.equal(replayRollbackChain(events).finalStatus, replayRollbackChain(events).finalStatus);
  assert.equal(replayRollbackChain(events).finalStatus, 'applied');
});

test('TRS-8b: reconstructRollbackChain is idempotent', () => {
  const events = [
    makeEvent('rollback_initiated', BASE),
    makeEvent('rollback_applied', LATER, { appliedAt: LATER }),
    makeEvent('rollback_expired', EVEN_LATER),
  ];
  const chain1 = reconstructRollbackChain(events);
  const chain2 = reconstructRollbackChain(events);
  assert.equal(chain1.finalStatus, chain2.finalStatus);
  assert.equal(chain1.finalStatus, 'applied');
  assert.equal(chain1.events.length, chain2.events.length);
});

// ── TRS-9: append-only — prior events preserved ─────────────────────────────

test('TRS-9: events before terminal are preserved in replay output', () => {
  const events = [
    makeEvent('rollback_initiated', BASE),
    makeEvent('rollback_authorized', APPROVED),
    makeEvent('rollback_applied', LATER, { appliedAt: LATER }),
    makeEvent('rollback_expired', EVEN_LATER),
  ];
  const chain = replayRollbackChain(events);
  assert.equal(chain.finalStatus, 'applied');
  assert.equal(chain.events.length, 4, 'all 4 events preserved in sorted output');
  const [e0, e1, e2, e3] = chain.events;
  assert.ok(e0 && e1 && e2 && e3, 'all 4 events must be present');
  assert.equal(e0.kind, 'rollback_initiated');
  assert.equal(e1.kind, 'rollback_authorized');
  assert.equal(e2.kind, 'rollback_applied');
  assert.equal(e3.kind, 'rollback_expired');
});
