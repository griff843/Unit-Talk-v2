import {
  humanDeliveryTargets,
  isHumanCapperDeliveryAuthorized,
  type SettlementRequest,
} from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { successResponse } from '../http.js';
import { isEvidencePlanePick, recordPickSettlement } from '../settlement-service.js';
import { postSettlementRecapIfPossible } from '../grading-service.js';
import { loadEnvironment } from '@unit-talk/config';
import { observeSettlementRecap } from '../settlement-recap-observation.js';

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
  /**
   * UTV2-1923: present only for an authorized human capper pick. The immediate
   * per-pick recap is part of the human delivery transaction, so its outcome
   * is reported rather than fire-and-forget — an operator who settles a
   * delivered pick needs to know whether members were told.
   */
  humanCapperRecap?: {
    posted: boolean;
    reason?: string;
  };
}

export async function settlePickController(
  pickId: string,
  payload: SettlementRequest,
  repositories: RepositoryBundle,
): Promise<ApiResponse<SettlePickControllerResult>> {
  const result = await recordPickSettlement(pickId, payload, repositories);

  // Fire immediate per-pick Discord recap in non-production environments only.
  // Production relies on the scheduled batch recap (11 AM EST daily).
  //
  // The `isEvidencePlanePick` guard mirrors `grading-service.ts`'s, and it is
  // enforcement rather than optimisation. Today a recap on a Track Only pick is
  // *structurally* inert — `resolveRecapChannel` requires a `sent`
  // distribution_outbox row and a Track Only pick has none — but that is the
  // absence of a delivery record, not a refusal to deliver. Relying on it would
  // make non-delivery a property of the data, so the first Track Only pick that
  // ever acquired an outbox row would start publishing. Publishing a recap for
  // one is member delivery, which Track Only exists to make impossible.
  const metadata = isRecord(result.pickRecord.metadata) ? result.pickRecord.metadata : null;
  const isHumanCapperDelivery = isHumanCapperDeliveryAuthorized(metadata);
  let humanCapperRecap: SettlePickControllerResult['humanCapperRecap'];

  // UTV2-1923 HUMAN_CAPPER_RECAP_GUARD_START
  // W4: a manually settled human capper pick gets its per-pick recap
  // immediately, in production, because that recap IS the member-facing close
  // of the transaction the pick opened. The existing non-production-only rule
  // below is unchanged for every other pick.
  //
  // Three conditions, all required, none of them incidental:
  //   1. the pick carries a server delivery authorization;
  //   2. the governed delivery target is not killed at the live kill switch --
  //      `postSettlementRecapIfPossible` posts by direct `fetch` and does NOT
  //      go through the outbox, so the worker's kill-switch check never sees
  //      it. Without this line the kill switch could stop the pick and not the
  //      recap about it;
  //   3. `resolveRecapChannel` finds a `sent` delivery for this pick, which it
  //      enforces itself — a pick that never reached members gets no recap.
  if (!isEvidencePlanePick(result.pickRecord) && isHumanCapperDelivery) {
    const killed = repositories.killSwitch
      ? await repositories.killSwitch.isKilled(humanDeliveryTargets[0])
      : true;
    if (killed) {
      humanCapperRecap = await observeSettlementRecap(
        result.pickRecord.id, result.settlementRecord.id, repositories.runs,
        async () => ({ posted: false, reason: 'kill-switch-engaged' }),
      );
    } else {
      try {
        const recap = await postSettlementRecapIfPossible(
          result.pickRecord,
          result.settlementRecord,
          repositories,
          {},
        );
        humanCapperRecap = recap.posted
          ? { posted: true }
          : { posted: false, reason: recap.reason };
      } catch (error) {
        humanCapperRecap = {
          posted: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
  } else if (
    !isEvidencePlanePick(result.pickRecord) &&
    loadEnvironment().UNIT_TALK_APP_ENV !== 'production'
  ) {
    postSettlementRecapIfPossible(result.pickRecord, result.settlementRecord, repositories, {}).catch(
      () => undefined,
    );
  }
  // UTV2-1923 HUMAN_CAPPER_RECAP_GUARD_END

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
    ...(humanCapperRecap === undefined ? {} : { humanCapperRecap }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
