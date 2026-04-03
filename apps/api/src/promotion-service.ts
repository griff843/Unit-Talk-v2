import {
  type BoardPromotionDecision,
  type BoardPromotionEvaluationInput,
  type CanonicalPick,
  type EdgeSource,
  type PickLifecycleState,
  type PromotionDecisionSnapshot,
  type PromotionPolicy,
  type PromotionOverrideAction,
  type PromotionTarget,
  resolveScoringProfile,
  type ExposureGateConfig,
  resolveExposureGateConfig,
} from '@unit-talk/contracts';
import { evaluatePromotionEligibility, detectCorrelatedPicks, computeCorrelationPenalty } from '@unit-talk/domain';
import type {
  AuditLogRecord,
  AuditLogRepository,
  PickRecord,
  PickRepository,
  PromotionHistoryRecord,
  SettlementRepository,
} from '@unit-talk/db';
import { computeClvTrustAdjustment } from './clv-feedback.js';

const activeScoringProfile = resolveScoringProfile(process.env['UNIT_TALK_SCORING_PROFILE']);

export interface PromotionEvaluationResult {
  pick: CanonicalPick;
  pickRecord: PickRecord;
  history: PromotionHistoryRecord;
  audit: AuditLogRecord;
  decision: BoardPromotionDecision;
  snapshot: PromotionDecisionSnapshot;
}

export async function evaluateAndPersistBestBetsPromotion(
  pickId: string,
  actor: string,
  pickRepository: PickRepository,
  auditLogRepository: AuditLogRepository,
): Promise<PromotionEvaluationResult> {
  return evaluateAndPersistPromotion(
    pickId,
    actor,
    pickRepository,
    auditLogRepository,
    activeScoringProfile.policies['best-bets'],
  );
}

export async function evaluateAndPersistPromotion(
  pickId: string,
  actor: string,
  pickRepository: PickRepository,
  auditLogRepository: AuditLogRepository,
  policy: PromotionPolicy,
): Promise<PromotionEvaluationResult> {
  return persistPromotionDecisionForPick(
    pickId,
    actor,
    pickRepository,
    auditLogRepository,
    policy,
    undefined,
  );
}

export function activePromotionPolicies() {
  return [
    activeScoringProfile.policies['exclusive-insights'],
    activeScoringProfile.policies['trader-insights'],
    activeScoringProfile.policies['best-bets'],
  ] as const;
}

export interface EagerPromotionAllPoliciesResult {
  pick: CanonicalPick;
  pickRecord: PickRecord;
  resolvedTarget: PromotionTarget | null;
  exclusiveInsightsDecision: BoardPromotionDecision;
  traderInsightsDecision: BoardPromotionDecision;
  bestBetsDecision: BoardPromotionDecision;
}

/**
 * Eagerly evaluates all active promotion policies in priority order (exclusive-insights first,
 * then trader-insights, then best-bets). All `pick_promotion_history` rows are written regardless
 * of outcome.
 * `picks.promotion_target` is set to the highest-priority qualified target, or null if
 * neither policy qualifies.
 *
 * Priority order: exclusive-insights > trader-insights > best-bets.
 * A pick that qualifies for multiple routes exclusively routes to the highest-tier target.
 */
