/**
 * Emergency Governance Rollback — INIT-2.4.4
 *
 * Dual-authorized, append-only, deterministically replayable rollback semantics.
 * Emergency override remains fail-closed: any missing or invalid authorization
 * throws before any state mutation occurs.
 */

import { type ApprovalRecord, completeApproval, createPendingApproval, type DualAuthAction } from './dual-auth.js';

// ---------------------------------------------------------------------------
// Window constants
// ---------------------------------------------------------------------------

/** How long an emergency rollback authorization remains valid (seconds). */
export const ROLLBACK_AUTHORIZATION_WINDOW_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Frozen domains — fail-closed override guard
// ---------------------------------------------------------------------------

/** Domains that are constitutionally frozen and cannot be rolled back. */
const FROZEN_DOMAINS = new Set<string>([
  'capital',
  'scaling',
  'ws-3.5',
]);

export function assertDomainNotFrozen(domain: string): void {
  if (FROZEN_DOMAINS.has(domain)) {
    throw new RollbackDomainFrozenError(domain);
  }
}

export function isFrozenDomain(domain: string): boolean {
  return FROZEN_DOMAINS.has(domain);
}

// ---------------------------------------------------------------------------
// Event kinds
// ---------------------------------------------------------------------------

export type RollbackEventKind =
  | 'rollback_initiated'
  | 'rollback_authorized'
  | 'rollback_applied'
  | 'rollback_rejected'
  | 'rollback_expired';

// ---------------------------------------------------------------------------
// Terminal rollback states — immutable once reached
// ---------------------------------------------------------------------------

/** Canonical terminal rollback status values. Once reached, replay must not overwrite. */
export const TERMINAL_ROLLBACK_STATUSES = ['applied', 'rejected', 'expired'] as const;

export type TerminalRollbackStatus = (typeof TERMINAL_ROLLBACK_STATUSES)[number];

/** Returns true if the status is terminal — no further state transitions are valid. */
export function isTerminalRollbackStatus(
  status: RollbackChain['finalStatus'],
): status is TerminalRollbackStatus {
  return (TERMINAL_ROLLBACK_STATUSES as readonly string[]).includes(status);
}

/** Throws if `status` is already terminal — prevents replay from overwriting finalized outcomes. */
export function assertRollbackStateNotTerminal(status: RollbackChain['finalStatus']): void {
  if (isTerminalRollbackStatus(status)) {
    throw new RollbackTerminalStateError(status);
  }
}

export class RollbackTerminalStateError extends Error {
  readonly code = 'ROLLBACK_TERMINAL_STATE' as const;
  constructor(public readonly status: TerminalRollbackStatus) {
    super(
      `ROLLBACK_TERMINAL_STATE: rollback is already in terminal state '${status}' — replay reconstruction must not overwrite finalized outcomes ERRCODE=ROLLBACK_TERMINAL_STATE`,
    );
    this.name = 'RollbackTerminalStateError';
  }
}

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface RollbackTarget {
  readonly domain: string;
  readonly issueId: string;
  readonly reason: string;
}

export interface RollbackEvent {
  readonly id: string;
  readonly kind: RollbackEventKind;
  readonly target: RollbackTarget;
  readonly approval: ApprovalRecord;
  readonly occurredAt: string;
  readonly appliedAt: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
}

