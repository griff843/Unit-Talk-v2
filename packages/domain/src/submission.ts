import {
  type SubmissionPayload,
  type ValidatedSubmission,
  validateSubmissionPayload,
} from '@unit-talk/contracts';

export function createValidatedSubmission(
  id: string,
  payload: SubmissionPayload,
  receivedAt = new Date().toISOString(),
): ValidatedSubmission {
  const validation = validateSubmissionPayload(payload);

  if (!validation.ok) {
    throw new Error(`Invalid submission payload: ${validation.errors.join(', ')}`);
  }

  return {
    id,
    receivedAt,
    payload,
  };
}
