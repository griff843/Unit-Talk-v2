import crypto from 'node:crypto';
import {
  V1_REFERENCE_DATA,
  type ProviderOfferInsert,
  type ReferenceDataCatalog,
} from '@unit-talk/contracts';
import type {
  CanonicalPick,
  LifecycleEvent,
} from '@unit-talk/contracts';
import type {
  AlertCooldownQuery,
  AlertDetectionCreateInput,
  AlertDetectionRepository,
  AuditLogCreateInput,
  AuditLogRepository,
  ClosingLineLookupCriteria,
  EventParticipantRepository,
  EventParticipantUpsertInput,
  EventRepository,
  EventSearchResult,
  EventUpsertInput,
  GradeResultInsertInput,
  GradeResultLookupCriteria,
  GradeResultRepository,
  OutboxCreateInput,
  OutboxRepository,
  ParticipantRepository,
  ParticipantUpsertInput,
  PickRepository,
  PlayerSearchResult,
  ProviderOfferRepository,
  ProviderOfferUpsertInput,
  ProviderOfferUpsertResult,
  PromotionBoardStateQuery,
  PromotionBoardStateSnapshot,
  PromotionDecisionPersistenceInput,
  PromotionHistoryInsertInput,
  PromotionPersistenceResult,
  ReferenceDataRepository,
  IngestorRepositoryBundle,
  RepositoryBundle,
  ReceiptCreateInput,
  ReceiptRepository,
  SettlementCreateInput,
  SettlementRepository,
  SubmissionEventCreateInput,
  SubmissionCreateInput,
  SubmissionRepository,
  SystemRunCompleteInput,
  SystemRunRepository,
  SystemRunStartInput,
  TeamSearchResult,
} from './repositories.js';
import type {
  AlertDetectionRecord,
  AuditLogRow,
  EventParticipantRow,
  EventRow,
  GradeResultRecord,
  ParticipantRow,
  SystemRunRecord,
  OutboxRecord,
  PickRecord,
  PickLifecycleRecord,
  ProviderOfferRecord,
  PromotionHistoryRecord,
  ReceiptRecord,
  SettlementRecord,
  SubmissionEventRecord,
  SubmissionRecord,
} from './types.js';
import type { Json } from './database.types.js';
import {
  createDatabaseClientFromConnection,
  type DatabaseConnectionConfig,
  type UnitTalkSupabaseClient,
} from './client.js';

function mapPickToRecord(pick: CanonicalPick): PickRecord {
  return {
    id: pick.id,
    submission_id: pick.submissionId,
    participant_id: null,
    market: pick.market,
    selection: pick.selection,
    line: pick.line ?? null,
    odds: pick.odds ?? null,
    stake_units: pick.stakeUnits ?? null,
    confidence: pick.confidence ?? null,
    source: pick.source,
    approval_status: pick.approvalStatus,
    promotion_status: pick.promotionStatus,
    promotion_target: pick.promotionTarget ?? null,
    promotion_score: pick.promotionScore ?? null,
    promotion_reason: pick.promotionReason ?? null,
    promotion_version: pick.promotionVersion ?? null,
    promotion_decided_at: pick.promotionDecidedAt ?? null,
    promotion_decided_by: pick.promotionDecidedBy ?? null,
    status: pick.lifecycleState,
    posted_at: null,
    settled_at: null,
    metadata: toJsonObject(pick.metadata),
    created_at: pick.createdAt,
    updated_at: pick.createdAt,
  };
}

function mapLifecycleEventToRecord(event: LifecycleEvent): PickLifecycleRecord {
  return {
    id: `${event.pickId}_${event.toState}_${event.createdAt}`,
    pick_id: event.pickId,
    from_state: event.fromState ?? null,
    to_state: event.toState,
    writer_role: event.writerRole,
    reason: event.reason,
    payload: {},
    created_at: event.createdAt,
  };
}

export class InMemorySubmissionRepository implements SubmissionRepository {
  private readonly submissions = new Map<string, SubmissionRecord>();
  private readonly submissionEvents: SubmissionEventRecord[] = [];

  async saveSubmission(input: SubmissionCreateInput): Promise<SubmissionRecord> {
    const submission: SubmissionRecord = {
      id: input.id,
      external_id: null,
      source: input.payload.source,
      submitted_by: input.payload.submittedBy ?? null,
      payload: {
        market: input.payload.market,
        selection: input.payload.selection,
        line: input.payload.line,
        odds: input.payload.odds,
        stakeUnits: input.payload.stakeUnits,
        confidence: input.payload.confidence,
        eventName: input.payload.eventName,
        metadata: toJsonObject(input.payload.metadata ?? {}),
      } as Json,
      status: 'validated',
      received_at: input.receivedAt,
      created_at: input.receivedAt,
      updated_at: input.receivedAt,
    };

    this.submissions.set(submission.id, submission);
    return submission;
  }

  async saveSubmissionEvent(
    input: SubmissionEventCreateInput,
  ): Promise<SubmissionEventRecord> {
    const event: SubmissionEventRecord = {
      id: `${input.submissionId}_${this.submissionEvents.length + 1}`,
      submission_id: input.submissionId,
      event_name: input.eventName,
      payload: toJsonObject(input.payload),
      created_at: input.createdAt,
    };

    this.submissionEvents.push(event);
    return event;
  }
}

export class InMemoryPickRepository implements PickRepository {
  private readonly picks = new Map<string, PickRecord>();
  private readonly lifecycleEvents: PickLifecycleRecord[] = [];
  private readonly promotionHistory: PromotionHistoryRecord[] = [];

  async savePick(pick: CanonicalPick): Promise<PickRecord> {
    const record = mapPickToRecord(pick);
    this.picks.set(record.id, record);
    return record;
  }

  async saveLifecycleEvent(event: LifecycleEvent): Promise<PickLifecycleRecord> {
    const record = mapLifecycleEventToRecord(event);
    this.lifecycleEvents.push(record);
    return record;
  }

  async updatePickLifecycleState(
    pickId: string,
    lifecycleState: CanonicalPick['lifecycleState'],
  ): Promise<PickRecord> {
    const existing = this.picks.get(pickId);
    if (!existing) {
      throw new Error(`Pick not found: ${pickId}`);
    }

    const updated: PickRecord = {
      ...existing,
      status: lifecycleState,
      updated_at: new Date().toISOString(),
    };

    this.picks.set(pickId, updated);
    return updated;
  }

  async findPickById(pickId: string): Promise<PickRecord | null> {
    return this.picks.get(pickId) ?? null;
  }

  async listByLifecycleState(
    lifecycleState: CanonicalPick['lifecycleState'],
    limit?: number | undefined,
  ): Promise<PickRecord[]> {
    const matches = Array.from(this.picks.values())
      .filter((pick) => pick.status === lifecycleState)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));

    return limit === undefined ? matches : matches.slice(0, limit);
  }

  async persistPromotionDecision(
    input: PromotionDecisionPersistenceInput,
  ): Promise<PromotionPersistenceResult> {
    const existing = this.picks.get(input.pickId);
    if (!existing) {
      throw new Error(`Pick not found: ${input.pickId}`);
    }

    const updated: PickRecord = {
      ...existing,
      approval_status: input.approvalStatus,
      promotion_status: input.promotionStatus,
      promotion_target: input.promotionTarget ?? null,
      promotion_score: input.promotionScore ?? null,
      promotion_reason: input.promotionReason ?? null,
      promotion_version: input.promotionVersion,
      promotion_decided_at: input.promotionDecidedAt,
      promotion_decided_by: input.promotionDecidedBy,
      updated_at: new Date().toISOString(),
    };

    const history: PromotionHistoryRecord = {
      id: `${input.pickId}_promotion_${this.promotionHistory.length + 1}`,
      pick_id: input.pickId,
      target: input.target,
      status: input.promotionStatus,
      score: input.promotionScore ?? null,
      reason: input.promotionReason ?? null,
      version: input.promotionVersion,
      decided_at: input.promotionDecidedAt,
      decided_by: input.promotionDecidedBy,
      override_action: input.overrideAction ?? null,
      payload: toJsonObject(input.payload),
      created_at: input.promotionDecidedAt,
    };

    this.picks.set(updated.id, updated);
    this.promotionHistory.push(history);

    return {
      pick: updated,
      history,
    };
  }

  async insertPromotionHistoryRow(
    input: PromotionHistoryInsertInput,
  ): Promise<PromotionHistoryRecord> {
    const history: PromotionHistoryRecord = {
      id: `${input.pickId}_promotion_${this.promotionHistory.length + 1}`,
      pick_id: input.pickId,
      target: input.target,
      status: input.promotionStatus,
      score: input.promotionScore ?? null,
      reason: input.promotionReason ?? null,
      version: input.promotionVersion,
      decided_at: input.promotionDecidedAt,
      decided_by: input.promotionDecidedBy,
      override_action: input.overrideAction ?? null,
      payload: toJsonObject(input.payload),
      created_at: input.promotionDecidedAt,
    };
    this.promotionHistory.push(history);
    return history;
  }

  async getPromotionBoardState(
    input: PromotionBoardStateQuery,
  ): Promise<PromotionBoardStateSnapshot> {
    // Only count picks that are currently active on the board.
    // Settled and voided picks no longer occupy board capacity.
    const promoted = Array.from(this.picks.values()).filter(
      (pick) =>
        pick.promotion_target === input.target &&
        (pick.promotion_status === 'qualified' || pick.promotion_status === 'promoted') &&
        pick.status !== 'settled' &&
        pick.status !== 'voided',
    );

    return {
      currentBoardCount: promoted.length,
      sameSportCount: countMatchingSport(promoted, input.sport),
      sameGameCount: countMatchingEvent(promoted, input.eventName),
      duplicateCount: promoted.filter(
        (pick) => pick.market === input.market && pick.selection === input.selection,
      ).length,
    };
  }
}