export async function evaluateAllPoliciesEagerAndPersist(
  pickId: string,
  actor: string,
  pickRepository: PickRepository,
  auditLogRepository: AuditLogRepository,
  settlementRepository?: SettlementRepository,
): Promise<EagerPromotionAllPoliciesResult> {
  const pickRecord = await pickRepository.findPickById(pickId);
  if (!pickRecord) {
    throw new Error(`Cannot evaluate promotion for unknown pick: ${pickId}`);
  }

  const canonicalPick = mapPickRecordToCanonicalPick(pickRecord);

  const policies = activePromotionPolicies();
  // Get board states for all targets in parallel (each target has its own board).
  const boardStates = await Promise.all(
    policies.map((policy) =>
      pickRepository.getPromotionBoardState({
        target: policy.target,
        sport: readMetadataString(canonicalPick.metadata, 'sport'),
        eventName: readMetadataString(canonicalPick.metadata, 'eventName'),
        market: canonicalPick.market,
        selection: canonicalPick.selection,
      }),
    ),
  );

  // Fetch open picks for correlation-aware scoring and exposure gate
  const openPickRecords = await pickRepository.listByLifecycleStates(['validated', 'queued', 'posted'], 300);
  const openPicks = openPickRecords.map(mapPickRecordToCanonicalPick);

  // Exposure gate — blocks before scoring if limits exceeded
  const exposureGateConfig = resolveExposureGateConfig();
  if (canonicalPick.source !== 'smart-form' && exposureGateConfig.enabled) {
    const exposureRejection = checkExposureGate(canonicalPick, openPicks, exposureGateConfig);
    if (exposureRejection) {
      return buildExposureSuppressedResult(
        canonicalPick, pickRecord, exposureRejection, actor, pickRepository, auditLogRepository,
      );
    }
  }

  const scoreInputs = await readPromotionScoreInputs(
    canonicalPick,
    openPicks,
    settlementRepository ? { settlements: settlementRepository, picks: pickRepository } : undefined,
  );
  const decidedAt = new Date().toISOString();

  if (canonicalPick.source === 'smart-form') {
    return buildSmartFormQualifiedResult(
      canonicalPick,
      pickRecord,
      actor,
      pickRepository,
      auditLogRepository,
      policies,
      boardStates,
      scoreInputs,
      decidedAt,
    );
  }

  const makeInput = (
    policy: PromotionPolicy,
    boardState: (typeof boardStates)[number],
  ): BoardPromotionEvaluationInput => ({
    target: policy.target,
    pick: canonicalPick,
    approvalStatus: canonicalPick.approvalStatus,
    hasRequiredFields: hasRequiredFields(canonicalPick),
    isStale: readMetadataBoolean(canonicalPick.metadata, 'isStale') ?? false,
    withinPostingWindow: !(readMetadataBoolean(canonicalPick.metadata, 'postingWindowClosed') ?? false),
    marketStillValid: readMetadataBoolean(canonicalPick.metadata, 'marketStillValid') ?? true,
    riskBlocked: readMetadataBoolean(canonicalPick.metadata, 'riskBlocked') ?? false,
    scoreInputs,
    minimumScore: policy.minimumScore,
    // Smart Form picks are deliberate human capper submissions — confidence is
    // analytical metadata only and must never block delivery.
    confidenceFloor:
      canonicalPick.source === 'smart-form' || canonicalPick.source === 'alert-agent'
        ? undefined
        : policy.confidenceFloor,
    boardCaps: policy.boardCaps,
    boardState,
    override: undefined,
    decidedAt,
    decidedBy: actor,
    version: policy.version,
  });

  const decisions = policies.map((policy, index) =>
    evaluatePromotionEligibility(makeInput(policy, boardStates[index]!), policy),
  );
  const decisionByTarget = new Map(
    policies.map((policy, index) => [policy.target, decisions[index]!] as const),
  );

  // First qualified policy in priority order wins. If none qualify, best-bets remains the
  // persisted fallback row so the pick still carries the least-restrictive policy history.
  const winnerIndex = decisions.findIndex((decision) => decision.qualified);
  const resolvedIndex = winnerIndex >= 0 ? winnerIndex : policies.length - 1;
  const winnerPolicy = policies[resolvedIndex]!;
  const winnerDecision = decisions[resolvedIndex]!;
  const winnerBoardState = boardStates[resolvedIndex]!;
  const resolvedTarget: PromotionTarget | null = winnerDecision.qualified
    ? winnerPolicy.target
    : null;
  const winnerReason = summarizePromotionReason(winnerDecision);

  const makeSnapshot = (
    policy: PromotionPolicy,
    boardState: (typeof boardStates)[number],
  ): PromotionDecisionSnapshot => ({
    scoringProfile: activeScoringProfile.name,
    policyVersion: policy.version,
    scoreInputs: {
      edge: scoreInputs.edge,
      trust: scoreInputs.trust,
      readiness: scoreInputs.readiness,
      uniqueness: scoreInputs.uniqueness,
      boardFit: scoreInputs.boardFit,
      edgeSource: scoreInputs.edgeSource,
    },
    gateInputs: {
      approvalStatus: canonicalPick.approvalStatus,
      hasRequiredFields: hasRequiredFields(canonicalPick),
      isStale: readMetadataBoolean(canonicalPick.metadata, 'isStale') ?? false,
      withinPostingWindow: !(readMetadataBoolean(canonicalPick.metadata, 'postingWindowClosed') ?? false),
      marketStillValid: readMetadataBoolean(canonicalPick.metadata, 'marketStillValid') ?? true,
      riskBlocked: readMetadataBoolean(canonicalPick.metadata, 'riskBlocked') ?? false,
      confidenceFloor: policy.confidenceFloor ?? null,
      pickConfidence: canonicalPick.confidence ?? null,
    },
    boardStateAtDecision: {
      currentBoardCount: boardState.currentBoardCount,
      sameSportCount: boardState.sameSportCount,
      sameGameCount: boardState.sameGameCount,
      duplicateCount: boardState.duplicateCount,
    },
    weightsUsed: {
      edge: policy.weights.edge,
      trust: policy.weights.trust,
      readiness: policy.weights.readiness,
      uniqueness: policy.weights.uniqueness,
      boardFit: policy.weights.boardFit,
    },
  });

  const winnerSnapshot = makeSnapshot(winnerPolicy, winnerBoardState);

  // Persist winner: updates picks + inserts winner's history row.
  const persisted = await pickRepository.persistPromotionDecision({
    pickId,
    target: winnerPolicy.target,
    approvalStatus: canonicalPick.approvalStatus,
    promotionStatus: winnerDecision.status,
    promotionTarget: resolvedTarget,
    promotionScore: winnerDecision.score,
    promotionReason: winnerReason,
    promotionVersion: winnerDecision.version,
    promotionDecidedAt: winnerDecision.decidedAt,
    promotionDecidedBy: winnerDecision.decidedBy,
    overrideAction: null,
    payload: {
      ...winnerSnapshot,
      explanation: winnerDecision.explanation,
      policy: winnerPolicy,
    },
  });

  await auditLogRepository.record({
    entityType: 'pick_promotion_history',
    entityId: persisted.history.id,
    entityRef: pickId,
    action: winnerDecision.qualified ? 'promotion.qualified' : 'promotion.suppressed',
    actor,
    payload: {
      pickId,
      target: winnerPolicy.target,
      status: winnerDecision.status,
      score: winnerDecision.score,
      resolvedTarget,
    },
  });

  // Insert all non-winning policy history rows (does not touch picks).
  // Wrapped in compensating rollback: if any history insert fails after the pick
  // was already updated, reset pick.promotion_target to null to avoid state-without-history.
  try {
    for (let index = 0; index < policies.length; index += 1) {
      if (index === resolvedIndex) {
        continue;
      }

      const policy = policies[index]!;
      const decision = decisions[index]!;
      const boardState = boardStates[index]!;
      const historyReason = summarizePromotionReason(decision);
      const nonWinnerSnapshot = makeSnapshot(policy, boardState);
      const history = await pickRepository.insertPromotionHistoryRow({
        pickId,
        target: policy.target,
        promotionStatus: decision.status,
        promotionScore: decision.score,
        promotionReason: historyReason,
        promotionVersion: decision.version,
        promotionDecidedAt: decision.decidedAt,
        promotionDecidedBy: decision.decidedBy,
        overrideAction: null,
        payload: {
          ...nonWinnerSnapshot,
          explanation: decision.explanation,
          policy,
        },
      });

      await auditLogRepository.record({
        entityType: 'pick_promotion_history',
        entityId: history.id,
        entityRef: pickId,
        action: decision.qualified ? 'promotion.qualified' : 'promotion.suppressed',
        actor,
        payload: {
          pickId,
          target: policy.target,
          status: decision.status,
          score: decision.score,
          resolvedTarget,
        },
      });
    }
  } catch (historyError: unknown) {
    // Compensating rollback: reset pick promotion state to avoid state-without-history
    console.error(JSON.stringify({
      service: 'promotion-service',
      event: 'promotion.history_insert_failed',
      pickId,
      resolvedTarget,
      error: historyError instanceof Error ? historyError.message : String(historyError),
      action: 'executing compensating rollback',
    }));

    try {
      await pickRepository.persistPromotionDecision({
        pickId,
        target: winnerPolicy.target,
        approvalStatus: canonicalPick.approvalStatus,
        promotionStatus: 'suppressed',
        promotionTarget: null,
        promotionScore: 0,
        promotionReason: 'compensating-rollback: history insert failure',
        promotionVersion: winnerDecision.version,
        promotionDecidedAt: new Date().toISOString(),
        promotionDecidedBy: 'system:rollback',
        overrideAction: null,
        payload: { rollbackReason: 'non-winner history insert failed', originalTarget: resolvedTarget },
      });

      await auditLogRepository.record({
        entityType: 'pick_promotion_history',
        entityId: persisted.history.id,
        entityRef: pickId,
        action: 'promotion.rollback',
        actor: 'system:rollback',
        payload: { pickId, resolvedTarget, reason: 'non-winner history insert failed after pick update' },
      });
    } catch (rollbackError: unknown) {
      console.error(JSON.stringify({
        service: 'promotion-service',
        event: 'promotion.rollback_failed',
        pickId,
        resolvedTarget,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        impact: 'Pick may be in inconsistent state — promotion_target set but history incomplete',
      }));
    }

    throw historyError;
  }

  return {
    pick: mapPickRecordToCanonicalPick(persisted.pick),
    pickRecord: persisted.pick,
    resolvedTarget,
    exclusiveInsightsDecision: decisionByTarget.get('exclusive-insights')!,
    traderInsightsDecision: decisionByTarget.get('trader-insights')!,
    bestBetsDecision: decisionByTarget.get('best-bets')!,
  };
}

