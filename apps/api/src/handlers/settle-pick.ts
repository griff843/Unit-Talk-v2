import type { SettlementRequest } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import { normalizeApiError } from '../errors.js';
import type { ApiResponse } from '../http.js';
import { errorResponse } from '../http.js';
import { settlePickController } from '../controllers/index.js';

export interface SettlePickRequest {
  params: {
    pickId: string;
  };
  body: unknown;
}

export type SettlePickResponse = ApiResponse<{
  pickId: string;
  settlementRecordId: string;
  settlementStatus: string;
  settlementResult: string | null;
  finalLifecycleState: string;
  settledLifecycleEventId: string | null;
  auditActionIds: string[];
  downstream: {
    effectiveSettlementRecordId: string | null;
    effectiveSettlementStatus: string | null;
    effectiveSettlementResult: string | null;
    correctionDepth: number | null;
    isFinal: boolean | null;
    totalRecords: number;
    pendingReviewCount: number;
    correctionCount: number;
    hitRatePct: number;
    flatBetRoiPct: number;
    lossAttributionClassification: string | null;
    unresolvedReason: string | null;
  };
}>;

export async function handleSettlePick(
  request: SettlePickRequest,
  repositories: RepositoryBundle,
): Promise<SettlePickResponse> {
  try {
    return await settlePickController(
      request.params.pickId,
      coerceSettlementRequest(request.body),
      repositories,
    );
  } catch (error) {
    const apiError = normalizeApiError(error);
    return errorResponse(apiError.status, apiError.code, apiError.message);
  }
}

function coerceSettlementRequest(body: unknown): SettlementRequest {
  const payload = isRecord(body) ? body : {};

  return {
    status: readString(payload.status) as SettlementRequest['status'],
    result: readOptionalString(payload.result) as SettlementRequest['result'],
    source: readString(payload.source) as SettlementRequest['source'],
    confidence: readString(payload.confidence) as SettlementRequest['confidence'],
    evidenceRef: readString(payload.evidenceRef),
    notes: readOptionalString(payload.notes),
    reviewReason: readOptionalString(payload.reviewReason),
    settledBy: readString(payload.settledBy),
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
