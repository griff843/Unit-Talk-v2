import {
  dispatchLedgerActions,
  isDispatchAmbiguous,
  isHumanDeliveryTarget,
  isTrackOnlyPickMetadata,
  parseGovernedTargetFromDeliveryTarget,
  readDispatchLedger,
} from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { successResponse, errorResponse } from '../http.js';

export interface RetryDeliveryRequest {
  reason: string;
  actor: string;
  /**
   * WORK-2026092901: the operator's attestation, after checking the channel,
   * that no message exists for this row's unresolved dispatch attempts.
   * Required to retry a human-capper row whose ledger is ambiguous; recorded
   * as `distribution.dispatch_reconciled`. Never inferred.
   */
  confirmedNotDelivered?: boolean;
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

  // UTV2-1672 TRACK_ONLY_RETRY_GUARD_START
  if (isTrackOnlyPickMetadata(isRecord(pick.metadata) ? pick.metadata : null)) {
    return errorResponse(409, 'TRACK_ONLY_DELIVERY_BLOCKED', `Pick ${pickId} is track-only and cannot be retried`);
  }
  // UTV2-1672 TRACK_ONLY_RETRY_GUARD_END

  // Find the failed/dead_letter outbox row for this pick
  const outboxRows = await repositories.outbox.listByPickId(pickId);
  const retryable = outboxRows.find(
    (row) => row.status === 'failed' || row.status === 'dead_letter',
  );

  if (!retryable) {
    return errorResponse(400, 'NO_RETRYABLE_ROW', `No failed or dead_letter outbox row found for pick ${pickId}`);
  }

  // Idempotency guard: reject retry if an active row already exists for this pick+target
  const alreadyActive = outboxRows.find(
    (row) =>
      row.target === retryable.target &&
      (row.status === 'pending' || row.status === 'processing') &&
      row.id !== retryable.id,
  );

  if (alreadyActive) {
    return errorResponse(
      409,
      'ACTIVE_ROW_EXISTS',
      `Cannot retry: an active outbox row already exists for pick ${pickId} target ${retryable.target} (id=${alreadyActive.id}, status=${alreadyActive.status})`,
    );
  }

  // WORK-2026092901 RETRY_DUPLICATE_GUARD_START
  // A retry re-posts. Refuse it whenever the message may already exist.
  const sentReceipt = await repositories.receipts.findLatestByOutboxId(retryable.id);
  if (sentReceipt?.status === 'sent') {
    return errorResponse(
      409,
      'ALREADY_DELIVERED',
      `Cannot retry: outbox ${retryable.id} already has sent receipt ${sentReceipt.id}`,
    );
  }

  const governedTarget = parseGovernedTargetFromDeliveryTarget(retryable.target);
  const ledgerGoverned = governedTarget !== null && isHumanDeliveryTarget(governedTarget);
  let reconciledThroughAttempt: number | null = null;
  if (ledgerGoverned) {
    if (!repositories.audit.listByEntity) {
      return errorResponse(
        503,
        'DISPATCH_LEDGER_UNAVAILABLE',
        `Cannot retry: the dispatch ledger for outbox ${retryable.id} cannot be read`,
      );
    }
    const ledger = readDispatchLedger(
      await repositories.audit.listByEntity('distribution_outbox', retryable.id, 'distribution.dispatch_'),
    );
    if (ledger.delivered) {
      return errorResponse(
        409,
        'ALREADY_DELIVERED',
        `Cannot retry: outbox ${retryable.id} was delivered as message ${ledger.delivered.receipt.externalId} (attempt ${ledger.delivered.attempt}); confirm it, do not re-post`,
      );
    }
    if (isDispatchAmbiguous(ledger)) {
      if (payload.confirmedNotDelivered !== true) {
        return errorResponse(
          409,
          'DELIVERY_OUTCOME_AMBIGUOUS',
          `Cannot retry: dispatch attempt(s) ${ledger.unresolvedAttempts.join(',') || '(unreadable ledger rows)'} for outbox ${retryable.id} may already have posted. ` +
            'Check the channel; retry only with confirmedNotDelivered: true if no message exists.',
        );
      }
      if (ledger.malformed > 0) {
        return errorResponse(
          409,
          'DISPATCH_LEDGER_MALFORMED',
          `Cannot retry: ${ledger.malformed} dispatch ledger row(s) for outbox ${retryable.id} are unreadable`,
        );
      }
      reconciledThroughAttempt = ledger.lastAttempt;
    }
  }
  // WORK-2026092901 RETRY_DUPLICATE_GUARD_END

  const previousStatus = retryable.status;

  if (reconciledThroughAttempt !== null) {
    // Written BEFORE the reset: a row back in `pending` without this
    // attestation would dead-letter again, never post twice.
    await repositories.audit.record({
      entityType: 'distribution_outbox',
      entityId: retryable.id,
      entityRef: pickId,
      action: dispatchLedgerActions.reconciled,
      actor: payload.actor.trim(),
      payload: {
        outboxId: retryable.id,
        target: retryable.target,
        throughAttempt: reconciledThroughAttempt,
        reason: payload.reason.trim(),
      },
    });
  }

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
      ...(reconciledThroughAttempt !== null ? { reconciledThroughAttempt } : {}),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
