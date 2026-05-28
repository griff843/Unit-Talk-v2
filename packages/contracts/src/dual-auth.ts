/**
 * Dual-Authorization Runtime — INIT-2.4.2 (UTV2-1109)
 *
 * Mechanically enforces dual authorization for governed actions. A single approval
 * creates a PendingApproval; a second, independently authenticated, different operator
 * must call completeApproval() to produce an immutable ApprovalRecord.
 *
 * Closes Gap #16: dual authorization was convention only; now runtime-enforced.
 */

export const DUAL_AUTH_ACTIONS = [
  'picks:void',
  'picks:override',
  'member:write',
  'operator:admin',
  'settlement:correct',
  'promotion:override',
] as const;

export type DualAuthAction = (typeof DUAL_AUTH_ACTIONS)[number];

export const DUAL_AUTH_TTL_SECONDS = 3600;

export interface PendingApproval {
  readonly id: string;
  readonly action: DualAuthAction;
  readonly firstApproverId: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly action: DualAuthAction;
  readonly firstApproverId: string;
  readonly secondApproverId: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

export class DualAuthViolationError extends Error {
  readonly code = 'DUAL_AUTH_VIOLATION' as const;

  constructor(
    public readonly reason: string,
    public readonly action: DualAuthAction,
  ) {
    super(`DUAL_AUTH_VIOLATION: ${reason} [action=${action}] ERRCODE=DUAL_AUTH_VIOLATION`);
    this.name = 'DualAuthViolationError';
  }
}

export function requiresDualAuth(action: string): action is DualAuthAction {
  return (DUAL_AUTH_ACTIONS as readonly string[]).includes(action);
}

export function createPendingApproval(params: {
  id: string;
  action: DualAuthAction;
  firstApproverId: string;
  requestedAt: string;
  ttlSeconds?: number;
}): PendingApproval {
  const ttl = params.ttlSeconds ?? DUAL_AUTH_TTL_SECONDS;
  const requestedMs = new Date(params.requestedAt).getTime();
  const expiresAt = new Date(requestedMs + ttl * 1000).toISOString();

  return Object.freeze({
    id: params.id,
    action: params.action,
    firstApproverId: params.firstApproverId,
    requestedAt: params.requestedAt,
    expiresAt,
  });
}

export function completeApproval(params: {
  pending: PendingApproval;
  secondApproverId: string;
  approvedAt: string;
}): ApprovalRecord {
  const { pending, secondApproverId, approvedAt } = params;

  if (pending.firstApproverId === secondApproverId) {
    throw new DualAuthViolationError(
      `Operator '${secondApproverId}' cannot provide both approvals — same-operator dual-auth is prohibited`,
      pending.action,
    );
  }

  if (isDualAuthExpired(pending, approvedAt)) {
    throw new DualAuthViolationError(
      `Pending approval expired at ${pending.expiresAt} — dual-auth window closed`,
      pending.action,
    );
  }

  return Object.freeze({
    id: pending.id,
    action: pending.action,
    firstApproverId: pending.firstApproverId,
    secondApproverId,
    approvedAt,
    expiresAt: pending.expiresAt,
  });
}

export function isDualAuthExpired(pending: PendingApproval, asOf: string): boolean {
  // Canonical boundary: asOf >= expiresAt is expired (fail-closed, matches approval-expiration.ts)
  return new Date(asOf).getTime() >= new Date(pending.expiresAt).getTime();
}

export function replayApprovalChain(
  pending: PendingApproval,
  secondApproverId: string,
  approvedAt: string,
): ApprovalRecord {
  return completeApproval({ pending, secondApproverId, approvedAt });
}