async function buildSmartFormQualifiedResult(
  canonicalPick: CanonicalPick,
  pickRecord: PickRecord,
  actor: string,
  pickRepository: PickRepository,
  auditLogRepository: AuditLogRepository,
  policies: readonly PromotionPolicy[],
  boardStates: Awaited<ReturnType<PickRepository['getPromotionBoardState']>>[],
  scoreInputs: Awaited<ReturnType<typeof readPromotionScoreInputs>>,
  decidedAt: string,
): Promise<EagerPromotionAllPoliciesResult> {
  const bestBetsPolicy = policies.find((policy) => policy.target === 'best-bets');
  const bestBetsIndex = policies.findIndex((policy) => policy.target === 'best-bets');
  if (!bestBetsPolicy || bestBetsIndex < 0) {
    throw new Error('best-bets policy must be active for smart-form submissions');
  }

  const makeInput = (
    policy: PromotionPolicy,
    boardState: (typeof boardStates)[number],
    override: BoardPromotionEvaluationInput['override'],
  ): BoardPromotionEvaluationInput => ({
    target: policy.target,
    pick: canonicalPick,
    approvalStatus: canonicalPick.approvalStatus,
    hasRequiredFields: hasRequiredFields(canonicalPick),
    isStale: readMetadataBoolean(canonicalPick.metadata, 'isStale') ?? false,
    withinPostingWindow: !(readMetadataBoolean(canonicalPick.metadata, 'postingWindowClosed') ?? false),
    marketStillValid: readMetadataBoolean(canonicalPick.metadata, 'marketStillValid') ?? true,
    riskBlocked: readMetadataBoolean(canonicalPick.metadata, 'riskBlocked') ?? false,
    scoreInputs,
    minimumScore: policy.minimumScore,
    confidenceFloor: undefined,
    boardCaps: policy.boardCaps,
    boardState,
    override,
    decidedAt,
    decidedBy: actor,
    version: policy.version,
  });

  const decisions = policies.map((policy, index) => {
    const boardState = boardStates[index]!;
    if (policy.target === 'best-bets') {
      return evaluatePromotionEligibility(
        makeInput(policy, boardState, {
          forcePromote: true,
          reason: 'smart-form submissions route directly to best-bets',
        }),
        policy,
      );
    }

    return evaluatePromotionEligibility(
      makeInput(policy, boardState, {
        suppress: true,
        reason: 'smart-form submissions route directly to best-bets',
      }),
      policy,
    );
  });

  const decisionByTarget = new Map(
    policies.map((policy, index) => [policy.target, decisions[index]!] as const),
  );

  const makeSnapshot = (
    policy: PromotionPolicy,
    boardState: (typeof boardStates)[number],
    override: BoardPromotionEvaluationInput['override'],
  ): PromotionDecisionSnapshot => ({
    scoringProfile: activeScoringProfile.name,
    policyVersion: policy.version,
    scoreInputs: {
      edge: scoreInputs.edge,
      trust: scoreInputs.trust,
      readiness: scoreInputs.readiness,
      uniqueness: scoreInputs.uniqueness,
      boardFit: scoreInputs.boardFit,
      edgeSource: scoreInputs.edgeSource,
    },
    gateInputs: {
      approvalStatus: canonicalPick.approvalStatus,
      hasRequiredFields: hasRequiredFields(canonicalPick),
      isStale: readMetadataBoolean(canonicalPick.metadata, 'isStale') ?? false,
      withinPostingWindow: !(readMetadataBoolean(canonicalPick.metadata, 'postingWindowClosed') ?? false),
      marketStillValid: readMetadataBoolean(canonicalPick.metadata, 'marketStillValid') ?? true,
      riskBlocked: readMetadataBoolean(canonicalPick.metadata, 'riskBlocked') ?? false,
      confidenceFloor: null,
      pickConfidence: canonicalPick.confidence ?? null,
    },
    boardStateAtDecision: {
      currentBoardCount: boardState.currentBoardCount,
      sameSportCount: boardState.sameSportCount,
      sameGameCount: boardState.sameGameCount,
      duplicateCount: boardState.duplicateCount,
    },
    weightsUsed: {
      edge: policy.weights.edge,
      trust: policy.weights.trust,
      readiness: policy.weights.readiness,
      uniqueness: policy.weights.uniqueness,
      boardFit: policy.weights.boardFit,
    },
    ...(toSnapshotOverride(override) ? { override: toSnapshotOverride(override) } : {}),
  }) as PromotionDecisionSnapshot;

  const winnerDecision = decisions[bestBetsIndex]!;
  const winnerBoardState = boardStates[bestBetsIndex]!;
  const winnerSnapshot = makeSnapshot(bestBetsPolicy, winnerBoardState, {
    forcePromote: true,
    reason: 'smart-form submissions route directly to best-bets',
  });
  const winnerReason = summarizePromotionReason(winnerDecision);

  const persisted = await pickRepository.persistPromotionDecision({
    pickId: canonicalPick.id,
    target: bestBetsPolicy.target,
    approvalStatus: canonicalPick.approvalStatus,
    promotionStatus: winnerDecision.status,
    promotionTarget: 'best-bets',
    promotionScore: winnerDecision.score,
    promotionReason: winnerReason,
    promotionVersion: winnerDecision.version,
    promotionDecidedAt: winnerDecision.decidedAt,
    promotionDecidedBy: winnerDecision.decidedBy,
    overrideAction: 'force_promote',
    payload: {
      ...winnerSnapshot,
      explanation: winnerDecision.explanation,
      policy: bestBetsPolicy,
    },
  });

  await auditLogRepository.record({
    entityType: 'pick_promotion_history',
    entityId: persisted.history.id,
    entityRef: canonicalPick.id,
    action: 'promotion.force_promote',
    actor,
    payload: {
      pickId: canonicalPick.id,
      target: 'best-bets',
      status: winnerDecision.status,
      score: winnerDecision.score,
      resolvedTarget: 'best-bets',
      reason: 'smart-form submissions route directly to best-bets',
    },
  });

  for (let index = 0; index < policies.length; index += 1) {
    if (index === bestBetsIndex) {
      continue;
    }

    const policy = policies[index]!;
    const decision = decisions[index]!;
    const boardState = boardStates[index]!;
    const history = await pickRepository.insertPromotionHistoryRow({
      pickId: canonicalPick.id,
      target: policy.target,
      promotionStatus: decision.status,
      promotionScore: decision.score,
      promotionReason: summarizePromotionReason(decision),
      promotionVersion: decision.version,
      promotionDecidedAt: decision.decidedAt,
      promotionDecidedBy: decision.decidedBy,
      overrideAction: null,
      payload: {
        ...makeSnapshot(policy, boardState, {
          suppress: true,
          reason: 'smart-form submissions route directly to best-bets',
        }),
        explanation: decision.explanation,
        policy,
      },
    });

    await auditLogRepository.record({
      entityType: 'pick_promotion_history',
      entityId: history.id,
      entityRef: canonicalPick.id,
      action: 'promotion.suppress',
      actor,
      payload: {
        pickId: canonicalPick.id,
        target: policy.target,
        status: decision.status,
        score: decision.score,
        resolvedTarget: 'best-bets',
        reason: 'smart-form submissions route directly to best-bets',
      },
    });
  }

  return {
    pick: mapPickRecordToCanonicalPick(persisted.pick),
    pickRecord: persisted.pick,
    resolvedTarget: 'best-bets',
    exclusiveInsightsDecision: decisionByTarget.get('exclusive-insights')!,
    traderInsightsDecision: decisionByTarget.get('trader-insights')!,
    bestBetsDecision: decisionByTarget.get('best-bets')!,
  };
}

