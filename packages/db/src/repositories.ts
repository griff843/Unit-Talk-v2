import type {
  CanonicalPick,
  LifecycleEvent,
  MemberTier,
  ProviderOfferInsert,
  SubmissionPayload,
  ValidatedSubmission,
} from '@unit-talk/contracts';
import type { IMarketUniverseRepository, MarketUniverseClosingLine, MarketUniverseUpsertInput } from './market-universe-repository.js';
import type { ISyndicateBoardRepository, SyndicateBoardInsertInput, SyndicateBoardRow } from './syndicate-board-repository.js';
import type { IMarketFamilyTrustRepository } from './market-family-trust-repository.js';
import type { ReferenceDataCatalog } from '@unit-talk/contracts';
import type {
  AlertDetectionMarketType,
  AlertDetectionRecord,
  AlertDetectionTier,
  ApprovalStatus,
  AuditLogRow,
  EventParticipantRole,
  EventParticipantRow,
  EventRow,
  EventStatus,
  GradeResultRecord,
  HedgeOpportunityPriority,
  HedgeOpportunityRecord,
  HedgeOpportunityType,
  MemberTierRecord,
  AlertLevel,
  ModelRegistryRecord,
  ModelHealthSnapshotRecord,
  ModelStatus,
  ParticipantRow,
  PickCandidateRow,
  PickCandidateFilterDetails,
  PickReviewRecord,
  ParticipantType,
  PickRecord,
  PickLifecycleRecord,
  PromotionHistoryRecord,
  ProviderCycleFreshnessStatus,
  ProviderIngestionFailureCategory,
  ProviderIngestionFailureScope,
  ProviderCycleProofStatus,
  ProviderCycleStageStatus,
  PromotionOverrideAction,
  PromotionStatus,
  PromotionTarget,
  OutboxRecord,
  ProviderMarketAliasRow,
  ProviderCycleStatusRow,
  ProviderOfferStagingRow,
  ProviderOfferRecord,
  ReceiptRecord,
  SettlementConfidence,
  SettlementRecord,
  ProviderOfferCurrentRow,
  ProviderOfferHistoryCompactRow,
  SettlementSource,
  SubmissionEventRecord,
  SubmissionRecord,
  SystemRunRecord,
  ExperimentLedgerRecord,
  ExperimentRunType,
  ExecutionQualityReport,
  ProviderEntityAliasRow,
  PickOfferSnapshotKind,
  PickOfferSnapshotRow,
} from './types.js';

export interface SubmissionCreateInput {
  id: string;
  payload: SubmissionPayload;
  receivedAt: string;
}

