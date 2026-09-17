import {
  humanDeliveryTargets,
  isHumanCapperDeliveryAuthorized,
  isTrackOnlyPickMetadata,
  readHumanCapperDeliveryAuthorization,
  type SubmissionPayload,
} from '@unit-talk/contracts';
import { isShadowEnabled, parseShadowModeEnv } from '@unit-talk/domain';
import { transitionPickLifecycle } from '@unit-talk/db';
import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { ApiError } from '../errors.js';
import { processShadowSubmission, processSubmission } from '../submission-service.js';
import {
  enqueueDistributionWithRunTracking,
  releaseHumanCapperDeliveryWithRunTracking,
} from '../run-audit-service.js';
import { isGovernanceBrakeSource } from '../distribution-service.js';
import {
  type Logger,
} from '@unit-talk/observability';
import { validateSmartFormRelationships } from '../smart-form-validation.js';
import type { SmartFormValidationOutcome } from '../smart-form-validation.js';

export interface SubmitPickControllerResult {
  submissionId: string;
  pickId: string;
  lifecycleState: string;
  promotionStatus: string;
  promotionTarget: string | null;
  outboxEnqueued: boolean;
  shadowMode?: boolean;
  governanceBrake?: boolean;
  /**
   * UTV2-1923: the server's own account of this pick's delivery posture, so a
   * surface can render truth instead of guessing. A surface may DISPLAY this;
   * it may not influence it.
   *
   *   `track-only`       no delivery is possible for this pick, ever.
   *   `delivered`        an authorized human capper's pick created exactly one
   *                      governed member-facing delivery, in this request.
   *   `delivery-refused` an authorized human capper's pick created NO delivery
   *                      because a control refused — the target is disabled or
   *                      killed. This is fail-closed, and it is NOT a request
   *                      for operator approval: no approval exists that would
   *                      deliver it, and the pick is not parked awaiting one.
   *                      `deliveryRefusedReason` carries the control's reason.
   */
  deliveryPosture?: 'track-only' | 'delivered' | 'delivery-refused';
  /** Present only with `deliveryPosture: 'delivery-refused'`. */
  deliveryRefusedReason?: string;
  /** The governed member-facing target, present whenever a human delivery was attempted. */
  deliveryTarget?: string;
}

