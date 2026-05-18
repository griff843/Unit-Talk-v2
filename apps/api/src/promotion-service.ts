import {
  type BoardPromotionDecision,
  type BoardPromotionEvaluationInput,
  type CanonicalPick,
  type EdgeSource,
  type EdgeFallbackReason,
  type EdgeMethod,
  type EdgeSourceQuality,
  type ProviderCoverageState,
  type PickLifecycleState,
  type PromotionDecisionSnapshot,
  type PromotionPolicy,
  type PromotionOverrideAction,
  type PromotionTarget,
  resolveScoringProfile,
  type ExposureGateConfig,
  resolveExposureGateConfig,
} from '@unit-talk/contracts';
import {
  applyBandDowngrades,
  computeBoardFitScore,
  computeUniquenessWithMeta,
  evaluatePromotionEligibility,
  generatePickNarrative,
  initialBandAssignment,
} from '@unit-talk/domain';
import type { BandInput, PortfolioSlot } from '@unit-talk/domain';
import type {
  AuditLogRecord,
  AuditLogRepository,
  IMarketUniverseRepository,
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
  marketUniverseRepository?: IMarketUniverseRepository,
): Promise<EagerPromotionAllPoliciesResult> {
  const pickRecord = await pickRepository.findPickById(pickId);
  if (!pickRecord) {
    throw new Error(`Cannot evaluate promotion for unknown pick: ${pickId}`);
  }

  const canonicalPick = mapPickRecordToCanonicalPick(pickRecord);

  // UTV2-775: Staleness gate — block promotion when universe data is stale at approval time.
  // Contract: §10 of T2_STALE_DATA_BEHAVIOR_CONTRACT.md
  // Re-fetch market_universe for the pick's universe. If stale: block and write to audit_log.
  if (marketUniverseRepository) {
    const universeId = readMetadataString(canonicalPick.metadata, 'marketUniverseId')
      ?? readMetadataString(canonicalPick.metadata, 'universeId');
    if (universeId) {
      const universeRows = await marketUniverseRepository.findByIds([universeId]);
      const universe = universeRows[0];
      if (universe?.is_stale === true) {
        // Block promotion — write to audit_log
        await auditLogRepository.record({
          entityType: 'pick_promotion_history',
          entityId: pickId,
          entityRef: pickId,
          action: 'promotion_blocked_stale_data',
          actor,
          payload: {
            pickId,
            universeId,
            code: 'STALE_DATA_AT_PROMOTION',
            blockedAt: new Date().toISOString(),
          },
        });

        // Persist suppressed promotion result
        const policies = activePromotionPolicies();
        const decidedAt = new Date().toISOString();
        const makeSuppressedDecision = (policy: PromotionPolicy): BoardPromotionDecision => ({
          status: 'suppressed',
          target: policy.target,
          qualified: false,
          score: 0,
          breakdown: { edge: 0, trust: 0, readiness: 0, uniqueness: 0, boardFit: 0, total: 0 },
          explanation: {
            target: policy.target,
            reasons: [],
            suppressionReasons: ['STALE_DATA_AT_PROMOTION'],
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

        const persisted = await pickRepository.persistPromotionDecision({
          pickId,
          target: winnerPolicy.target,
          approvalStatus: canonicalPick.approvalStatus,
          promotionStatus: 'suppressed',
          promotionTarget: null,
          promotionScore: 0,
          promotionReason: 'STALE_DATA_AT_PROMOTION',
          promotionVersion: winnerPolicy.version,
          promotionDecidedAt: decidedAt,
          promotionDecidedBy: actor,
          overrideAction: null,
          metadataPatch: { band: 'SUPPRESS' },
          payload: { staleDataBlock: true, code: 'STALE_DATA_AT_PROMOTION', universeId, band: 'SUPPRESS', qualified: false, score: 0 },
        });

        return {
          pick: mapPickRecordToCanonicalPick(persisted.pick),
          pickRecord: persisted.pick,
          resolvedTarget: null,
          exclusiveInsightsDecision: decisionByTarget.get('exclusive-insights')!,
          traderInsightsDecision: decisionByTarget.get('trader-insights')!,
          bestBetsDecision: decisionByTarget.get('best-bets')!,
        };
      }
    }
  }

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
  const winnerBand = computeDeterministicBand(canonicalPick, scoreInputs, winnerDecision);

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
      edgeSourceQuality: scoreInputs.edgeSourceQuality,
      ...(scoreInputs.edgeFallbackReason
        ? { edgeFallbackReason: scoreInputs.edgeFallbackReason }
        : {}),
      edgeMethod: scoreInputs.edgeMethod,
      providerCoverageState: scoreInputs.providerCoverageState,
      ...(scoreInputs.uniquenessFallbackReason
        ? { uniquenessFallbackReason: scoreInputs.uniquenessFallbackReason }
        : {}),
      ...(scoreInputs.uniquenessInputs
        ? { uniquenessInputs: scoreInputs.uniquenessInputs }
        : {}),
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
    metadataPatch: { band: winnerBand },
    payload: {
      band: winnerBand,
      ...winnerSnapshot,
      explanation: winnerDecision.explanation,
      qualified: winnerDecision.qualified,
      score: winnerDecision.score,
      breakdown: winnerDecision.breakdown,
      policy: winnerPolicy,
      narrative: generatePickNarrative({
        qualified: winnerDecision.qualified,
        target: winnerDecision.target,
        score: winnerDecision.score,
        breakdown: winnerDecision.breakdown,
        edgeSourceQuality: scoreInputs.edgeSourceQuality,
        edgeSource: scoreInputs.edgeSource,
        market: canonicalPick.market ?? undefined,
        sport: readMetadataString(canonicalPick.metadata, 'sport') ?? undefined,
        suppressionReasons: winnerDecision.explanation.suppressionReasons,
        minimumScore: winnerPolicy.minimumScore,
      }),
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
      const historyBand = computeDeterministicBand(canonicalPick, scoreInputs, decision);
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
          band: historyBand,
          ...nonWinnerSnapshot,
          explanation: decision.explanation,
          qualified: decision.qualified,
          score: decision.score,
          breakdown: decision.breakdown,
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
      edgeSourceQuality: scoreInputs.edgeSourceQuality,
      ...(scoreInputs.edgeFallbackReason
        ? { edgeFallbackReason: scoreInputs.edgeFallbackReason }
        : {}),
      edgeMethod: scoreInputs.edgeMethod,
      providerCoverageState: scoreInputs.providerCoverageState,
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
  const winnerBand = computeDeterministicBand(canonicalPick, scoreInputs, winnerDecision);
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
    metadataPatch: { band: winnerBand },
    payload: {
      band: winnerBand,
      ...winnerSnapshot,
      explanation: winnerDecision.explanation,
      qualified: winnerDecision.qualified,
      score: winnerDecision.score,
      breakdown: winnerDecision.breakdown,
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

  try {
    for (let index = 0; index < policies.length; index += 1) {
      if (index === bestBetsIndex) {
        continue;
      }

      const policy = policies[index]!;
      const decision = decisions[index]!;
      const boardState = boardStates[index]!;
      const historyBand = computeDeterministicBand(canonicalPick, scoreInputs, decision);
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
          band: historyBand,
          ...makeSnapshot(policy, boardState, {
            suppress: true,
            reason: 'smart-form submissions route directly to best-bets',
          }),
          explanation: decision.explanation,
          qualified: decision.qualified,
          score: decision.score,
          breakdown: decision.breakdown,
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
  } catch (historyError: unknown) {
    console.error(JSON.stringify({
      service: 'promotion-service',
      event: 'promotion.history_insert_failed',
      pickId: canonicalPick.id,
      resolvedTarget: 'best-bets',
      error: historyError instanceof Error ? historyError.message : String(historyError),
      action: 'executing compensating rollback',
    }));

    try {
      await pickRepository.persistPromotionDecision({
        pickId: canonicalPick.id,
        target: bestBetsPolicy.target,
        approvalStatus: canonicalPick.approvalStatus,
        promotionStatus: 'suppressed',
        promotionTarget: null,
        promotionScore: 0,
        promotionReason: 'compensating-rollback: history insert failure',
        promotionVersion: winnerDecision.version,
        promotionDecidedAt: new Date().toISOString(),
        promotionDecidedBy: 'system:rollback',
        overrideAction: null,
        payload: { rollbackReason: 'non-winner history insert failed', originalTarget: 'best-bets' },
      });

      await auditLogRepository.record({
        entityType: 'pick_promotion_history',
        entityId: persisted.history.id,
        entityRef: canonicalPick.id,
        action: 'promotion.rollback',
        actor: 'system:rollback',
        payload: { pickId: canonicalPick.id, resolvedTarget: 'best-bets', reason: 'non-winner history insert failed after pick update' },
      });
    } catch (rollbackError: unknown) {
      console.error(JSON.stringify({
        service: 'promotion-service',
        event: 'promotion.rollback_failed',
        pickId: canonicalPick.id,
        resolvedTarget: 'best-bets',
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        impact: 'Pick may be in inconsistent state — promotion_target set but history incomplete',
      }));
    }

    throw historyError;
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
  const band = computeDeterministicBand(canonicalPick, scoreInputs, decision);
  const snapshot: PromotionDecisionSnapshot = {
    band,
    scoringProfile: activeScoringProfile.name,
    policyVersion: policy.version,
    scoreInputs: {
      edge: scoreInputs.edge,
      trust: scoreInputs.trust,
      readiness: scoreInputs.readiness,
      uniqueness: scoreInputs.uniqueness,
      boardFit: scoreInputs.boardFit,
      edgeSource: scoreInputs.edgeSource,
      edgeSourceQuality: scoreInputs.edgeSourceQuality,
      ...(scoreInputs.edgeFallbackReason
        ? { edgeFallbackReason: scoreInputs.edgeFallbackReason }
        : {}),
      edgeMethod: scoreInputs.edgeMethod,
      providerCoverageState: scoreInputs.providerCoverageState,
      ...(scoreInputs.uniquenessFallbackReason
        ? { uniquenessFallbackReason: scoreInputs.uniquenessFallbackReason }
        : {}),
      ...(scoreInputs.uniquenessInputs
        ? { uniquenessInputs: scoreInputs.uniquenessInputs }
        : {}),
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
    metadataPatch: { band },
    payload: {
      ...snapshot,
      explanation: decision.explanation,
      qualified: decision.qualified,
      score: decision.score,
      breakdown: decision.breakdown,
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

function computeDeterministicBand(
  pick: CanonicalPick,
  scoreInputs: Awaited<ReturnType<typeof readPromotionScoreInputs>>,
  decision: BoardPromotionDecision,
): string {
  if (!decision.qualified) {
    return 'SUPPRESS';
  }

  const bandInput = buildBandInput(pick, scoreInputs, decision);
  const initial = initialBandAssignment(bandInput);
  const band = applyBandDowngrades(bandInput, initial.band).finalBand;
  if (!band) {
    throw new Error(
      'Band computation returned empty for pick ' + pick.id + ' — this is a bug in band assignment logic.',
    );
  }
  return band;
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

  // Edge fallback priority: explicit promotionScores.edge > market-backed edge > 0.
  // UTV2-985 (PM requirement): confidence-delta must NOT contribute a positive
  // edge score. Picks without market-backed data receive edge = 0 so they cannot
  // masquerade as edge-driven promotions. Use readMarketBackedEdgeScore() here.
  const marketBackedEdgeScore = readMarketBackedEdgeScore(pick.metadata);

  // Track the source of the edge score for the decision snapshot
  const edgeIsExplicit = typeof configured?.['edge'] === 'number';
  const edgeSource: EdgeSource = edgeIsExplicit
    ? 'explicit'
    : marketBackedEdgeScore !== null
      ? readDomainAnalysisEdgeSource(pick.metadata)
      : 'confidence-delta';
  const edgeSourceQuality = resolveEdgeSourceQuality(edgeSource);

  // PM UTV2-985: granular fallback reason from persisted edgeProvenance when available,
  // otherwise use the legacy summary label.
  const edgeProvenance = pick.metadata['edgeProvenance'];
  const persistedFallbackReason =
    isRecord(edgeProvenance) && typeof edgeProvenance['fallbackReason'] === 'string'
      ? (edgeProvenance['fallbackReason'] as EdgeFallbackReason)
      : undefined;
  const edgeFallbackReason: EdgeFallbackReason | undefined =
    edgeSourceQuality === 'confidence-fallback'
      ? (persistedFallbackReason ?? 'missing-explicit-edge-and-market-edge')
      : undefined;

  // Derive edgeMethod and providerCoverageState for explicit snapshot provenance.
  const edgeMethod: EdgeMethod = edgeIsExplicit ? 'market-devigged' : (
    edgeSourceQuality === 'confidence-fallback' ? 'confidence-delta' : 'market-devigged'
  );
  const providerCoverageState: ProviderCoverageState =
    isRecord(edgeProvenance) && typeof edgeProvenance['providerCoverageState'] === 'string'
      ? (edgeProvenance['providerCoverageState'] as ProviderCoverageState)
      : edgeSourceQuality === 'confidence-fallback' ? 'none'
      : (edgeSource === 'real-edge' ? 'pinnacle'
        : edgeSource === 'consensus-edge' ? 'consensus'
        : edgeSource === 'sgo-edge' ? 'sgo'
        : edgeSource === 'single-book-edge' ? 'single-book' : 'none');

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

  const explicitBoardFit =
    typeof configured?.['boardFit'] === 'number' && Number.isFinite(configured['boardFit'] as number)
      ? (configured['boardFit'] as number)
      : null;

  let boardFit: number;
  if (explicitBoardFit !== null) {
    // Operator-provided explicit override takes precedence over live computation
    boardFit = explicitBoardFit;
  } else if (openPicks && openPicks.length > 0) {
    // Compute from live portfolio state: concentration + correlation penalties.
    // Exclude self: the pick being evaluated is already in validated state in the
    // open picks list (saved before promotion runs). Without this filter, the pick
    // would be counted twice in the board (once in board[], once as candidate).
    const board = openPicks.filter(p => p.id !== pick.id).map(pickToPortfolioSlot);
    const candidate = pickToPortfolioSlot(pick);
    boardFit = computeBoardFitScore(board, candidate).score;
  } else {
    // No board data available — neutral fallback
    boardFit = 75;
  }

  const explicitUniqueness =
    typeof configured?.['uniqueness'] === 'number' && Number.isFinite(configured['uniqueness'] as number)
      ? (configured['uniqueness'] as number)
      : null;

  // Compute selection overlap: count open picks targeting same player/participant.
  // Use first two tokens of selection string as rough participant identifier.
  const selectionPrefix = pick.selection.split(' ').slice(0, 2).join(' ').toLowerCase();
  const activeSelectionOverlapCount = openPicks?.filter(
    p => p.id !== pick.id && p.selection.toLowerCase().startsWith(selectionPrefix),
  ).length;

  const uniquenessResult = explicitUniqueness !== null
    ? { score: explicitUniqueness, fallbackReason: undefined, dimensions: null }
    : computeUniquenessWithMeta({
        activeSameSportMarketCount: openPicks?.filter(
          p => p.id !== pick.id && p.market === pick.market,
        ).length,
        activeSelectionOverlapCount,
      });
  const uniqueness = uniquenessResult.score;

  // PM UTV2-985: explicit score — market-backed edge OR 0 (fail-closed).
  // When edgeIsExplicit, operator-provided value takes precedence (trust the operator).
  // When market data exists, use the devigged edge score.
  // When only confidence-delta is available, edge contribution is 0 — no inflation.
  const edgeContribution: number = edgeIsExplicit
    ? readScore(configured, 'edge', 0)
    : marketBackedEdgeScore ?? 0;

  return {
    edge: edgeContribution,
    trust,
    readiness: readScore(configured, 'readiness', readinessFallback),
    uniqueness,
    boardFit,
    /** Source of the edge component — used in decision snapshot for auditability. */
    edgeSource,
    /** Coarse bucket for measuring market-backed vs confidence-fallback routing. */
    edgeSourceQuality,
    ...(edgeFallbackReason ? { edgeFallbackReason } : {}),
    /** How the edge was computed (market-devigged or confidence-delta). UTV2-985. */
    edgeMethod,
    /** Which provider tier supplied market data, or 'none'. UTV2-985. */
    providerCoverageState,
    /** Explicit reason when uniqueness returned fallback value. UTV2-987. */
    ...(uniquenessResult.fallbackReason ? { uniquenessFallbackReason: uniquenessResult.fallbackReason } : {}),
    /** Dimensions used to compute uniqueness when data was available. UTV2-987. */
    ...(uniquenessResult.dimensions ? { uniquenessInputs: uniquenessResult.dimensions } : {}),
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
 *
 * NOTE: Do NOT use this function for promotion eligibility decisions (UTV2-985).
 * Use readMarketBackedEdgeScore() instead — confidence-delta must not inflate
 * promotion scores. This function is kept for band assignment and diagnostics.
 */
export function readDomainAnalysisEdgeScore(
  metadata: Record<string, unknown>,
): number | null {
  const domainAnalysis = metadata['domainAnalysis'];
  const topLevelMarketEdge = readTopLevelMarketBackedRealEdge(metadata);
  if (!isRecord(domainAnalysis)) {
    if (topLevelMarketEdge !== null) {
      return scoreRawEdge(topLevelMarketEdge);
    }
    return null;
  }

  // Prefer real edge (vs Pinnacle/consensus) when available
  const realEdge = domainAnalysis['realEdge'];
  if (typeof realEdge === 'number' && Number.isFinite(realEdge)) {
    return scoreRawEdge(realEdge);
  }

  if (topLevelMarketEdge !== null) {
    return scoreRawEdge(topLevelMarketEdge);
  }

  // Fall back to confidence delta
  const rawEdge = domainAnalysis['edge'];
  if (typeof rawEdge !== 'number' || !Number.isFinite(rawEdge)) {
    return null;
  }

  return scoreRawEdge(rawEdge);
}

/**
 * Read edge score from market-backed data ONLY.
 *
 * Returns null when no devigged market offer was found (confidence-delta fallback).
 * Used for promotion eligibility decisions (UTV2-985): confidence-delta must not
 * contribute a positive edge score — picks without market data receive edge = 0.
 *
 * This enforces the PM fail-closed requirement: "prefer UNPROVEN / insufficient
 * market edge evidence over synthetic confidence inflation."
 */
export function readMarketBackedEdgeScore(
  metadata: Record<string, unknown>,
): number | null {
  const domainAnalysis = metadata['domainAnalysis'];
  const topLevelMarketEdge = readTopLevelMarketBackedRealEdge(metadata);

  if (isRecord(domainAnalysis)) {
    const realEdge = domainAnalysis['realEdge'];
    if (typeof realEdge === 'number' && Number.isFinite(realEdge)) {
      return scoreRawEdge(realEdge);
    }
  }

  if (topLevelMarketEdge !== null) {
    return scoreRawEdge(topLevelMarketEdge);
  }

  // No market-backed data available — return null (caller uses 0 as edge contribution).
  // Confidence-delta value in domainAnalysis.edge is intentionally excluded here.
  return null;
}

/**
 * Determine the authoritative source of the edge score.
 *
 * Returns 'real-edge' when Pinnacle data drove the edge,
 * 'consensus-edge' for multi-book, 'sgo-edge' for SGO-only,
 * 'single-book-edge' for one non-SGO book, 'confidence-delta' when no market data was available.
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
  if (source === 'single-book') return 'single-book-edge';
  return 'confidence-delta';
}

function resolveEdgeSourceQuality(edgeSource: EdgeSource): EdgeSourceQuality {
  if (edgeSource === 'confidence-delta') return 'confidence-fallback';
  if (edgeSource === 'explicit') return 'explicit';
  return 'market-backed';
}

function readTopLevelMarketBackedRealEdge(metadata: Record<string, unknown>): number | null {
  if (metadata['realEdgeSource'] === 'confidence-delta') {
    return null;
  }

  const topLevelRealEdge = metadata['realEdge'];
  if (typeof topLevelRealEdge === 'number' && Number.isFinite(topLevelRealEdge)) {
    return topLevelRealEdge;
  }

  return null;
}

function scoreRawEdge(rawEdge: number): number {
  return Math.max(0, Math.min(100, 50 + rawEdge * 400));
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
    const fraction = kellySizing['fractional_kelly'];
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

/**
 * Map a CanonicalPick to a PortfolioSlot for board-fit computation.
 *
 * Extracts sport, market family, participant, team, and sizing signals from
 * pick fields and metadata. Fields not present in metadata default to safe
 * neutral values — the concentration/correlation engine handles missing data
 * gracefully (null participantId → no player concentration penalty, etc.).
 */
function pickToPortfolioSlot(pick: CanonicalPick): PortfolioSlot {
  const market = pick.market.toLowerCase();
  let marketFamily: PortfolioSlot['marketFamily'] = 'unknown';
  if (market.startsWith('player_') || market.startsWith('player-') || market.includes('player')) {
    marketFamily = 'player-prop';
  } else if (market.startsWith('team_') || market.startsWith('team-')) {
    marketFamily = 'team-prop';
  } else if (
    market.includes('spread') ||
    market.includes('moneyline') ||
    market.includes('total') ||
    market.includes('game_line') ||
    market.includes('game-line')
  ) {
    marketFamily = 'game-line';
  }

  const domainEdge = readDomainAnalysisEdgeScore(pick.metadata);
  const edge = domainEdge !== null ? domainEdge / 100 : 0;
  const stake = typeof pick.stakeUnits === 'number' ? Math.min(1, pick.stakeUnits / 10) : 0.1;
  const modelProbability =
    typeof pick.confidence === 'number'
      ? Math.min(1, Math.max(0, pick.confidence / 100))
      : 0.5;

  return {
    pickId: pick.id,
    sport: readMetadataString(pick.metadata, 'sport') ?? 'unknown',
    marketFamily,
    participantId:
      readMetadataString(pick.metadata, 'playerId') ??
      readMetadataString(pick.metadata, 'participantId') ??
      null,
    teamId:
      readMetadataString(pick.metadata, 'teamId') ??
      readMetadataString(pick.metadata, 'team') ??
      null,
    modelProbability,
    edge,
    stake,
  };
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

function readMetadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readNestedRecord(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildBandInput(
  pick: CanonicalPick,
  scoreInputs: Awaited<ReturnType<typeof readPromotionScoreInputs>>,
  decision: BoardPromotionDecision,
): BandInput {
  const domainAnalysis = readNestedRecord(pick.metadata, 'domainAnalysis') ?? {};
  const liquidityTier = readMetadataString(pick.metadata, 'liquidityTier')
    ?? readMetadataString(domainAnalysis, 'liquidityTier')
    ?? 'unknown';
  const riskDecision = readMetadataString(pick.metadata, 'riskDecision')
    ?? readMetadataString(domainAnalysis, 'riskDecision');
  const riskThrottleReasonCodes = pick.metadata['riskThrottleReasonCodes']
    ?? domainAnalysis['riskThrottleReasonCodes'];
  const normalizedLiquidityTier =
    liquidityTier === 'high' || liquidityTier === 'medium' || liquidityTier === 'low' || liquidityTier === 'unknown'
      ? liquidityTier
      : 'unknown';
  const normalizedRiskDecision =
    riskDecision === 'allow' || riskDecision === 'reduce' || riskDecision === 'reject'
      ? riskDecision
      : undefined;
  const normalizedReasonCodes =
    Array.isArray(riskThrottleReasonCodes) && riskThrottleReasonCodes.every((entry) => typeof entry === 'string')
      ? riskThrottleReasonCodes
      : undefined;

  return {
    edge: normalizeBandEdge(scoreInputs.edge),
    uncertainty: readMetadataNumber(pick.metadata, 'uncertainty')
      ?? readMetadataNumber(domainAnalysis, 'uncertainty')
      ?? Math.max(0, Math.min(1, 1 - (pick.confidence ?? 0.75))),
    clvForecast: readMetadataNumber(pick.metadata, 'clvForecast')
      ?? readMetadataNumber(domainAnalysis, 'clvForecast')
      ?? 0,
    liquidityTier: normalizedLiquidityTier,
    marketResistance: readMetadataNumber(pick.metadata, 'marketResistance')
      ?? readMetadataNumber(domainAnalysis, 'marketResistance')
      ?? null,
    selectionDecision: decision.qualified ? 'select' : 'hold',
    selectionScore: decision.score,
    ...(normalizedRiskDecision ? { riskDecision: normalizedRiskDecision } : {}),
    ...(normalizedReasonCodes ? { riskThrottleReasonCodes: normalizedReasonCodes } : {}),
  };
}

function normalizeBandEdge(score: number) {
  return Math.max(-1, Math.min(1, (score - 50) / 100));
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
    payload: { exposureGateRejection: reason, qualified: false, score: 0 },
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
      payload: { exposureGateRejection: reason, qualified: false, score: 0 },
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