export interface SubmissionEventCreateInput {
  submissionId: string;
  eventName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SubmissionAtomicInput {
  submission: SubmissionCreateInput;
  event: SubmissionEventCreateInput;
  pick: CanonicalPick;
  idempotencyKey?: string | null;
  lifecycleEvent?: LifecycleEvent | null;
}

export interface SubmissionAtomicResult {
  submission: SubmissionRecord;
  submissionEvent: SubmissionEventRecord | null;
  pick: PickRecord;
  lifecycleEvent: PickLifecycleRecord | null;
}

/**
 * UTV2-519 P7A-04 Corrective: atomic pick lifecycle transition.
 *
 * Inputs for the `transition_pick_lifecycle` RPC that wraps
 * `UPDATE picks.status` + `INSERT pick_lifecycle` in a single Postgres
 * transaction. Replaces the prior two-write pattern in
 * `packages/db/src/lifecycle.ts` which could strand picks.status when the
 * lifecycle event insert failed a CHECK constraint.
 */
export interface TransitionPickLifecycleAtomicInput {
  pickId: string;
  fromState: string;
  toState: string;
  writerRole: string;
  reason: string;
  payload?: Record<string, unknown> | null | undefined;
}

export interface TransitionPickLifecycleAtomicResult {
  pickId: string;
  fromState: string;
  toState: string;
  eventId: string;
}

export interface SubmissionRepository {
  saveSubmission(input: SubmissionCreateInput): Promise<SubmissionRecord>;
  saveSubmissionEvent(input: SubmissionEventCreateInput): Promise<SubmissionEventRecord>;
  processSubmissionAtomic(input: SubmissionAtomicInput): Promise<SubmissionAtomicResult>;
}

export interface PickRepository {
  savePick(pick: CanonicalPick, idempotencyKey?: string | null): Promise<PickRecord>;
  saveLifecycleEvent(event: LifecycleEvent): Promise<PickLifecycleRecord>;
  updatePickLifecycleState(
    pickId: string,
    lifecycleState: CanonicalPick['lifecycleState'],
  ): Promise<PickRecord>;
  updateApprovalStatus(pickId: string, status: ApprovalStatus): Promise<PickRecord>;
  findPickById(pickId: string): Promise<PickRecord | null>;
  findPicksByIds(pickIds: string[]): Promise<Map<string, PickRecord>>;
  findPickByIdempotencyKey(key: string): Promise<PickRecord | null>;
  listByLifecycleState(
    lifecycleState: CanonicalPick['lifecycleState'],
    limit?: number | undefined,
  ): Promise<PickRecord[]>;
  listByLifecycleStates(
    lifecycleStates: CanonicalPick['lifecycleState'][],
    limit?: number | undefined,
  ): Promise<PickRecord[]>;
  listBySource(
    source: CanonicalPick['source'],
    limit?: number | undefined,
  ): Promise<PickRecord[]>;
  persistPromotionDecision(
    input: PromotionDecisionPersistenceInput,
  ): Promise<PromotionPersistenceResult>;
  insertPromotionHistoryRow(
    input: PromotionHistoryInsertInput,
  ): Promise<PromotionHistoryRecord>;
  getPromotionBoardState(
    input: PromotionBoardStateQuery,
  ): Promise<PromotionBoardStateSnapshot>;
  claimPickTransition(
    pickId: string,
    fromState: string,
    toState: string,
  ): Promise<{ claimed: boolean }>;
  /**
   * UTV2-519: atomic lifecycle transition. Updates picks.status and inserts a
   * pick_lifecycle event in a single Postgres transaction. Throws
   * `InvalidTransitionError` (from lifecycle.ts) when the from-state does not
   * match, `InvalidPickStateError` when the pick is not found, and the
   * InMemory sentinel `'transitionPickLifecycleAtomic is not supported in
   * InMemory mode. Use the sequential path.'` when running against the
   * InMemory repository.
   *
   * UTV2-520: now required on the interface. All implementers (including test
   * fakes) must provide this method. InMemory implementations throw the
   * sentinel message; lifecycle.ts catches that and falls back to sequential.
   */
  transitionPickLifecycleAtomic(
    input: TransitionPickLifecycleAtomicInput,
  ): Promise<TransitionPickLifecycleAtomicResult>;
}

export interface PromotionDecisionPersistenceInput {
  pickId: string;
  target: PromotionTarget;
  approvalStatus: ApprovalStatus;
  promotionStatus: PromotionStatus;
  promotionTarget?: PromotionTarget | null | undefined;
  promotionScore?: number | null | undefined;
  promotionReason?: string | null | undefined;
  promotionVersion: string;
  promotionDecidedAt: string;
  promotionDecidedBy: string;
  overrideAction?: PromotionOverrideAction | null | undefined;
  payload: Record<string, unknown>;
}

export interface PromotionPersistenceResult {
  pick: PickRecord;
  history: PromotionHistoryRecord;
}

export interface PromotionHistoryInsertInput {
  pickId: string;
  target: PromotionTarget;
  promotionStatus: PromotionStatus;
  promotionScore?: number | null | undefined;
  promotionReason?: string | null | undefined;
  promotionVersion: string;
  promotionDecidedAt: string;
  promotionDecidedBy: string;
  overrideAction?: PromotionOverrideAction | null | undefined;
  payload: Record<string, unknown>;
}

export interface PromotionBoardStateQuery {
  target: PromotionTarget;
  sport?: string | undefined;
  eventName?: string | undefined;
  market: string;
  selection: string;
}

export interface PromotionBoardStateSnapshot {
  currentBoardCount: number;
  sameSportCount: number;
  sameGameCount: number;
  duplicateCount: number;
}

export interface OutboxCreateInput {
  pickId: string;
  target: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface EnqueueDistributionAtomicInput {
  pickId: string;
  fromState: string;
  toState: string;
  writerRole: string;
  reason: string;
  lifecycleCreatedAt: string;
  outboxTarget: string;
  outboxPayload: Record<string, unknown>;
  outboxIdempotencyKey: string;
}

export interface EnqueueDistributionAtomicResult {
  pick: PickRecord;
  lifecycleEvent: PickLifecycleRecord;
  outbox: OutboxRecord;
}

export interface ClaimNextAtomicResult {
  outbox: OutboxRecord;
}

export interface ConfirmDeliveryAtomicInput {
  outboxId: string;
  pickId: string;
  workerId: string;
  receiptType: string;
  receiptStatus: string;
  receiptChannel: string;
  receiptExternalId: string | null;
  receiptIdempotencyKey: string;
  receiptPayload: Record<string, unknown>;
  lifecycleFromState: string;
  lifecycleToState: string;
  lifecycleWriterRole: string;
  lifecycleReason: string;
  auditAction: string;
  auditPayload: Record<string, unknown>;
}

export interface ConfirmDeliveryAtomicResult {
  outbox: OutboxRecord;
  lifecycleEvent?: PickLifecycleRecord;
  receipt?: ReceiptRecord;
  alreadyConfirmed: boolean;
}

export interface OutboxRepository {
  enqueue(input: OutboxCreateInput): Promise<OutboxRecord>;
  enqueueDistributionAtomic(input: EnqueueDistributionAtomicInput): Promise<EnqueueDistributionAtomicResult | null>;
  findByIdempotencyKey?(idempotencyKey: string): Promise<OutboxRecord | null>;
  claimNextAtomic(target: string, workerId: string): Promise<OutboxRecord | null>;
  confirmDeliveryAtomic(input: ConfirmDeliveryAtomicInput): Promise<ConfirmDeliveryAtomicResult>;
  findByPickAndTarget(
    pickId: string,
    target: string,
    statuses?: readonly string[] | undefined,
  ): Promise<OutboxRecord | null>;
  findLatestByPick(
    pickId: string,
    statuses?: readonly string[] | undefined,
  ): Promise<OutboxRecord | null>;
  claimNext(target: string, workerId: string): Promise<OutboxRecord | null>;
  touchClaim(outboxId: string, workerId: string): Promise<OutboxRecord | null>;
  reapStaleClaims(
    target: string,
    staleBefore: string,
    reason: string,
  ): Promise<OutboxRecord[]>;
  markSent(outboxId: string): Promise<OutboxRecord>;
  markFailed(
    outboxId: string,
    errorMessage: string,
    nextAttemptAt?: string | undefined,
  ): Promise<OutboxRecord>;
  markDeadLetter(
    outboxId: string,
    errorMessage: string,
  ): Promise<OutboxRecord>;
  listByPickId(pickId: string): Promise<OutboxRecord[]>;
  resetForRetry(outboxId: string): Promise<OutboxRecord>;
}

export interface AlertDetectionCreateInput {
  idempotencyKey: string;
  eventId: string;
  participantId?: string | null | undefined;
  marketKey: string;
  bookmakerKey: string;
  firstMoverBook?: string | null | undefined;
  baselineSnapshotAt: string;
  currentSnapshotAt: string;
  oldLine: number;
  newLine: number;
  lineChange: number;
  lineChangeAbs: number;
  velocity?: number | null | undefined;
  timeElapsedMinutes: number;
  direction: 'up' | 'down';
  marketType: AlertDetectionMarketType;
  tier: AlertDetectionTier;
  steamDetected?: boolean | undefined;
  notified?: boolean | undefined;
  notifiedAt?: string | null | undefined;
  notifiedChannels?: string[] | null | undefined;
  cooldownExpiresAt?: string | null | undefined;
  metadata: Record<string, unknown>;
}

export interface AlertCooldownQuery {
  eventId: string;
  participantId?: string | null | undefined;
  marketKey: string;
  bookmakerKey: string;
  tier: AlertDetectionTier;
  now: string;
}

export interface AlertNotificationUpdateInput {
  id: string;
  notifiedAt: string;
  notifiedChannels: string[];
  cooldownExpiresAt: string;
}

export interface AlertDetectionListOptions {
  minTier?: Exclude<AlertDetectionTier, 'watch'> | undefined;
}

export interface AlertDetectionStatusSummary {
  lastDetectedAt: string | null;
  counts: {
    notable: number;
    alertWorthy: number;
    notified: number;
    steamEvents: number;
  };
}

export interface AlertDetectionRepository {
  saveDetection(input: AlertDetectionCreateInput): Promise<AlertDetectionRecord | null>;
  findActiveCooldown(input: AlertCooldownQuery): Promise<AlertDetectionRecord | null>;
  findByIds(ids: string[]): Promise<Map<string, AlertDetectionRecord>>;
  findFirstMoverBook(
    eventId: string,
    marketKey: string,
    since: string,
  ): Promise<string | null>;
  findRecentByEventMarketDirection(
    eventId: string,
    marketKey: string,
    direction: 'up' | 'down',
    since: string,
  ): Promise<AlertDetectionRecord[]>;
  markSteamDetected(
    ids: string[],
    steamBookCount: number,
    steamWindowMinutes: number,
  ): Promise<Map<string, AlertDetectionRecord>>;
  listRecent(
    limit?: number | undefined,
    options?: AlertDetectionListOptions | undefined,
  ): Promise<AlertDetectionRecord[]>;
  getStatusSummary(windowStart: string): Promise<AlertDetectionStatusSummary>;
  updateNotified(input: AlertNotificationUpdateInput): Promise<void>;
}

export interface HedgeOpportunityCreateInput {
  idempotencyKey: string;
  eventId?: string | null | undefined;
  participantId?: string | null | undefined;
  marketKey: string;
  type: HedgeOpportunityType;
  priority: HedgeOpportunityPriority;
  bookmakerA: string;
  bookmakerB: string;
  lineA: number;
  lineB: number;
  overOddsA: number;
  underOddsB: number;
  lineDiscrepancy: number;
  impliedProbA: number;
  impliedProbB: number;
  totalImpliedProb: number;
  arbitragePercentage: number;
  profitPotential: number;
  guaranteedProfit?: number | null | undefined;
  middleGap?: number | null | undefined;
  winProbability?: number | null | undefined;
  notified?: boolean | undefined;
  notifiedAt?: string | null | undefined;
  notifiedChannels?: string[] | null | undefined;
  cooldownExpiresAt?: string | null | undefined;
  metadata: Record<string, unknown>;
  detectedAt: string;
}

export interface HedgeOpportunityCooldownQuery {
  eventId?: string | null | undefined;
  marketKey: string;
  type: HedgeOpportunityType;
  now: string;
}

export interface HedgeOpportunityNotificationUpdateInput {
  id: string;
  notifiedAt: string;
  notifiedChannels: string[];
  cooldownExpiresAt: string;
}

export interface HedgeOpportunityRepository {
  saveOpportunity(input: HedgeOpportunityCreateInput): Promise<HedgeOpportunityRecord | null>;
  findActiveCooldown(input: HedgeOpportunityCooldownQuery): Promise<HedgeOpportunityRecord | null>;
  listRecent(limit?: number | undefined): Promise<HedgeOpportunityRecord[]>;
  updateNotified(input: HedgeOpportunityNotificationUpdateInput): Promise<void>;
}

export interface ReceiptCreateInput {
  outboxId: string;
  receiptType: string;
  status: string;
  channel?: string | undefined;
  externalId?: string | undefined;
  idempotencyKey?: string | undefined;
  payload: Record<string, unknown>;
}

export interface ReceiptRepository {
  record(input: ReceiptCreateInput): Promise<ReceiptRecord>;
  findLatestByOutboxId(
    outboxId: string,
    receiptType?: string | undefined,
  ): Promise<ReceiptRecord | null>;
}

export interface SettlementCreateInput {
  pickId: string;
  status: 'settled' | 'manual_review';
  result?: string | null | undefined;
  source: SettlementSource;
  confidence: SettlementConfidence;
  evidenceRef: string;
  notes?: string | null | undefined;
  reviewReason?: string | null | undefined;
  settledBy: string;
  settledAt: string;
  correctsId?: string | null | undefined;
  payload: Record<string, unknown>;
}

export interface SettlePickAtomicInput {
  pickId: string;
  settlement: SettlementCreateInput;
  lifecycleFromState: string;
  lifecycleToState: string;
  lifecycleWriterRole: string;
  lifecycleReason: string;
  auditAction: string;
  auditActor: string;
  auditPayload: Record<string, unknown>;
}

export interface SettlePickAtomicResult {
  settlement: SettlementRecord;
  pick: PickRecord;
  lifecycleEvent: PickLifecycleRecord | null;
  duplicate: boolean;
}

export interface SettlementRepository {
  record(input: SettlementCreateInput): Promise<SettlementRecord>;
  settlePickAtomic(input: SettlePickAtomicInput): Promise<SettlePickAtomicResult>;
  updatePayload(
    settlementId: string,
    payload: Record<string, unknown>,
  ): Promise<SettlementRecord>;
  findLatestForPick(pickId: string): Promise<SettlementRecord | null>;
  listByPick(pickId: string): Promise<SettlementRecord[]>;
  listRecent(limit?: number | undefined): Promise<SettlementRecord[]>;
}

export interface SystemRunStartInput {
  runType: string;
  actor?: string | undefined;
  details: Record<string, unknown>;
  idempotencyKey?: string | undefined;
}

export interface SystemRunCompleteInput {
  runId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  details?: Record<string, unknown> | undefined;
}

export interface SystemRunRepository {
  startRun(input: SystemRunStartInput): Promise<SystemRunRecord>;
  completeRun(input: SystemRunCompleteInput): Promise<SystemRunRecord>;
  listByType(runType: string, limit?: number): Promise<SystemRunRecord[]>;
}

export type ProviderOfferUpsertInput = ProviderOfferInsert;

export interface ProviderOfferUpsertResult {
  insertedCount: number;
  updatedCount: number;
  totalProcessed: number;
}

export interface ProviderOfferStageInput extends ProviderOfferInsert {
  runId: string;
  league: string;
  identityKey: string;
}

export interface ProviderOfferStageResult {
  stagedCount: number;
  duplicateCount: number;
  totalProcessed: number;
}

export interface ProviderOfferMergeInput {
  runId: string;
  maxRows: number;
  identityStrategy: string;
}

export interface ProviderOfferMergeResult {
  processedCount: number;
  mergedCount: number;
  duplicateCount: number;
}

export interface ProviderCycleStatusUpsertInput {
  runId: string;
  providerKey: string;
  league: string;
  cycleSnapshotAt: string;
  stageStatus: ProviderCycleStageStatus;
  freshnessStatus?: ProviderCycleFreshnessStatus | undefined;
  proofStatus?: ProviderCycleProofStatus | undefined;
  stagedCount?: number | undefined;
  mergedCount?: number | undefined;
  duplicateCount?: number | undefined;
  failureCategory?: ProviderIngestionFailureCategory | null | undefined;
  failureScope?: ProviderIngestionFailureScope | null | undefined;
  affectedProviderKey?: string | null | undefined;
  affectedSportKey?: string | null | undefined;
  affectedMarketKey?: string | null | undefined;
  lastError?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ClosingLineLookupCriteria {
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId?: string | null | undefined;
  before: string;
  bookmakerKey?: string | null;
}

export interface ProviderOfferRepository {
  upsertBatch(offers: ProviderOfferUpsertInput[]): Promise<ProviderOfferUpsertResult>;
  stageBatch(offers: ProviderOfferStageInput[]): Promise<ProviderOfferStageResult>;
  mergeStagedCycle(input: ProviderOfferMergeInput): Promise<ProviderOfferMergeResult>;
  upsertCycleStatus(input: ProviderCycleStatusUpsertInput): Promise<ProviderCycleStatusRow>;
  getCycleStatus(runId: string): Promise<ProviderCycleStatusRow | null>;
  listStagedOffers(runId: string): Promise<ProviderOfferStagingRow[]>;
  findClosingLine(criteria: ClosingLineLookupCriteria): Promise<ProviderOfferRecord | null>;
  /**
   * Returns the earliest is_opening=true snapshot for the given market criteria.
   * Used as a CLV fallback when no closing line exists (e.g. Odds API was down).
   * Opening-line CLV is directionally valid but less precise than closing-line CLV.
   */
  findOpeningLine(criteria: ClosingLineLookupCriteria): Promise<ProviderOfferRecord | null>;
  findLatestByMarketKey(
    marketKey: string,
    providerKey?: string,
    providerParticipantId?: string | null,
  ): Promise<ProviderOfferRecord | null>;
  findCurrentOffer(criteria: {
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId?: string | null;
    bookmakerKey?: string | null;
  }): Promise<ProviderOfferCurrentRow | null>;
  listAll(): Promise<ProviderOfferRecord[]>;
  listByProvider(providerKey: string): Promise<ProviderOfferRecord[]>;
  /**
   * Returns offers with snapshot_at >= since, ordered by snapshot_at descending.
   * An optional limit caps the result set as a safety net (default: 10 000).
   */
  listRecentOffers(since: string, limit?: number): Promise<ProviderOfferRecord[]>;
  /**
   * Returns all offers with is_closing=true and snapshot_at >= since.
   * No row limit — ensures closing-line offers are always included in
   * materializer runs regardless of total offer volume. The recent-offer
   * cap can exclude closing rows because they carry earlier timestamps
   * (pre-commence snapshots) that get sorted behind live offers.
   */
  listClosingOffers(since: string): Promise<ProviderOfferRecord[]>;
  /**
   * Returns a Set of combination keys in the format
   * "providerKey:providerEventId:marketKey:participantId" for which at least
   * one row already exists in current offer truth for the given event IDs.
   * Used before a batch insert to determine which offers are opening lines.
   */
  findExistingCombinations(
    providerEventIds: string[],
    options?: { includeBookmakerKey?: boolean; beforeSnapshotAt?: string },
  ): Promise<Set<string>>;
  /**
   * For each event in the list where commenceTime <= snapshotAt (game has started),
   * marks the latest pre-commence snapshot per (providerKey, marketKey, participantId)
   * as is_closing = true. Returns the total count of rows updated.
   */
  markClosingLines(
    events: Array<{ providerEventId: string; commenceTime: string }>,
    snapshotAt: string,
    options?: { includeBookmakerKey?: boolean },
  ): Promise<number>;
  /**
   * Translates a canonical market key (e.g. pick.market = 'player_turnovers_ou') to
   * the provider-native market key used in offer truth (e.g. 'turnovers-all-game-ou').
   * Returns null when no alias mapping exists for the given provider.
   */
  resolveProviderMarketKey(canonicalKey: string, provider: string): Promise<string | null>;
  /**
   * Reverse alias lookup: translates a provider-native market key (e.g. 'points-all-game-ou')
   * to the canonical market_type_id (e.g. 'player_points_ou').
   * Used by the system pick scanner to build gradeable picks from raw provider offers.
   */
  resolveCanonicalMarketKey(providerMarketKey: string, provider: string): Promise<string | null>;
  /**
   * Bulk-loads all provider_market_alias rows for a given provider.
   * Returns the full alias row set, including sport_id for sport-aware disambiguation.
   * Used by the market universe materializer for O(1) per-row alias lookups without
   * N+1 query patterns.
   */
  listAliasLookup(provider: string): Promise<ProviderMarketAliasRow[]>;
  /**
   * Bulk-loads all provider_entity_alias rows for a given provider where entity_kind = 'player'.
   * Returns rows including provider_entity_id and participant_id for FK resolution.
   * Used by the market universe materializer for O(1) participant FK lookups.
   */
  listParticipantAliasLookup(provider: string): Promise<ProviderEntityAliasRow[]>;
  /**
   * Returns recent is_opening=true rows for a given provider, within the lookback window,
   * that have both over_odds and under_odds and a non-null line and participant.
   * Used by the system pick scanner to auto-generate picks from opening lines.
   */
  listOpeningOffers(since: string, provider: string, limit?: number): Promise<ProviderOfferRecord[]>;
  listOpeningCurrentOffers(
    since: string,
    provider: string,
    limit?: number,
  ): Promise<ProviderOfferCurrentRow[]>;
  savePickOfferSnapshot(input: {
    pickId: string;
    snapshotKind: PickOfferSnapshotKind;
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
    bookmakerKey: string | null;
    identityKey: string;
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    devigMode: ProviderOfferInsert['devigMode'];
    sourceSnapshotAt: string | null;
    capturedAt: string;
    sourceRunId?: string | null;
    sourceCompactSnapshotId?: string | null;
    sourceCurrentIdentityKey?: string | null;
    settlementRecordId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<PickOfferSnapshotRow>;
  listPickOfferSnapshots(
    pickId: string,
    snapshotKinds?: PickOfferSnapshotKind[],
  ): Promise<PickOfferSnapshotRow[]>;
  listCompactHistory(criteria: {
    providerKey?: string;
    providerEventId?: string;
    providerMarketKey?: string;
    providerParticipantId?: string | null;
    bookmakerKey?: string | null;
    since?: string;
    limit?: number;
  }): Promise<ProviderOfferHistoryCompactRow[]>;
}

export interface ParticipantUpsertInput {
  externalId: string;
  displayName: string;
  participantType: ParticipantType;
  sport?: string | null | undefined;
  league?: string | null | undefined;
  metadata: Record<string, unknown>;
}

export interface ParticipantRepository {
  upsertByExternalId(input: ParticipantUpsertInput): Promise<ParticipantRow>;
  findById(participantId: string): Promise<ParticipantRow | null>;
  findByExternalId(externalId: string): Promise<ParticipantRow | null>;
  listByType(participantType: ParticipantType, sport?: string | undefined): Promise<ParticipantRow[]>;
  updateMetadata(participantId: string, metadata: Record<string, unknown>): Promise<ParticipantRow>;
}

export interface EventUpsertInput {
  externalId: string;
  sportId: string;
  eventName: string;
  eventDate: string;
  status: EventStatus;
  metadata: Record<string, unknown>;
}

export interface EventRepository {
  upsertByExternalId(input: EventUpsertInput): Promise<EventRow>;
  findById(eventId: string): Promise<EventRow | null>;
  findByExternalId(externalId: string): Promise<EventRow | null>;
  listUpcoming(sportId?: string, windowDays?: number): Promise<EventRow[]>;
  /** Returns all events whose event_name matches the given name (case-insensitive). */
  listByName(eventName: string): Promise<EventRow[]>;
  /**
   * Returns all events whose event_date is on or before the given snapshotAt timestamp.
   * Used by the ingestor to identify started events for closing line detection.
   */
  listStartedBySnapshot(snapshotAt: string): Promise<EventRow[]>;
}

export interface EventParticipantUpsertInput {
  eventId: string;
  participantId: string;
  role: EventParticipantRole;
}

export interface EventParticipantRepository {
  upsert(input: EventParticipantUpsertInput): Promise<EventParticipantRow>;
  listByEvent(eventId: string): Promise<EventParticipantRow[]>;
  listByParticipant(participantId: string): Promise<EventParticipantRow[]>;
}

export interface GradeResultInsertInput {
  eventId: string;
  participantId: string | null;
  marketKey: string;
  actualValue: number;
  source: string;
  sourcedAt: string;
}

export interface GradeResultLookupCriteria {
  eventId: string;
  participantId: string | null;
  marketKey: string;
}

export interface GradeResultRepository {
  insert(input: GradeResultInsertInput): Promise<GradeResultRecord>;
  findResult(criteria: GradeResultLookupCriteria): Promise<GradeResultRecord | null>;
  listByEvent(eventId: string): Promise<GradeResultRecord[]>;
}

export interface AuditLogCreateInput {
  entityType: string;
  entityId?: string | null | undefined;
  entityRef?: string | null | undefined;
  action: string;
  actor?: string | undefined;
  payload: Record<string, unknown>;
}

export interface AuditLogRepository {
  record(input: AuditLogCreateInput): Promise<AuditLogRow>;
  listRecentByEntityType(
    entityType: string,
    since: string,
    action?: string | undefined,
  ): Promise<AuditLogRow[]>;
}

export interface ModelRegistryCreateInput {
  modelName: string;
  version: string;
  sport: string;
  marketFamily: string;
  status?: ModelStatus;
  metadata?: Record<string, unknown>;
}

export interface ModelRegistryRepository {
  create(input: ModelRegistryCreateInput): Promise<ModelRegistryRecord>;
  findById(id: string): Promise<ModelRegistryRecord | null>;
  findChampion(sport: string, marketFamily: string): Promise<ModelRegistryRecord | null>;
  listBySport(sport: string): Promise<ModelRegistryRecord[]>;
  updateStatus(id: string, status: ModelStatus, championSince?: string): Promise<ModelRegistryRecord>;
}

export interface ExperimentLedgerCreateInput {
  modelId: string;
  runType: ExperimentRunType;
  sport: string;
  marketFamily: string;
  notes?: string;
}

export interface ExperimentLedgerRepository {
  create(input: ExperimentLedgerCreateInput): Promise<ExperimentLedgerRecord>;
  findById(id: string): Promise<ExperimentLedgerRecord | null>;
  listByModelId(modelId: string): Promise<ExperimentLedgerRecord[]>;
  complete(id: string, metrics: Record<string, unknown>): Promise<ExperimentLedgerRecord>;
  fail(id: string, notes?: string): Promise<ExperimentLedgerRecord>;
}

export interface ModelHealthSnapshotCreateInput {
  modelId: string;
  sport: string;
  marketFamily: string;
  winRate?: number;
  roi?: number;
  sampleSize?: number;
  driftScore?: number;
  calibrationScore?: number;
  alertLevel?: AlertLevel;
  /** ISO timestamp of the last real state transition. Stored in metadata.transitionAt. */
  transitionAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelHealthSnapshotRepository {
  create(input: ModelHealthSnapshotCreateInput): Promise<ModelHealthSnapshotRecord>;
  findLatestByModel(modelId: string): Promise<ModelHealthSnapshotRecord | null>;
  listByModel(modelId: string, limit?: number): Promise<ModelHealthSnapshotRecord[]>;
  listAlerted(level?: Exclude<AlertLevel, 'none'>): Promise<ModelHealthSnapshotRecord[]>;
}

export interface ExecutionQualityRepository {
  summarizeByProvider(sport?: string): Promise<ExecutionQualityReport[]>;
  summarizeByMarketFamily(providerKey: string): Promise<ExecutionQualityReport[]>;
}

export interface SubmissionPersistenceResult {
  submission: SubmissionRecord;
  submissionEvent: SubmissionEventRecord;
  pick: PickRecord;
  lifecycleEvent: PickLifecycleRecord;
}

export interface TeamSearchResult {
  participantId: string;
  displayName: string;
  sport: string;
}

export interface PlayerSearchResult {
  participantId: string;
  displayName: string;
  sport: string;
}

export interface EventSearchResult {
  eventId: string;
  eventName: string;
  eventDate: string;
  status: string;
  sportId: string;
}

export interface BrowseSearchResult {
  resultType: 'player' | 'team' | 'matchup';
  participantId: string | null;
  displayName: string;
  contextLabel: string;
  teamId: string | null;
  teamName: string | null;
  matchup: MatchupBrowseResult;
}

export interface LeagueBrowseResult {
  id: string;
  sportId: string;
  displayName: string;
}

export interface MatchupBrowseTeam {
  participantId: string;
  teamId: string | null;
  displayName: string;
  role: 'home' | 'away';
}

export interface MatchupBrowseResult {
  eventId: string;
  externalId: string | null;
  eventName: string;
  eventDate: string;
  /** Full ISO timestamp from events.metadata.starts_at. Null when not yet populated. */
  startTime: string | null;
  status: string;
  sportId: string;
  leagueId: string | null;
  teams: MatchupBrowseTeam[];
}

export interface EventParticipantBrowseResult {
  participantId: string;
  canonicalId: string | null;
  participantType: 'team' | 'player';
  displayName: string;
  role: string;
  teamId: string | null;
  teamName: string | null;
}

export interface EventOfferBrowseResult {
  sportsbookId: string | null;
  sportsbookName: string | null;
  marketTypeId: string | null;
  marketDisplayName: string;
  participantId: string | null;
  participantName: string | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  snapshotAt: string;
  providerKey: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
}

export interface EventBrowseResult {
  eventId: string;
  externalId: string | null;
  eventName: string;
  eventDate: string;
  /** Full ISO timestamp from events.metadata.starts_at. Null when not yet populated. */
  startTime: string | null;
  status: string;
  sportId: string;
  leagueId: string | null;
  participants: EventParticipantBrowseResult[];
  offers: EventOfferBrowseResult[];
}

export interface ReferenceDataRepository {
  getCatalog(): Promise<ReferenceDataCatalog>;
  listLeagues(sportId: string): Promise<LeagueBrowseResult[]>;
  listMatchups(sportId: string, date: string): Promise<MatchupBrowseResult[]>;
  getEventBrowse(eventId: string): Promise<EventBrowseResult | null>;
  searchTeams(sportId: string, query: string, limit?: number): Promise<TeamSearchResult[]>;
  searchPlayers(sportId: string, query: string, limit?: number): Promise<PlayerSearchResult[]>;
  listEvents(sportId: string, date: string): Promise<EventSearchResult[]>;
  searchBrowse(sportId: string, date: string, query: string, limit?: number): Promise<BrowseSearchResult[]>;
}

export interface RepositoryBundle {
  submissions: SubmissionRepository;
  picks: PickRepository;
  outbox: OutboxRepository;
  alertDetections: AlertDetectionRepository;
  hedgeOpportunities: HedgeOpportunityRepository;
  receipts: ReceiptRepository;
  settlements: SettlementRepository;
  providerOffers: ProviderOfferRepository;
  participants: ParticipantRepository;
  events: EventRepository;
  eventParticipants: EventParticipantRepository;
  gradeResults: GradeResultRepository;
  runs: SystemRunRepository;
  audit: AuditLogRepository;
  referenceData: ReferenceDataRepository;
  tiers: MemberTierRepository;
  reviews: PickReviewRepository;
  marketUniverse: IMarketUniverseRepository;
  pickCandidates: IPickCandidateRepository;
  syndicateBoard: ISyndicateBoardRepository;
  marketFamilyTrust: IMarketFamilyTrustRepository;
  modelRegistry?: ModelRegistryRepository;
  experimentLedger?: ExperimentLedgerRepository;
  modelHealthSnapshots?: ModelHealthSnapshotRepository;
  executionQuality?: ExecutionQualityRepository;
}

export type { IMarketUniverseRepository, MarketUniverseClosingLine, MarketUniverseUpsertInput };
export type { ISyndicateBoardRepository, SyndicateBoardInsertInput, SyndicateBoardRow };
export type { IMarketFamilyTrustRepository, MarketFamilyTrustInsert, MarketFamilyTrustRow, ClvFeedbackInsert } from './market-family-trust-repository.js';

// ---------------------------------------------------------------------------
// IPickCandidateRepository — Phase 2 UTV2-463
// Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md §5
//
// Hard Phase 2 invariants (never violate):
//   - pick_id must remain NULL on every row written in Phase 2
//   - shadow_mode must remain DEFAULT true in Phase 2
//   - model_score / model_tier / model_confidence must remain NULL in Phase 2
// ---------------------------------------------------------------------------

export interface PickCandidateUpsertInput {
  universe_id: string;
  status: string;                                          // 'qualified' | 'rejected' | 'pending'
  rejection_reason: string | null;                         // first failing filter key; null if qualified
  filter_details: PickCandidateFilterDetails;              // canonical §5.5 shape — all 7 booleans required
  scan_run_id: string | null;                              // UUID of the scan run that produced this row
  provenance: Record<string, unknown> | null;              // { scanVersion, filterVersion, runAt }
  expires_at: string | null;                               // ISO timestamptz from event.starts_at or null
  // NOTE: pick_id, model_score, model_tier, model_confidence, shadow_mode must NEVER be set in Phase 2
}

export interface ModelScoreUpdate {
  id: string;
  model_score: number;
  model_tier: string;
  model_confidence: number;
}

export interface SelectionRankUpdate {
  id: string;
  selection_rank: number;
  is_board_candidate: boolean;
}

/** Phase 5 — link a created pick back to its originating candidate. */
export interface PickIdUpdate {
  id: string;       // pick_candidates.id
  pick_id: string;  // picks.id — the governed system pick that was created
}

export interface IPickCandidateRepository {
  /**
   * Upsert pick_candidates rows using the conflict target: universe_id (unique index).
   * One active candidate per market opportunity. Idempotent across repeated scan runs.
   *
   * ON CONFLICT (universe_id): UPDATE status, filter_details, scan_run_id, provenance,
   * expires_at, updated_at. Do NOT insert a new row.
   *
   * Phase 2 invariant: pick_id MUST remain NULL. shadow_mode MUST remain DEFAULT true.
   * model_score / model_tier / model_confidence MUST remain NULL.
   */
  upsertCandidates(rows: PickCandidateUpsertInput[]): Promise<void>;

  /**
   * Find candidates by status. Used by tests and Phase 3 model runner.
   */
  findByStatus(status: string): Promise<PickCandidateRow[]>;

  /**
   * Batch-updates model scoring fields on pick_candidates rows.
   * Only sets model_score, model_tier, model_confidence — never touches pick_id or shadow_mode.
   * Used by the Phase 3 candidate scoring service.
   */
  updateModelScoreBatch(updates: ModelScoreUpdate[]): Promise<void>;
  /**
   * Batch-updates selection_rank and is_board_candidate on pick_candidates rows.
   * Called by the ranked selection service after each full ranking cycle.
   * Never touches pick_id, shadow_mode, model_score, or status.
   */
  updateSelectionRankBatch(updates: SelectionRankUpdate[]): Promise<void>;
  /**
   * Resets selection_rank to NULL and is_board_candidate to false on ALL rows.
   * Called at the start of each ranking run to eliminate stale rank state.
   */
  resetSelectionRanks(): Promise<void>;

  /**
   * Find candidates by their primary IDs.
   * Used by board-pick-writer to load board candidates for pick creation.
   */
  findByIds(ids: string[]): Promise<PickCandidateRow[]>;

  /**
   * Phase 5 — link a created pick back to its originating candidate.
   * Sets pick_id and clears shadow_mode (false) on each candidate row.
   * Called once per board write run, after all picks are successfully created.
   */
  updatePickIdBatch(updates: PickIdUpdate[]): Promise<void>;
}

export type { PickCandidateRow, PickCandidateFilterDetails };

export interface IngestorRepositoryBundle {
  providerOffers: ProviderOfferRepository;
  runs: SystemRunRepository;
  events: EventRepository;
  eventParticipants: EventParticipantRepository;
  participants: ParticipantRepository;
  gradeResults: GradeResultRepository;
}

export interface MemberTierActivateInput {
  discordId: string;
  discordUsername?: string | undefined;
  tier: MemberTier;
  source: 'discord-role' | 'manual' | 'system';
  changedBy: string;
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  /** When set, persisted as effective_until on the tier row (e.g. trial expiry date). */
  effectiveUntil?: Date | null | undefined;
}

export interface MemberTierDeactivateInput {
  discordId: string;
  tier: MemberTier;
  changedBy: string;
  reason?: string | undefined;
}

export interface MemberTierRepository {
  activateTier(input: MemberTierActivateInput): Promise<MemberTierRecord>;
  deactivateTier(input: MemberTierDeactivateInput): Promise<void>;
  getActiveTiers(discordId: string): Promise<MemberTierRecord[]>;
  getTierHistory(discordId: string): Promise<MemberTierRecord[]>;
  getActiveMembersForTier(tier: MemberTier): Promise<MemberTierRecord[]>;
  getTierCounts(): Promise<Record<MemberTier, number>>;
  /** Returns active trial rows whose effective_until is at or before the given timestamp. */
  getExpiredTrials(now: string): Promise<MemberTierRecord[]>;
}

// ---------------------------------------------------------------------------
// Pick Review
// ---------------------------------------------------------------------------

export interface PickReviewCreateInput {
  pickId: string;
  decision: PickReviewRecord['decision'];
  reason: string;
  decidedBy: string;
}

export interface PickReviewRepository {
  createReview(input: PickReviewCreateInput): Promise<PickReviewRecord>;
  listByPick(pickId: string): Promise<PickReviewRecord[]>;
  listByDecision(decision: PickReviewRecord['decision'], limit?: number): Promise<PickReviewRecord[]>;
  listRecent(limit?: number): Promise<PickReviewRecord[]>;
}

export function mapValidatedSubmissionToSubmissionCreateInput(
  submission: ValidatedSubmission,
): SubmissionCreateInput {
  return {
    id: submission.id,
    payload: submission.payload,
    receivedAt: submission.receivedAt,
  };
}