export async function submitPickController(
  payload: SubmissionPayload,
  repositories: RepositoryBundle,
  options: {
    correlationId?: string | undefined;
    traceparent?: string | undefined;
    logger?: Logger | undefined;
  } = {},
): Promise<ApiResponse<SubmitPickControllerResult>> {
  // UTV2-1842: the outcome records which path admitted the submission, so the event-existence
  // gate in processSubmission can waive itself for a server-validated fallback and for nothing
  // else. Passing it is what makes the waiver possible; omitting it leaves the gate enforcing.
  //
  // It is held in a container declared *outside* the guard markers on purpose. The mutation
  // control in submit-pick-controller.test.ts deletes every line between them, so a build with
  // the relationship guard removed must still compile and must waive nothing. An unset
  // `outcome` is the fail-closed value, so removing the guard removes the waiver with it.
  const smartForm: { outcome?: SmartFormValidationOutcome } = {};
  // UTV2-1672 SMART_FORM_RELATIONSHIP_GUARD_START
  smartForm.outcome = await validateSmartFormRelationships(payload, repositories.referenceData);
  // UTV2-1672 SMART_FORM_RELATIONSHIP_GUARD_END
  const routingShadowEnabled = isModelDrivenRoutingShadowEnabled(payload);
  const result = routingShadowEnabled
    ? await processShadowSubmission(payload, repositories)
    : await processSubmission(payload, repositories, smartForm.outcome);

  if (!result.pick.id) {
    throw new ApiError(500, 'PICK_CREATION_FAILED', 'Canonical pick was not created');
  }

  options.logger?.info('submission ingested', {
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    ...(options.traceparent ? { traceparent: options.traceparent } : {}),
    lifecyclePoint: 'api.ingestion',
    pickId: result.pick.id,
    submissionId: result.submission.id,
    source: result.pick.source,
    promotionStatus: result.pick.promotionStatus ?? 'not_eligible',
    promotionTarget: result.pick.promotionTarget ?? null,
  });

  // Phase 7A governance brake: non-human pick sources must NOT auto-enqueue.
  // They land in `awaiting_approval` and wait for operator review. The brake
  // is applied BEFORE enqueueDistributionWithRunTracking is considered — no
  // atomic transition, no outbox row, no run. Approval path (review controller)
  // is the only way out of awaiting_approval.
  const governanceBrakeApplied =
    !routingShadowEnabled && isGovernanceBrakeSource(result.pick.source);

  // UTV2-1672 TRACK_ONLY_REQUEST_INTEGRITY_GUARD_START
  // The Track Only pin in handlers/submit-pick.ts marks the *incoming payload*.
  // On the idempotent-duplicate path processSubmission discards that payload and
  // returns the pre-existing row, whose metadata may say nothing about
  // distribution -- so a Track Only request can resolve to a pick that every
  // downstream guard reads as delivery-eligible. Refuse instead of silently
  // handing back a pick that does not honour what was asked for.
  if (
    !routingShadowEnabled &&
    isTrackOnlyPickMetadata(payload.metadata) &&
    !isTrackOnlyPickMetadata(result.pick.metadata)
  ) {
    throw new ApiError(
      409,
      'TRACK_ONLY_CONFLICT',
      'This submission matches an existing pick that is not Track Only; it cannot be reused for a Track Only submission.',
    );
  }
  // UTV2-1672 TRACK_ONLY_REQUEST_INTEGRITY_GUARD_END

  if (!routingShadowEnabled && isTrackOnlyPickMetadata(result.pick.metadata)) {
    return {
      status: 201,
      body: {
        ok: true,
        data: {
          submissionId: result.submission.id,
          pickId: result.pick.id,
          lifecycleState: result.pick.lifecycleState,
          promotionStatus: result.pick.promotionStatus ?? 'not_eligible',
          promotionTarget: result.pick.promotionTarget ?? null,
          outboxEnqueued: false,
          deliveryPosture: 'track-only',
        },
      },
    };
  }

  // UTV2-1923 HUMAN_DELIVERY_REQUEST_INTEGRITY_GUARD_START
  // The mirror of the Track Only guard above, for the other direction. On the
  // idempotent-duplicate path `processSubmission` discards the incoming
  // payload and returns a pre-existing row. An authorized capper's
  // delivery-eligible submission could therefore be answered with some older
  // pick that was never authorized -- or, worse, an unauthorized submission
  // could be answered with a pick that IS delivery-authorized, handing the
  // caller a pick the delivery path will accept. Refuse either mismatch rather
  // than reusing a row whose authorization is not the one just decided.
  if (
    !routingShadowEnabled &&
    isHumanCapperDeliveryAuthorized(payload.metadata) !==
      isHumanCapperDeliveryAuthorized(result.pick.metadata)
  ) {
    throw new ApiError(
      409,
      'DELIVERY_AUTHORIZATION_CONFLICT',
      'This submission matches an existing pick whose delivery authorization differs from the one decided for this request; it cannot be reused.',
    );
  }
  // UTV2-1923 HUMAN_DELIVERY_REQUEST_INTEGRITY_GUARD_END

  // UTV2-1923 HUMAN_DELIVERY_IMMEDIATE_GUARD_START
  // An authorized human capper's pick is delivery-eligible, so none of the
  // eight Track Only chokepoints stop it -- and no model gate stops it either,
  // because no model ever runs on it. Nor should one: for a human capper there
  // is nothing left to decide. The server already decided, from its own
  // allow-list, that this capper's picks go to members. Approval exists to
  // govern producers that decide for themselves -- the model, the board
  // builder, the scanner, the alert agent -- and a human capper is not one of
  // them. Parking this pick would be inventing a second decision to make about
  // something already decided.
  //
  // So it is released here, immediately, in ONE transaction with the outbox
  // row: `validated -> queued` plus the governed delivery, or neither.
  //
  // Fail-closed is NOT approval. If the registry has the target disabled or
  // the kill switch has it killed, this returns `delivery-refused` with the
  // control's own reason, writes no outbox row, and leaves the pick in
  // `validated`. It does not park the pick in `awaiting_approval`, because no
  // operator decision would release it -- only releasing the control would,
  // and that is a deliberate operator action taken elsewhere.
  const humanDeliveryAuthorization = routingShadowEnabled
    ? null
    : readHumanCapperDeliveryAuthorization(result.pick.metadata);

  if (humanDeliveryAuthorization?.decision === 'authorized') {
    const humanDeliveryTarget = `discord:${humanDeliveryTargets[0]}`;

    // The idempotent-duplicate path. `processSubmission` returns a pre-existing
    // row rather than creating a second one, so a resubmission of the same pick
    // arrives here already past `validated`. Re-releasing it is what would
    // produce a second Discord post, so it is not attempted: the existing
    // delivery is reported instead. Exactly-once is held at two levels -- this
    // check, and the outbox idempotency key underneath it.
    if (result.pick.lifecycleState !== 'validated') {
      return {
        status: 201,
        body: {
          ok: true,
          data: {
            submissionId: result.submission.id,
            pickId: result.pick.id,
            lifecycleState: result.pick.lifecycleState,
            promotionStatus: result.pick.promotionStatus ?? 'not_eligible',
            promotionTarget: result.pick.promotionTarget ?? null,
            outboxEnqueued: false,
            deliveryPosture: 'delivered',
            deliveryTarget: humanDeliveryTarget,
          },
        },
      };
    }

    // `picks.promotion_target` is deliberately NOT written. That column is the
    // model/board lane's record of a scoring decision, and no scoring decision
    // was made about this pick. The human destination comes from the
    // authorization record, which is the thing that actually authorizes it.
    const released = await releaseHumanCapperDeliveryWithRunTracking(
      result.pick.id,
      'submission',
      `human capper delivery: ${humanDeliveryAuthorization.capperId ?? 'unknown capper'} authorized by ${humanDeliveryAuthorization.authority}`,
      repositories.picks,
      repositories.outbox,
      repositories.runs,
      repositories.audit,
      'submission',
      repositories.cappers,
    );

    await repositories.audit.record({
      entityType: 'picks',
      entityId: released.run.id,
      entityRef: result.pick.id,
      action: 'pick.human_capper_delivery.released',
      actor: 'submission',
      payload: {
        pickId: result.pick.id,
        source: result.pick.source,
        capperId: humanDeliveryAuthorization.capperId,
        authority: humanDeliveryAuthorization.authority,
        allowlistSource: humanDeliveryAuthorization.allowlistSource,
        decidedAt: humanDeliveryAuthorization.decidedAt,
        deliveryTarget: released.target,
        destinationChannelId: released.destination?.channelId ?? null,
        destinationSource: released.destination?.source ?? null,
        fromState: 'validated',
        toState: released.enqueued ? 'queued' : result.pick.lifecycleState,
        outboxEnqueued: released.enqueued,
        operatorApprovalRequired: false,
        ...(released.reason === undefined ? {} : { refusedReason: released.reason }),
      },
    });

    return {
      status: 201,
      body: {
        ok: true,
        data: {
          submissionId: result.submission.id,
          pickId: result.pick.id,
          lifecycleState: released.enqueued ? 'queued' : result.pick.lifecycleState,
          promotionStatus: result.pick.promotionStatus ?? 'not_eligible',
          promotionTarget: result.pick.promotionTarget ?? null,
          outboxEnqueued: released.enqueued,
          deliveryTarget: released.target,
          ...(released.enqueued
            ? { deliveryPosture: 'delivered' as const }
            : {
                deliveryPosture: 'delivery-refused' as const,
                ...(released.reason === undefined ? {} : { deliveryRefusedReason: released.reason }),
              }),
        },
      },
    };
  }
  // UTV2-1923 HUMAN_DELIVERY_IMMEDIATE_GUARD_END

  if (governanceBrakeApplied) {
    // UTV2-1611: the brake is STATE-AWARE. An automated production admitted by
    // the automated write boundary is BORN in `awaiting_approval` — the state
    // is materialized in the same atomic write as the pick and its birth
    // lifecycle event, so there is no `validated` state to transition out of.
    // Re-applying the brake here would attempt `awaiting_approval ->
    // awaiting_approval`, which the FSM forbids (`pickLifecycleTransitions`
    // allows only queued/voided out of awaiting_approval); the controller would
    // throw InvalidTransitionError and reject a submission that is already
    // correctly governed. The governed state is the goal, not the transition.
    const alreadyGoverned = result.pick.lifecycleState === 'awaiting_approval';

    const brakeEventId = alreadyGoverned
      ? result.lifecycleEventRecord.id
      : (
          await transitionPickLifecycle(
            repositories.picks,
            result.pick.id,
            'awaiting_approval',
            `governance brake: non-human source ${result.pick.source}`,
            'promoter',
          )
        ).lifecycleEvent.id;

    await repositories.audit.record({
      entityType: 'picks',
      entityId: brakeEventId,
      action: 'pick.governance_brake.applied',
      actor: 'submission',
      payload: {
        pickId: result.pick.id,
        source: result.pick.source,
        promotionStatus: result.pick.promotionStatus ?? 'not_eligible',
        promotionTarget: result.pick.promotionTarget ?? null,
        fromState: alreadyGoverned ? null : 'validated',
        toState: 'awaiting_approval',
        // `materialized_at_birth` means the automated write boundary produced
        // the governed state atomically; no separate brake transition existed
        // to record. `transition` means this controller braked a validated row.
        brakeMechanism: alreadyGoverned ? 'materialized_at_birth' : 'transition',
      },
    });

    return {
      status: 201,
      body: {
        ok: true,
        data: {
          submissionId: result.submission.id,
          pickId: result.pick.id,
          lifecycleState: 'awaiting_approval',
          promotionStatus: result.pick.promotionStatus ?? 'not_eligible',
          promotionTarget: result.pick.promotionTarget ?? null,
          outboxEnqueued: false,
          governanceBrake: true,
        },
      },
    };
  }

  // Auto-enqueue qualified picks for distribution.
  // promotionTarget is the short-form name ('best-bets', 'trader-insights', 'exclusive-insights').
  // enqueueDistributionWithRunTracking expects the full target ('discord:best-bets', etc.).
  // It handles the validated → queued lifecycle transition internally.
  // If enqueue fails, the pick is still durable in the DB (promotionStatus=qualified).
  // The failed run is recorded by enqueueDistributionWithRunTracking before it re-throws.
  let outboxEnqueued = false;

  if (!routingShadowEnabled && result.pick.promotionStatus === 'qualified' && result.pick.promotionTarget != null) {
    const distributionTarget = `discord:${result.pick.promotionTarget}`;
    try {
      options.logger?.info('distribution enqueue requested', {
        ...(options.correlationId ? { correlationId: options.correlationId } : {}),
        ...(options.traceparent ? { traceparent: options.traceparent } : {}),
        lifecyclePoint: 'api.outbox_enqueue',
        pickId: result.pick.id,
        target: distributionTarget,
      });
      await enqueueDistributionWithRunTracking(
        result.pick,
        distributionTarget,
        'submission',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      );
      outboxEnqueued = true;
      options.logger?.info('distribution enqueue completed', {
        ...(options.correlationId ? { correlationId: options.correlationId } : {}),
        ...(options.traceparent ? { traceparent: options.traceparent } : {}),
        lifecyclePoint: 'api.outbox_enqueue',
        pickId: result.pick.id,
        target: distributionTarget,
      });
    } catch (enqueueError) {
      // Enqueue failure is audited inside enqueueDistributionWithRunTracking.
      // The pick is durable and qualified, but no active outbox row exists. The
      // safe operator repair is POST /api/picks/:id/requeue; that path refuses
      // duplicate active outbox rows before replaying the enqueue.
      outboxEnqueued = false;
      await recordZombiePickAlertRun({
        repositories,
        pickId: result.pick.id,
        promotionTarget: result.pick.promotionTarget,
        distributionTarget,
        enqueueError,
      });
      options.logger?.error('distribution enqueue failed; zombie pick alert recorded', enqueueError, {
        ...(options.correlationId ? { correlationId: options.correlationId } : {}),
        ...(options.traceparent ? { traceparent: options.traceparent } : {}),
        lifecyclePoint: 'api.outbox_enqueue',
        pickId: result.pick.id,
        target: distributionTarget,
        recoveryAction: 'POST /api/picks/:id/requeue',
      });
    }
  }

  // If enqueue succeeded, the pick is now in 'queued' lifecycle state.
  // Otherwise it remains in whatever state processSubmission left it.
  const responseLifecycleState = outboxEnqueued ? 'queued' : result.pick.lifecycleState;

  return {
    status: 201,
    body: {
      ok: true,
      data: {
        submissionId: result.submission.id,
        pickId: result.pick.id,
        lifecycleState: responseLifecycleState,
        promotionStatus: result.pick.promotionStatus ?? 'not_eligible',
        promotionTarget: result.pick.promotionTarget ?? null,
        outboxEnqueued,
        ...(routingShadowEnabled ? { shadowMode: true } : {}),
        ...(outboxEnqueued === false && result.pick.promotionStatus === 'qualified'
          ? { warning: 'Pick qualified but distribution enqueue failed. Manual intervention may be required.' }
          : {}),
      },
    },
  };
}

