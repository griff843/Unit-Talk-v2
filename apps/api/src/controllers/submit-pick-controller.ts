import type { SubmissionPayload } from '@unit-talk/contracts';
import { isShadowEnabled, parseShadowModeEnv } from '@unit-talk/domain';
import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { ApiError } from '../errors.js';
import { processShadowSubmission, processSubmission } from '../submission-service.js';
import { enqueueDistributionWithRunTracking } from '../run-audit-service.js';

export interface SubmitPickControllerResult {
  submissionId: string;
  pickId: string;
  lifecycleState: string;
  promotionStatus: string;
  promotionTarget: string | null;
  outboxEnqueued: boolean;
  shadowMode?: boolean;
}

export async function submitPickController(
  payload: SubmissionPayload,
  repositories: RepositoryBundle,
): Promise<ApiResponse<SubmitPickControllerResult>> {
  const routingShadowEnabled = isModelDrivenRoutingShadowEnabled(payload);
  const result = routingShadowEnabled
    ? await processShadowSubmission(payload, repositories)
    : await processSubmission(payload, repositories);

  if (!result.pick.id) {
    throw new ApiError(500, 'PICK_CREATION_FAILED', 'Canonical pick was not created');
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
    } catch (enqueueError) {
      // Enqueue failure is audited inside enqueueDistributionWithRunTracking.
      // Pick is durable but NOT queued — this is a degraded state.
      // Log structured error so operators can find zombie picks.
      outboxEnqueued = false;
      console.error(JSON.stringify({
        service: 'submit-pick-controller',
        event: 'enqueue.failed',
        pickId: result.pick.id,
        promotionTarget: result.pick.promotionTarget,
        error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
        impact: 'Pick qualified but not queued for delivery. Manual re-queue required.',
      }));
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