export async function applyPromotionOverride(
  input: {
    pickId: string;
    actor: string;
    action: PromotionOverrideAction;
    reason: string;
    target?: PromotionTarget | undefined;
  },
  pickRepository: PickRepository,
  auditLogRepository: AuditLogRepository,
): Promise<PromotionEvaluationResult> {
  return persistPromotionDecisionForPick(
    input.pickId,
    input.actor,
    pickRepository,
    auditLogRepository,
    resolvePromotionPolicyForTarget(input.target ?? 'best-bets'),
    input,
  );
}

async function persistPromotionDecisionForPick(
  pickId: string,
  actor: string,
  pickRepository: PickRepository,
  auditLogRepository: AuditLogRepository,
  policy: PromotionPolicy,
  override:
    | {
        action: PromotionOverrideAction;
        reason: string;
      }
    | undefined,
  settlementRepository?: SettlementRepository,
): Promise<PromotionEvaluationResult> {
  const pickRecord = await pickRepository.findPickById(pickId);
  if (!pickRecord) {
    throw new Error(`Cannot evaluate promotion for unknown pick: ${pickId}`);
  }

  const canonicalPick = mapPickRecordToCanonicalPick(pickRecord);
  const boardState = await pickRepository.getPromotionBoardState({
    target: policy.target,
    sport: readMetadataString(canonicalPick.metadata, 'sport'),
    eventName: readMetadataString(canonicalPick.metadata, 'eventName'),
    market: canonicalPick.market,
    selection: canonicalPick.selection,
  });
  // Fetch open picks for correlation-aware scoring
  const openPickRecords = await pickRepository.listByLifecycleStates(['validated', 'queued', 'posted'], 300);
  const openPicks = openPickRecords.map(mapPickRecordToCanonicalPick);
  const scoreInputs = await readPromotionScoreInputs(
    canonicalPick,
    openPicks,
    settlementRepository ? { settlements: settlementRepository, picks: pickRepository } : undefined,
  );
  const overrideState = mapOverrideState(override);
  const decision = evaluatePromotionEligibility({
    target: policy.target,
    pick: canonicalPick,
    approvalStatus: canonicalPick.approvalStatus,
    hasRequiredFields: hasRequiredFields(canonicalPick),
    isStale: readMetadataBoolean(canonicalPick.metadata, 'isStale') ?? false,
    withinPostingWindow: !(readMetadataBoolean(canonicalPick.metadata, 'postingWindowClosed') ?? false),
    marketStillValid: readMetadataBoolean(canonicalPick.metadata, 'marketStillValid') ?? true,
    riskBlocked: readMetadataBoolean(canonicalPick.metadata, 'riskBlocked') ?? false,
    scoreInputs,
    minimumScore: policy.minimumScore,
    confidenceFloor:
      canonicalPick.source === 'smart-form' || canonicalPick.source === 'alert-agent'
        ? undefined
        : policy.confidenceFloor,
    boardCaps: policy.boardCaps,
    boardState,
    override: overrideState,
    decidedAt: new Date().toISOString(),
    decidedBy: actor,
    version: policy.version,
  }, policy);

  const reason = summarizePromotionReason(decision);
  const snapshot: PromotionDecisionSnapshot = {
    scoringProfile: activeScoringProfile.name,
    policyVersion: policy.version,
    scoreInputs: {
      edge: scoreInputs.edge,
      trust: scoreInputs.trust,
      readiness: scoreInputs.readiness,
      uniqueness: scoreInputs.uniqueness,
      boardFit: scoreInputs.boardFit,
      edgeSource: scoreInputs.edgeSource,
    },
    gateInputs: {
      approvalStatus: canonicalPick.approvalStatus,
      hasRequiredFields: hasRequiredFields(canonicalPick),
      isStale: readMetadataBoolean(canonicalPick.metadata, 'isStale') ?? false,
      withinPostingWindow: !(readMetadataBoolean(canonicalPick.metadata, 'postingWindowClosed') ?? false),
      marketStillValid: readMetadataBoolean(canonicalPick.metadata, 'marketStillValid') ?? true,
      riskBlocked: readMetadataBoolean(canonicalPick.metadata, 'riskBlocked') ?? false,
      confidenceFloor: policy.confidenceFloor ?? null,
      pickConfidence: canonicalPick.confidence ?? null,
    },
    boardStateAtDecision: {
      currentBoardCount: boardState.currentBoardCount,
      sameSportCount: boardState.sameSportCount,
      sameGameCount: boardState.sameGameCount,
      duplicateCount: boardState.duplicateCount,
    },
    weightsUsed: {
      edge: policy.weights.edge,
      trust: policy.weights.trust,
      readiness: policy.weights.readiness,
      uniqueness: policy.weights.uniqueness,
      boardFit: policy.weights.boardFit,
    },
    ...(overrideState !== undefined ? { override: overrideState } : {}),
  };

  const persisted = await pickRepository.persistPromotionDecision({
    pickId,
    target: policy.target,
    approvalStatus: canonicalPick.approvalStatus,
    promotionStatus: decision.status,
    promotionTarget: decision.qualified ? policy.target : null,
    promotionScore: decision.score,
    promotionReason: reason,
    promotionVersion: decision.version,
    promotionDecidedAt: decision.decidedAt,
    promotionDecidedBy: decision.decidedBy,
    overrideAction: override?.action ?? null,
    payload: {
      ...snapshot,
      explanation: decision.explanation,
      policy,
    },
  });
  const audit = await auditLogRepository.record({
    entityType: 'pick_promotion_history',
    entityId: persisted.history.id,
    entityRef: persisted.pick.id,
    action: mapAuditAction(decision, override),
    actor,
    payload: {
      pickId: persisted.pick.id,
      target: policy.target,
      status: decision.status,
      score: decision.score,
      overrideAction: override?.action ?? null,
      reason,
    },
  });

  return {
    pick: mapPickRecordToCanonicalPick(persisted.pick),
    pickRecord: persisted.pick,
    history: persisted.history,
    audit,
    decision,
    snapshot,
  };
}

