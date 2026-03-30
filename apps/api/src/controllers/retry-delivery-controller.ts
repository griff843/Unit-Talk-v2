import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { successResponse, errorResponse } from '../http.js';

export interface RetryDeliveryRequest {
  reason: string;
  actor: string;
}

export interface RetryDeliveryResult {
  pickId: string;
  outboxId: string;
  previousStatus: string;
  newStatus: string;
  attemptCount: number;
  auditId: string;
}

/**
 * Resets a failed or dead_letter outbox row back to 'pending' for retry.
 * Resets attempt_count to 0. Records audit trail.
 */
export async function retryDeliveryController(
  pickId: string,
  payload: RetryDeliveryRequest,
  repositories: RepositoryBundle,
): Promise<ApiResponse<RetryDeliveryResult>> {
  if (!payload.reason || payload.reason.trim().length === 0) {
    return errorResponse(400, 'REASON_REQUIRED', 'A reason is required for delivery retry');
  }
  if (!payload.actor || payload.actor.trim().length === 0) {
    return errorResponse(400, 'ACTOR_REQUIRED', 'actor is required');
  }

  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    return errorResponse(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  // Find the failed/dead_letter outbox row for this pick
  const outboxRows = await repositories.outbox.listByPickId(pickId);
  const retryable = outboxRows.find(
    (row) => row.status === 'failed' || row.status === 'dead_letter',
  );

  if (!retryable) {
    return errorResponse(400, 'NO_RETRYABLE_ROW', `No failed or dead_letter outbox row found for pick ${pickId}`);
  }

  const previousStatus = retryable.status;

  // Reset to pending with attempt_count = 0
  await repositories.outbox.resetForRetry(retryable.id);

  const audit = await repositories.audit.record({
    entityType: 'distribution_outbox',
    entityId: retryable.id,
    entityRef: pickId,
    action: 'delivery.retry',
    actor: payload.actor.trim(),
    payload: {
      reason: payload.reason.trim(),
      previousStatus,
      outboxId: retryable.id,
      target: retryable.target,
    },
  });

  return successResponse(200, {
    pickId,
    outboxId: retryable.id,
    previousStatus,
    newStatus: 'pending',
    attemptCount: 0,
    auditId: audit.id,
  });
}
