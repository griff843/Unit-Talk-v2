import type {
  CanonicalPick,
  LifecycleEvent,
  ProviderOfferInsert,
  SubmissionPayload,
  ValidatedSubmission,
} from '@unit-talk/contracts';
import type { ReferenceDataCatalog } from '@unit-talk/contracts';
import type {
  ApprovalStatus,
  AuditLogRow,
  EventParticipantRow,
  EventRow,
  GradeResultRecord,
  ParticipantRecord,
  PickRecord,
  PickLifecycleRecord,
  PromotionHistoryRecord,
  PromotionOverrideAction,
  PromotionStatus,
  PromotionTarget,
  OutboxRecord,
  ProviderOfferRecord,
  ReceiptRecord,
  SettlementRecord,
  SubmissionEventRecord,
  SubmissionRecord,
  SystemRunRecord,
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

export interface SubmissionRepository {
  saveSubmission(input: SubmissionCreateInput): Promise<SubmissionRecord>;
  saveSubmissionEvent(input: SubmissionEventCreateInput): Promise<SubmissionEventRecord>;
}

export interface PickRepository {
  savePick(pick: CanonicalPick): Promise<PickRecord>;
  saveLifecycleEvent(event: LifecycleEvent): Promise<PickLifecycleRecord>;
  updatePickLifecycleState(
    pickId: string,
    lifecycleState: CanonicalPick['lifecycleState'],
  ): Promise<PickRecord>;
  findPickById(pickId: string): Promise<PickRecord | null>;
  listByLifecycleState(state: string): Promise<PickRecord[]>;
  persistPromotionDecision(
    input: PromotionDecisionPersistenceInput,
  ): Promise<PromotionPersistenceResult>;
  insertPromotionHistoryRow(
    input: PromotionHistoryInsertInput,
  ): Promise<PromotionHistoryRecord>;
  getPromotionBoardState(
    input: PromotionBoardStateQuery,
  ): Promise<PromotionBoardStateSnapshot>;
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

export interface OutboxRepository {
  enqueue(input: OutboxCreateInput): Promise<OutboxRecord>;
  claimNext(target: string, workerId: string): Promise<OutboxRecord | null>;
  markSent(outboxId: string): Promise<OutboxRecord>;
  markFailed(
    outboxId: string,
    errorMessage: string,
    nextAttemptAt?: string | undefined,
  ): Promise<OutboxRecord>;
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
}

export interface SettlementCreateInput {
  pickId: string;
  status: 'settled' | 'manual_review';
  result?: string | null | undefined;
  source: string;
  confidence: string;
  evidenceRef: string;
  notes?: string | null | undefined;
  reviewReason?: string | null | undefined;
  settledBy: string;
  settledAt: string;
  correctsId?: string | null | undefined;
  payload: Record<string, unknown>;
}

export interface SettlementRepository {
  record(input: SettlementCreateInput): Promise<SettlementRecord>;
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

export interface ReferenceDataRepository {
  getCatalog(): Promise<ReferenceDataCatalog>;
  searchTeams(sportId: string, query: string, limit?: number): Promise<TeamSearchResult[]>;
  searchPlayers(sportId: string, query: string, limit?: number): Promise<PlayerSearchResult[]>;
  listEvents(sportId: string, date: string): Promise<EventSearchResult[]>;
}

export interface ParticipantUpsertInput {
  externalId: string;
  displayName: string;
  participantType: string;
  sport: string | null;
  league: string | null;
  metadata: Record<string, unknown>;
}

export interface ParticipantRepository {
  findById(id: string): Promise<ParticipantRecord | null>;
  upsertByExternalId(input: ParticipantUpsertInput): Promise<ParticipantRecord>;
}

export interface EventUpsertInput {
  externalId: string;
  sportId: string;
  eventName: string;
  eventDate: string;
  status: string;
  metadata: Record<string, unknown>;
}

export interface EventRepository {
  findById(id: string): Promise<EventRow | null>;
  upsertByExternalId(input: EventUpsertInput): Promise<EventRow>;
}

export interface EventParticipantUpsertInput {
  eventId: string;
  participantId: string;
  role: string;
}

export interface EventParticipantRepository {
  upsert(input: EventParticipantUpsertInput): Promise<EventParticipantRow>;
  listByParticipant(participantId: string): Promise<EventParticipantRow[]>;
}

export interface FindClosingLineInput {
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  before: string;
}

export interface ProviderOfferRepository {
  upsertBatch(offers: ProviderOfferInsert[]): Promise<void>;
  findClosingLine(input: FindClosingLineInput): Promise<ProviderOfferRecord | null>;
  listByProvider(providerKey: string): Promise<ProviderOfferRecord[]>;
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

export interface RepositoryBundle {
  submissions: SubmissionRepository;
  picks: PickRepository;
  outbox: OutboxRepository;
  receipts: ReceiptRepository;
  settlements: SettlementRepository;
  runs: SystemRunRepository;
  audit: AuditLogRepository;
  referenceData: ReferenceDataRepository;
  participants: ParticipantRepository;
  events: EventRepository;
  eventParticipants: EventParticipantRepository;
  providerOffers: ProviderOfferRepository;
  gradeResults: GradeResultRepository;
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