function mapPickRecordToCanonicalPick(pick: PickRecord): CanonicalPick {
  return {
    id: pick.id,
    submissionId: pick.submission_id ?? '',
    market: pick.market,
    selection: pick.selection,
    line: pick.line ?? undefined,
    odds: pick.odds ?? undefined,
    stakeUnits: pick.stake_units ?? undefined,
    confidence: pick.confidence ?? undefined,
    source: pick.source as CanonicalPick['source'],
    approvalStatus: pick.approval_status as CanonicalPick['approvalStatus'],
    promotionStatus: pick.promotion_status as CanonicalPick['promotionStatus'],
    promotionTarget: (pick.promotion_target ?? undefined) as CanonicalPick['promotionTarget'],
    promotionScore: pick.promotion_score ?? undefined,
    promotionReason: pick.promotion_reason ?? undefined,
    promotionVersion: pick.promotion_version ?? undefined,
    promotionDecidedAt: pick.promotion_decided_at ?? undefined,
    promotionDecidedBy: pick.promotion_decided_by ?? undefined,
    lifecycleState: pick.status as PickLifecycleState,
    metadata: isRecord(pick.metadata) ? pick.metadata : {},
    createdAt: pick.created_at,
  };
}

function hasRequiredFields(pick: CanonicalPick) {
  return Boolean(pick.market && pick.selection && pick.source);
}

