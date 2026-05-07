import type { SubmissionPayload } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import { ApiError, normalizeApiError } from '../errors.js';
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
  const source = readString(payload.source) as SubmissionPayload['source'];
  const stakeUnits = resolveStakeUnits(payload, source);
  if (stakeUnits.value === undefined || stakeUnits.value <= 0) {
    throw new ApiError(400, 'INVALID_SUBMISSION', 'stakeUnits must be a positive number.');
  }
  const metadata = isRecord(payload.metadata) ? { ...payload.metadata } : {};

  if (stakeUnits.defaulted) {
    // Keep the default explicit for machine-generated request paths.
    metadata.stakeUnitsSource = 'system_default_flat_1u';
  }

  // Capper JWT claim overrides any form-supplied submittedBy value.
  const submittedBy = auth?.role === 'capper' && auth.capperId
    ? auth.capperId
    : readOptionalString(payload.submittedBy);

  return {
    source,
    submittedBy,
    market: readString(payload.market),
    selection: readString(payload.selection),
    line: readOptionalNumber(payload.line),
    odds: readOptionalNumber(payload.odds),
    stakeUnits: stakeUnits.value,
    confidence: readOptionalNumber(payload.confidence),
    eventName: readOptionalString(payload.eventName),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

const SYSTEM_DEFAULT_STAKE_SOURCES = new Set<SubmissionPayload['source']>([
  'alert-agent',
  'board-construction',
  'model-driven',
  'system-pick-scanner',
]);

function resolveStakeUnits(
  payload: Record<string, unknown>,
  source: SubmissionPayload['source'],
): { value: number | undefined; defaulted: boolean } {
  const camel = readOptionalNumber(payload.stakeUnits);
  const snake = readOptionalNumber(payload.stake_units);
  const explicit = camel ?? snake;

  if (explicit !== undefined) {
    return { value: explicit, defaulted: false };
  }

  if (SYSTEM_DEFAULT_STAKE_SOURCES.has(source)) {
    return { value: 1, defaulted: true };
  }

  return { value: undefined, defaulted: false };
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
