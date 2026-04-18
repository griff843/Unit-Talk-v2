import type { SubmissionPayload } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import { normalizeApiError } from '../errors.js';
import type { ApiResponse } from '../http.js';
import { errorResponse } from '../http.js';
import type { AuthContext } from '../auth.js';
import { submitPickController } from '../controllers/index.js';

export interface SubmitPickRequest {
  body: unknown;
  /** Auth context from the bearer token — capperId overrides submittedBy when role === 'capper'. */
  auth?: AuthContext | null | undefined;
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
      coerceSubmissionPayload(request.body, request.auth),
      repositories,
    );
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

/**
 * Coerce raw request body into a typed SubmissionPayload.
 *
 * When the authenticated role is 'capper', the capperId from the JWT claim
 * takes precedence over whatever submittedBy the form sent — the form field
 * is ignored entirely. This is the trust boundary enforcement for UTV2-658.
 */
function coerceSubmissionPayload(body: unknown, auth?: AuthContext | null): SubmissionPayload {
  const payload = isRecord(body) ? body : {};

  // Capper JWT claim overrides any form-supplied submittedBy value.
  const submittedBy = auth?.role === 'capper' && auth.capperId
    ? auth.capperId
    : readOptionalString(payload.submittedBy);

  return {
    source: readString(payload.source) as SubmissionPayload['source'],
    submittedBy,
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