async function readPromotionScoreInputs(
  pick: CanonicalPick,
  openPicks?: readonly CanonicalPick[],
  repositories?: {
    settlements: SettlementRepository;
    picks: PickRepository;
  },
) {
  const configured = readNestedRecord(pick.metadata, 'promotionScores');
  const confidenceScore = normalizeConfidenceForScoring(pick.confidence);

  // Edge fallback priority: explicit promotionScores.edge > domain analysis edge > confidence
  const domainEdgeScore = readDomainAnalysisEdgeScore(pick.metadata);
  const edgeFallback = domainEdgeScore ?? confidenceScore;

  // Track the source of the edge score for the decision snapshot
  const edgeIsExplicit = typeof configured?.['edge'] === 'number';
  const edgeSource: EdgeSource = edgeIsExplicit
    ? 'explicit'
    : domainEdgeScore !== null
      ? readDomainAnalysisEdgeSource(pick.metadata)
      : 'confidence-delta';

  // Trust fallback priority: explicit promotionScores.trust > domain trust signal > confidence
  const trustFallback = readDomainAnalysisTrustSignal(pick.metadata) ?? confidenceScore;

  // Readiness: uses Kelly fraction as gradient signal (higher Kelly = higher readiness)
  // Falls back to 60 (neutral) when no Kelly data available
  const readinessFallback = readKellyGradientReadiness(pick.metadata) ?? 60;

  let trust = readScore(configured, 'trust', trustFallback);

  // Apply CLV feedback adjustment to trust score when repositories are available
  if (repositories) {
    const capperIdentity = readMetadataString(pick.metadata, 'capper') || pick.source;
    const clvAdjustment = await computeClvTrustAdjustment(
      capperIdentity,
      repositories.settlements,
      repositories.picks,
    );
    if (clvAdjustment) {
      trust = Math.max(0, Math.min(100, trust + clvAdjustment.adjustment));
    }
  }

  let boardFit = readScore(configured, 'boardFit', 75);

  // Apply correlation penalty when open picks are available
  if (openPicks && openPicks.length > 0) {
    const correlationInfo = detectCorrelatedPicks(pick, openPicks);
    const penalty = computeCorrelationPenalty(correlationInfo);
    boardFit = Math.max(0, boardFit + penalty);
  }

  return {
    edge: readScore(configured, 'edge', edgeFallback),
    trust,
    readiness: readScore(configured, 'readiness', readinessFallback),
    // Uniqueness: no real signal wired yet — uses neutral default.
    // Weight should be minimal until a market saturation signal exists.
    uniqueness: readScore(configured, 'uniqueness', 50),
    boardFit,
    /** Source of the edge component — used in decision snapshot for auditability. */
    edgeSource,
  };
}

/**
 * Read edge score from domain analysis.
 *
 * Priority: real edge (vs Pinnacle/consensus) > confidence delta (vs submitted odds)
 *
 * Real edge (UTV2-198): model probability vs devigged market consensus.
 * Available when Pinnacle or multi-book data exists via The Odds API.
 *
 * Confidence delta (legacy): confidence - impliedProbability from submitted odds.
 * Used as fallback when no market data is available.
 *
 * Both are mapped to 0-100 score: clamp(50 + rawValue * 400, 0, 100)
 */
export function readDomainAnalysisEdgeScore(
  metadata: Record<string, unknown>,
): number | null {
  const domainAnalysis = metadata['domainAnalysis'];
  if (!isRecord(domainAnalysis)) {
    // Check if real edge is in top-level metadata (from submission enrichment)
    const topLevelRealEdge = metadata['realEdge'];
    if (typeof topLevelRealEdge === 'number' && Number.isFinite(topLevelRealEdge)) {
      return Math.max(0, Math.min(100, 50 + topLevelRealEdge * 400));
    }
    return null;
  }

  // Prefer real edge (vs Pinnacle/consensus) when available
  const realEdge = domainAnalysis['realEdge'];
  if (typeof realEdge === 'number' && Number.isFinite(realEdge)) {
    return Math.max(0, Math.min(100, 50 + realEdge * 400));
  }

  // Fall back to confidence delta
  const rawEdge = domainAnalysis['edge'];
  if (typeof rawEdge !== 'number' || !Number.isFinite(rawEdge)) {
    return null;
  }

  return Math.max(0, Math.min(100, 50 + rawEdge * 400));
}

