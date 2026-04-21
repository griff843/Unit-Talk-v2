import type { SettlementRequest } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { successResponse } from '../http.js';
import { recordPickSettlement } from '../settlement-service.js';
import { postSettlementRecapIfPossible } from '../grading-service.js';

export interface SettlePickControllerResult {
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
}

export async function settlePickController(
  pickId: string,
  payload: SettlementRequest,
  repositories: RepositoryBundle,
): Promise<ApiResponse<SettlePickControllerResult>> {
  const result = await recordPickSettlement(pickId, payload, repositories);

  // Fire Discord recap — same downstream as auto-settle; non-fatal if it fails
  postSettlementRecapIfPossible(result.pickRecord, result.settlementRecord, repositories, {}).catch(
    () => undefined,
  );

  return successResponse(201, {
    pickId,
    settlementRecordId: result.settlementRecord.id,
    settlementStatus: result.settlementRecord.status,
    settlementResult: result.settlementRecord.result,
    finalLifecycleState: result.finalLifecycleState,
    settledLifecycleEventId: result.lifecycleEvent?.id ?? null,
    auditActionIds: result.auditRecords.map((record) => record.id),
    downstream: {
      effectiveSettlementRecordId:
        result.downstream.effectiveSettlement?.effective_record_id ?? null,
      effectiveSettlementStatus:
        result.downstream.effectiveSettlement?.status ?? null,
      effectiveSettlementResult:
        result.downstream.effectiveSettlement?.result ?? null,
      correctionDepth:
        result.downstream.effectiveSettlement?.correction_depth ?? null,
      isFinal: result.downstream.effectiveSettlement?.is_final ?? null,
      totalRecords: result.downstream.settlementSummary.total_records,
      pendingReviewCount: result.downstream.settlementSummary.pending_review_count,
      correctionCount: result.downstream.settlementSummary.correction_count,
      hitRatePct: result.downstream.settlementSummary.hit_rate_pct,
      flatBetRoiPct: result.downstream.settlementSummary.flat_bet_roi.roi_pct,
      lossAttributionClassification:
        result.downstream.lossAttribution?.classification ?? null,
      unresolvedReason: result.downstream.unresolvedReason,
    },
  });
}