export class InMemoryOutboxRepository implements OutboxRepository {
  private readonly entries: OutboxRecord[] = [];

  async enqueue(input: OutboxCreateInput): Promise<OutboxRecord> {
    const now = new Date().toISOString();
    const record: OutboxRecord = {
      id: `${input.pickId}_${this.entries.length + 1}`,
      pick_id: input.pickId,
      target: input.target,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: null,
      last_error: null,
      payload: toJsonObject(input.payload),
      claimed_at: null,
      claimed_by: null,
      idempotency_key: input.idempotencyKey,
      created_at: now,
      updated_at: now,
    };

    this.entries.push(record);
    return record;
  }

  async findByPickAndTarget(
    pickId: string,
    target: string,
    statuses: readonly string[] = ['pending', 'processing', 'sent'],
  ): Promise<OutboxRecord | null> {
    return (
      this.entries.find(
        (entry) =>
          entry.pick_id === pickId &&
          entry.target === target &&
          statuses.includes(entry.status),
      ) ?? null
    );
  }

  async findLatestByPick(
    pickId: string,
    statuses: readonly string[] = ['sent'],
  ): Promise<OutboxRecord | null> {
    return (
      [...this.entries]
        .filter((entry) => entry.pick_id === pickId && statuses.includes(entry.status))
        .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null
    );
  }

  async claimNext(target: string, workerId: string): Promise<OutboxRecord | null> {
    const next = this.entries.find(
      (entry) =>
        entry.target === target &&
        entry.status === 'pending' &&
        entry.claimed_at === null &&
        entry.claimed_by === null,
    );

    if (!next) {
      return null;
    }

    const now = new Date().toISOString();
    next.status = 'processing';
    next.claimed_at = now;
    next.claimed_by = workerId;
    next.updated_at = now;
    return next;
  }

  async markSent(outboxId: string): Promise<OutboxRecord> {
    const existing = this.entries.find((entry) => entry.id === outboxId);
    if (!existing) {
      throw new Error(`Outbox record not found: ${outboxId}`);
    }

    existing.status = 'sent';
    existing.updated_at = new Date().toISOString();
    return existing;
  }

  async markFailed(
    outboxId: string,
    errorMessage: string,
    nextAttemptAt?: string | undefined,
  ): Promise<OutboxRecord> {
    const existing = this.entries.find((entry) => entry.id === outboxId);
    if (!existing) {
      throw new Error(`Outbox record not found: ${outboxId}`);
    }

    existing.status = 'failed';
    existing.last_error = errorMessage;
    existing.next_attempt_at = nextAttemptAt ?? null;
    existing.attempt_count += 1;
    existing.claimed_at = null;
    existing.claimed_by = null;
    existing.updated_at = new Date().toISOString();
    return existing;
  }

  async markDeadLetter(
    outboxId: string,
    errorMessage: string,
  ): Promise<OutboxRecord> {
    const existing = this.entries.find((entry) => entry.id === outboxId);
    if (!existing) {
      throw new Error(`Outbox record not found: ${outboxId}`);
    }

    existing.status = 'dead_letter';
    existing.last_error = errorMessage;
    existing.next_attempt_at = null;
    existing.claimed_at = null;
    existing.claimed_by = null;
    existing.updated_at = new Date().toISOString();
    return existing;
  }
}

export class InMemoryAlertDetectionRepository implements AlertDetectionRepository {
  private readonly records = new Map<string, AlertDetectionRecord>();

  async saveDetection(input: AlertDetectionCreateInput): Promise<AlertDetectionRecord | null> {
    const existing = this.records.get(input.idempotencyKey);
    if (existing) {
      return null;
    }

    const record: AlertDetectionRecord = {
      id: crypto.randomUUID(),
      idempotency_key: input.idempotencyKey,
      event_id: input.eventId,
      participant_id: input.participantId ?? null,
      market_key: input.marketKey,
      bookmaker_key: input.bookmakerKey,
      baseline_snapshot_at: input.baselineSnapshotAt,
      current_snapshot_at: input.currentSnapshotAt,
      old_line: input.oldLine,
      new_line: input.newLine,
      line_change: input.lineChange,
      line_change_abs: input.lineChangeAbs,
      velocity: input.velocity ?? null,
      time_elapsed_minutes: input.timeElapsedMinutes,
      direction: input.direction,
      market_type: input.marketType,
      tier: input.tier,
      notified: input.notified ?? false,
      notified_at: input.notifiedAt ?? null,
      notified_channels: input.notifiedChannels ?? null,
      cooldown_expires_at: input.cooldownExpiresAt ?? null,
      metadata: toJsonObject(input.metadata),
      created_at: new Date().toISOString(),
    };

    this.records.set(record.idempotency_key, record);
    return record;
  }

  async findActiveCooldown(input: AlertCooldownQuery): Promise<AlertDetectionRecord | null> {
    return (
      Array.from(this.records.values())
        .filter(
          (record) =>
            record.event_id === input.eventId &&
            (record.participant_id ?? null) === (input.participantId ?? null) &&
            record.market_key === input.marketKey &&
            record.bookmaker_key === input.bookmakerKey &&
            record.tier === input.tier &&
            record.notified === true &&
            typeof record.cooldown_expires_at === 'string' &&
            record.cooldown_expires_at > input.now,
        )
        .sort((left, right) =>
          (right.notified_at ?? '').localeCompare(left.notified_at ?? ''),
        )[0] ?? null
    );
  }

  async listRecent(limit = 20): Promise<AlertDetectionRecord[]> {
    return Array.from(this.records.values())
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit);
  }
}

export class InMemoryReceiptRepository implements ReceiptRepository {
  private readonly receipts: ReceiptRecord[] = [];

  async record(input: ReceiptCreateInput): Promise<ReceiptRecord> {
    const record: ReceiptRecord = {
      id: `receipt_${this.receipts.length + 1}`,
      outbox_id: input.outboxId,
      external_id: input.externalId ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      receipt_type: input.receiptType,
      status: input.status,
      channel: input.channel ?? null,
      payload: toJsonObject(input.payload),
      recorded_at: new Date().toISOString(),
    };

    this.receipts.push(record);
    return record;
  }

  async findLatestByOutboxId(
    outboxId: string,
    receiptType?: string | undefined,
  ): Promise<ReceiptRecord | null> {
    const matching = this.receipts
      .filter(
        (record) =>
          record.outbox_id === outboxId &&
          (receiptType === undefined || record.receipt_type === receiptType),
      )
      .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at));

    return matching[0] ?? null;
  }
}

export class InMemoryGradeResultRepository implements GradeResultRepository {
  private readonly records: GradeResultRecord[] = [];