/**
 * Determine the authoritative source of the edge score.
 *
 * Returns 'real-edge' when Pinnacle data drove the edge,
 * 'consensus-edge' for multi-book, 'sgo-edge' for SGO-only,
 * 'confidence-delta' when no market data was available.
 *
 * This is used to label the snapshot so operators can see whether
 * the edge score reflects a true market comparison or a self-reported
 * confidence assertion.
 */
export function readDomainAnalysisEdgeSource(
  metadata: Record<string, unknown>,
): EdgeSource {
  const domainAnalysis = metadata['domainAnalysis'];

  // Check inside domainAnalysis first (set at submission enrichment time)
  if (isRecord(domainAnalysis)) {
    if (typeof domainAnalysis['realEdge'] === 'number' && Number.isFinite(domainAnalysis['realEdge'])) {
      return mapRealEdgeSource(domainAnalysis['realEdgeSource']);
    }
  }

  // Check top-level metadata (also set at submission enrichment time)
  if (typeof metadata['realEdge'] === 'number' && Number.isFinite(metadata['realEdge'])) {
    return mapRealEdgeSource(metadata['realEdgeSource']);
  }

  return 'confidence-delta';
}

function mapRealEdgeSource(source: unknown): EdgeSource {
  if (source === 'pinnacle') return 'real-edge';
  if (source === 'consensus') return 'consensus-edge';
  if (source === 'sgo') return 'sgo-edge';
  return 'confidence-delta';
}

/**
 * Derive a trust signal from domain analysis confidence delta.
 *
 * Uses the confidence delta (confidence - implied probability from submitted odds).
 * This is a confidence assertion, NOT real market edge. A positive delta means
 * the submitter's confidence exceeds the implied probability of their own odds.
 *
 * Binary output: ≥5% delta → 80, >0% delta → 65, else null.
 * Returns null if domain analysis is absent or delta is not positive.
 */
export function readDomainAnalysisTrustSignal(
  metadata: Record<string, unknown>,
): number | null {
  const domainAnalysis = metadata['domainAnalysis'];
  if (!isRecord(domainAnalysis)) {
    return null;
  }

  if (domainAnalysis['hasPositiveEdge'] !== true) {
    return null;
  }

  // Prefer `confidenceDelta` (canonical name); fall back to `edge` for existing DB records
  const delta = domainAnalysis['confidenceDelta'] ?? domainAnalysis['edge'];
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    return null;
  }

  return delta >= 0.05 ? 80 : 65;
}

/**
 * Derive a readiness signal from domain analysis Kelly fraction.
 *
 * When domain analysis computed a positive Kelly fraction, the pick has been
 * mathematically assessed for position sizing — a stronger readiness signal
 * than the default.
 *
 * Returns null if domain analysis is absent or Kelly was not computed (falls
 * through to default 80).
 */
/**
 * Readiness signal from Kelly fraction as gradient (0-95 range).
 * Kelly 0.01→45, 0.05→51, 0.10→62, 0.25+→95
 */
export function readKellyGradientReadiness(
  metadata: Record<string, unknown>,
): number | null {
  const kellySizing = metadata['kellySizing'];
  if (isRecord(kellySizing)) {
    const fraction = kellySizing['kellyFraction'];
    if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0) {
      return Math.round(40 + 55 * Math.min(1, fraction / 0.25));
    }
  }
  const domainAnalysis = metadata['domainAnalysis'];
  if (isRecord(domainAnalysis)) {
    const fraction = domainAnalysis['kellyFraction'];
    if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0) {
      return Math.round(40 + 55 * Math.min(1, fraction / 0.25));
    }
  }
  return null;
}

/** @deprecated Use readKellyGradientReadiness */
export function readDomainAnalysisReadinessSignal(
  metadata: Record<string, unknown>,
): number | null {
  return readKellyGradientReadiness(metadata);
}

function readScore(
  input: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
) {
  const candidate = input?.[key];
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }

  return fallback;
}

function normalizeConfidenceForScoring(confidence: number | undefined) {
  if (confidence === undefined || Number.isNaN(confidence)) {
    return 50;
  }

  if (confidence <= 1) {
    return confidence * 100;
  }

  return confidence;
}

function mapOverrideState(
  override:
    | {
        action: PromotionOverrideAction;
      reason: string;
      }
    | undefined,
) {
  if (!override) {
    return undefined;
  }

  if (override.action === 'force_promote') {
    return {
      forcePromote: true,
      reason: override.reason,
    };
  }

  return {
    suppress: true,
    reason: override.reason,
  };
}

function toSnapshotOverride(
  override: BoardPromotionEvaluationInput['override'],
): PromotionDecisionSnapshot['override'] {
  if (!override) {
    return undefined;
  }

  if (override.forcePromote) {
    return {
      forcePromote: true,
      ...(override.reason ? { reason: override.reason } : {}),
    };
  }

  if (override.suppress) {
    return {
      suppress: true,
      ...(override.reason ? { reason: override.reason } : {}),
    };
  }

  return override.reason ? { reason: override.reason } : undefined;
}

function summarizePromotionReason(decision: BoardPromotionDecision) {
  if (decision.explanation.suppressionReasons.length > 0) {
    return decision.explanation.suppressionReasons.join(' | ');
  }

  if (decision.explanation.reasons.length > 0) {
    return decision.explanation.reasons.join(' | ');
  }

  return `promotion status ${decision.status}`;
}