function isModelDrivenRoutingShadowEnabled(payload: SubmissionPayload) {
  if (payload.source !== 'model-driven') {
    return false;
  }

  return isShadowEnabled(parseShadowModeEnv(process.env.UNIT_TALK_SHADOW_MODE), 'routing');
}

async function recordZombiePickAlertRun(input: {
  repositories: RepositoryBundle;
  pickId: string;
  promotionTarget: string | undefined;
  distributionTarget: string;
  enqueueError: unknown;
}) {
  const errorMessage = input.enqueueError instanceof Error
    ? input.enqueueError.message
    : String(input.enqueueError);
  const details = {
    event: 'zombie_pick.detected',
    pickId: input.pickId,
    promotionTarget: input.promotionTarget ?? null,
    distributionTarget: input.distributionTarget,
    error: errorMessage,
    impact: 'Pick qualified but no active delivery outbox row was created.',
    recoveryAction: 'POST /api/picks/:id/requeue',
    duplicateDeliveryGuard: 'requeue checks for existing pending/processing/sent outbox rows before enqueueing',
  };
  const run = await input.repositories.runs.startRun({
    runType: 'distribution.enqueue.zombie_pick',
    actor: 'submission',
    details,
    idempotencyKey: `${input.pickId}:${input.distributionTarget}:zombie-pick-alert`,
  });
  await input.repositories.runs.completeRun({
    runId: run.id,
    status: 'failed',
    details,
  });
}