  async insert(input: GradeResultInsertInput): Promise<GradeResultRecord> {
    const duplicate = this.records.find(
      (record) =>
        record.event_id === input.eventId &&
        record.participant_id === input.participantId &&
        record.market_key === input.marketKey &&
        record.source === input.source,
    );

    if (duplicate) {
      return duplicate;
    }

    const record: GradeResultRecord = {
      id: `game_result_${this.records.length + 1}`,
      event_id: input.eventId,
      participant_id: input.participantId,
      market_key: input.marketKey,
      actual_value: input.actualValue,
      source: input.source,
      sourced_at: input.sourcedAt,
      created_at: new Date().toISOString(),
    };

    this.records.push(record);
    return record;
  }

  async findResult(
    criteria: GradeResultLookupCriteria,
  ): Promise<GradeResultRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.event_id === criteria.eventId &&
          record.participant_id === criteria.participantId &&
          record.market_key === criteria.marketKey,
      ) ?? null
    );
  }

  async listByEvent(eventId: string): Promise<GradeResultRecord[]> {
    return this.records.filter((record) => record.event_id === eventId);
  }
}

export class InMemorySettlementRepository implements SettlementRepository {
  private readonly settlements: SettlementRecord[] = [];

  async record(input: SettlementCreateInput): Promise<SettlementRecord> {
    const record: SettlementRecord = {
      id: `settlement_${this.settlements.length + 1}`,
      pick_id: input.pickId,
      status: input.status,
      result: input.result ?? null,
      source: input.source,
      confidence: input.confidence,
      evidence_ref: input.evidenceRef,
      notes: input.notes ?? null,
      review_reason: input.reviewReason ?? null,
      settled_by: input.settledBy,
      settled_at: input.settledAt,
      corrects_id: input.correctsId ?? null,
      payload: toJsonObject(input.payload),
      created_at: input.settledAt,
    };

    this.settlements.push(record);
    return record;
  }

  async findLatestForPick(pickId: string): Promise<SettlementRecord | null> {
    const matches = this.settlements
      .filter((record) => record.pick_id === pickId)
      .sort(compareSettlementRecordsDescending);

    return matches[0] ?? null;
  }

  async listByPick(pickId: string): Promise<SettlementRecord[]> {
    return this.settlements
      .filter((record) => record.pick_id === pickId)
      .sort(compareSettlementRecordsDescending);
  }

  async listRecent(limit = 12): Promise<SettlementRecord[]> {
    return [...this.settlements]
      .sort(compareSettlementRecordsDescending)
      .slice(0, limit);
  }

  async updatePayload(
    settlementId: string,
    payload: Record<string, unknown>,
  ): Promise<SettlementRecord> {
    const existing = this.settlements.find((record) => record.id === settlementId);
    if (!existing) {
      throw new Error(`Settlement record not found: ${settlementId}`);
    }

    existing.payload = toJsonObject(payload);
    return existing;
  }
}

export class InMemoryProviderOfferRepository implements ProviderOfferRepository {
  private readonly offers = new Map<string, ProviderOfferRecord>();

  async upsertBatch(offers: ProviderOfferUpsertInput[]): Promise<ProviderOfferUpsertResult> {
    let insertedCount = 0;
    let updatedCount = 0;

    for (const offer of offers) {
      const existing = this.offers.get(offer.idempotencyKey);
      if (existing) {
        this.offers.set(
          offer.idempotencyKey,
          mapProviderOfferInsertToRecord(offer, existing.id, existing.created_at),
        );
        updatedCount += 1;
      } else {
        this.offers.set(offer.idempotencyKey, mapProviderOfferInsertToRecord(offer));
        insertedCount += 1;
      }
    }

    return {
      insertedCount,
      updatedCount,
      totalProcessed: offers.length,
    };
  }

  async listByProvider(providerKey: string): Promise<ProviderOfferRecord[]> {
    return Array.from(this.offers.values())
      .filter((offer) => offer.provider_key === providerKey)
      .sort((left, right) => right.snapshot_at.localeCompare(left.snapshot_at));
  }

  async listAll(): Promise<ProviderOfferRecord[]> {
    return Array.from(this.offers.values()).sort(
      (left, right) => right.snapshot_at.localeCompare(left.snapshot_at),
    );
  }

  async findClosingLine(
    criteria: ClosingLineLookupCriteria,
  ): Promise<ProviderOfferRecord | null> {
    const providerParticipantId =
      criteria.providerParticipantId === undefined ? null : criteria.providerParticipantId;

    return (
      Array.from(this.offers.values())
        .filter(
          (offer) =>
            offer.provider_event_id === criteria.providerEventId &&
            offer.provider_market_key === criteria.providerMarketKey &&
            offer.snapshot_at <= criteria.before &&
            offer.provider_participant_id === providerParticipantId,
        )
        .sort((left, right) => right.snapshot_at.localeCompare(left.snapshot_at))[0] ?? null
    );
  }
}

export class InMemoryParticipantRepository implements ParticipantRepository {
  private readonly participants = new Map<string, ParticipantRow>();

  constructor(seed: ParticipantRow[] = []) {
    for (const row of seed) {
      this.participants.set(row.id, row);
    }
  }

  async upsertByExternalId(input: ParticipantUpsertInput): Promise<ParticipantRow> {
    const existing = Array.from(this.participants.values()).find(
      (row) => row.external_id === input.externalId,
    );
    const now = new Date().toISOString();
    const record: ParticipantRow = {
      id: existing?.id ?? crypto.randomUUID(),
      display_name: input.displayName,
      external_id: input.externalId,
      league: input.league ?? null,
      metadata: toJsonObject(input.metadata),
      participant_type: input.participantType,
      sport: input.sport ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    this.participants.set(record.id, record);
    return record;
  }

  async findByExternalId(externalId: string): Promise<ParticipantRow | null> {
    return (
      Array.from(this.participants.values()).find((row) => row.external_id === externalId) ??
      null
    );
  }

  async findById(participantId: string): Promise<ParticipantRow | null> {
    return this.participants.get(participantId) ?? null;
  }

  async listByType(
    participantType: ParticipantUpsertInput['participantType'],
    sport?: string,
  ): Promise<ParticipantRow[]> {
    return Array.from(this.participants.values())
      .filter(
        (row) =>
          row.participant_type === participantType && (sport ? row.sport === sport : true),
      )
      .sort((left, right) => left.display_name.localeCompare(right.display_name));
  }
}

export class InMemoryEventRepository implements EventRepository {
  private readonly events = new Map<string, EventRow>();

  constructor(seed: EventRow[] = []) {
    for (const row of seed) {
      this.events.set(row.id, row);
    }
  }

  async upsertByExternalId(input: EventUpsertInput): Promise<EventRow> {
    const existing = Array.from(this.events.values()).find(
      (row) => row.external_id === input.externalId,
    );
    const now = new Date().toISOString();
    const record: EventRow = {
      id: existing?.id ?? crypto.randomUUID(),
      sport_id: input.sportId,
      event_name: input.eventName,
      event_date: input.eventDate,
      external_id: input.externalId,
      status: existing && existing.status !== 'scheduled' ? existing.status : input.status,
      metadata: JSON.parse(JSON.stringify(input.metadata)) as Record<string, unknown>,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    this.events.set(record.id, record);
    return record;
  }

  async findByExternalId(externalId: string): Promise<EventRow | null> {
    return Array.from(this.events.values()).find((row) => row.external_id === externalId) ?? null;
  }

  async findById(eventId: string): Promise<EventRow | null> {
    return this.events.get(eventId) ?? null;
  }

  async listUpcoming(sportId?: string, windowDays = 7): Promise<EventRow[]> {
    const now = new Date();
    const start = toIsoDate(addDays(now, -windowDays));
    const end = toIsoDate(addDays(now, windowDays));
    return Array.from(this.events.values())
      .filter(
        (row) =>
          (sportId ? row.sport_id === sportId : true) &&
          row.event_date >= start &&
          row.event_date <= end,
      )
      .sort((left, right) => left.event_date.localeCompare(right.event_date));
  }
}

export class InMemoryEventParticipantRepository implements EventParticipantRepository {
  private readonly rows = new Map<string, EventParticipantRow>();

  constructor(seed: EventParticipantRow[] = []) {
    for (const row of seed) {
      this.rows.set(eventParticipantKey(row.event_id, row.participant_id), row);
    }
  }

