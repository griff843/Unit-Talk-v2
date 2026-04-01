import type { RepositoryBundle, ApprovalStatus } from '@unit-talk/db';
import type { PickReviewDecision } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { successResponse, errorResponse } from '../http.js';

const VALID_DECISIONS: PickReviewDecision[] = ['approve', 'deny', 'hold', 'return'];

/** Maps human decision to system gate value. */
function decisionToApprovalStatus(decision: PickReviewDecision): ApprovalStatus | null {
  switch (decision) {
    case 'approve': return 'approved';
    case 'deny': return 'rejected';
    case 'hold': return null;   // no change — stays pending
    case 'return': return null; // no change — stays pending
  }
}

export interface ReviewPickRequest {
  decision: string;
  reason: string;
  decidedBy: string;
}

export interface ReviewPickResult {
  pickId: string;
  reviewId: string;
  decision: PickReviewDecision;
  approvalStatus: string;
  auditId: string;
  promotionError?: string;
}

export async function reviewPickController(
  pickId: string,
  payload: ReviewPickRequest,
  repositories: RepositoryBundle,
): Promise<ApiResponse<ReviewPickResult>> {
  if (!payload.decision || !VALID_DECISIONS.includes(payload.decision as PickReviewDecision)) {
    return errorResponse(400, 'INVALID_DECISION', `Decision must be one of: ${VALID_DECISIONS.join(', ')}`);
  }

  if (!payload.reason || payload.reason.trim().length === 0) {
    return errorResponse(400, 'REASON_REQUIRED', 'A reason is required for every review decision');
  }

  if (!payload.decidedBy || payload.decidedBy.trim().length === 0) {
    return errorResponse(400, 'DECIDED_BY_REQUIRED', 'decidedBy is required');
  }

  const decision = payload.decision as PickReviewDecision;
  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    return errorResponse(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  // Validate state transitions
  if (decision === 'return') {
    // return is only valid if the latest review decision is 'hold'
    const reviews = await repositories.reviews.listByPick(pickId);
    const latest = reviews[0];
    if (!latest || latest.decision !== 'hold') {
      return errorResponse(400, 'INVALID_RETURN', 'Can only return a pick that is currently held');
    }
  }

  if (pick.approval_status !== 'pending' && (decision === 'approve' || decision === 'deny' || decision === 'hold')) {
    return errorResponse(400, 'NOT_PENDING', `Pick approval status is '${pick.approval_status}', not 'pending'. Cannot review.`);
  }

  // Record the review decision
  const review = await repositories.reviews.createReview({
    pickId,
    decision,
    reason: payload.reason.trim(),
    decidedBy: payload.decidedBy.trim(),
  });

  // Update approval_status if decision changes it
  const newApprovalStatus = decisionToApprovalStatus(decision);
  if (newApprovalStatus) {
    await repositories.picks.updateApprovalStatus(pickId, newApprovalStatus);
  }

  // Write audit log
  const audit = await repositories.audit.record({
    entityType: 'pick_review',
    entityId: review.id,
    entityRef: pickId,
    action: `review.${decision}`,
    actor: payload.decidedBy.trim(),
    payload: {
      decision,
      reason: payload.reason.trim(),
      previousApprovalStatus: pick.approval_status,
      newApprovalStatus: newApprovalStatus ?? pick.approval_status,
    },
  });

  // If approved, trigger promotion re-evaluation
  let promotionError: string | undefined;
  if (decision === 'approve') {
    try {
      const { evaluateAllPoliciesEagerAndPersist } = await import('../promotion-service.js');
      await evaluateAllPoliciesEagerAndPersist(
        pickId,
        `review.${payload.decidedBy.trim()}`,
        repositories.picks,
        repositories.audit,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      promotionError = `Promotion evaluation failed: ${message}`;

      // Log structured error so operators can observe failures
      console.error(JSON.stringify({
        level: 'error',
        event: 'promotion_evaluation_failed',
        pickId,
        actor: payload.decidedBy.trim(),
        error: message,
        timestamp: new Date().toISOString(),
      }));

      // Record the failure in the audit log so it is visible in operator tools
      await repositories.audit.record({
        entityType: 'pick_review',
        entityId: review.id,
        entityRef: pickId,
        action: 'promotion.evaluation_failed',
        actor: payload.decidedBy.trim(),
        payload: { error: message, decision },
      });
    }
  }

  const result: ReviewPickResult = {
    pickId,
    reviewId: review.id,
    decision,
    approvalStatus: newApprovalStatus ?? pick.approval_status,
    auditId: audit.id,
  };

  if (promotionError) {
    result.promotionError = promotionError;
  }

  return successResponse(200, result);
}
