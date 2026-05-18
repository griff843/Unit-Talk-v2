import type { SubmissionPayload } from '@unit-talk/contracts';
import { isShadowEnabled, parseShadowModeEnv } from '@unit-talk/domain';
import { transitionPickLifecycle } from '@unit-talk/db';
import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { ApiError } from '../errors.js';
import { processShadowSubmission, processSubmission } from '../submission-service.js';
import { enqueueDistributionWithRunTracking } from '../run-audit-service.js';
import { isGovernanceBrakeSource } from '../distribution-service.js';
import {
  type Logger,
} from '@unit-talk/observability';

export interface SubmitPickControllerResult {
  submissionId: string;
  pickId: string;
  lifecycleState: string;
  promotionStatus: string;
  promotionTarget: string | null;
  outboxEnqueued: boolean;
  shadowMode?: boolean;
  governanceBrake?: boolean;
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
  const routingShadowEnabled = isModelDrivenRoutingShadowEnabled(payload);
  const result = routingShadowEnabled
    ? await processShadowSubmission(payload, repositories)
    : await processSubmission(payload, repositories);

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

  if (governanceBrakeApplied) {
    const brakeTransition = await transitionPickLifecycle(
      repositories.picks,
      result.pick.id,
      'awaiting_approval',
      `governance brake: non-human source ${result.pick.source}`,
      'promoter',
    );
    await repositories.audit.record({
      entityType: 'picks',
      entityId: brakeTransition.lifecycleEvent.id,
      action: 'pick.governance_brake.applied',
      actor: 'submission',
      payload: {
        pickId: result.pick.id,
        source: result.pick.source,
        promotionStatus: result.pick.promotionStatus ?? 'not_eligible',
        promotionTarget: result.pick.promotionTarget ?? null,
        fromState: 'validated',
        toState: 'awaiting_approval',
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