  async upsert(input: EventParticipantUpsertInput): Promise<EventParticipantRow> {
    const key = eventParticipantKey(input.eventId, input.participantId);
    const existing = this.rows.get(key);
    if (existing) {
      return existing;
    }

    const row: EventParticipantRow = {
      id: crypto.randomUUID(),
      event_id: input.eventId,
      participant_id: input.participantId,
      role: input.role,
      created_at: new Date().toISOString(),
    };

    this.rows.set(key, row);
    return row;
  }

  async listByEvent(eventId: string): Promise<EventParticipantRow[]> {
    return Array.from(this.rows.values()).filter((row) => row.event_id === eventId);
  }

  async listByParticipant(participantId: string): Promise<EventParticipantRow[]> {
    return Array.from(this.rows.values()).filter((row) => row.participant_id === participantId);
  }
}

export class InMemorySystemRunRepository implements SystemRunRepository {
  private readonly runs = new Map<string, SystemRunRecord>();

  async startRun(input: SystemRunStartInput): Promise<SystemRunRecord> {
    const now = new Date().toISOString();
    const record: SystemRunRecord = {
      id: `run_${this.runs.size + 1}`,
      run_type: input.runType,
      status: 'running',
      started_at: now,
      finished_at: null,
      actor: input.actor ?? null,
      details: toJsonObject(input.details),
      created_at: now,
      idempotency_key: input.idempotencyKey ?? null,
    };

    this.runs.set(record.id, record);
    return record;
  }

  async completeRun(input: SystemRunCompleteInput): Promise<SystemRunRecord> {
    const existing = this.runs.get(input.runId);
    if (!existing) {
      throw new Error(`Run not found: ${input.runId}`);
    }

    const updated: SystemRunRecord = {
      ...existing,
      status: input.status,
      finished_at: new Date().toISOString(),
      details: toJsonObject(input.details ?? {}),
    };

    this.runs.set(updated.id, updated);
    return updated;
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly records: AuditLogRow[] = [];

  async record(input: AuditLogCreateInput): Promise<AuditLogRow> {
    const record: AuditLogRow = {
      id: `audit_${this.records.length + 1}`,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_ref: input.entityRef ?? null,
      action: input.action,
      actor: input.actor ?? null,
      payload: toJsonObject(input.payload),
      created_at: new Date().toISOString(),
    };

    this.records.push(record);
    return record;
  }
}

export class InMemoryReferenceDataRepository implements ReferenceDataRepository {
  private readonly catalog: ReferenceDataCatalog;
  private readonly participants: ParticipantRow[];
  private readonly events: EventRow[];

  constructor(
    catalog: ReferenceDataCatalog,
    options: {
      participants?: ParticipantRow[];
      events?: EventRow[];
    } = {},
  ) {
    this.catalog = catalog;
    this.participants = options.participants ?? [];
    this.events = options.events ?? [];
  }

  async getCatalog(): Promise<ReferenceDataCatalog> {
    return this.catalog;
  }

  async searchTeams(sportId: string, query: string, limit = 20): Promise<TeamSearchResult[]> {
    const sport = this.catalog.sports.find((s) => s.id === sportId);
    if (!sport) return [];
    const lowerQuery = query.toLowerCase();
    return sport.teams
      .filter((t) => t.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map((t) => ({ participantId: `team:${sportId}:${t}`, displayName: t, sport: sportId }));
  }

  async searchPlayers(sportId: string, query: string, limit = 20): Promise<PlayerSearchResult[]> {
    const lowerQuery = query.toLowerCase();
    return this.participants
      .filter(
        (row) =>
          row.participant_type === 'player' &&
          row.sport === sportId &&
          row.display_name.toLowerCase().includes(lowerQuery),
      )
      .slice(0, limit)
      .map((row) => ({
        participantId: row.id,
        displayName: row.display_name,
        sport: row.sport ?? sportId,
      }));
  }

  async listEvents(sportId: string, date: string): Promise<EventSearchResult[]> {
    return this.events
      .filter((row) => row.sport_id === sportId && row.event_date === date)
      .sort((left, right) => left.event_name.localeCompare(right.event_name))
      .map((row) => ({
        eventId: row.id,
        eventName: row.event_name,
        eventDate: row.event_date,
        status: row.status,
        sportId: row.sport_id,
      }));
  }
}

export class DatabaseSubmissionRepository implements SubmissionRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async saveSubmission(input: SubmissionCreateInput): Promise<SubmissionRecord> {
    const { data, error } = await this.client
      .from('submissions')
      .insert({
        id: input.id,
        source: input.payload.source,
        submitted_by: input.payload.submittedBy ?? null,
        payload: {
          market: input.payload.market,
          selection: input.payload.selection,
          line: input.payload.line,
          odds: input.payload.odds,
          stakeUnits: input.payload.stakeUnits,
          confidence: input.payload.confidence,
          eventName: input.payload.eventName,
          metadata: toJsonObject(input.payload.metadata ?? {}),
        } as Json,
        status: 'validated',
        received_at: input.receivedAt,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to save submission: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }

  async saveSubmissionEvent(
    input: SubmissionEventCreateInput,
  ): Promise<SubmissionEventRecord> {
    const { data, error } = await this.client
      .from('submission_events')
      .insert({
        submission_id: input.submissionId,
        event_name: input.eventName,
        payload: toJsonObject(input.payload),
        created_at: input.createdAt,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to save submission event: ${error?.message ?? 'unknown error'}`,
      );
    }

    return data;
  }
}

export class DatabasePickRepository implements PickRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async savePick(pick: CanonicalPick): Promise<PickRecord> {
    const { data, error } = await this.client
      .from('picks')
      .insert({
        id: pick.id,
        submission_id: pick.submissionId,
        participant_id: null,
        market: pick.market,
        selection: pick.selection,
        line: pick.line ?? null,
        odds: pick.odds ?? null,
        stake_units: pick.stakeUnits ?? null,
        confidence: pick.confidence ?? null,
        source: pick.source,
        approval_status: pick.approvalStatus,
        promotion_status: pick.promotionStatus,
        promotion_target: pick.promotionTarget ?? null,
        promotion_score: pick.promotionScore ?? null,
        promotion_reason: pick.promotionReason ?? null,
        promotion_version: pick.promotionVersion ?? null,
        promotion_decided_at: pick.promotionDecidedAt ?? null,
        promotion_decided_by: pick.promotionDecidedBy ?? null,
        status: pick.lifecycleState,
        posted_at: null,
        settled_at: null,
        metadata: toJsonObject(pick.metadata),
        created_at: pick.createdAt,
        updated_at: pick.createdAt,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to save pick: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }

  async saveLifecycleEvent(event: LifecycleEvent): Promise<PickLifecycleRecord> {
    const { data, error } = await this.client
      .from('pick_lifecycle')
      .insert({
        pick_id: event.pickId,
        from_state: event.fromState ?? null,
        to_state: event.toState,
        writer_role: event.writerRole,
        reason: event.reason,
        payload: {},
        created_at: event.createdAt,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to save lifecycle event: ${error?.message ?? 'unknown error'}`,
      );
    }

    return data;
  }

  async updatePickLifecycleState(
    pickId: string,
    lifecycleState: CanonicalPick['lifecycleState'],
  ): Promise<PickRecord> {
    const updates: {
      status: CanonicalPick['lifecycleState'];
      posted_at?: string | null;
      settled_at?: string | null;
    } = {
      status: lifecycleState,
    };

    const now = new Date().toISOString();
    if (lifecycleState === 'posted') {
      updates.posted_at = now;
    }

    if (lifecycleState === 'settled') {
      updates.settled_at = now;
    }

    const { data, error } = await this.client
      .from('picks')
      .update(updates)
      .eq('id', pickId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update pick lifecycle: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }

  async findPickById(pickId: string): Promise<PickRecord | null> {
    const { data, error } = await this.client
      .from('picks')
      .select()
      .eq('id', pickId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find pick: ${error.message}`);
    }

    return data;
  }

  async listByLifecycleState(
    lifecycleState: CanonicalPick['lifecycleState'],
    limit?: number | undefined,
  ): Promise<PickRecord[]> {
    let query = this.client
      .from('picks')
      .select('*')
      .eq('status', lifecycleState)
      .order('created_at', { ascending: true });

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list picks by lifecycle state: ${error.message}`);
    }

    return data ?? [];
  }

  async persistPromotionDecision(
    input: PromotionDecisionPersistenceInput,
  ): Promise<PromotionPersistenceResult> {
    const { data: pick, error: pickError } = await this.client
      .from('picks')
      .update({
        approval_status: input.approvalStatus,
        promotion_status: input.promotionStatus,
        promotion_target: input.promotionTarget ?? null,
        promotion_score: input.promotionScore ?? null,
        promotion_reason: input.promotionReason ?? null,
        promotion_version: input.promotionVersion,
        promotion_decided_at: input.promotionDecidedAt,
        promotion_decided_by: input.promotionDecidedBy,
      })
      .eq('id', input.pickId)
      .select()
      .single();

    if (pickError || !pick) {
      throw new Error(
        `Failed to persist promotion state: ${pickError?.message ?? 'unknown error'}`,
      );
    }

    const { data: history, error: historyError } = await this.client
      .from('pick_promotion_history')
      .insert({
        pick_id: input.pickId,
        target: input.target,
        status: input.promotionStatus,
        score: input.promotionScore ?? null,
        reason: input.promotionReason ?? null,
        version: input.promotionVersion,
        decided_at: input.promotionDecidedAt,
        decided_by: input.promotionDecidedBy,
        override_action: input.overrideAction ?? null,
        payload: toJsonObject(input.payload),
      })
      .select()
      .single();

    if (historyError || !history) {
      throw new Error(
        `Failed to persist promotion history: ${historyError?.message ?? 'unknown error'}`,
      );
    }

    return {
      pick,
      history,
    };
  }

  async insertPromotionHistoryRow(
    input: PromotionHistoryInsertInput,
  ): Promise<PromotionHistoryRecord> {
    const { data, error } = await this.client
      .from('pick_promotion_history')
      .insert({
        pick_id: input.pickId,
        target: input.target,
        status: input.promotionStatus,
        score: input.promotionScore ?? null,
        reason: input.promotionReason ?? null,
        version: input.promotionVersion,
        decided_at: input.promotionDecidedAt,
        decided_by: input.promotionDecidedBy,
        override_action: input.overrideAction ?? null,
        payload: toJsonObject(input.payload),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to insert promotion history: ${error?.message ?? 'unknown error'}`,
      );
    }

    return data;
  }

  async getPromotionBoardState(
    input: PromotionBoardStateQuery,
  ): Promise<PromotionBoardStateSnapshot> {
    // Only count picks that are currently active on the board.
    // Settled and voided picks no longer occupy board capacity.
    const { data, error } = await this.client
      .from('picks')
      .select('market,selection,metadata,promotion_target,promotion_status')
      .eq('promotion_target', input.target)
      .in('promotion_status', ['qualified', 'promoted'])
      .neq('status', 'settled')
      .neq('status', 'voided');

    if (error) {
      throw new Error(`Failed to query promotion board state: ${error.message}`);
    }

    const promoted = data ?? [];
    return {
      currentBoardCount: promoted.length,
      sameSportCount: promoted.filter((pick) => metadataSport(pick.metadata) === input.sport).length,
      sameGameCount: promoted.filter((pick) => metadataEventName(pick.metadata) === input.eventName).length,
      duplicateCount: promoted.filter(
        (pick) => pick.market === input.market && pick.selection === input.selection,
      ).length,
    };
  }
}

export class DatabaseOutboxRepository implements OutboxRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async enqueue(input: OutboxCreateInput): Promise<OutboxRecord> {
    const { data, error } = await this.client
      .from('distribution_outbox')
      .insert({
        pick_id: input.pickId,
        target: input.target,
        status: 'pending',
        attempt_count: 0,
        payload: toJsonObject(input.payload),
        idempotency_key: input.idempotencyKey,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to enqueue outbox work: ${error?.message ?? 'unknown error'}`);
    }

    return data as OutboxRecord;
  }

  async findByPickAndTarget(
    pickId: string,
    target: string,
    statuses: readonly string[] = ['pending', 'processing', 'sent'],
  ): Promise<OutboxRecord | null> {
    const { data, error } = await this.client
      .from('distribution_outbox')
      .select('*')
      .eq('pick_id', pickId)
      .eq('target', target)
      .in('status', [...statuses])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find outbox row by pick and target: ${error.message}`);
    }

    return (data as OutboxRecord | null) ?? null;
  }

  async findLatestByPick(
    pickId: string,
    statuses: readonly string[] = ['sent'],
  ): Promise<OutboxRecord | null> {
    const { data, error } = await this.client
      .from('distribution_outbox')
      .select('*')
      .eq('pick_id', pickId)
      .in('status', [...statuses])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find latest outbox row by pick: ${error.message}`);
    }

