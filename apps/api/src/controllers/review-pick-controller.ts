import type { RepositoryBundle, ApprovalStatus } from '@unit-talk/db';
import type { PickReviewDecision } from '@unit-talk/db';
import { transitionPickLifecycle, InvalidTransitionError } from '@unit-talk/db';
import { isHumanCapperDeliveryAuthorized } from '@unit-talk/contracts';
import type { ApiResponse } from '../http.js';
import { successResponse, errorResponse } from '../http.js';
import { releaseHumanCapperDeliveryWithRunTracking } from '../run-audit-service.js';

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
  /**
   * UTV2-1923: present only for a human capper pick released to the governed
   * member-facing target by this approval. `enqueued: false` means a control
   * (the registry, or the kill switch downstream) refused — that is a correct
   * outcome, not an error, and it is reported rather than hidden.
   */
  humanDelivery?: {
    target: string;
    enqueued: boolean;
    reason?: string;
  };
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

  // Two distinct review lanes protected by this guard:
  //   1. Promotion-approval lane (legacy): approval_status must be 'pending'
  //   2. Governance-review lane (Phase 7A, UTV2-491/UTV2-509/UTV2-521): lifecycle
  //      status must be 'awaiting_approval', regardless of approval_status. Brake
  //      picks enter this lane with approval_status='approved' as a post-promotion
  //      default — approval_status and lifecycle status are orthogonal dimensions
  //      here. Collapsing them would break the separation of approval from promotion.
  const isGovernanceReview = pick.status === 'awaiting_approval';
  const isPromotionReview = pick.approval_status === 'pending';
  if (!isGovernanceReview && !isPromotionReview && (decision === 'approve' || decision === 'deny' || decision === 'hold')) {
    return errorResponse(
      400,
      'NOT_PENDING',
      `Pick not in a reviewable state (status='${pick.status}', approval_status='${pick.approval_status}'). Cannot review.`,
    );
  }

  // Record the review decision
  const review = await repositories.reviews.createReview({
    pickId,
    decision,
    reason: payload.reason.trim(),
    decidedBy: payload.decidedBy.trim(),
  });

  // Update approval_status if decision changes it.
  //
  // Option A writeback semantics (UTV2-521): brake picks enter the governance-review
  // lane with approval_status='approved' as a post-promotion default, so:
  //   - approve → 'approved' (no-op for brake picks; was already 'approved')
  //   - deny → 'rejected'
  //   - hold → null (no change)
  //   - return → null (no change)
  // decisionToApprovalStatus is not modified; the writeback path is unchanged.
  const newApprovalStatus = decisionToApprovalStatus(decision);
  if (newApprovalStatus) {
    await repositories.picks.updateApprovalStatus(pickId, newApprovalStatus);
  }

  // For picks in awaiting_approval state, the approve/deny decision also drives
  // a lifecycle transition: approved → queued, denied → voided.
  // This is the governance brake release path (Phase 7A, UTV2-491/UTV2-509).
  const pickLifecycleState = pick.status as string;
  // UTV2-1923 HUMAN_DELIVERY_APPROVAL_KEY_GUARD_START
  // RECOVERY DOOR, NOT THE CANONICAL PATH.
  //
  // An authorized human capper's pick is delivered at submission time and does
  // not enter `awaiting_approval` -- approval governs autonomous producers, not
  // people (see `humanCapperDeliveryRequiresOperatorApproval` in
  // distribution-service.ts, which is `false` and is asserted by test). So this
  // branch fires only for a human capper pick an operator has deliberately
  // parked there, and it exists so such a pick is not stranded.
  //
  // It must never become the way human picks are delivered. In particular a
  // delivery control that refuses at submission time (target disabled, or
  // killed) is fail-closed and does NOT park the pick here; reintroducing that
  // would rebuild the approval dependency this lane removed.
  const isHumanCapperDelivery = isHumanCapperDeliveryAuthorized(
    isRecord(pick.metadata) ? pick.metadata : null,
  );
  // UTV2-1923 HUMAN_DELIVERY_APPROVAL_KEY_GUARD_END
  let humanDelivery: ReviewPickResult['humanDelivery'];

  if (pickLifecycleState === 'awaiting_approval') {
    if (decision === 'approve') {
      try {
        if (isHumanCapperDelivery) {
          // The release performs the awaiting_approval -> queued transition and
          // the outbox write in ONE transaction. Transitioning separately would
          // allow a pick to reach `queued` with no delivery work behind it --
          // the zombie-queued shape the model lane has produced before.
          const released = await releaseHumanCapperDeliveryWithRunTracking(
            pickId,
            payload.decidedBy.trim(),
            `operator approved: ${payload.reason.trim()}`,
            repositories.picks,
            repositories.outbox,
            repositories.runs,
            repositories.audit,
            'approval',
            repositories.cappers,
          );
          humanDelivery = {
            target: released.target,
            enqueued: released.enqueued,
            ...(released.reason === undefined ? {} : { reason: released.reason }),
          };
        } else {
          await transitionPickLifecycle(
            repositories.picks,
            pickId,
            'queued',
            `operator approved: ${payload.reason.trim()}`,
            'operator_override',
          );
        }
      } catch (err: unknown) {
        if (err instanceof InvalidTransitionError) {
          return errorResponse(409, 'INVALID_LIFECYCLE_TRANSITION', err.message);
        }
        if (isHumanCapperDelivery) {
          // A refused release must not be reported as an approval that worked.
          // The pick stays in `awaiting_approval` and the reason is returned.
          return errorResponse(
            409,
            'HUMAN_DELIVERY_RELEASE_FAILED',
            err instanceof Error ? err.message : String(err),
          );
        }
        throw err;
      }
    } else if (decision === 'deny') {
      try {
        await transitionPickLifecycle(
          repositories.picks,
          pickId,
          'voided',
          `operator denied: ${payload.reason.trim()}`,
          'operator_override',
        );
      } catch (err: unknown) {
        if (err instanceof InvalidTransitionError) {
          return errorResponse(409, 'INVALID_LIFECYCLE_TRANSITION', err.message);
        }
        throw err;
      }
    }
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
      previousLifecycleState: pickLifecycleState,
    },
  });

  // If approved, trigger promotion re-evaluation
  // UTV2-1923: a human capper pick is deliberately excluded from promotion
  // re-evaluation. No model scored it and none should: re-evaluating would let
  // the board lane assign it a `promotion_target`, which is the one thing that
  // could route an approved human pick into a model-lane Discord target it was
  // never approved for. Models are outside this milestone by PM instruction,
  // and this is where that instruction becomes mechanical.
  let promotionError: string | undefined;
  if (decision === 'approve' && !isHumanCapperDelivery) {
    try {
      const { evaluateAllPoliciesEagerAndPersist } = await import('../promotion-service.js');
      // settlements passed to enable CLV-based trust adjustment.
      await evaluateAllPoliciesEagerAndPersist(
        pickId,
        `review.${payload.decidedBy.trim()}`,
        repositories.picks,
        repositories.audit,
        repositories.settlements,
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

  if (humanDelivery) {
    result.humanDelivery = humanDelivery;
  }

  return successResponse(200, result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
