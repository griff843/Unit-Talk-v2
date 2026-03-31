import {
  type BoardPromotionDecision,
  type BoardPromotionEvaluationInput,
  type CanonicalPick,
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
  const openPickRecords = await pickRepository.listByLifecycleState('validated', 100);
  const openPicks = openPickRecords.map(mapPickRecordToCanonicalPick);

  // Exposure gate — blocks before scoring if limits exceeded
  const exposureGateConfig = resolveExposureGateConfig();
  if (exposureGateConfig.enabled) {
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
    confidenceFloor: policy.confidenceFloor,
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

  return {
    pick: mapPickRecordToCanonicalPick(persisted.pick),
    pickRecord: persisted.pick,
    resolvedTarget,
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
  const openPickRecords = await pickRepository.listByLifecycleState('validated', 100);
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
    confidenceFloor: policy.confidenceFloor,
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
  const edgeFallback = readDomainAnalysisEdgeScore(pick.metadata) ?? confidenceScore;

  // Trust fallback priority: explicit promotionScores.trust > domain trust signal > confidence
  const trustFallback = readDomainAnalysisTrustSignal(pick.metadata) ?? confidenceScore;

  // Readiness fallback priority: explicit promotionScores.readiness > domain readiness signal > 80
  const readinessFallback = readDomainAnalysisReadinessSignal(pick.metadata) ?? 80;

  let trust = readScore(configured, 'trust', trustFallback);

  // Apply CLV feedback adjustment to trust score when repositories are available
  // Use metadata.capper (canonical capper identity), falling back to pick.source
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
    uniqueness: readScore(configured, 'uniqueness', 80),
    boardFit,
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

/**
 * Derive a trust signal from domain analysis edge.
 *
 * When domain analysis confirms a positive edge, the pick has mathematically-backed
 * trustworthiness beyond raw confidence. Picks with significant edge (≥5%) get
 * higher trust; marginal-edge picks get moderate trust.
 *
 * Returns null if domain analysis is absent or edge is not positive (falls through
 * to confidence-based fallback).
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

  const edge = domainAnalysis['edge'];
  if (typeof edge !== 'number' || !Number.isFinite(edge)) {
    return null;
  }

  return edge >= 0.05 ? 80 : 65;
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
export function readDomainAnalysisReadinessSignal(
  metadata: Record<string, unknown>,
): number | null {
  const domainAnalysis = metadata['domainAnalysis'];
  if (!isRecord(domainAnalysis)) {
    return null;
  }

  const kellyFraction = domainAnalysis['kellyFraction'];
  if (typeof kellyFraction !== 'number' || !Number.isFinite(kellyFraction) || kellyFraction <= 0) {
    return null;
  }

  return 85;
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
  // Use metadata.capper (canonical capper identity), falling back to pick.source
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
