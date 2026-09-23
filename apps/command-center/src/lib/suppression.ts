/**
 * One definition of "why was this pick suppressed", shared by every operator surface.
 *
 * `T1_PRODUCTION_READINESS_CONTRACT.md` Dimension 5 requires suppressed picks to render a
 * `suppressionReason` that is non-null and non-blank. The requirement exists because a suppressed
 * pick with no visible reason is indistinguishable from one suppressed by mistake — so the honest
 * rendering of a missing reason is *not* a dash. A dash reads as "nothing to say here"; the absence
 * of a reason on a suppressed pick is a defect an operator needs to see.
 *
 * This module is deliberately pure and free of any data-client import so a client component can use
 * it without pulling in server-only code.
 */

/** Promotion statuses that mean the pick was withheld and therefore owes an explanation. */
const SUPPRESSED_STATUSES = new Set(['suppressed', 'not_eligible']);

export interface SuppressionDescription {
  /** True when the promotion status is one that withholds the pick. */
  suppressed: boolean;
  /** The recorded reason, trimmed. Null when there is none to show. */
  reason: string | null;
  /**
   * True only when the pick is suppressed *and* carries no usable reason. This is the state the
   * contract is actually about, and the one a surface must render as a defect rather than a blank.
   */
  missingReason: boolean;
}

/**
 * Blank, whitespace-only and non-string reasons all collapse to "no reason recorded".
 * A whitespace-only reason would otherwise satisfy a naive non-null check while telling an
 * operator nothing, which is the exact failure the contract's "non-blank" wording names.
 */
export function describeSuppression(
  promotionStatus: string | null | undefined,
  promotionReason: string | null | undefined,
): SuppressionDescription {
  const status = typeof promotionStatus === 'string' ? promotionStatus.trim().toLowerCase() : '';
  const suppressed = SUPPRESSED_STATUSES.has(status);

  const trimmed = typeof promotionReason === 'string' ? promotionReason.trim() : '';
  const reason = trimmed.length > 0 ? trimmed : null;

  return {
    suppressed,
    reason,
    missingReason: suppressed && reason === null,
  };
}

/** The label a surface shows when a suppressed pick records no reason. */
export const NO_REASON_RECORDED = 'no reason recorded';