export interface RollbackChain {
  readonly events: readonly RollbackEvent[];
  readonly finalStatus: 'pending' | 'applied' | 'rejected' | 'expired';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RollbackAuthorizationError extends Error {
  readonly code = 'ROLLBACK_AUTHORIZATION_FAILED' as const;
  constructor(public readonly reason: string) {
    super(`ROLLBACK_AUTHORIZATION_FAILED: ${reason} ERRCODE=ROLLBACK_AUTHORIZATION_FAILED`);
    this.name = 'RollbackAuthorizationError';
  }
}

export class RollbackExpiredError extends Error {
  readonly code = 'ROLLBACK_EXPIRED' as const;
  constructor(public readonly expiresAt: string) {
    super(`ROLLBACK_EXPIRED: authorization expired at ${expiresAt} ERRCODE=ROLLBACK_EXPIRED`);
    this.name = 'RollbackExpiredError';
  }
}

export class RollbackDomainFrozenError extends Error {
  readonly code = 'ROLLBACK_DOMAIN_FROZEN' as const;
  constructor(public readonly domain: string) {
    super(`ROLLBACK_DOMAIN_FROZEN: domain ${domain} is frozen and cannot be rolled back ERRCODE=ROLLBACK_DOMAIN_FROZEN`);
    this.name = 'RollbackDomainFrozenError';
  }
}

// ---------------------------------------------------------------------------
// Authorization expiry helpers
// ---------------------------------------------------------------------------

export function computeRollbackExpiresAt(approvedAt: string): string {
  return new Date(
    new Date(approvedAt).getTime() + ROLLBACK_AUTHORIZATION_WINDOW_SECONDS * 1000,
  ).toISOString();
}

export function isRollbackExpired(approval: ApprovalRecord, asOf: string): boolean {
  return new Date(asOf).getTime() >= new Date(approval.expiresAt).getTime();
}

export function assertRollbackNotExpired(approval: ApprovalRecord, asOf: string): void {
  if (isRollbackExpired(approval, asOf)) {
    throw new RollbackExpiredError(approval.expiresAt);
  }
}

// ---------------------------------------------------------------------------
// Fail-closed authorization assertion
// ---------------------------------------------------------------------------

/**
 * Asserts that a rollback is fully authorized before any mutation occurs.
 * Throws on any authorization failure — fail-closed.
 */
export function assertRollbackAuthorized(
  target: RollbackTarget,
  approval: ApprovalRecord,
  asOf: string,
): void {
  assertDomainNotFrozen(target.domain);
  assertRollbackNotExpired(approval, asOf);
}

// ---------------------------------------------------------------------------
// Rollback authorization factory
// ---------------------------------------------------------------------------

/**
 * Creates a fully authorized rollback approval via the dual-auth runtime.
 * Fail-closed: same-operator or expired window throws before returning.
 */
export function authorizeRollback(params: {
  id: string;
  action: DualAuthAction;
  firstApproverId: string;
  secondApproverId: string;
  requestedAt: string;
  approvedAt: string;
  target: RollbackTarget;
}): ApprovalRecord {
  assertDomainNotFrozen(params.target.domain);

  const pending = createPendingApproval({
    id: params.id,
    action: params.action,
    firstApproverId: params.firstApproverId,
    requestedAt: params.requestedAt,
  });

  return completeApproval({
    pending,
    secondApproverId: params.secondApproverId,
    approvedAt: params.approvedAt,
  });
}

// ---------------------------------------------------------------------------
// Append-only event construction
// ---------------------------------------------------------------------------

export function createRollbackEvent(params: {
  id: string;
  kind: RollbackEventKind;
  target: RollbackTarget;
  approval: ApprovalRecord;
  occurredAt: string;
  appliedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
}): RollbackEvent {
  return Object.freeze({
    id: params.id,
    kind: params.kind,
    target: Object.freeze({ ...params.target }),
    approval: Object.freeze({ ...params.approval }),
    occurredAt: params.occurredAt,
    appliedAt: params.appliedAt ?? null,
    rejectedAt: params.rejectedAt ?? null,
    rejectionReason: params.rejectionReason ?? null,
  });
}

// ---------------------------------------------------------------------------
// Deterministic replay
// ---------------------------------------------------------------------------

/**
 * Replays a sequence of rollback events to reconstruct the final chain state.
 * Deterministic: same inputs always produce same output.
 */
export function replayRollbackChain(events: readonly RollbackEvent[]): RollbackChain {
  const sorted = [...events].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  let finalStatus: RollbackChain['finalStatus'] = 'pending';

  for (const event of sorted) {
    // Terminal states are immutable — stop processing once reached (CR-4)
    if (isTerminalRollbackStatus(finalStatus)) break;
    switch (event.kind) {
      case 'rollback_applied':
        finalStatus = 'applied';
        break;
      case 'rollback_rejected':
        finalStatus = 'rejected';
        break;
      case 'rollback_expired':
        finalStatus = 'expired';
        break;
      default:
        break;
    }
  }

  return Object.freeze({
    events: sorted,
    finalStatus,
  });
}

/**
 * Reconstructs rollback chain state from serialized event records.
 * Idempotent — safe to call multiple times with same input.
 */
export function reconstructRollbackChain(rawEvents: readonly RollbackEvent[]): RollbackChain {
  const reconstructed = rawEvents.map(e =>
    createRollbackEvent({
      id: e.id,
      kind: e.kind,
      target: e.target,
      approval: e.approval,
      occurredAt: e.occurredAt,
      appliedAt: e.appliedAt,
      rejectedAt: e.rejectedAt,
      rejectionReason: e.rejectionReason,
    }),
  );
  return replayRollbackChain(reconstructed);
}