    return (data as OutboxRecord | null) ?? null;
  }

  async claimNext(target: string, workerId: string): Promise<OutboxRecord | null> {
    const { data: pending, error: selectError } = await this.client
      .from('distribution_outbox')
      .select()
      .eq('target', target)
      .eq('status', 'pending')
      .is('claimed_at', null)
      .is('claimed_by', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to claim outbox work: ${selectError.message}`);
    }

    if (!pending) {
      return null;
    }

    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('distribution_outbox')
      .update({
        status: 'processing',
        claimed_at: now,
        claimed_by: workerId,
      })
      .eq('id', pending.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update outbox claim: ${error.message}`);
    }

    return (data as OutboxRecord | null) ?? null;
  }

  async markSent(outboxId: string): Promise<OutboxRecord> {
    const { data, error } = await this.client
      .from('distribution_outbox')
      .update({
        status: 'sent',
      })
      .eq('id', outboxId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to mark outbox sent: ${error?.message ?? 'unknown error'}`);
    }

    return data as OutboxRecord;
  }

  async markFailed(
    outboxId: string,
    errorMessage: string,
    nextAttemptAt?: string | undefined,
  ): Promise<OutboxRecord> {
    const { data: existing, error: existingError } = await this.client
      .from('distribution_outbox')
      .select()
      .eq('id', outboxId)
      .single();

    if (existingError || !existing) {
      throw new Error(
        `Failed to load outbox record for failure update: ${existingError?.message ?? 'unknown error'}`,
      );
    }

    const { data, error } = await this.client
      .from('distribution_outbox')
      .update({
        status: 'failed',
        last_error: errorMessage,
        next_attempt_at: nextAttemptAt ?? null,
        attempt_count: existing.attempt_count + 1,
        claimed_at: null,
        claimed_by: null,
      })
      .eq('id', outboxId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to mark outbox failed: ${error?.message ?? 'unknown error'}`);
    }

    return data as OutboxRecord;
  }

  async markDeadLetter(
    outboxId: string,
    errorMessage: string,
  ): Promise<OutboxRecord> {
    const { data: existing, error: existingError } = await this.client
      .from('distribution_outbox')
      .select()
      .eq('id', outboxId)
      .single();

    if (existingError || !existing) {
      throw new Error(
        `Failed to load outbox record for dead-letter update: ${existingError?.message ?? 'unknown error'}`,
      );
    }

    const { data, error } = await this.client
      .from('distribution_outbox')
      .update({
        status: 'dead_letter',
        last_error: errorMessage,
        next_attempt_at: null,
        claimed_at: null,
        claimed_by: null,
      })
      .eq('id', outboxId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to mark outbox dead_letter: ${error?.message ?? 'unknown error'}`);
    }

    return data as OutboxRecord;
  }
}

export class DatabaseAlertDetectionRepository implements AlertDetectionRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async saveDetection(input: AlertDetectionCreateInput): Promise<AlertDetectionRecord | null> {
    const { data, error } = await this.client
      .from('alert_detections')
      .insert({
        idempotency_key: input.idempotencyKey,
        event_id: input.eventId,
        participant_id: input.participantId ?? null,
        market_key: input.marketKey,
        bookmaker_key: input.bookmakerKey,
        baseline_snapshot_at: input.baselineSnapshotAt,
        current_snapshot_at: input.currentSnapshotAt,
        old_line: input.oldLine,
        new_line: input.newLine,
        line_change: input.lineChange,
        line_change_abs: input.lineChangeAbs,
        velocity: input.velocity ?? null,
        time_elapsed_minutes: input.timeElapsedMinutes,
        direction: input.direction,
        market_type: input.marketType,
        tier: input.tier,
        notified: input.notified ?? false,
        notified_at: input.notifiedAt ?? null,
        notified_channels: input.notifiedChannels ?? null,
        cooldown_expires_at: input.cooldownExpiresAt ?? null,
        metadata: toJsonObject(input.metadata),
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return null;
      }

      throw new Error(`Failed to save alert detection: ${error.message}`);
    }

    return data;
  }

  async findActiveCooldown(input: AlertCooldownQuery): Promise<AlertDetectionRecord | null> {
    const { data, error } = await this.client
      .from('alert_detections')
      .select('*')
      .eq('event_id', input.eventId)
      .eq('participant_id', input.participantId ?? null)
      .eq('market_key', input.marketKey)
      .eq('bookmaker_key', input.bookmakerKey)
      .eq('tier', input.tier)
      .eq('notified', true)
      .gt('cooldown_expires_at', input.now)
      .order('notified_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to read active alert cooldown: ${error.message}`);
    }

