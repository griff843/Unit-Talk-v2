/**
 * INIT-2.4.3 — Approval Expiration
 *
 * Generic expiration engine for all governance approval windows.
 * Fail-closed: expired approvals throw ApprovalExpiredError rather than degrading silently.
 * Replay-safe: expiration state is deterministic from (issuedAt, kind) alone.
 */

export const APPROVAL_WINDOW_SECONDS = {
  'dual-auth': 3600,
  'operator-action': 1800,
  'member-promotion': 86400,
} as const;

export type ApprovalWindowKind = keyof typeof APPROVAL_WINDOW_SECONDS;

export const APPROVAL_WINDOW_KINDS = Object.keys(
  APPROVAL_WINDOW_SECONDS,
) as ApprovalWindowKind[];

export interface ExpirationRecord {
  readonly id: string;
  readonly kind: ApprovalWindowKind;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly expiredAt: string | null;
  readonly reason: string;
}

export class ApprovalExpiredError extends Error {
  readonly code = 'APPROVAL_EXPIRED' as const;
  constructor(
    public readonly kind: ApprovalWindowKind,
    public readonly expiresAt: string,
  ) {
    super(
      `APPROVAL_EXPIRED: ${kind} approval window expired at ${expiresAt} ERRCODE=APPROVAL_EXPIRED`,
    );
    this.name = 'ApprovalExpiredError';
  }
}

export function computeExpiresAt(issuedAt: string, kind: ApprovalWindowKind): string {
  const windowMs = APPROVAL_WINDOW_SECONDS[kind] * 1000;
  return new Date(new Date(issuedAt).getTime() + windowMs).toISOString();
}

export function isApprovalExpired(expiresAt: string, asOf: string): boolean {
  return new Date(asOf).getTime() >= new Date(expiresAt).getTime();
}

export function assertApprovalNotExpired(
  expiresAt: string,
  asOf: string,
  kind: ApprovalWindowKind,
): void {
  if (isApprovalExpired(expiresAt, asOf)) {
    throw new ApprovalExpiredError(kind, expiresAt);
  }
}

export function createExpirationRecord(params: {
  id: string;
  kind: ApprovalWindowKind;
  issuedAt: string;
  expiredAt: string | null;
  reason: string;
}): ExpirationRecord {
  return Object.freeze({
    id: params.id,
    kind: params.kind,
    issuedAt: params.issuedAt,
    expiresAt: computeExpiresAt(params.issuedAt, params.kind),
    expiredAt: params.expiredAt,
    reason: params.reason,
  });
}

export function replayExpirationChain(
  records: readonly ExpirationRecord[],
): ExpirationRecord[] {
  return records.map((r) =>
    createExpirationRecord({
      id: r.id,
      kind: r.kind,
      issuedAt: r.issuedAt,
      expiredAt: r.expiredAt,
      reason: r.reason,
    }),
  );
}
