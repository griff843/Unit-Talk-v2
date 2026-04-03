import type { SubmissionPayload } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import { normalizeApiError } from '../errors.js';
import type { ApiResponse } from '../http.js';
import { errorResponse } from '../http.js';
import { submitPickController } from '../controllers/index.js';

export interface SubmitPickRequest {
  body: unknown;
}

export type SubmitPickResponse = ApiResponse<{
  submissionId: string;
  pickId: string;
  lifecycleState: string;
}>;

export async function handleSubmitPick(
  request: SubmitPickRequest,
  repositories: RepositoryBundle,
): Promise<SubmitPickResponse> {
  try {
    return await submitPickController(
      coerceSubmissionPayload(request.body),
      repositories,
    );
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

function coerceSubmissionPayload(body: unknown): SubmissionPayload {
  const payload = isRecord(body) ? body : {};

  return {
    source: readString(payload.source) as SubmissionPayload['source'],
    submittedBy: readOptionalString(payload.submittedBy),
    market: readString(payload.market),
    selection: readString(payload.selection),
    line: readOptionalNumber(payload.line),
    odds: readOptionalNumber(payload.odds),
    stakeUnits: readOptionalNumber(payload.stakeUnits),
    confidence: readOptionalNumber(payload.confidence),
    eventName: readOptionalString(payload.eventName),
    metadata: isRecord(payload.metadata) ? payload.metadata : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
