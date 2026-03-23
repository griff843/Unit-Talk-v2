import {
  V1_REFERENCE_DATA,
  type ReferenceDataCatalog,
} from '@unit-talk/contracts';
import type {
  CanonicalPick,
  LifecycleEvent,
} from '@unit-talk/contracts';
import type {
  AuditLogCreateInput,
  AuditLogRepository,
  EventSearchResult,
  OutboxCreateInput,
  OutboxRepository,
  PickRepository,
  PlayerSearchResult,
  PromotionBoardStateQuery,
  PromotionBoardStateSnapshot,
  PromotionDecisionPersistenceInput,
  PromotionHistoryInsertInput,
  PromotionPersistenceResult,
  ReferenceDataRepository,
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
  AuditLogRow,
  SystemRunRecord,
  OutboxRecord,
  PickRecord,
  PickLifecycleRecord,
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
    const promoted = Array.from(this.picks.values()).filter(
      (pick) =>
        pick.promotion_target === input.target &&
        (pick.promotion_status === 'qualified' || pick.promotion_status === 'promoted'),
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

  constructor(catalog: ReferenceDataCatalog) {
    this.catalog = catalog;
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

  async searchPlayers(_sportId: string, _query: string, _limit?: number): Promise<PlayerSearchResult[]> {
    return [];
  }

  async listEvents(_sportId: string, _date: string): Promise<EventSearchResult[]> {
    return [];
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
    const { data, error } = await this.client
      .from('picks')
      .select('market,selection,metadata,promotion_target,promotion_status')
      .eq('promotion_target', input.target)
      .in('promotion_status', ['qualified', 'promoted']);

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
  return {
    submissions: new InMemorySubmissionRepository(),
    picks: new InMemoryPickRepository(),
    outbox: new InMemoryOutboxRepository(),
    receipts: new InMemoryReceiptRepository(),
    settlements: new InMemorySettlementRepository(),
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
    receipts: new DatabaseReceiptRepository(connection),
    settlements: new DatabaseSettlementRepository(connection),
    runs: new DatabaseSystemRunRepository(connection),
    audit: new DatabaseAuditLogRepository(connection),
    referenceData: new InMemoryReferenceDataRepository(V1_REFERENCE_DATA),
  };
}

function toJsonObject(value: Record<string, unknown>): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
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
