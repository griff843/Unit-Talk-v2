import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { successResponse, errorResponse } from '../http.js';
import { evaluateAllPoliciesEagerAndPersist } from '../promotion-service.js';

export interface RerunPromotionRequest {
  reason: string;
  actor: string;
}

export interface RerunPromotionResult {
  pickId: string;
  previousPromotionStatus: string;
  previousPromotionTarget: string | null;
  previousPromotionScore: number | null;
  newPromotionStatus: string;
  newPromotionTarget: string | null;
  newPromotionScore: number | null;
  auditId: string;
}

/**
 * Reruns promotion evaluation for a pick. Preserves original decision
 * in pick_promotion_history. Records before/after state in audit.
 */
export async function rerunPromotionController(
  pickId: string,
  payload: RerunPromotionRequest,
  repositories: RepositoryBundle,
): Promise<ApiResponse<RerunPromotionResult>> {
  if (!payload.reason || payload.reason.trim().length === 0) {
    return errorResponse(400, 'REASON_REQUIRED', 'A reason is required for promotion rerun');
  }
  if (!payload.actor || payload.actor.trim().length === 0) {
    return errorResponse(400, 'ACTOR_REQUIRED', 'actor is required');
  }

  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    return errorResponse(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  if (pick.status === 'settled' || pick.status === 'voided') {
    return errorResponse(400, 'TERMINAL_STATE', `Pick is in terminal state '${pick.status}' — promotion rerun not allowed`);
  }

  if (pick.approval_status !== 'approved') {
    return errorResponse(400, 'NOT_APPROVED', `Pick approval_status is '${pick.approval_status}' — must be approved for promotion rerun`);
  }

  const previousStatus = pick.promotion_status;
  const previousTarget = pick.promotion_target;
  const previousScore = pick.promotion_score;

  // Rerun promotion — this writes new pick_promotion_history rows
  // settlements passed to enable CLV-based trust adjustment.
  const result = await evaluateAllPoliciesEagerAndPersist(
    pickId,
    `rerun.${payload.actor.trim()}`,
    repositories.picks,
    repositories.audit,
    repositories.settlements,
  );

  // Read updated pick state from the result
  const updated = result.pickRecord;

  const audit = await repositories.audit.record({
    entityType: 'pick',
    entityId: pickId,
    entityRef: pickId,
    action: 'promotion.rerun',
    actor: payload.actor.trim(),
    payload: {
      reason: payload.reason.trim(),
      before: { status: previousStatus, target: previousTarget, score: previousScore },
      after: {
        status: updated.promotion_status,
        target: updated.promotion_target,
        score: updated.promotion_score,
      },
    },
  });

  return successResponse(200, {
    pickId,
    previousPromotionStatus: previousStatus,
    previousPromotionTarget: previousTarget,
    previousPromotionScore: previousScore,
    newPromotionStatus: updated.promotion_status,
    newPromotionTarget: updated.promotion_target,
    newPromotionScore: updated.promotion_score,
    auditId: audit.id,
  });
}