    return data;
  }

  async listRecent(limit = 20): Promise<AlertDetectionRecord[]> {
    const { data, error } = await this.client
      .from('alert_detections')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list alert detections: ${error.message}`);
    }

    return data ?? [];
  }
}

export class DatabaseReceiptRepository implements ReceiptRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async record(input: ReceiptCreateInput): Promise<ReceiptRecord> {
    const { data, error } = await this.client
      .from('distribution_receipts')
      .insert({
        outbox_id: input.outboxId,
        external_id: input.externalId ?? null,
        idempotency_key: input.idempotencyKey ?? null,
        receipt_type: input.receiptType,
        status: input.status,
        channel: input.channel ?? null,
        payload: toJsonObject(input.payload),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to record receipt: ${error?.message ?? 'unknown error'}`);
    }

    return data as ReceiptRecord;
  }

  async findLatestByOutboxId(
    outboxId: string,
    receiptType?: string | undefined,
  ): Promise<ReceiptRecord | null> {
    let query = this.client
      .from('distribution_receipts')
      .select('*')
      .eq('outbox_id', outboxId)
      .order('recorded_at', { ascending: false })
      .limit(1);

    if (receiptType) {
      query = query.eq('receipt_type', receiptType);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`Failed to find latest receipt by outbox id: ${error.message}`);
    }

    return (data as ReceiptRecord | null) ?? null;
  }
}

export class DatabaseSettlementRepository implements SettlementRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async record(input: SettlementCreateInput): Promise<SettlementRecord> {
    const { data, error } = await this.client
      .from('settlement_records')
      .insert({
        pick_id: input.pickId,
        status: input.status,
        result: input.result ?? null,
        source: input.source,
        confidence: input.confidence,
        evidence_ref: input.evidenceRef,
        notes: input.notes ?? null,
        review_reason: input.reviewReason ?? null,
        settled_by: input.settledBy,
        settled_at: input.settledAt,
        corrects_id: input.correctsId ?? null,
        payload: toJsonObject(input.payload),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to record settlement: ${error?.message ?? 'unknown error'}`,
      );
    }

    return data;
  }

  async findLatestForPick(pickId: string): Promise<SettlementRecord | null> {
    const { data, error } = await this.client
      .from('settlement_records')
      .select()
      .eq('pick_id', pickId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load latest settlement: ${error.message}`);
    }

    return data;
  }

  async listByPick(pickId: string): Promise<SettlementRecord[]> {
    const { data, error } = await this.client
      .from('settlement_records')
      .select()
      .eq('pick_id', pickId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list settlements for pick: ${error.message}`);
    }

    return (data ?? []).sort(compareSettlementRecordsDescending);
  }

  async listRecent(limit = 12): Promise<SettlementRecord[]> {
    const { data, error } = await this.client
      .from('settlement_records')
      .select()
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list settlements: ${error.message}`);
    }

    return data ?? [];
  }

  async updatePayload(
    settlementId: string,
    payload: Record<string, unknown>,
  ): Promise<SettlementRecord> {
    const { data, error } = await this.client
      .from('settlement_records')
      .update({
        payload: toJsonObject(payload),
      })
      .eq('id', settlementId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to update settlement payload: ${error?.message ?? 'unknown error'}`,
      );
    }

    return data;
  }
}

export class DatabaseGradeResultRepository implements GradeResultRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async insert(input: GradeResultInsertInput): Promise<GradeResultRecord> {
    const { data, error } = await this.client
      .from('game_results')
      .insert({
        event_id: input.eventId,
        participant_id: input.participantId,
        market_key: input.marketKey,
        actual_value: input.actualValue,
        source: input.source,
        sourced_at: input.sourcedAt,
      })
      .select()
      .single();

    if (
      error &&
      (error.code === '23505' ||
        error.message.toLowerCase().includes('duplicate key') ||
        error.message.toLowerCase().includes('duplicate'))
    ) {
      const existing = await this.findResult({
        eventId: input.eventId,
        participantId: input.participantId,
        marketKey: input.marketKey,
      });
      if (existing) {
        return existing;
      }
    }

    if (error || !data) {
      throw new Error(`Failed to insert game result: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }

  async findResult(
    criteria: GradeResultLookupCriteria,
  ): Promise<GradeResultRecord | null> {
    let query = this.client
      .from('game_results')
      .select()
      .select('*')
      .eq('event_id', criteria.eventId)
      .eq('market_key', criteria.marketKey);

    if (criteria.participantId === null) {
      query = query.is('participant_id', null);
    } else {
      query = query.eq('participant_id', criteria.participantId);
    }

    const { data, error } = await query
      .order('sourced_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find game result: ${error.message}`);
    }

    return data;
  }

  async listByEvent(eventId: string): Promise<GradeResultRecord[]> {
    const { data, error } = await this.client
      .from('game_results')
      .select('*')
      .eq('event_id', eventId)
      .order('sourced_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list game results: ${error.message}`);
    }

    return data ?? [];
  }
}

export class DatabaseSystemRunRepository implements SystemRunRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async startRun(input: SystemRunStartInput): Promise<SystemRunRecord> {
    const { data, error } = await this.client
      .from('system_runs')
      .insert({
        run_type: input.runType,
        status: 'running',
        actor: input.actor ?? null,
        details: toJsonObject(input.details),
        idempotency_key: input.idempotencyKey ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to start system run: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }

  async completeRun(input: SystemRunCompleteInput): Promise<SystemRunRecord> {
    // finished_at is set server-side by the system_runs_set_finished_at trigger,
    // which uses now() (DB clock) to avoid client/server clock skew.
    const { data, error } = await this.client
      .from('system_runs')
      .update({
        status: input.status,
        details: toJsonObject(input.details ?? {}),
      })
      .eq('id', input.runId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to complete system run: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }
}

export class DatabaseProviderOfferRepository implements ProviderOfferRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async upsertBatch(offers: ProviderOfferUpsertInput[]): Promise<ProviderOfferUpsertResult> {
    if (offers.length === 0) {
      return {
        insertedCount: 0,
        updatedCount: 0,
        totalProcessed: 0,
      };
    }

    const idempotencyKeys = [...new Set(offers.map((offer) => offer.idempotencyKey))];
    const existingKeys = new Set<string>();
    for (let i = 0; i < idempotencyKeys.length; i += 100) {
      const chunk = idempotencyKeys.slice(i, i + 100);
      const { data: chunkRows, error: existingError } = await this.client
        .from('provider_offers')
        .select('idempotency_key')
        .in('idempotency_key', chunk);
      if (existingError) {
        throw new Error(`Failed to load existing provider offers: ${existingError.message}`);
      }
      for (const row of chunkRows ?? []) {
        existingKeys.add(row.idempotency_key);
      }
    }
    const rows = offers.map(mapProviderOfferInsertToRow);

    const { error } = await this.client
      .from('provider_offers')
      .upsert(rows, { onConflict: 'idempotency_key' });

    if (error) {
      throw new Error(`Failed to upsert provider offers: ${error.message}`);
    }

    return {
      insertedCount: rows.length - existingKeys.size,
      updatedCount: existingKeys.size,
      totalProcessed: rows.length,
    };
  }

  async listByProvider(providerKey: string): Promise<ProviderOfferRecord[]> {
    const { data, error } = await this.client
      .from('provider_offers')
      .select('*')
      .eq('provider_key', providerKey)
      .order('snapshot_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list provider offers: ${error.message}`);
    }

    return data ?? [];
  }

  async listAll(): Promise<ProviderOfferRecord[]> {
    const { data, error } = await this.client
      .from('provider_offers')
      .select('*')
      .order('snapshot_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list provider offers: ${error.message}`);
    }

    return data ?? [];
  }

  async findClosingLine(
    criteria: ClosingLineLookupCriteria,
  ): Promise<ProviderOfferRecord | null> {
    let query = this.client
      .from('provider_offers')
      .select('*')
      .eq('provider_event_id', criteria.providerEventId)
      .eq('provider_market_key', criteria.providerMarketKey)
      .lte('snapshot_at', criteria.before);

    if (criteria.providerParticipantId === undefined || criteria.providerParticipantId === null) {
      query = query.is('provider_participant_id', null);
    } else {
      query = query.eq('provider_participant_id', criteria.providerParticipantId);
    }

    const { data, error } = await query
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find closing line: ${error.message}`);
    }

    return data;
  }
}

export class DatabaseAuditLogRepository implements AuditLogRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async record(input: AuditLogCreateInput): Promise<AuditLogRow> {
    const { data, error } = await this.client
      .from('audit_log')
      .insert({
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        entity_ref: input.entityRef ?? null,
        action: input.action,
        actor: input.actor ?? null,
        payload: toJsonObject(input.payload),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to record audit log: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }
}

export class DatabaseParticipantRepository implements ParticipantRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async upsertByExternalId(input: ParticipantUpsertInput): Promise<ParticipantRow> {
    const row = {
      external_id: input.externalId,
      display_name: input.displayName,
      participant_type: input.participantType,
      sport: input.sport ?? null,
      league: input.league ?? null,
      metadata: toJsonObject(input.metadata),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('participants')
      .upsert(row, { onConflict: 'external_id' })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to upsert participant: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }

  async findByExternalId(externalId: string): Promise<ParticipantRow | null> {
    const { data, error } = await this.client
      .from('participants')
      .select('*')
      .eq('external_id', externalId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load participant by external_id: ${error.message}`);
    }

