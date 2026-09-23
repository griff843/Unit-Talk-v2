import {
  humanCapperDeliveryAuthorizationKey,
  type SubmissionPayload,
} from '@unit-talk/contracts';
import { evaluateCapperDeliveryAuthorization } from '../capper-delivery-authorization.js';
import type { RepositoryBundle } from '@unit-talk/db';
import { ApiError, normalizeApiError } from '../errors.js';
import type { ApiResponse } from '../http.js';
import { errorResponse } from '../http.js';
import type { AuthContext } from '../auth.js';
import { submitPickController, type SubmitPickControllerResult } from '../controllers/index.js';
import {
  type Logger,
} from '@unit-talk/observability';

export interface SubmitPickRequest {
  body: unknown;
  /** Auth context from the bearer token — capperId overrides submittedBy when role === 'capper'. */
  auth?: AuthContext | null | undefined;
  correlationId?: string | undefined;
  traceparent?: string | undefined;
  logger?: Logger | undefined;
}

/**
 * UTV2-1923: the handler now carries the controller's own result shape rather
 * than a hand-written subset of it. The subset predated `promotionStatus`,
 * `outboxEnqueued` and `deliveryPosture`, so every caller that went through the
 * handler -- which is every HTTP caller -- was typed as if the delivery posture
 * the controller had just decided did not exist. Widening it is what lets the
 * Smart Form show server truth instead of a hardcoded Track Only label.
 */
export type SubmitPickResponse = ApiResponse<SubmitPickControllerResult>;

export async function handleSubmitPick(
  request: SubmitPickRequest,
  repositories: RepositoryBundle,
): Promise<SubmitPickResponse> {
  try {
    return await submitPickController(
      coerceSubmissionPayload(request.body, request.auth, {
        correlationId: request.correlationId,
        traceparent: request.traceparent,
      }),
      repositories,
      {
        correlationId: request.correlationId,
        traceparent: request.traceparent,
        logger: request.logger,
      },
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
 * takes precedence over whatever submittedBy the form sent. Capper requests
 * are also pinned to source=smart-form and distributionMode=track-only so a
 * modified client cannot opt into member delivery.
 */
function coerceSubmissionPayload(
  body: unknown,
  auth?: AuthContext | null,
  traceContext?: {
    correlationId?: string | undefined;
    traceparent?: string | undefined;
  },
): SubmissionPayload {
  const payload = isRecord(body) ? body : {};
  const requestedSource = readString(payload.source) as SubmissionPayload['source'];
  const isAuthenticatedCapper = auth?.role === 'capper' && Boolean(auth.capperId);
  // UTV2-1672: `source` starts as whatever the client asked for. The guard
  // below is the ONLY thing that makes an authenticated capper's source
  // server-authoritative, so deleting the guard genuinely removes the property
  // rather than leaving a silent coercion behind. The mutation control in
  // http-integration.test.ts depends on that being true.
  let source = requestedSource;
  // UTV2-1672 CAPPER_SOURCE_PIN_GUARD_START
  if (isAuthenticatedCapper && requestedSource !== 'smart-form') {
    throw new ApiError(
      403,
      'CAPPER_SOURCE_FORBIDDEN',
      'Authenticated capper submissions must use the Smart Form source.',
    );
  }
  if (isAuthenticatedCapper) {
    source = 'smart-form';
  }
  // UTV2-1672 CAPPER_SOURCE_PIN_GUARD_END
  const stakeUnits = resolveStakeUnits(payload, source);
  if (stakeUnits.value === undefined || stakeUnits.value <= 0) {
    throw new ApiError(400, 'INVALID_SUBMISSION', 'stakeUnits must be a positive number.');
  }
  const metadata = isRecord(payload.metadata) ? { ...payload.metadata } : {};

  // UTV2-1923 CAPPER_DELIVERY_AUTHORIZATION_FORGERY_GUARD_START
  // The authorization record is server-authored, for EVERY source, without
  // exception. Deleting a client-supplied key here is what makes
  // `readHumanCapperDeliveryAuthorization` a statement about what the server
  // decided rather than about what the caller typed. It runs before the
  // decision below so a forged record cannot survive into `metadata` on any
  // branch, including the ones that throw.
  delete metadata[humanCapperDeliveryAuthorizationKey];
  // UTV2-1923 CAPPER_DELIVERY_AUTHORIZATION_FORGERY_GUARD_END

  // UTV2-1672 CAPPER_TRACK_ONLY_PIN_GUARD_START
  // UTV2-1923: extended, not relaxed. The refusal below is unchanged -- a
  // client still cannot ask for anything but Track Only -- and an unauthorized
  // capper is still pinned to Track Only exactly as before. What is new is
  // that an authorized capper is pinned to `delivery-eligible` INSTEAD, by the
  // server, on the strength of a server-side allow-list the client cannot
  // reach. Client intent never widens the outcome in either direction.
  if (isAuthenticatedCapper) {
    if (metadata['distributionMode'] !== undefined && metadata['distributionMode'] !== 'track-only') {
      throw new ApiError(
        403,
        'CAPPER_TRACK_ONLY_REQUIRED',
        'Authenticated capper submissions are restricted to Track Only internal tracking.',
      );
    }
    const deliveryAuthorization = evaluateCapperDeliveryAuthorization({
      capperId: auth?.capperId,
      isAuthenticatedCapper,
    });
    // Server authority, not client intent, decides whether a capper pick can
    // produce delivery work during the recovery phase.
    metadata['distributionMode'] =
      deliveryAuthorization.decision === 'authorized' ? 'delivery-eligible' : 'track-only';
    metadata[humanCapperDeliveryAuthorizationKey] = deliveryAuthorization;
  }
  // UTV2-1672 CAPPER_TRACK_ONLY_PIN_GUARD_END

  // UTV2-1672 SMART_FORM_HTTP_CONTRACT_GUARD_START
  // `smart-form` is also a legacy plain source label used by in-process
  // service callers, so smart-form-validation.ts keys its canonical contract on
  // the presence of the Smart Form fields. That exemption must not be reachable
  // over HTTP: without this guard a `submitter`/`operator` key -- or any
  // fail-open deployment, whose bypass context is `operator` -- could POST
  // `source: 'smart-form'` with no distributionMode and no participantResolution
  // and skip every canonical event, team and participant check, while still
  // landing in LIVE_SOURCES. Requests arriving at the HTTP boundary must carry
  // the full contract; the exemption then covers only in-process callers.
  if (source === 'smart-form') {
    if (metadata['distributionMode'] === undefined) {
      throw new ApiError(
        400,
        'SMART_FORM_CONTRACT_REQUIRED',
        'Smart Form submissions must declare metadata.distributionMode.',
      );
    }
    if (metadata['participantResolution'] === undefined) {
      throw new ApiError(
        400,
        'SMART_FORM_CONTRACT_REQUIRED',
        'Smart Form submissions must declare metadata.participantResolution.',
      );
    }
  }
  // UTV2-1672 SMART_FORM_HTTP_CONTRACT_GUARD_END


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
    metadata: buildSubmissionMetadata(metadata, traceContext),
  };
}

function buildSubmissionMetadata(
  metadata: Record<string, unknown>,
  traceContext:
    | {
        correlationId?: string | undefined;
        traceparent?: string | undefined;
      }
    | undefined,
) {
  if (traceContext?.correlationId) {
    const enriched = {
      ...metadata,
      correlationId: traceContext.correlationId,
      ...(traceContext.traceparent ? { traceparent: traceContext.traceparent } : {}),
    };
    return Object.keys(enriched).length > 0 ? enriched : undefined;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
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
