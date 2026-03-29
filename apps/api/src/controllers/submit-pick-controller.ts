import type { SubmissionPayload } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { ApiError } from '../errors.js';
import { processSubmission } from '../submission-service.js';
import { enqueueDistributionWithRunTracking } from '../run-audit-service.js';

export interface SubmitPickControllerResult {
  submissionId: string;
  pickId: string;
  lifecycleState: string;
  promotionStatus: string;
  promotionTarget: string | null;
  outboxEnqueued: boolean;
}

export async function submitPickController(
  payload: SubmissionPayload,
  repositories: RepositoryBundle,
): Promise<ApiResponse<SubmitPickControllerResult>> {
  const result = await processSubmission(payload, repositories);

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

  if (result.pick.promotionStatus === 'qualified' && result.pick.promotionTarget != null) {
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
    } catch {
      // Enqueue failure is audited inside enqueueDistributionWithRunTracking.
      // Submission is still valid — return 201 so the caller gets the pick ID.
      outboxEnqueued = false;
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
      },
    },
  };
}