    return data;
  }

  async findById(participantId: string): Promise<ParticipantRow | null> {
    const { data, error } = await this.client
      .from('participants')
      .select('*')
      .eq('id', participantId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load participant by id: ${error.message}`);
    }

    return data;
  }

  async listByType(participantType: ParticipantUpsertInput['participantType'], sport?: string) {
    let query = this.client
      .from('participants')
      .select('*')
      .eq('participant_type', participantType);
    if (sport) {
      query = query.eq('sport', sport);
    }

    const { data, error } = await query.order('display_name');
    if (error) {
      throw new Error(`Failed to list participants by type: ${error.message}`);
    }

    return data ?? [];
  }
}

export class DatabaseEventRepository implements EventRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async upsertByExternalId(input: EventUpsertInput): Promise<EventRow> {
    const existing = await this.findByExternalId(input.externalId);
    if (existing) {
      const { data, error } = await this.client
        .from('events')
        .update({
          sport_id: input.sportId,
          event_name: input.eventName,
          event_date: input.eventDate,
          metadata: toJsonObject(input.metadata),
          status: existing.status === 'scheduled' ? input.status : existing.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Failed to update event: ${error?.message ?? 'unknown error'}`);
      }

      return data;
    }

    const { data, error } = await this.client
      .from('events')
      .insert({
        external_id: input.externalId,
        sport_id: input.sportId,
        event_name: input.eventName,
        event_date: input.eventDate,
        status: input.status,
        metadata: toJsonObject(input.metadata),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to insert event: ${error?.message ?? 'unknown error'}`);
    }

    return data;
  }

  async findByExternalId(externalId: string): Promise<EventRow | null> {
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .eq('external_id', externalId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load event by external_id: ${error.message}`);
    }

    return data;
  }

  async findById(eventId: string): Promise<EventRow | null> {
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load event by id: ${error.message}`);
    }

    return data;
  }

  async listUpcoming(sportId?: string, windowDays = 7): Promise<EventRow[]> {
    const today = new Date();
    const start = toIsoDate(addDays(today, -windowDays));
    const end = toIsoDate(addDays(today, windowDays));
    let query = this.client
      .from('events')
      .select('*')
      .gte('event_date', start)
      .lte('event_date', end);
    if (sportId) {
      query = query.eq('sport_id', sportId);
    }

    const { data, error } = await query.order('event_date', { ascending: true });
    if (error) {
      throw new Error(`Failed to list upcoming events: ${error.message}`);
    }

    return data ?? [];
  }
}

export class DatabaseEventParticipantRepository implements EventParticipantRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async upsert(input: EventParticipantUpsertInput): Promise<EventParticipantRow> {
    const existing = await this.client
      .from('event_participants')
      .select('*')
      .eq('event_id', input.eventId)
      .eq('participant_id', input.participantId)
      .maybeSingle();

    if (existing.error) {
      throw new Error(`Failed to load event participant: ${existing.error.message}`);
    }
    if (existing.data) {
      return existing.data;
    }

    const { data, error } = await this.client
      .from('event_participants')
      .insert({
        event_id: input.eventId,
        participant_id: input.participantId,
        role: input.role,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to insert event participant link: ${error?.message ?? 'unknown error'}`,
      );
    }

    return data;
  }

  async listByEvent(eventId: string): Promise<EventParticipantRow[]> {
    const { data, error } = await this.client
      .from('event_participants')
      .select('*')
      .eq('event_id', eventId);

    if (error) {
      throw new Error(`Failed to list event participants: ${error.message}`);
    }

    return data ?? [];
  }

  async listByParticipant(participantId: string): Promise<EventParticipantRow[]> {
    const { data, error } = await this.client
      .from('event_participants')
      .select('*')
      .eq('participant_id', participantId);

    if (error) {
      throw new Error(`Failed to list participant event links: ${error.message}`);
    }

    return data ?? [];
  }
}

export class DatabaseReferenceDataRepository implements ReferenceDataRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async getCatalog(): Promise<ReferenceDataCatalog> {
    const [sportsRes, marketTypesRes, statTypesRes, sportsbooksRes, cappersRes, teamsRes] =
      await Promise.all([
        this.client.from('sports').select('*').eq('active', true).order('sort_order'),
        this.client.from('sport_market_types').select('*').order('sort_order'),
        this.client.from('stat_types').select('*').eq('active', true).order('sort_order'),
        this.client.from('sportsbooks').select('*').eq('active', true).order('sort_order'),
        this.client.from('cappers').select('*').eq('active', true),
        this.client
          .from('participants')
          .select('external_id,display_name,sport')
          .eq('participant_type', 'team'),
      ]);

    if (sportsRes.error) throw new Error(`Failed to load sports: ${sportsRes.error.message}`);
    if (marketTypesRes.error) throw new Error(`Failed to load market types: ${marketTypesRes.error.message}`);
    if (statTypesRes.error) throw new Error(`Failed to load stat types: ${statTypesRes.error.message}`);
    if (sportsbooksRes.error) throw new Error(`Failed to load sportsbooks: ${sportsbooksRes.error.message}`);
    if (cappersRes.error) throw new Error(`Failed to load cappers: ${cappersRes.error.message}`);
    if (teamsRes.error) throw new Error(`Failed to load teams: ${teamsRes.error.message}`);

    const sports = (sportsRes.data ?? []).map((sport) => ({
      id: sport.id as string,
      name: sport.display_name as string,
      marketTypes: (marketTypesRes.data ?? [])
        .filter((mt) => mt.sport_id === sport.id)
        .map((mt) => mt.market_type as string) as ReferenceDataCatalog['sports'][number]['marketTypes'],
      statTypes: (statTypesRes.data ?? [])
        .filter((st) => st.sport_id === sport.id)
        .map((st) => st.name as string),
      teams: (teamsRes.data ?? [])
        .filter((t) => t.sport === sport.id)
        .map((t) => t.display_name as string),
    }));

    const sportsbooks = (sportsbooksRes.data ?? []).map((sb) => ({
      id: sb.id as string,
      name: sb.display_name as string,
    }));

