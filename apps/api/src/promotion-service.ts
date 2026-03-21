import {
  type BoardPromotionDecision,
  type BoardPromotionEvaluationInput,
  type CanonicalPick,
  type PickLifecycleState,
  type PromotionPolicy,
  type PromotionOverrideAction,
  type PromotionTarget,
} from '@unit-talk/contracts';
import {
  bestBetsPromotionPolicy,
  evaluatePromotionEligibility,
  traderInsightsPromotionPolicy,
} from '@unit-talk/domain';
import type {
  AuditLogRecord,
  AuditLogRepository,
  PickRecord,
  PickRepository,
  PromotionHistoryRecord,
} from '@unit-talk/db';

export interface PromotionEvaluationResult {
  pick: CanonicalPick;
  pickRecord: PickRecord;
  history: PromotionHistoryRecord;
  audit: AuditLogRecord;
  decision: BoardPromotionDecision;
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
    bestBetsPromotionPolicy,
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
  return [bestBetsPromotionPolicy, traderInsightsPromotionPolicy] as const;
}

export interface EagerPromotionAllPoliciesResult {
  pick: CanonicalPick;
  pickRecord: PickRecord;
  resolvedTarget: PromotionTarget | null;
  traderInsightsDecision: BoardPromotionDecision;
  bestBetsDecision: BoardPromotionDecision;
}

/**
 * Eagerly evaluates all active promotion policies in priority order (trader-insights first,
 * then best-bets). Both `pick_promotion_history` rows are written regardless of outcome.
 * `picks.promotion_target` is set to the highest-priority qualified target, or null if
 * neither policy qualifies.
 *
 * Priority order: trader-insights > best-bets.
 * A pick that qualifies for both routes exclusively to trader-insights.
 */
export async function evaluateAllPoliciesEagerAndPersist(
  pickId: string,
  actor: string,
  pickRepository: PickRepository,
  auditLogRepository: AuditLogRepository,
): Promise<EagerPromotionAllPoliciesResult> {
  const pickRecord = await pickRepository.findPickById(pickId);
  if (!pickRecord) {
    throw new Error(`Cannot evaluate promotion for unknown pick: ${pickId}`);
  }

  const canonicalPick = mapPickRecordToCanonicalPick(pickRecord);

  // Get board states for both targets in parallel (each target has its own board).
  const [tiBoardState, bbBoardState] = await Promise.all([
    pickRepository.getPromotionBoardState({
      target: 'trader-insights',
      sport: readMetadataString(canonicalPick.metadata, 'sport'),
      eventName: readMetadataString(canonicalPick.metadata, 'eventName'),
      market: canonicalPick.market,
      selection: canonicalPick.selection,
    }),
    pickRepository.getPromotionBoardState({
      target: 'best-bets',
      sport: readMetadataString(canonicalPick.metadata, 'sport'),
      eventName: readMetadataString(canonicalPick.metadata, 'eventName'),
      market: canonicalPick.market,
      selection: canonicalPick.selection,
    }),
  ]);

  const scoreInputs = readPromotionScoreInputs(canonicalPick);
  const decidedAt = new Date().toISOString();

  const makeInput = (
    policy: PromotionPolicy,
    boardState: typeof tiBoardState,
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
    confidenceFloor: policy.confidenceFloor,
    boardCaps: policy.boardCaps,
    boardState,
    override: undefined,
    decidedAt,
    decidedBy: actor,
    version: policy.version,
  });

  const tiDecision = evaluatePromotionEligibility(
    makeInput(traderInsightsPromotionPolicy, tiBoardState),
    traderInsightsPromotionPolicy,
  );
  const bbDecision = evaluatePromotionEligibility(
    makeInput(bestBetsPromotionPolicy, bbBoardState),
    bestBetsPromotionPolicy,
  );

  // Priority order: trader-insights first.
  // A dual-qualifying pick routes exclusively to trader-insights.
  const resolvedTarget: PromotionTarget | null = tiDecision.qualified
    ? 'trader-insights'
    : bbDecision.qualified
      ? 'best-bets'
      : null;

  // The "primary" result (winner or best-bets when neither qualifies) is persisted on the
  // picks row via persistPromotionDecision. The other policy's result is recorded as a
  // history-only row that does not update picks.promotion_target.
  //
  // Convention: if ti wins → persist ti on picks, bb goes to history-only.
  //             otherwise  → persist bb on picks, ti goes to history-only.
  const [winnerPolicy, winnerDecision, loserPolicy, loserDecision] =
    tiDecision.qualified
      ? ([traderInsightsPromotionPolicy, tiDecision, bestBetsPromotionPolicy, bbDecision] as const)
      : ([bestBetsPromotionPolicy, bbDecision, traderInsightsPromotionPolicy, tiDecision] as const);

  const winnerReason = summarizePromotionReason(winnerDecision);
  const loserReason = summarizePromotionReason(loserDecision);

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
      boardState: tiDecision.qualified ? tiBoardState : bbBoardState,
      scoreInputs,
      policy: winnerPolicy,
      explanation: winnerDecision.explanation,
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

  // Insert loser's history row only (does not touch picks).
  const loserHistory = await pickRepository.insertPromotionHistoryRow({
    pickId,
    target: loserPolicy.target,
    promotionStatus: loserDecision.status,
    promotionScore: loserDecision.score,
    promotionReason: loserReason,
    promotionVersion: loserDecision.version,
    promotionDecidedAt: loserDecision.decidedAt,
    promotionDecidedBy: loserDecision.decidedBy,
    overrideAction: null,
    payload: {
      boardState: tiDecision.qualified ? bbBoardState : tiBoardState,
      scoreInputs,
      policy: loserPolicy,
      explanation: loserDecision.explanation,
    },
  });

  await auditLogRepository.record({
    entityType: 'pick_promotion_history',
    entityId: loserHistory.id,
    entityRef: pickId,
    action: loserDecision.qualified ? 'promotion.qualified' : 'promotion.suppressed',
    actor,
    payload: {
      pickId,
      target: loserPolicy.target,
      status: loserDecision.status,
      score: loserDecision.score,
      resolvedTarget,
    },
  });

  return {
    pick: mapPickRecordToCanonicalPick(persisted.pick),
    pickRecord: persisted.pick,
    resolvedTarget,
    traderInsightsDecision: tiDecision,
    bestBetsDecision: bbDecision,
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
  const scoreInputs = readPromotionScoreInputs(canonicalPick);
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
    confidenceFloor: policy.confidenceFloor,
    boardCaps: policy.boardCaps,
    boardState,
    override: mapOverrideState(override),
    decidedAt: new Date().toISOString(),
    decidedBy: actor,
    version: policy.version,
  }, policy);

  const reason = summarizePromotionReason(decision);
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
      boardState,
      scoreInputs,
      policy,
      explanation: decision.explanation,
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
    source: pick.source,
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