function mapAuditAction(
  decision: BoardPromotionDecision,
  override:
    | {
        action: PromotionOverrideAction;
        reason: string;
      }
    | undefined,
) {
  if (override?.action === 'force_promote') {
    return 'promotion.force_promote';
  }

  if (override?.action === 'suppress' || override?.action === 'suppress_from_best_bets') {
    return 'promotion.suppress';
  }

  return decision.qualified ? 'promotion.qualified' : 'promotion.suppressed';
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function readNestedRecord(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvePromotionPolicyForTarget(target: PromotionTarget): PromotionPolicy {
  return activeScoringProfile.policies[target];
}

// ---------------------------------------------------------------------------
// Exposure gate (UTV2-179)
// ---------------------------------------------------------------------------

type ExposureGateRejectionReason = 'exposure-game-limit' | 'exposure-daily-limit';

export function checkExposureGate(
  pick: CanonicalPick,
  openPicks: readonly CanonicalPick[],
  config: ExposureGateConfig,
): ExposureGateRejectionReason | null {
  const submitter = readMetadataString(pick.metadata, 'capper') || pick.source;
  const pickEventName = readMetadataString(pick.metadata, 'eventName');

  if (pickEventName) {
    const sameGameCount = openPicks.filter((op) => {
      if (op.id === pick.id) return false;
      const opCapper = readMetadataString(op.metadata, 'capper') || op.source;
      if (opCapper !== submitter) return false;
      return readMetadataString(op.metadata, 'eventName') === pickEventName;
    }).length;
    if (sameGameCount >= config.maxPicksPerGame) {
      return 'exposure-game-limit';
    }
  }

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const sameDayCount = openPicks.filter((op) => {
    if (op.id === pick.id) return false;
    const opCapper = readMetadataString(op.metadata, 'capper') || op.source;
    if (opCapper !== submitter) return false;
    return op.createdAt.slice(0, 10) === todayPrefix;
  }).length;
  if (sameDayCount >= config.maxPicksPerDay) {
    return 'exposure-daily-limit';
  }

  return null;
}

async function buildExposureSuppressedResult(
  canonicalPick: CanonicalPick,
  pickRecord: PickRecord,
  reason: ExposureGateRejectionReason,
  actor: string,
  pickRepository: PickRepository,
  auditLogRepository: AuditLogRepository,
): Promise<EagerPromotionAllPoliciesResult> {
  const decidedAt = new Date().toISOString();
  const policies = activePromotionPolicies();

  const makeSuppressedDecision = (policy: PromotionPolicy): BoardPromotionDecision => ({
    status: 'suppressed',
    target: policy.target,
    qualified: false,
    score: 0,
    breakdown: { edge: 0, trust: 0, readiness: 0, uniqueness: 0, boardFit: 0, total: 0 },
    explanation: {
      target: policy.target,
      reasons: [],
      suppressionReasons: [reason],
      weights: policy.weights,
    },
    version: policy.version,
    decidedAt,
    decidedBy: actor,
  });

  const decisions = policies.map(makeSuppressedDecision);
  const decisionByTarget = new Map(
    policies.map((policy, index) => [policy.target, decisions[index]!] as const),
  );

  const winnerPolicy = policies[policies.length - 1]!;
  const winnerDecision = decisions[decisions.length - 1]!;

  const persisted = await pickRepository.persistPromotionDecision({
    pickId: canonicalPick.id,
    target: winnerPolicy.target,
    approvalStatus: canonicalPick.approvalStatus,
    promotionStatus: 'suppressed',
    promotionTarget: null,
    promotionScore: 0,
    promotionReason: reason,
    promotionVersion: winnerDecision.version,
    promotionDecidedAt: decidedAt,
    promotionDecidedBy: actor,
    overrideAction: null,
    payload: { exposureGateRejection: reason },
  });

  await auditLogRepository.record({
    entityType: 'pick_promotion_history',
    entityId: persisted.history.id,
    entityRef: canonicalPick.id,
    action: 'promotion.suppressed',
    actor,
    payload: {
      pickId: canonicalPick.id,
      target: winnerPolicy.target,
      status: 'suppressed',
      score: 0,
      resolvedTarget: null,
      exposureGateRejection: reason,
    },
  });

  for (let index = 0; index < policies.length - 1; index += 1) {
    const policy = policies[index]!;
    const decision = decisions[index]!;
    const history = await pickRepository.insertPromotionHistoryRow({
      pickId: canonicalPick.id,
      target: policy.target,
      promotionStatus: 'suppressed',
      promotionScore: 0,
      promotionReason: reason,
      promotionVersion: decision.version,
      promotionDecidedAt: decidedAt,
      promotionDecidedBy: decision.decidedBy,
      overrideAction: null,
      payload: { exposureGateRejection: reason },
    });

    await auditLogRepository.record({
      entityType: 'pick_promotion_history',
      entityId: history.id,
      entityRef: canonicalPick.id,
      action: 'promotion.suppressed',
      actor,
      payload: {
        pickId: canonicalPick.id,
        target: policy.target,
        status: 'suppressed',
        score: 0,
        resolvedTarget: null,
        exposureGateRejection: reason,
      },
    });
  }

  return {
    pick: mapPickRecordToCanonicalPick(persisted.pick),
    pickRecord: persisted.pick,
    resolvedTarget: null,
    exclusiveInsightsDecision: decisionByTarget.get('exclusive-insights')!,
    traderInsightsDecision: decisionByTarget.get('trader-insights')!,
    bestBetsDecision: decisionByTarget.get('best-bets')!,
  };
}