    const cappers = (cappersRes.data ?? []).map((c) => c.id as string);

    // ticketTypes are a UI concept — not stored in DB
    const ticketTypes: ReferenceDataCatalog['ticketTypes'] = [
      { id: 'single', name: 'Single', enabled: true },
      { id: 'parlay', name: 'Parlay', enabled: false },
      { id: 'teaser', name: 'Teaser', enabled: false },
      { id: 'round-robin', name: 'Round Robin', enabled: false },
      { id: 'future', name: 'Future', enabled: false },
    ];

    return { sports, sportsbooks, ticketTypes, cappers };
  }

  async searchTeams(sportId: string, query: string, limit = 20): Promise<TeamSearchResult[]> {
    const { data, error } = await this.client
      .from('participants')
      .select('id,display_name,sport')
      .eq('participant_type', 'team')
      .eq('sport', sportId)
      .ilike('display_name', `%${query}%`)
      .limit(limit);

    if (error) throw new Error(`Failed to search teams: ${error.message}`);

    return (data ?? []).map((row) => ({
      participantId: row.id as string,
      displayName: row.display_name as string,
      sport: row.sport as string,
    }));
  }

  async searchPlayers(sportId: string, query: string, limit = 20): Promise<PlayerSearchResult[]> {
    const { data, error } = await this.client
      .from('participants')
      .select('id,display_name,sport')
      .eq('participant_type', 'player')
      .eq('sport', sportId)
      .ilike('display_name', `%${query}%`)
      .limit(limit);

    if (error) throw new Error(`Failed to search players: ${error.message}`);

    return (data ?? []).map((row) => ({
      participantId: row.id as string,
      displayName: row.display_name as string,
      sport: row.sport as string,
    }));
  }

  async listEvents(sportId: string, date: string): Promise<EventSearchResult[]> {
    const { data, error } = await this.client
      .from('events')
      .select('id,event_name,event_date,status,sport_id')
      .eq('sport_id', sportId)
      .eq('event_date', date)
      .order('event_name');

    if (error) throw new Error(`Failed to list events: ${error.message}`);

    return (data ?? []).map((row) => ({
      eventId: row.id as string,
      eventName: row.event_name as string,
      eventDate: row.event_date as string,
      status: row.status as string,
      sportId: row.sport_id as string,
    }));
  }
}

export function createInMemoryRepositoryBundle(): RepositoryBundle {
  const seededTeams = createSeededTeamParticipants();
  const providerOffers = new InMemoryProviderOfferRepository();
  const participants = new InMemoryParticipantRepository(seededTeams);
  const events = new InMemoryEventRepository();
  const eventParticipants = new InMemoryEventParticipantRepository();
  return {
    submissions: new InMemorySubmissionRepository(),
    picks: new InMemoryPickRepository(),
    outbox: new InMemoryOutboxRepository(),
    alertDetections: new InMemoryAlertDetectionRepository(),
    receipts: new InMemoryReceiptRepository(),
    settlements: new InMemorySettlementRepository(),
    providerOffers,
    participants,
    events,
    eventParticipants,
    gradeResults: new InMemoryGradeResultRepository(),
    runs: new InMemorySystemRunRepository(),
    audit: new InMemoryAuditLogRepository(),
    referenceData: new InMemoryReferenceDataRepository(V1_REFERENCE_DATA),
  };
}

export function createDatabaseRepositoryBundle(
  connection: DatabaseConnectionConfig,
): RepositoryBundle {
  return {
    submissions: new DatabaseSubmissionRepository(connection),
    picks: new DatabasePickRepository(connection),
    outbox: new DatabaseOutboxRepository(connection),
    alertDetections: new DatabaseAlertDetectionRepository(connection),
    receipts: new DatabaseReceiptRepository(connection),
    settlements: new DatabaseSettlementRepository(connection),
    providerOffers: new DatabaseProviderOfferRepository(connection),
    participants: new DatabaseParticipantRepository(connection),
    events: new DatabaseEventRepository(connection),
    eventParticipants: new DatabaseEventParticipantRepository(connection),
    gradeResults: new DatabaseGradeResultRepository(connection),
    runs: new DatabaseSystemRunRepository(connection),
    audit: new DatabaseAuditLogRepository(connection),
    referenceData: new DatabaseReferenceDataRepository(connection),
  };
}

export function createInMemoryIngestorRepositoryBundle(): IngestorRepositoryBundle {
  const seededTeams = createSeededTeamParticipants();
  return {
    providerOffers: new InMemoryProviderOfferRepository(),
    runs: new InMemorySystemRunRepository(),
    events: new InMemoryEventRepository(),
    eventParticipants: new InMemoryEventParticipantRepository(),
    participants: new InMemoryParticipantRepository(seededTeams),
    gradeResults: new InMemoryGradeResultRepository(),
  };
}

export function createDatabaseIngestorRepositoryBundle(
  connection: DatabaseConnectionConfig,
): IngestorRepositoryBundle {
  return {
    providerOffers: new DatabaseProviderOfferRepository(connection),
    runs: new DatabaseSystemRunRepository(connection),
    events: new DatabaseEventRepository(connection),
    eventParticipants: new DatabaseEventParticipantRepository(connection),
    participants: new DatabaseParticipantRepository(connection),
    gradeResults: new DatabaseGradeResultRepository(connection),
  };
}

function createSeededTeamParticipants(): ParticipantRow[] {
  const now = new Date().toISOString();
  return V1_REFERENCE_DATA.sports.flatMap((sport) =>
    sport.teams.map((team) => ({
      id: crypto.randomUUID(),
      display_name: team,
      external_id: null,
      league: sport.id.toUpperCase(),
      metadata: toJsonObject({}),
      participant_type: 'team',
      sport: sport.id.toUpperCase(),
      created_at: now,
      updated_at: now,
    })),
  );
}

function toJsonObject(value: Record<string, unknown>): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function eventParticipantKey(eventId: string, participantId: string) {
  return `${eventId}:${participantId}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function countMatchingSport(picks: PickRecord[], sport: string | undefined) {
  if (!sport) {
    return 0;
  }

  return picks.filter((pick) => metadataSport(pick.metadata) === sport).length;
}

function countMatchingEvent(picks: PickRecord[], eventName: string | undefined) {
  if (!eventName) {
    return 0;
  }

  return picks.filter((pick) => metadataEventName(pick.metadata) === eventName).length;
}

function metadataSport(metadata: Json) {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const sport = metadata.sport;
  return typeof sport === 'string' ? sport : undefined;
}

function metadataEventName(metadata: Json) {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const eventName = metadata.eventName;
  return typeof eventName === 'string' ? eventName : undefined;
}

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareSettlementRecordsDescending(
  left: SettlementRecord,
  right: SettlementRecord,
) {
  const createdAtComparison = right.created_at.localeCompare(left.created_at);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return right.id.localeCompare(left.id);
}

function mapProviderOfferInsertToRecord(
  offer: ProviderOfferInsert,
  id: string = crypto.randomUUID(),
  createdAt: string = new Date().toISOString(),
): ProviderOfferRecord {
  return {
    id,
    provider_key: offer.providerKey,
    provider_event_id: offer.providerEventId,
    provider_market_key: offer.providerMarketKey,
    provider_participant_id: offer.providerParticipantId,
    sport_key: offer.sportKey,
    line: offer.line,
    over_odds: offer.overOdds,
    under_odds: offer.underOdds,
    devig_mode: offer.devigMode,
    is_opening: offer.isOpening,
    is_closing: offer.isClosing,
    snapshot_at: offer.snapshotAt,
    idempotency_key: offer.idempotencyKey,
    created_at: createdAt,
  };
}

function mapProviderOfferInsertToRow(offer: ProviderOfferInsert) {
  return {
    provider_key: offer.providerKey,
    provider_event_id: offer.providerEventId,
    provider_market_key: offer.providerMarketKey,
    provider_participant_id: offer.providerParticipantId,
    sport_key: offer.sportKey,
    line: offer.line,
    over_odds: offer.overOdds,
    under_odds: offer.underOdds,
    devig_mode: offer.devigMode,
    is_opening: offer.isOpening,
    is_closing: offer.isClosing,
    snapshot_at: offer.snapshotAt,
    idempotency_key: offer.idempotencyKey,
  };
}