function readPromotionScoreInputs(pick: CanonicalPick) {
  const configured = readNestedRecord(pick.metadata, 'promotionScores');
  const confidenceScore = normalizeConfidenceForScoring(pick.confidence);

  // Edge fallback priority: explicit promotionScores.edge > domain analysis edge > confidence
  const edgeFallback = readDomainAnalysisEdgeScore(pick.metadata) ?? confidenceScore;

  return {
    edge: readScore(configured, 'edge', edgeFallback),
    trust: readScore(configured, 'trust', confidenceScore),
    readiness: readScore(configured, 'readiness', 80),
    uniqueness: readScore(configured, 'uniqueness', 80),
    boardFit: readScore(configured, 'boardFit', 75),
  };
}

/**
 * Convert domain analysis raw edge to a 0-100 promotion score.
 *
 * Raw edge is confidence - impliedProbability (typically -0.5 to +0.5).
 * Mapping: score = clamp(50 + rawEdge * 400, 0, 100)
 *
 * Examples: +0.10 → 90, +0.05 → 70, 0.00 → 50, -0.05 → 30, -0.10 → 10
 *
 * Returns null if domain analysis is absent or edge was not computed.
 */
export function readDomainAnalysisEdgeScore(
  metadata: Record<string, unknown>,
): number | null {
  const domainAnalysis = metadata['domainAnalysis'];
  if (!isRecord(domainAnalysis)) {
    return null;
  }

  const rawEdge = domainAnalysis['edge'];
  if (typeof rawEdge !== 'number' || !Number.isFinite(rawEdge)) {
    return null;
  }

  return Math.max(0, Math.min(100, 50 + rawEdge * 400));
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
  if (target === 'trader-insights') {
    return traderInsightsPromotionPolicy;
  }

  return bestBetsPromotionPolicy;
}
