import { randomUUID } from 'node:crypto';
import type {
  AuditLogRecord,
  AuditLogRepository,
  Json,
  PickRecord,
  PickRepository,
  PromotionBoardStateQuery,
  PromotionBoardStateSnapshot,
  PromotionDecisionPersistenceInput,
  PromotionHistoryInsertInput,
  PromotionHistoryRecord,
  PromotionPersistenceResult,
  RepositoryBundle,
} from '@unit-talk/db';
import type { PromotionTarget } from '@unit-talk/contracts';
import type { BoardPromotionDecision } from '@unit-talk/contracts';
import type { ApiResponse } from '../http.js';
import { errorResponse, successResponse } from '../http.js';
import { evaluateAllPoliciesEagerAndPersist } from '../promotion-service.js';

export interface PromotionPreviewResult {
  pickId: string;
  wouldPromoteTo: string | null;
  score: number | null;
  reasons: string[];
  qualifies: boolean;
}

export async function promotionPreviewController(
  pickId: string,
  repositories: RepositoryBundle,
): Promise<ApiResponse<PromotionPreviewResult>> {
  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    return errorResponse(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  const dryRunPickRepository = createDryRunPickRepository(repositories.picks, pick);
  const dryRunAuditRepository = createDryRunAuditRepository(repositories.audit);
  const result = await evaluateAllPoliciesEagerAndPersist(
    pickId,
    'preview.command-center',
    dryRunPickRepository,
    dryRunAuditRepository,
    repositories.settlements,
  );

  const decision = selectPreviewDecision(result.resolvedTarget, {
    'exclusive-insights': result.exclusiveInsightsDecision,
    'trader-insights': result.traderInsightsDecision,
    'best-bets': result.bestBetsDecision,
  });
  const reasons = [
    ...decision.explanation.reasons,
    ...decision.explanation.suppressionReasons,
  ];

  return successResponse(200, {
    pickId,
    wouldPromoteTo: result.resolvedTarget,
    score: decision.score,
    reasons: reasons.length > 0 ? reasons : [`promotion status ${decision.status}`],
    qualifies: result.resolvedTarget !== null,
  });
}

function selectPreviewDecision(
  resolvedTarget: PromotionTarget | null,
  decisions: Record<PromotionTarget, BoardPromotionDecision>,
) {
  if (resolvedTarget) {
    return decisions[resolvedTarget];
  }

  return decisions['best-bets'];
}

function createDryRunPickRepository(
  repository: PickRepository,
  initialPick: PickRecord,
): PickRepository {
  let currentPick = { ...initialPick };
  let historyCount = 0;

  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'findPickById') {
        return async (pickId: string) => (pickId === currentPick.id ? { ...currentPick } : target.findPickById(pickId));
      }

      if (property === 'listByLifecycleStates') {
        return async (
          states: Parameters<PickRepository['listByLifecycleStates']>[0],
          limit?: Parameters<PickRepository['listByLifecycleStates']>[1],
        ) => {
          const picks = await target.listByLifecycleStates(states, limit);
          return picks.filter((pick) => pick.id !== currentPick.id);
        };
      }

      if (property === 'getPromotionBoardState') {
        return async (input: PromotionBoardStateQuery): Promise<PromotionBoardStateSnapshot> => {
          const snapshot = await target.getPromotionBoardState(input);
          if (!countsAsCurrentBoardPick(currentPick, input)) {
            return snapshot;
          }

          return {
            currentBoardCount: Math.max(0, snapshot.currentBoardCount - 1),
            sameSportCount: Math.max(0, snapshot.sameSportCount - matchesMetadata(currentPick, 'sport', input.sport)),
            sameGameCount: Math.max(0, snapshot.sameGameCount - matchesMetadata(currentPick, 'eventName', input.eventName)),
            duplicateCount: Math.max(
              0,
              snapshot.duplicateCount - (currentPick.market === input.market && currentPick.selection === input.selection ? 1 : 0),
            ),
          };
        };
      }

      if (property === 'persistPromotionDecision') {
        return async (input: PromotionDecisionPersistenceInput): Promise<PromotionPersistenceResult> => {
          const decidedAt = input.promotionDecidedAt;
          currentPick = {
            ...currentPick,
            approval_status: input.approvalStatus,
            promotion_status: input.promotionStatus,
            promotion_target: input.promotionTarget ?? null,
            promotion_score: input.promotionScore ?? null,
            promotion_reason: input.promotionReason ?? null,
            promotion_version: input.promotionVersion,
            promotion_decided_at: decidedAt,
            promotion_decided_by: input.promotionDecidedBy,
          };

          return {
            pick: { ...currentPick },
            history: buildHistory(input, ++historyCount),
          };
        };
      }

      if (property === 'insertPromotionHistoryRow') {
        return async (input: PromotionHistoryInsertInput): Promise<PromotionHistoryRecord> =>
          buildHistory(input, ++historyCount);
      }

      return Reflect.get(target, property, receiver);
    },
  }) as PickRepository;
}

function countsAsCurrentBoardPick(pick: PickRecord, input: PromotionBoardStateQuery) {
  return (
    pick.promotion_target === input.target &&
    (pick.promotion_status === 'qualified' || pick.promotion_status === 'promoted') &&
    pick.status !== 'settled' &&
    pick.status !== 'voided' &&
    pick.source != null
  );
}

function matchesMetadata(
  pick: PickRecord,
  key: 'sport' | 'eventName',
  value: string | null | undefined,
) {
  if (!value || !pick.metadata || typeof pick.metadata !== 'object' || Array.isArray(pick.metadata)) {
    return 0;
  }

  return pick.metadata[key] === value ? 1 : 0;
}

function createDryRunAuditRepository(repository: AuditLogRepository): AuditLogRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'record') {
        return async (input: Parameters<AuditLogRepository['record']>[0]): Promise<AuditLogRecord> => ({
          id: `preview-audit-${randomUUID()}`,
          entity_type: input.entityType,
          entity_id: input.entityId ?? null,
          entity_ref: input.entityRef ?? null,
          action: input.action,
          actor: input.actor ?? null,
          payload: input.payload as Json,
          created_at: new Date().toISOString(),
        });
      }

      return Reflect.get(target, property, receiver);
    },
  }) as AuditLogRepository;
}

function buildHistory(
  input: PromotionDecisionPersistenceInput | PromotionHistoryInsertInput,
  index: number,
): PromotionHistoryRecord {
  return {
    id: `preview-history-${index}`,
    pick_id: input.pickId,
    target: input.target,
    status: input.promotionStatus,
    score: input.promotionScore ?? null,
    reason: input.promotionReason ?? null,
    version: input.promotionVersion,
    decided_at: input.promotionDecidedAt,
    decided_by: input.promotionDecidedBy,
    override_action: input.overrideAction ?? null,
    payload: input.payload as Json,
    created_at: input.promotionDecidedAt,
  };
}
