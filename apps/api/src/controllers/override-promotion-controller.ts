import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { successResponse, errorResponse } from '../http.js';
import { applyPromotionOverride } from '../promotion-service.js';

const VALID_TARGETS = ['best-bets', 'trader-insights', 'exclusive-insights'];

export interface OverridePromotionRequest {
  action: 'force_promote' | 'suppress';
  target?: string;
  reason: string;
  actor: string;
}

export interface OverridePromotionResult {
  pickId: string;
  overrideAction: string;
  previousPromotionStatus: string;
  previousPromotionTarget: string | null;
  newPromotionStatus: string;
  newPromotionTarget: string | null;
  auditId: string;
}

/**
 * Applies a promotion override (force_promote or suppress).
 * Preserves original model decision in pick_promotion_history.
 */
export async function overridePromotionController(
  pickId: string,
  payload: OverridePromotionRequest,
  repositories: RepositoryBundle,
): Promise<ApiResponse<OverridePromotionResult>> {
  if (!payload.reason || payload.reason.trim().length === 0) {
    return errorResponse(400, 'REASON_REQUIRED', 'A reason is required for promotion override');
  }
  if (!payload.actor || payload.actor.trim().length === 0) {
    return errorResponse(400, 'ACTOR_REQUIRED', 'actor is required');
  }
  if (payload.action !== 'force_promote' && payload.action !== 'suppress') {
    return errorResponse(400, 'INVALID_ACTION', 'action must be force_promote or suppress');
  }
  if (payload.action === 'force_promote' && payload.target && !VALID_TARGETS.includes(payload.target)) {
    return errorResponse(400, 'INVALID_TARGET', `target must be one of: ${VALID_TARGETS.join(', ')}`);
  }

  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    return errorResponse(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  if (pick.status === 'settled' || pick.status === 'voided') {
    return errorResponse(400, 'TERMINAL_STATE', `Pick is in terminal state '${pick.status}' — override not allowed`);
  }

  const previousStatus = pick.promotion_status;
  const previousTarget = pick.promotion_target;

  await applyPromotionOverride({
    pickId,
    actor: payload.actor.trim(),
    action: payload.action,
    reason: payload.reason.trim(),
    target: payload.target as 'best-bets' | 'trader-insights' | 'exclusive-insights' | undefined,
  }, repositories.picks, repositories.audit);

  const updated = await repositories.picks.findPickById(pickId);

  const audit = await repositories.audit.record({
    entityType: 'pick',
    entityId: pickId,
    entityRef: pickId,
    action: `promotion.override.${payload.action}`,
    actor: payload.actor.trim(),
    payload: {
      reason: payload.reason.trim(),
      overrideAction: payload.action,
      target: payload.target ?? null,
      before: { status: previousStatus, target: previousTarget },
      after: { status: updated?.promotion_status, target: updated?.promotion_target },
    },
  });

  return successResponse(200, {
    pickId,
    overrideAction: payload.action,
    previousPromotionStatus: previousStatus,
    previousPromotionTarget: previousTarget,
    newPromotionStatus: updated?.promotion_status ?? '',
    newPromotionTarget: updated?.promotion_target ?? null,
    auditId: audit.id,
  });
}
