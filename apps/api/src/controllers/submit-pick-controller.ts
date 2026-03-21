import type { SubmissionPayload } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { ApiError } from '../errors.js';
import { processSubmission } from '../submission-service.js';

export interface SubmitPickControllerResult {
  submissionId: string;
  pickId: string;
  lifecycleState: string;
}

export async function submitPickController(
  payload: SubmissionPayload,
  repositories: RepositoryBundle,
): Promise<ApiResponse<SubmitPickControllerResult>> {
  const result = await processSubmission(payload, repositories);

  if (!result.pick.id) {
    throw new ApiError(500, 'PICK_CREATION_FAILED', 'Canonical pick was not created');
  }

  return {
    status: 201,
    body: {
      ok: true,
      data: {
        submissionId: result.submission.id,
        pickId: result.pick.id,
        lifecycleState: result.pick.lifecycleState,
      },
    },
  };
}

