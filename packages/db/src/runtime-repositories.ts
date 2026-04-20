import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InvalidTransitionError, InvalidPickStateError } from './lifecycle.js';
import {
  V1_REFERENCE_DATA,
  type ProviderOfferInsert,
  type ReferenceDataCatalog,
  type MemberTier,
  memberTiers,
} from '@unit-talk/contracts';
import type {
  CanonicalPick,
  LifecycleEvent,
  PickLifecycleState,
} from '@unit-talk/contracts';
import type {
  AlertCooldownQuery,
  AlertDetectionCreateInput,
  AlertDetectionListOptions,
  AlertDetectionRepository,
  AlertDetectionStatusSummary,
  AlertNotificationUpdateInput,
  AuditLogCreateInput,
  AuditLogRepository,
  BrowseSearchResult,
  ClosingLineLookupCriteria,
  EventParticipantRepository,
  EventParticipantUpsertInput,
  EventRepository,
  EventSearchResult,
  EventUpsertInput,
  ExperimentLedgerCreateInput,
  ExperimentLedgerRepository,
  ExecutionQualityRepository,
  GradeResultInsertInput,
  GradeResultLookupCriteria,
  GradeResultRepository,
  HedgeOpportunityCreateInput,
  HedgeOpportunityCooldownQuery,
  HedgeOpportunityNotificationUpdateInput,
  HedgeOpportunityRepository,
  IMarketUniverseRepository,
  IPickCandidateRepository,
  MarketUniverseUpsertInput,
  ModelScoreUpdate,
  SelectionRankUpdate,
  PickIdUpdate,
  PickCandidateUpsertInput,
  MemberTierActivateInput,
  MemberTierDeactivateInput,
  MemberTierRepository,
  ModelHealthSnapshotCreateInput,
  ModelHealthSnapshotRepository,
  ModelRegistryCreateInput,
  ModelRegistryRepository,
  ConfirmDeliveryAtomicInput,
  ConfirmDeliveryAtomicResult,
  EventBrowseResult,
  EventOfferBrowseResult,
  EventParticipantBrowseResult,
  EnqueueDistributionAtomicInput,
  EnqueueDistributionAtomicResult,
  LeagueBrowseResult,
  OutboxCreateInput,
  OutboxRepository,
  MatchupBrowseResult,
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
  SettlePickAtomicInput,
  SettlePickAtomicResult,
  SubmissionAtomicInput,
  SubmissionAtomicResult,
  TransitionPickLifecycleAtomicInput,
  TransitionPickLifecycleAtomicResult,
  SubmissionEventCreateInput,
  SubmissionCreateInput,
  SubmissionRepository,
  SystemRunCompleteInput,
  SystemRunRepository,
  SystemRunStartInput,
  TeamSearchResult,
  PickReviewCreateInput,
  PickReviewRepository,
} from './repositories.js';
import type {
  AlertDetectionRecord,
  AuditLogRow,
  EventParticipantRow,
  ExperimentLedgerRecord,
  ExecutionQualityReport,
  EventRow,
  GradeResultRecord,
  MarketUniverseRow,
  PickCandidateRow,
  ModelHealthSnapshotRecord,
  MemberTierRecord,
  ModelRegistryRecord,
  ParticipantRow,
  SystemRunRecord,
  OutboxRecord,
  PickRecord,
  PickLifecycleRecord,
  HedgeOpportunityRecord,
  ProviderMarketAliasRow,
  ProviderEntityAliasRow,
  ProviderOfferRecord,
  PromotionHistoryRecord,
  ReceiptRecord,
  SettlementRecord,
  SubmissionEventRecord,
  SubmissionRecord,
  PickReviewRecord,
} from './types.js';
import type { Json } from './database.types.js';
import {
  createDatabaseClientFromConnection,
  type DatabaseConnectionConfig,
  type UnitTalkSupabaseClient,
} from './client.js';
import { derivePickForeignKeyCandidates } from './pick-foreign-keys.js';
import {
  InMemorySyndicateBoardRepository,
  DatabaseSyndicateBoardRepository,
} from './syndicate-board-repository.js';
import {
  InMemoryMarketFamilyTrustRepository,
  DatabaseMarketFamilyTrustRepository,
} from './market-family-trust-repository.js';
export {
  InMemoryMarketFamilyTrustRepository,
  DatabaseMarketFamilyTrustRepository,
} from './market-family-trust-repository.js';

function extractPlayerId(pick: CanonicalPick): string | null {
  const raw = pick.metadata?.['playerId'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function extractParticipantId(pick: CanonicalPick): string | null {
  const raw = pick.metadata?.['participantId'];
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }

  const legacyPlayerId = pick.metadata?.['playerId'];
  return typeof legacyPlayerId === 'string' && legacyPlayerId.length > 0 ? legacyPlayerId : null;
}

function mapPickToRecord(pick: CanonicalPick, idempotencyKey?: string | null): PickRecord {
  const foreignKeyCandidates = derivePickForeignKeyCandidates(pick);
  return {
    id: pick.id,
    submission_id: pick.submissionId,
    participant_id: extractParticipantId(pick),
    player_id: extractPlayerId(pick),
    capper_id: foreignKeyCandidates.capperCandidate,
    sport_id: foreignKeyCandidates.sportId,
    market_type_id: foreignKeyCandidates.marketTypeId,
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
    idempotency_key: idempotencyKey ?? null,
    metadata: toJsonObject(pick.metadata),
    created_at: pick.createdAt,
    updated_at: pick.createdAt,
  } as PickRecord;
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

async function resolvePickForeignKeys(
  client: UnitTalkSupabaseClient,
  pick: CanonicalPick,
): Promise<{
  capperId: string | null;
  sportId: string | null;
  marketTypeId: string | null;
}> {
  const candidates = derivePickForeignKeyCandidates(pick);

  if (!candidates.capperCandidate) {
    return {
      capperId: null,
      sportId: candidates.sportId,
      marketTypeId: candidates.marketTypeId,
    };
  }

  const { data, error } = await client
    .from('cappers')
    .select('id')
    .eq('id', candidates.capperCandidate)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve capper foreign key: ${error.message}`);
  }

  return {
    capperId: data?.id ?? null,
    sportId: candidates.sportId,
    marketTypeId: candidates.marketTypeId,
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

  async processSubmissionAtomic(_input: SubmissionAtomicInput): Promise<SubmissionAtomicResult> {
    throw new Error(
      'processSubmissionAtomic is not supported in InMemory mode. Use the sequential path.',
    );
  }
}

export class InMemoryPickRepository implements PickRepository {
  private readonly picks = new Map<string, PickRecord>();
  private readonly lifecycleEvents: PickLifecycleRecord[] = [];
  private readonly promotionHistory: PromotionHistoryRecord[] = [];

  async savePick(pick: CanonicalPick, idempotencyKey?: string | null): Promise<PickRecord> {
    const record = mapPickToRecord(pick, idempotencyKey);
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

  async updateApprovalStatus(pickId: string, approvalStatus: string): Promise<PickRecord> {
    const existing = this.picks.get(pickId);
    if (!existing) {
      throw new Error(`Pick not found: ${pickId}`);
    }
    const updated: PickRecord = {
      ...existing,
      approval_status: approvalStatus,
      updated_at: new Date().toISOString(),
    };
    this.picks.set(pickId, updated);
    return updated;
  }

  async findPickById(pickId: string): Promise<PickRecord | null> {
    return this.picks.get(pickId) ?? null;
  }

  async findPicksByIds(pickIds: string[]): Promise<Map<string, PickRecord>> {
    const result = new Map<string, PickRecord>();
    for (const id of pickIds) {
      const pick = this.picks.get(id);
      if (pick) {
        result.set(id, pick);
      }
    }
    return result;
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

  async listByLifecycleStates(
    lifecycleStates: CanonicalPick['lifecycleState'][],
    limit?: number | undefined,
  ): Promise<PickRecord[]> {
    const stateSet = new Set(lifecycleStates);
    const matches = Array.from(this.picks.values())
      .filter((pick) => stateSet.has(pick.status as CanonicalPick['lifecycleState']))
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
    return limit === undefined ? matches : matches.slice(0, limit);
  }

  async listBySource(
    source: CanonicalPick['source'],
    limit?: number | undefined,
  ): Promise<PickRecord[]> {
    const matches = Array.from(this.picks.values())
      .filter((pick) => pick.source === source)
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
    // 7-day window prevents stale picks from permanently blocking.
    const boardWindowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const promoted = Array.from(this.picks.values()).filter(
      (pick) =>
        pick.promotion_target === input.target &&
        (pick.promotion_status === 'qualified' || pick.promotion_status === 'promoted') &&
        pick.status !== 'settled' &&
        pick.status !== 'voided' &&
        pick.created_at >= boardWindowStart &&
        pick.source != null,
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

  async claimPickTransition(
    pickId: string,
    fromState: string,
    toState: string,
  ): Promise<{ claimed: boolean }> {
    const existing = this.picks.get(pickId);
    if (!existing || existing.status !== fromState) {
      return { claimed: false };
    }
    const updated: PickRecord = {
      ...existing,
      status: toState,
      updated_at: new Date().toISOString(),
    };
    this.picks.set(pickId, updated);
    return { claimed: true };
  }

  async transitionPickLifecycleAtomic(
    _input: TransitionPickLifecycleAtomicInput,
  ): Promise<TransitionPickLifecycleAtomicResult> {
    throw new Error(
      'transitionPickLifecycleAtomic is not supported in InMemory mode. Use the sequential path.',
    );
  }

  async findPickByIdempotencyKey(key: string): Promise<PickRecord | null> {
    for (const pick of this.picks.values()) {
      if (pick.idempotency_key === key) {
        return pick;
      }
    }
    return null;
  }
}

export class InMemoryOutboxRepository implements OutboxRepository {
  private readonly entries: OutboxRecord[] = [];

  async enqueue(input: OutboxCreateInput): Promise<OutboxRecord> {
    // Idempotency: reject if an active (pending/processing) row already exists
    // for the same pick+target combination.
    const activeStatuses = ['pending', 'processing'];
    const existing = this.entries.find(
      (entry) =>
        entry.pick_id === input.pickId &&
        entry.target === input.target &&
        activeStatuses.includes(entry.status),
    );
    if (existing) {
      throw new Error(
        `Duplicate outbox row: an active row already exists for pick ${input.pickId} target ${input.target} (id=${existing.id}, status=${existing.status})`,
      );
    }

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

  async enqueueDistributionAtomic(_input: EnqueueDistributionAtomicInput): Promise<EnqueueDistributionAtomicResult | null> {
    throw new Error('enqueueDistributionAtomic is not supported in InMemory mode. Use the sequential path.');
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OutboxRecord | null> {
    return (
      [...this.entries]
        .filter((entry) => entry.idempotency_key === idempotencyKey)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null
    );
  }

  async claimNextAtomic(_target: string, _workerId: string): Promise<OutboxRecord | null> {
    throw new Error('claimNextAtomic is not supported in InMemory mode. Use claimNext.');
  }

  async confirmDeliveryAtomic(_input: ConfirmDeliveryAtomicInput): Promise<ConfirmDeliveryAtomicResult> {
    throw new Error('confirmDeliveryAtomic is not supported in InMemory mode. Use the sequential path.');
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
    const now = new Date().toISOString();
    const next = this.entries.find(
      (entry) =>
        entry.target === target &&
        entry.status === 'pending' &&
        entry.claimed_at === null &&
        entry.claimed_by === null &&
        (entry.next_attempt_at === null || entry.next_attempt_at <= now),
    );

    if (!next) {
      return null;
    }

    next.status = 'processing';
    next.claimed_at = now;
    next.claimed_by = workerId;
    next.updated_at = now;
    return next;
  }

  async touchClaim(outboxId: string, workerId: string): Promise<OutboxRecord | null> {
    const existing = this.entries.find((entry) => entry.id === outboxId);
    if (!existing) {
      return null;
    }

    if (existing.status !== 'processing' || existing.claimed_by !== workerId) {
      return null;
    }

    const now = new Date().toISOString();
    existing.claimed_at = now;
    existing.updated_at = now;
    return existing;
  }

  async reapStaleClaims(
    target: string,
    staleBefore: string,
    reason: string,
  ): Promise<OutboxRecord[]> {
    const reaped: OutboxRecord[] = [];

    for (const entry of this.entries) {
      if (
        entry.target !== target ||
        entry.status !== 'processing' ||
        entry.claimed_at === null ||
        entry.claimed_at > staleBefore
      ) {
        continue;
      }

      entry.status = 'pending';
      entry.attempt_count += 1;
      entry.last_error = reason;
      entry.next_attempt_at = null;
      entry.claimed_at = null;
      entry.claimed_by = null;
      entry.updated_at = new Date().toISOString();
      reaped.push(entry);
    }

    return reaped;
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

    existing.status = 'pending';
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

  async listByPickId(pickId: string): Promise<OutboxRecord[]> {
    return this.entries.filter((e) => e.pick_id === pickId);
  }

  async resetForRetry(outboxId: string): Promise<OutboxRecord> {
    const existing = this.entries.find((e) => e.id === outboxId);
    if (!existing) throw new Error(`Outbox record not found: ${outboxId}`);
    existing.status = 'pending';
    existing.attempt_count = 0;
    existing.last_error = null;
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
      first_mover_book: input.firstMoverBook ?? input.bookmakerKey,
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
      steam_detected: input.steamDetected ?? false,
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

  async findByIds(ids: string[]): Promise<Map<string, AlertDetectionRecord>> {
    const wanted = new Set(ids);
    const result = new Map<string, AlertDetectionRecord>();

    for (const record of this.records.values()) {
      if (wanted.has(record.id)) {
        result.set(record.id, record);
      }
    }

    return result;
  }

  async findFirstMoverBook(
    eventId: string,
    marketKey: string,
    since: string,
  ): Promise<string | null> {
    return (
      Array.from(this.records.values())
        .filter(
          (record) =>
            record.event_id === eventId &&
            record.market_key === marketKey &&
            record.current_snapshot_at >= since,
        )
        .sort((left, right) => {
          const detectedOrder = left.current_snapshot_at.localeCompare(right.current_snapshot_at);
          if (detectedOrder !== 0) {
            return detectedOrder;
          }

          return left.created_at.localeCompare(right.created_at);
        })[0]?.first_mover_book ?? null
    );
  }

  async findRecentByEventMarketDirection(
    eventId: string,
    marketKey: string,
    direction: 'up' | 'down',
    since: string,
  ): Promise<AlertDetectionRecord[]> {
    return Array.from(this.records.values())
      .filter(
        (record) =>
          record.event_id === eventId &&
          record.market_key === marketKey &&
          record.direction === direction &&
          record.current_snapshot_at >= since,
      )
      .sort((left, right) => right.current_snapshot_at.localeCompare(left.current_snapshot_at));
  }

  async markSteamDetected(
    ids: string[],
    steamBookCount: number,
    steamWindowMinutes: number,
  ): Promise<Map<string, AlertDetectionRecord>> {
    const updated = new Map<string, AlertDetectionRecord>();

    for (const [key, record] of this.records.entries()) {
      if (!ids.includes(record.id)) {
        continue;
      }

      const nextRecord: AlertDetectionRecord = {
        ...record,
        steam_detected: true,
        metadata: toJsonObject({
          ...asJsonObjectRecord(record.metadata),
          steamBookCount,
          steamWindowMinutes,
        }),
      };
      this.records.set(key, nextRecord);
      updated.set(nextRecord.id, nextRecord);
    }

    return updated;
  }

  async listRecent(
    limit = 20,
    options: AlertDetectionListOptions = {},
  ): Promise<AlertDetectionRecord[]> {
    return Array.from(this.records.values())
      .filter((record) => {
        if (options.minTier === undefined) {
          return true;
        }

        if (options.minTier === 'notable') {
          return record.tier === 'notable' || record.tier === 'alert-worthy';
        }

        return record.tier === options.minTier;
      })
      .sort((left, right) => right.current_snapshot_at.localeCompare(left.current_snapshot_at))
      .slice(0, limit);
  }

  async getStatusSummary(windowStart: string): Promise<AlertDetectionStatusSummary> {
    const records = Array.from(this.records.values());
    const inWindow = records.filter((record) => record.current_snapshot_at > windowStart);

    const lastDetectedAt =
      records
        .map((record) => record.current_snapshot_at)
        .sort((left, right) => right.localeCompare(left))[0] ?? null;

    return {
      lastDetectedAt,
      counts: {
        notable: inWindow.filter((record) => record.tier === 'notable').length,
        alertWorthy: inWindow.filter((record) => record.tier === 'alert-worthy').length,
        notified: inWindow.filter((record) => record.notified === true).length,
        steamEvents: inWindow.filter((record) => record.steam_detected === true).length,
      },
    };
  }

  async updateNotified(input: AlertNotificationUpdateInput): Promise<void> {
    for (const [key, record] of this.records.entries()) {
      if (record.id === input.id) {
        this.records.set(key, {
          ...record,
          notified: true,
          notified_at: input.notifiedAt,
          notified_channels: input.notifiedChannels,
          cooldown_expires_at: input.cooldownExpiresAt,
        });
        return;
      }
    }
  }
}

export class InMemoryHedgeOpportunityRepository
  implements HedgeOpportunityRepository
{
  private readonly records = new Map<string, HedgeOpportunityRecord>();

  async saveOpportunity(
    input: HedgeOpportunityCreateInput,
  ): Promise<HedgeOpportunityRecord | null> {
    const existing = this.records.get(input.idempotencyKey);
    if (existing) {
      return null;
    }

    const record: HedgeOpportunityRecord = {
      id: crypto.randomUUID(),
      idempotency_key: input.idempotencyKey,
      event_id: input.eventId ?? null,
      participant_id: input.participantId ?? null,
      market_key: input.marketKey,
      type: input.type,
      priority: input.priority,
      bookmaker_a: input.bookmakerA,
      line_a: input.lineA,
      over_odds_a: input.overOddsA,
      bookmaker_b: input.bookmakerB,
      line_b: input.lineB,
      under_odds_b: input.underOddsB,
      line_discrepancy: input.lineDiscrepancy,
      implied_prob_a: input.impliedProbA,
      implied_prob_b: input.impliedProbB,
      total_implied_prob: input.totalImpliedProb,
      arbitrage_percentage: input.arbitragePercentage,
      profit_potential: input.profitPotential,
      guaranteed_profit: input.guaranteedProfit ?? null,
      middle_gap: input.middleGap ?? null,
      win_probability: input.winProbability ?? null,
      notified: input.notified ?? false,
      notified_at: input.notifiedAt ?? null,
      notified_channels: input.notifiedChannels ?? null,
      cooldown_expires_at: input.cooldownExpiresAt ?? null,
      metadata: toJsonObject(input.metadata),
      detected_at: input.detectedAt,
      created_at: input.detectedAt,
    };

    this.records.set(record.idempotency_key, record);
    return record;
  }

  async findActiveCooldown(
    input: HedgeOpportunityCooldownQuery,
  ): Promise<HedgeOpportunityRecord | null> {
    return (
      Array.from(this.records.values())
        .filter(
          (record) =>
            (record.event_id ?? null) === (input.eventId ?? null) &&
            record.market_key === input.marketKey &&
            record.type === input.type &&
            record.notified === true &&
            typeof record.cooldown_expires_at === 'string' &&
            record.cooldown_expires_at > input.now,
        )
        .sort((left, right) =>
          (right.notified_at ?? '').localeCompare(left.notified_at ?? ''),
        )[0] ?? null
    );
  }

  async listRecent(limit = 20): Promise<HedgeOpportunityRecord[]> {
    return Array.from(this.records.values())
      .sort((left, right) => right.detected_at.localeCompare(left.detected_at))
      .slice(0, limit);
  }

  async updateNotified(input: HedgeOpportunityNotificationUpdateInput): Promise<void> {
    for (const [key, record] of this.records.entries()) {
      if (record.id === input.id) {
        this.records.set(key, {
          ...record,
          notified: true,
          notified_at: input.notifiedAt,
          notified_channels: input.notifiedChannels,
          cooldown_expires_at: input.cooldownExpiresAt,
        });
        return;
      }
    }
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

  async settlePickAtomic(_input: SettlePickAtomicInput): Promise<SettlePickAtomicResult> {
    throw new Error('settlePickAtomic is not supported in InMemory mode. Use the sequential path.');
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

  async findLatestByMarketKey(
    marketKey: string,
    providerKey?: string,
    providerParticipantId?: string | null,
  ): Promise<ProviderOfferRecord | null> {
    const matches = Array.from(this.offers.values())
      .filter(
        (o) =>
          o.provider_market_key === marketKey &&
          (providerKey ? o.provider_key === providerKey : true) &&
          (providerParticipantId === undefined
            ? true
            : (o.provider_participant_id ?? null) === providerParticipantId),
      )
      .sort((a, b) => b.snapshot_at.localeCompare(a.snapshot_at));
    return matches[0] ?? null;
  }

  async listAll(): Promise<ProviderOfferRecord[]> {
    return Array.from(this.offers.values()).sort(
      (left, right) => right.snapshot_at.localeCompare(left.snapshot_at),
    );
  }

  async listRecentOffers(since: string, limit = 10_000): Promise<ProviderOfferRecord[]> {
    return Array.from(this.offers.values())
      .filter((offer) => offer.snapshot_at >= since)
      .sort((left, right) => right.snapshot_at.localeCompare(left.snapshot_at))
      .slice(0, limit);
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
            offer.provider_participant_id === providerParticipantId &&
            (criteria.bookmakerKey === undefined ||
              offer.bookmaker_key === criteria.bookmakerKey),
        )
        .sort((left, right) => right.snapshot_at.localeCompare(left.snapshot_at))[0] ?? null
    );
  }

  async findOpeningLine(
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
            offer.is_opening === true &&
            offer.provider_participant_id === providerParticipantId &&
            (criteria.bookmakerKey === undefined ||
              offer.bookmaker_key === criteria.bookmakerKey),
        )
        .sort((left, right) => left.snapshot_at.localeCompare(right.snapshot_at))[0] ?? null
    );
  }

  async findExistingCombinations(
    providerEventIds: string[],
    options?: { includeBookmakerKey?: boolean; beforeSnapshotAt?: string },
  ): Promise<Set<string>> {
    const eventIdSet = new Set(providerEventIds);
    const result = new Set<string>();
    for (const offer of this.offers.values()) {
      if (
        eventIdSet.has(offer.provider_event_id) &&
        (options?.beforeSnapshotAt === undefined || offer.snapshot_at < options.beforeSnapshotAt)
      ) {
        const participantKey = offer.provider_participant_id ?? '';
        const bookmakerKey = options?.includeBookmakerKey ? (offer.bookmaker_key ?? '') : null;
        result.add(
          options?.includeBookmakerKey
            ? `${offer.provider_key}:${offer.provider_event_id}:${offer.provider_market_key}:${participantKey}:${bookmakerKey}`
            : `${offer.provider_key}:${offer.provider_event_id}:${offer.provider_market_key}:${participantKey}`,
        );
      }
    }
    return result;
  }

  async markClosingLines(
    events: Array<{ providerEventId: string; commenceTime: string }>,
    snapshotAt: string,
    options?: { includeBookmakerKey?: boolean },
  ): Promise<number> {
    // InMemory: no row-count problem, so no time-window filter needed.
    let updated = 0;
    for (const { providerEventId, commenceTime } of events) {
      if (snapshotAt < commenceTime) continue;

      // Find all pre-commence offers for this event
      const candidates = Array.from(this.offers.values()).filter(
        (o) => o.provider_event_id === providerEventId && o.snapshot_at < commenceTime,
      );

      // Group by combination key, keep latest per group
      const latestByKey = new Map<string, ProviderOfferRecord>();
      for (const offer of candidates) {
        const participantKey = offer.provider_participant_id ?? '';
        const bookmakerKey = options?.includeBookmakerKey ? (offer.bookmaker_key ?? '') : null;
        const key = options?.includeBookmakerKey
          ? `${offer.provider_key}:${offer.provider_market_key}:${participantKey}:${bookmakerKey}`
          : `${offer.provider_key}:${offer.provider_market_key}:${participantKey}`;
        const existing = latestByKey.get(key);
        if (!existing || offer.snapshot_at > existing.snapshot_at) {
          latestByKey.set(key, offer);
        }
      }

      for (const offer of latestByKey.values()) {
        if (!offer.is_closing) {
          this.offers.set(offer.idempotency_key, { ...offer, is_closing: true });
          updated += 1;
        }
      }
    }
    return updated;
  }

  async resolveProviderMarketKey(_canonicalKey: string, _provider: string): Promise<string | null> {
    // InMemory implementation has no alias table — alias resolution not supported in tests.
    return null;
  }

  async resolveCanonicalMarketKey(_providerMarketKey: string, _provider: string): Promise<string | null> {
    // InMemory implementation has no alias table — reverse alias resolution not supported in tests.
    return null;
  }

  async listAliasLookup(_provider: string): Promise<ProviderMarketAliasRow[]> {
    // InMemory implementation has no alias table — returns empty array in test mode.
    return [] as unknown as ProviderMarketAliasRow[];
  }

  async listParticipantAliasLookup(_provider: string): Promise<ProviderEntityAliasRow[]> {
    // InMemory implementation has no alias table — returns empty array in test mode.
    return [] as unknown as ProviderEntityAliasRow[];
  }

  async listOpeningOffers(since: string, _provider: string, limit = 500): Promise<ProviderOfferRecord[]> {
    const sinceMs = new Date(since).getTime();
    return Array.from(this.offers.values())
      .filter(
        (o) =>
          o.is_opening === true &&
          new Date(o.snapshot_at).getTime() >= sinceMs &&
          o.over_odds != null &&
          o.under_odds != null &&
          o.line != null &&
          o.provider_participant_id != null,
      )
      .slice(0, limit);
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

    // Preserve enrichment-only fields (headshot_url, logo_url) managed by the
    // enrichment service. The ingestor passes null for these — do not overwrite
    // a previously enriched value with null.
    const incomingMeta = input.metadata as Record<string, unknown>;
    const existingMeta = (existing?.metadata as Record<string, unknown>) ?? {};
    const mergedMeta: Record<string, unknown> = { ...incomingMeta };
    for (const field of ['headshot_url', 'logo_url']) {
      if (mergedMeta[field] == null && existingMeta[field] != null) {
        mergedMeta[field] = existingMeta[field];
      }
    }

    const record: ParticipantRow = {
      id: existing?.id ?? crypto.randomUUID(),
      display_name: input.displayName,
      external_id: input.externalId,
      league: input.league ?? null,
      metadata: toJsonObject(mergedMeta),
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

  async updateMetadata(participantId: string, metadata: Record<string, unknown>): Promise<ParticipantRow> {
    const existing = this.participants.get(participantId);
    if (!existing) {
      throw new Error(`Participant not found: ${participantId}`);
    }
    const merged = { ...(existing.metadata as Record<string, unknown> ?? {}), ...metadata };
    const updated: ParticipantRow = {
      ...existing,
      metadata: toJsonObject(merged),
      updated_at: new Date().toISOString(),
    };
    this.participants.set(participantId, updated);
    return updated;
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

  async listByName(eventName: string): Promise<EventRow[]> {
    const normalized = eventName.trim().toLowerCase();
    return Array.from(this.events.values()).filter(
      (row) => row.event_name.trim().toLowerCase() === normalized,
    );
  }

  async listStartedBySnapshot(snapshotAt: string): Promise<EventRow[]> {
    const snapshotDate = snapshotAt.slice(0, 10); // YYYY-MM-DD
    return Array.from(this.events.values()).filter(
      (row) => row.event_date <= snapshotDate,
    );
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

  async listByType(runType: string, limit = 50): Promise<SystemRunRecord[]> {
    return Array.from(this.runs.values())
      .filter((row) => row.run_type === runType)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit);
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

  async listRecentByEntityType(
    entityType: string,
    since: string,
    action?: string | undefined,
  ): Promise<AuditLogRow[]> {
    return this.records
      .filter(
        (record) =>
          record.entity_type === entityType &&
          record.created_at >= since &&
          (action === undefined || record.action === action),
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }
}

export class InMemoryReferenceDataRepository implements ReferenceDataRepository {
  private readonly catalog: ReferenceDataCatalog;
  private readonly participants: ParticipantRow[];
  private readonly events: EventRow[];
  private readonly leagues: LeagueBrowseResult[];
  private readonly matchups: MatchupBrowseResult[];
  private readonly eventBrowses: Map<string, EventBrowseResult>;

  constructor(
    catalog: ReferenceDataCatalog,
    options: {
      participants?: ParticipantRow[];
      events?: EventRow[];
      leagues?: LeagueBrowseResult[];
      matchups?: MatchupBrowseResult[];
      eventBrowses?: EventBrowseResult[];
    } = {},
  ) {
    this.catalog = catalog;
    this.participants = options.participants ?? [];
    this.events = options.events ?? [];
    this.leagues =
      options.leagues ??
      this.catalog.sports.map((sport) => ({
        id: sport.id.toLowerCase(),
        sportId: sport.id,
        displayName: sport.name,
      }));
    this.matchups = options.matchups ?? [];
    this.eventBrowses = new Map((options.eventBrowses ?? []).map((row) => [row.eventId, row]));
  }

  async getCatalog(): Promise<ReferenceDataCatalog> {
    return this.catalog;
  }

  async listLeagues(sportId: string): Promise<LeagueBrowseResult[]> {
    return this.leagues.filter((league) => league.sportId === sportId);
  }

  async listMatchups(sportId: string, date: string): Promise<MatchupBrowseResult[]> {
    return this.matchups.filter((matchup) => matchup.sportId === sportId && matchup.eventDate === date);
  }

  async getEventBrowse(eventId: string): Promise<EventBrowseResult | null> {
    return this.eventBrowses.get(eventId) ?? null;
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

  async searchBrowse(sportId: string, date: string, query: string, limit = 20): Promise<BrowseSearchResult[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const matchups = await this.listMatchups(sportId, date);
    const results: BrowseSearchResult[] = [];
    const seen = new Set<string>();

    for (const matchup of matchups) {
      const matchupLabel = formatBrowseMatchup(matchup);
      const matchupContext = buildMatchupContext(matchup);

      if (matchesBrowseQuery(normalizedQuery, matchup.eventName, matchupLabel, matchup.teams.map((team) => team.displayName))) {
        pushBrowseSearchResult(results, seen, {
          resultType: 'matchup',
          participantId: null,
          displayName: matchupLabel,
          contextLabel: matchupContext,
          teamId: null,
          teamName: null,
          matchup,
        });
      }

      for (const team of matchup.teams) {
        if (!matchesBrowseQuery(normalizedQuery, team.displayName)) {
          continue;
        }

        const opponent = matchup.teams.find((candidate) => candidate.participantId !== team.participantId);
        pushBrowseSearchResult(results, seen, {
          resultType: 'team',
          participantId: team.teamId ?? team.participantId,
          displayName: team.displayName,
          contextLabel: `${opponent ? `vs ${opponent.displayName} · ` : ''}${matchupContext}`,
          teamId: team.teamId ?? team.participantId,
          teamName: team.displayName,
          matchup,
        });
      }

      const eventBrowse = this.eventBrowses.get(matchup.eventId);
      if (!eventBrowse) {
        continue;
      }

      for (const participant of eventBrowse.participants) {
        if (participant.participantType !== 'player' || !matchesBrowseQuery(normalizedQuery, participant.displayName)) {
          continue;
        }

        pushBrowseSearchResult(results, seen, {
          resultType: 'player',
          participantId: participant.canonicalId ?? participant.participantId,
          displayName: participant.displayName,
          contextLabel: `${participant.teamName ?? 'Unassigned'} · ${matchupLabel} · ${matchupContext}`,
          teamId: participant.teamId,
          teamName: participant.teamName,
          matchup,
        });
      }
    }

  return results.slice(0, limit);
  }
}

export class InMemoryModelRegistryRepository implements ModelRegistryRepository {
  private readonly models = new Map<string, ModelRegistryRecord>();

  async create(input: ModelRegistryCreateInput): Promise<ModelRegistryRecord> {
    const now = new Date().toISOString();
    const record: ModelRegistryRecord = {
      id: crypto.randomUUID(),
      model_name: input.modelName,
      version: input.version,
      sport: input.sport,
      market_family: input.marketFamily,
      status: input.status ?? 'staged',
      champion_since: input.status === 'champion' ? now : null,
      metadata: toJsonObject(input.metadata ?? {}),
      created_at: now,
      updated_at: now,
    };

    if (record.status === 'champion') {
      this.archiveChampionForSlot(record.sport, record.market_family, record.id, now);
    }

    this.models.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<ModelRegistryRecord | null> {
    return this.models.get(id) ?? null;
  }

  async findChampion(sport: string, marketFamily: string): Promise<ModelRegistryRecord | null> {
    for (const record of this.models.values()) {
      if (
        record.sport === sport &&
        record.market_family === marketFamily &&
        record.status === 'champion'
      ) {
        return record;
      }
    }

    return null;
  }

  async listBySport(sport: string): Promise<ModelRegistryRecord[]> {
    return Array.from(this.models.values())
      .filter((record) => record.sport === sport)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async updateStatus(
    id: string,
    status: ModelRegistryRecord['status'],
    championSince?: string,
  ): Promise<ModelRegistryRecord> {
    const existing = this.models.get(id);
    if (!existing) {
      throw new Error(`Model registry record not found: ${id}`);
    }

    const now = new Date().toISOString();
    const nextChampionSince =
      status === 'champion' ? (championSince ?? now) : null;

    if (status === 'champion') {
      this.archiveChampionForSlot(existing.sport, existing.market_family, existing.id, now);
    }

    const updated: ModelRegistryRecord = {
      ...existing,
      status,
      champion_since: nextChampionSince,
      updated_at: now,
    };

    this.models.set(id, updated);
    return updated;
  }

  private archiveChampionForSlot(
    sport: string,
    marketFamily: string,
    excludeId: string,
    now: string,
  ) {
    for (const [id, record] of this.models.entries()) {
      if (
        id !== excludeId &&
        record.sport === sport &&
        record.market_family === marketFamily &&
        record.status === 'champion'
      ) {
        this.models.set(id, {
          ...record,
          status: 'archived',
          champion_since: null,
          updated_at: now,
        });
      }
    }
  }
}

export class InMemoryExperimentLedgerRepository implements ExperimentLedgerRepository {
  private readonly runs = new Map<string, ExperimentLedgerRecord>();

  async create(input: ExperimentLedgerCreateInput): Promise<ExperimentLedgerRecord> {
    const now = new Date().toISOString();
    const record: ExperimentLedgerRecord = {
      id: crypto.randomUUID(),
      model_id: input.modelId,
      run_type: input.runType,
      sport: input.sport,
      market_family: input.marketFamily,
      status: 'running',
      started_at: now,
      finished_at: null,
      metrics: toJsonObject({}),
      notes: input.notes ?? null,
      created_at: now,
    };

    this.runs.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<ExperimentLedgerRecord | null> {
    return this.runs.get(id) ?? null;
  }

  async listByModelId(modelId: string): Promise<ExperimentLedgerRecord[]> {
    return Array.from(this.runs.values())
      .filter((record) => record.model_id === modelId)
      .sort((left, right) => left.started_at.localeCompare(right.started_at));
  }

  async complete(
    id: string,
    metrics: Record<string, unknown>,
  ): Promise<ExperimentLedgerRecord> {
    const existing = this.runs.get(id);
    if (!existing) {
      throw new Error(`Experiment ledger record not found: ${id}`);
    }

    const updated: ExperimentLedgerRecord = {
      ...existing,
      status: 'completed',
      finished_at: new Date().toISOString(),
      metrics: toJsonObject(metrics),
    };

    this.runs.set(id, updated);
    return updated;
  }

  async fail(id: string, notes?: string): Promise<ExperimentLedgerRecord> {
    const existing = this.runs.get(id);
    if (!existing) {
      throw new Error(`Experiment ledger record not found: ${id}`);
    }

    const updated: ExperimentLedgerRecord = {
      ...existing,
      status: 'failed',
      finished_at: new Date().toISOString(),
      notes: notes ?? existing.notes,
    };

    this.runs.set(id, updated);
    return updated;
  }
}

export class InMemoryModelHealthSnapshotRepository implements ModelHealthSnapshotRepository {
  private readonly snapshots = new Map<string, ModelHealthSnapshotRecord>();

  async create(
    input: ModelHealthSnapshotCreateInput,
  ): Promise<ModelHealthSnapshotRecord> {
    const now = new Date().toISOString();
    const record: ModelHealthSnapshotRecord = {
      id: crypto.randomUUID(),
      model_id: input.modelId,
      sport: input.sport,
      market_family: input.marketFamily,
      snapshot_at: now,
      win_rate: input.winRate ?? null,
      roi: input.roi ?? null,
      sample_size: input.sampleSize ?? 0,
      drift_score: input.driftScore ?? null,
      calibration_score: input.calibrationScore ?? null,
      alert_level: input.alertLevel ?? 'none',
      metadata: toJsonObject(input.metadata ?? {}),
      created_at: now,
    };

    this.snapshots.set(record.id, record);
    return record;
  }

  async findLatestByModel(modelId: string): Promise<ModelHealthSnapshotRecord | null> {
    return (
      Array.from(this.snapshots.values())
        .filter((record) => record.model_id === modelId)
        .sort(compareModelHealthSnapshotsDescending)[0] ?? null
    );
  }

  async listByModel(modelId: string, limit?: number): Promise<ModelHealthSnapshotRecord[]> {
    const records = Array.from(this.snapshots.values())
      .filter((record) => record.model_id === modelId)
      .sort(compareModelHealthSnapshotsDescending);

    return limit === undefined ? records : records.slice(0, limit);
  }

  async listAlerted(level?: 'warning' | 'critical'): Promise<ModelHealthSnapshotRecord[]> {
    return Array.from(this.snapshots.values())
      .filter((record) => (level ? record.alert_level === level : record.alert_level !== 'none'))
      .sort(compareModelHealthSnapshotsDescending);
  }
}

export class InMemoryExecutionQualityRepository implements ExecutionQualityRepository {
  constructor(private readonly seedReports: ExecutionQualityReport[] = []) {}

  async summarizeByProvider(sport?: string): Promise<ExecutionQualityReport[]> {
    return this.seedReports.filter((report) => sport === undefined || report.sportKey === sport);
  }

  async summarizeByMarketFamily(providerKey: string): Promise<ExecutionQualityReport[]> {
    return this.seedReports.filter((report) => report.providerKey === providerKey);
  }
}

export class DatabaseSubmissionRepository implements SubmissionRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  private fromUntyped(table: string) {
    return fromUntyped(this.client, table);
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

  async findByIds(ids: string[]): Promise<Map<string, AlertDetectionRecord>> {
    if (ids.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from('alert_detections')
      .select('*')
      .in('id', ids);

    if (error) {
      throw new Error(`Failed to load alert detections by id: ${error.message}`);
    }

    return new Map((data ?? []).map((record) => [record.id, record]));
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

  async processSubmissionAtomic(input: SubmissionAtomicInput): Promise<SubmissionAtomicResult> {
    const pick = input.pick;
    const sub = input.submission;
    const evt = input.event;
    const lce = input.lifecycleEvent;
    const foreignKeys = await resolvePickForeignKeys(this.client, pick);

    const { data, error } = await this.client.rpc('process_submission_atomic', {
      p_submission: {
        id: sub.id,
        source: sub.payload.source,
        submitted_by: sub.payload.submittedBy ?? null,
        payload: {
          market: sub.payload.market,
          selection: sub.payload.selection,
          line: sub.payload.line,
          odds: sub.payload.odds,
          stakeUnits: sub.payload.stakeUnits,
          confidence: sub.payload.confidence,
          eventName: sub.payload.eventName,
          metadata: toJsonObject(sub.payload.metadata ?? {}),
        },
        status: 'validated',
        received_at: sub.receivedAt,
        created_at: sub.receivedAt,
        updated_at: sub.receivedAt,
      },
      p_event: {
        submission_id: evt.submissionId,
        event_name: evt.eventName,
        payload: toJsonObject(evt.payload),
        created_at: evt.createdAt,
      },
      p_pick: {
        id: pick.id,
        submission_id: pick.submissionId,
        participant_id: extractParticipantId(pick),
        player_id: extractPlayerId(pick),
        capper_id: foreignKeys.capperId,
        sport_id: foreignKeys.sportId,
        market_type_id: foreignKeys.marketTypeId,
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
      },
      p_idempotency_key: input.idempotencyKey ?? null,
      p_lifecycle_event: lce
        ? {
            pick_id: lce.pickId,
            from_state: lce.fromState ?? null,
            to_state: lce.toState,
            writer_role: lce.writerRole,
            reason: lce.reason,
            payload: {},
            created_at: lce.createdAt,
          }
        : null,
    });

    if (error) {
      throw new Error(`process_submission_atomic failed: ${error.message}`);
    }

    const { data: eventData, error: eventError } = await this.client
      .from('submission_events')
      .select('*')
      .eq('submission_id', sub.id)
      .eq('event_name', evt.eventName)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (eventError) {
      throw new Error(`Failed to load submission event after atomic insert: ${eventError.message}`);
    }

    const result = data as {
      submission: SubmissionRecord;
      pick: PickRecord;
      lifecycleEvent: PickLifecycleRecord | null;
    };

    return {
      submission: result.submission,
      submissionEvent: eventData ?? null,
      pick: result.pick,
      lifecycleEvent: result.lifecycleEvent,
    };
  }
}

export class DatabasePickRepository implements PickRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  private fromUntyped(table: string) {
    return fromUntyped(this.client, table);
  }

  async savePick(pick: CanonicalPick, idempotencyKey?: string | null): Promise<PickRecord> {
    const foreignKeys = await resolvePickForeignKeys(this.client, pick);
    const { data, error } = await this.fromUntyped('picks')
      .insert({
        id: pick.id,
        submission_id: pick.submissionId,
        participant_id: extractParticipantId(pick),
        player_id: extractPlayerId(pick),
        capper_id: foreignKeys.capperId,
        sport_id: foreignKeys.sportId,
        market_type_id: foreignKeys.marketTypeId,
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
        idempotency_key: idempotencyKey ?? null,
        metadata: toJsonObject(pick.metadata),
        created_at: pick.createdAt,
        updated_at: pick.createdAt,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to save pick: ${error?.message ?? 'unknown error'}`);
    }

    return data as PickRecord;
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

  async updateApprovalStatus(pickId: string, approvalStatus: string): Promise<PickRecord> {
    const { data, error } = await this.client
      .from('picks')
      .update({ approval_status: approvalStatus, updated_at: new Date().toISOString() })
      .eq('id', pickId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update approval status: ${error?.message ?? 'unknown error'}`);
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

  async findPicksByIds(pickIds: string[]): Promise<Map<string, PickRecord>> {
    const result = new Map<string, PickRecord>();
    if (pickIds.length === 0) {
      return result;
    }

    const { data, error } = await this.client
      .from('picks')
      .select()
      .in('id', pickIds);

    if (error) {
      throw new Error(`Failed to find picks by ids: ${error.message}`);
    }

    for (const pick of data ?? []) {
      result.set(pick.id, pick);
    }

    return result;
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

  async listByLifecycleStates(
    lifecycleStates: CanonicalPick['lifecycleState'][],
    limit?: number | undefined,
  ): Promise<PickRecord[]> {
    let query = this.client
      .from('picks')
      .select('*')
      .in('status', lifecycleStates)
      .order('created_at', { ascending: true });

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list picks by lifecycle states: ${error.message}`);
    }

    return data ?? [];
  }

  async listBySource(
    source: CanonicalPick['source'],
    limit?: number | undefined,
  ): Promise<PickRecord[]> {
    let query = this.client
      .from('picks')
      .select('*')
      .eq('source', source)
      .order('created_at', { ascending: true });

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list picks by source: ${error.message}`);
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
    // Only picks created within the last 7 days count — stale picks
    // from old test/proof runs must not permanently block the board.
    const boardWindowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.client
      .from('picks')
      .select('market,selection,metadata,promotion_target,promotion_status,source')
      .eq('promotion_target', input.target)
      .in('promotion_status', ['qualified', 'promoted'])
      .not('source', 'is', null)
      .neq('status', 'settled')
      .neq('status', 'voided')
      .gte('created_at', boardWindowStart);

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

  async claimPickTransition(
    pickId: string,
    fromState: string,
    toState: string,
  ): Promise<{ claimed: boolean }> {
    const updates: Record<string, unknown> = {
      status: toState,
      updated_at: new Date().toISOString(),
    };
    if (toState === 'posted') {
      updates.posted_at = new Date().toISOString();
    }
    if (toState === 'settled') {
      updates.settled_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('picks')
      .update(updates)
      .eq('id', pickId)
      .eq('status', fromState)
      .select('id');

    if (error) {
      throw new Error(`Failed to claim pick transition: ${error.message}`);
    }

    return { claimed: (data?.length ?? 0) > 0 };
  }

  async transitionPickLifecycleAtomic(
    input: TransitionPickLifecycleAtomicInput,
  ): Promise<TransitionPickLifecycleAtomicResult> {
    const { data, error } = await this.client.rpc('transition_pick_lifecycle', {
      p_pick_id: input.pickId,
      p_from_state: input.fromState,
      p_to_state: input.toState,
      p_writer_role: input.writerRole,
      p_reason: input.reason,
      p_payload: toJsonObject(input.payload ?? {}),
    });

    if (error) {
      const message = error.message ?? '';
      if (message.includes('PICK_NOT_FOUND')) {
        throw new InvalidPickStateError(input.pickId);
      }
      if (message.includes('INVALID_LIFECYCLE_TRANSITION')) {
        // The RPC raises with the actual current status. The caller already
        // knows the intended fromState, but we prefer the observed mismatch
        // value (parsed from the error message) when constructing the typed
        // FSM error so the thrown error reflects live DB truth.
        const observedMatch = message.match(/got ([a-z_]+)/);
        const observed = (observedMatch?.[1] ?? input.fromState) as PickLifecycleState;
        throw new InvalidTransitionError(observed, input.toState as PickLifecycleState);
      }
      throw new Error(`transition_pick_lifecycle failed: ${error.message}`);
    }

    const result = data as {
      pickId: string;
      fromState: string;
      toState: string;
      eventId: string;
    } | null;

    if (!result) {
      throw new Error('transition_pick_lifecycle returned null');
    }

    return {
      pickId: result.pickId,
      fromState: result.fromState,
      toState: result.toState,
      eventId: result.eventId,
    };
  }

  async findPickByIdempotencyKey(key: string): Promise<PickRecord | null> {
    const { data, error } = await this.client
      .from('picks')
      .select()
      .eq('idempotency_key', key)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find pick by idempotency key: ${error.message}`);
    }

    return data;
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

  async enqueueDistributionAtomic(input: EnqueueDistributionAtomicInput): Promise<EnqueueDistributionAtomicResult | null> {
    const { data, error } = await this.client.rpc('enqueue_distribution_atomic', {
      p_pick_id: input.pickId,
      p_from_state: input.fromState,
      p_to_state: input.toState,
      p_writer_role: input.writerRole,
      p_reason: input.reason,
      p_lifecycle_created_at: input.lifecycleCreatedAt,
      p_outbox_target: input.outboxTarget,
      p_outbox_payload: input.outboxPayload,
      p_outbox_idempotency_key: input.outboxIdempotencyKey,
    });

    if (error) {
      throw new Error(`enqueue_distribution_atomic failed: ${error.message}`);
    }

    if (!data) return null;

    const result = data as {
      pick: PickRecord;
      lifecycleEvent: PickLifecycleRecord;
      outbox: OutboxRecord;
    };

    return result;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OutboxRecord | null> {
    const { data, error } = await this.client
      .from('distribution_outbox')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find outbox row by idempotency key: ${error.message}`);
    }

    return (data as OutboxRecord | null) ?? null;
  }

  async claimNextAtomic(target: string, workerId: string): Promise<OutboxRecord | null> {
    const { data, error } = await this.client.rpc('claim_next_outbox', {
      p_target: target,
      p_worker_id: workerId,
    });

    if (error) {
      throw new Error(`claim_next_outbox failed: ${error.message}`);
    }

    if (!data) return null;
    return data as OutboxRecord;
  }

  async confirmDeliveryAtomic(input: ConfirmDeliveryAtomicInput): Promise<ConfirmDeliveryAtomicResult> {
    const { data, error } = await this.client.rpc('confirm_delivery_atomic', {
      p_outbox_id: input.outboxId,
      p_pick_id: input.pickId,
      p_worker_id: input.workerId,
      p_receipt_type: input.receiptType,
      p_receipt_status: input.receiptStatus,
      p_receipt_channel: input.receiptChannel,
      p_receipt_external_id: input.receiptExternalId,
      p_receipt_idempotency_key: input.receiptIdempotencyKey,
      p_receipt_payload: input.receiptPayload,
      p_lifecycle_from_state: input.lifecycleFromState,
      p_lifecycle_to_state: input.lifecycleToState,
      p_lifecycle_writer_role: input.lifecycleWriterRole,
      p_lifecycle_reason: input.lifecycleReason,
      p_audit_action: input.auditAction,
      p_audit_payload: input.auditPayload,
    });

    if (error) {
      throw new Error(`confirm_delivery_atomic failed: ${error.message}`);
    }

    const result = data as {
      outbox: OutboxRecord;
      lifecycleEvent?: PickLifecycleRecord;
      receipt?: ReceiptRecord;
      alreadyConfirmed: boolean;
      error?: string;
    };

    if (result.error) {
      throw new Error(`confirm_delivery_atomic: ${result.error}`);
    }

    return result;
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
    const now = new Date().toISOString();
    const { data: pending, error: selectError } = await this.client
      .from('distribution_outbox')
      .select()
      .eq('target', target)
      .eq('status', 'pending')
      .is('claimed_at', null)
      .is('claimed_by', null)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to claim outbox work: ${selectError.message}`);
    }

    if (!pending) {
      return null;
    }

    const claimTime = new Date().toISOString();
    const { data, error } = await this.client
      .from('distribution_outbox')
      .update({
        status: 'processing',
        claimed_at: claimTime,
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

  async touchClaim(outboxId: string, workerId: string): Promise<OutboxRecord | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('distribution_outbox')
      .update({
        claimed_at: now,
      })
      .eq('id', outboxId)
      .eq('status', 'processing')
      .eq('claimed_by', workerId)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to touch outbox claim: ${error.message}`);
    }

    return (data as OutboxRecord | null) ?? null;
  }

  async reapStaleClaims(
    target: string,
    staleBefore: string,
    reason: string,
  ): Promise<OutboxRecord[]> {
    const { data: staleRows, error: staleError } = await this.client
      .from('distribution_outbox')
      .select()
      .eq('target', target)
      .eq('status', 'processing')
      .lt('claimed_at', staleBefore);

    if (staleError) {
      throw new Error(`Failed to query stale outbox claims: ${staleError.message}`);
    }

    const reaped: OutboxRecord[] = [];
    for (const row of staleRows ?? []) {
      const { data, error } = await this.client
        .from('distribution_outbox')
        .update({
          status: 'pending',
          attempt_count: row.attempt_count + 1,
          last_error: reason,
          next_attempt_at: null,
          claimed_at: null,
          claimed_by: null,
        })
        .eq('id', row.id)
        .eq('status', 'processing')
        .select()
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to reap stale outbox claim: ${error.message}`);
      }

      if (data) {
        reaped.push(data as OutboxRecord);
      }
    }

    return reaped;
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
        status: 'pending',
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

  async listByPickId(pickId: string): Promise<OutboxRecord[]> {
    const { data, error } = await this.client
      .from('distribution_outbox')
      .select('*')
      .eq('pick_id', pickId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to list outbox by pick: ${error.message}`);
    return (data ?? []) as OutboxRecord[];
  }

  async resetForRetry(outboxId: string): Promise<OutboxRecord> {
    const { data, error } = await this.client
      .from('distribution_outbox')
      .update({
        status: 'pending',
        attempt_count: 0,
        last_error: null,
        next_attempt_at: null,
        claimed_at: null,
        claimed_by: null,
      })
      .eq('id', outboxId)
      .select()
      .single();
    if (error || !data) throw new Error(`Failed to reset outbox for retry: ${error?.message ?? 'unknown'}`);
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
        first_mover_book: input.firstMoverBook ?? input.bookmakerKey,
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
        steam_detected: input.steamDetected ?? false,
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

  async findByIds(ids: string[]): Promise<Map<string, AlertDetectionRecord>> {
    if (ids.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from('alert_detections')
      .select('*')
      .in('id', ids);

    if (error) {
      throw new Error(`Failed to load alert detections by id: ${error.message}`);
    }

    return new Map((data ?? []).map((record) => [record.id, record]));
  }

  async findFirstMoverBook(
    eventId: string,
    marketKey: string,
    since: string,
  ): Promise<string | null> {
    const { data, error } = await this.client
      .from('alert_detections')
      .select('first_mover_book,bookmaker_key')
      .eq('event_id', eventId)
      .eq('market_key', marketKey)
      .gte('current_snapshot_at', since)
      .order('current_snapshot_at', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load first mover book: ${error.message}`);
    }

    return data?.first_mover_book ?? data?.bookmaker_key ?? null;
  }

  async findRecentByEventMarketDirection(
    eventId: string,
    marketKey: string,
    direction: 'up' | 'down',
    since: string,
  ): Promise<AlertDetectionRecord[]> {
    const { data, error } = await this.client
      .from('alert_detections')
      .select('*')
      .eq('event_id', eventId)
      .eq('market_key', marketKey)
      .eq('direction', direction)
      .gte('current_snapshot_at', since)
      .order('current_snapshot_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to load steam candidates: ${error.message}`);
    }

    return data ?? [];
  }

  async markSteamDetected(
    ids: string[],
    steamBookCount: number,
    steamWindowMinutes: number,
  ): Promise<Map<string, AlertDetectionRecord>> {
    if (ids.length === 0) {
      return new Map();
    }

    const existing = await this.findByIds(ids);

    for (const id of ids) {
      const record = existing.get(id);
      if (!record) {
        continue;
      }

      const { error } = await this.client
        .from('alert_detections')
        .update({
          steam_detected: true,
          metadata: toJsonObject({
            ...asJsonObjectRecord(record.metadata),
            steamBookCount,
            steamWindowMinutes,
          }),
        })
        .eq('id', id);

      if (error) {
        throw new Error(`Failed to mark steam detection: ${error.message}`);
      }
    }

    return this.findByIds(ids);
  }

  async listRecent(
    limit = 20,
    options: AlertDetectionListOptions = {},
  ): Promise<AlertDetectionRecord[]> {
    let query = this.client
      .from('alert_detections')
      .select('*')
      .order('current_snapshot_at', { ascending: false })
      .limit(limit);

    if (options.minTier) {
      query =
        options.minTier === 'notable'
          ? query.in('tier', ['notable', 'alert-worthy'])
          : query.eq('tier', options.minTier);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list alert detections: ${error.message}`);
    }

    return data ?? [];
  }

  async getStatusSummary(windowStart: string): Promise<AlertDetectionStatusSummary> {
    const [
      lastDetectedResponse,
      notableResponse,
      alertWorthyResponse,
      notifiedResponse,
      steamResponse,
    ] =
      await Promise.all([
        this.client
          .from('alert_detections')
          .select('current_snapshot_at')
          .order('current_snapshot_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.client
          .from('alert_detections')
          .select('*', { count: 'exact', head: true })
          .eq('tier', 'notable')
          .gt('current_snapshot_at', windowStart),
        this.client
          .from('alert_detections')
          .select('*', { count: 'exact', head: true })
          .eq('tier', 'alert-worthy')
          .gt('current_snapshot_at', windowStart),
        this.client
          .from('alert_detections')
          .select('*', { count: 'exact', head: true })
          .eq('notified', true)
          .gt('current_snapshot_at', windowStart),
        this.client
          .from('alert_detections')
          .select('*', { count: 'exact', head: true })
          .eq('steam_detected', true)
          .gt('current_snapshot_at', windowStart),
      ]);

    if (lastDetectedResponse.error) {
      throw new Error(
        `Failed to read latest alert detection timestamp: ${lastDetectedResponse.error.message}`,
      );
    }
    if (notableResponse.error) {
      throw new Error(`Failed to count notable alert detections: ${notableResponse.error.message}`);
    }
    if (alertWorthyResponse.error) {
      throw new Error(
        `Failed to count alert-worthy detections: ${alertWorthyResponse.error.message}`,
      );
    }
    if (notifiedResponse.error) {
      throw new Error(`Failed to count notified alert detections: ${notifiedResponse.error.message}`);
    }
    if (steamResponse.error) {
      throw new Error(`Failed to count steam alert detections: ${steamResponse.error.message}`);
    }

    return {
      lastDetectedAt: lastDetectedResponse.data?.current_snapshot_at ?? null,
      counts: {
        notable: notableResponse.count ?? 0,
        alertWorthy: alertWorthyResponse.count ?? 0,
        notified: notifiedResponse.count ?? 0,
        steamEvents: steamResponse.count ?? 0,
      },
    };
  }

  async updateNotified(input: AlertNotificationUpdateInput): Promise<void> {
    const { error } = await this.client
      .from('alert_detections')
      .update({
        notified: true,
        notified_at: input.notifiedAt,
        notified_channels: input.notifiedChannels,
        cooldown_expires_at: input.cooldownExpiresAt,
      })
      .eq('id', input.id);

    if (error) {
      throw new Error(`Failed to update alert notification state: ${error.message}`);
    }
  }
}

export class DatabaseHedgeOpportunityRepository
  implements HedgeOpportunityRepository
{
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async saveOpportunity(
    input: HedgeOpportunityCreateInput,
  ): Promise<HedgeOpportunityRecord | null> {
    const { data, error } = await this.client
      .from('hedge_opportunities')
      .insert({
        idempotency_key: input.idempotencyKey,
        event_id: input.eventId ?? null,
        participant_id: input.participantId ?? null,
        market_key: input.marketKey,
        type: input.type,
        priority: input.priority,
        bookmaker_a: input.bookmakerA,
        line_a: input.lineA,
        over_odds_a: input.overOddsA,
        bookmaker_b: input.bookmakerB,
        line_b: input.lineB,
        under_odds_b: input.underOddsB,
        line_discrepancy: input.lineDiscrepancy,
        implied_prob_a: input.impliedProbA,
        implied_prob_b: input.impliedProbB,
        total_implied_prob: input.totalImpliedProb,
        arbitrage_percentage: input.arbitragePercentage,
        profit_potential: input.profitPotential,
        guaranteed_profit: input.guaranteedProfit ?? null,
        middle_gap: input.middleGap ?? null,
        win_probability: input.winProbability ?? null,
        notified: input.notified ?? false,
        notified_at: input.notifiedAt ?? null,
        notified_channels: input.notifiedChannels ?? null,
        cooldown_expires_at: input.cooldownExpiresAt ?? null,
        metadata: toJsonObject(input.metadata),
        detected_at: input.detectedAt,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return null;
      }

      throw new Error(`Failed to save hedge opportunity: ${error.message}`);
    }

    return data;
  }

  async findActiveCooldown(
    input: HedgeOpportunityCooldownQuery,
  ): Promise<HedgeOpportunityRecord | null> {
    let query = this.client
      .from('hedge_opportunities')
      .select('*')
      .eq('market_key', input.marketKey)
      .eq('type', input.type)
      .eq('notified', true)
      .gt('cooldown_expires_at', input.now)
      .order('notified_at', { ascending: false })
      .limit(1);

    if (input.eventId === undefined || input.eventId === null) {
      query = query.is('event_id', null);
    } else {
      query = query.eq('event_id', input.eventId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`Failed to read active hedge cooldown: ${error.message}`);
    }

    return data;
  }

  async listRecent(limit = 20): Promise<HedgeOpportunityRecord[]> {
    const { data, error } = await this.client
      .from('hedge_opportunities')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list hedge opportunities: ${error.message}`);
    }

    return data ?? [];
  }

  async updateNotified(input: HedgeOpportunityNotificationUpdateInput): Promise<void> {
    const { error } = await this.client
      .from('hedge_opportunities')
      .update({
        notified: true,
        notified_at: input.notifiedAt,
        notified_channels: input.notifiedChannels,
        cooldown_expires_at: input.cooldownExpiresAt,
      })
      .eq('id', input.id);

    if (error) {
      throw new Error(`Failed to update hedge notification state: ${error.message}`);
    }
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

  async settlePickAtomic(input: SettlePickAtomicInput): Promise<SettlePickAtomicResult> {
    const s = input.settlement;
    const { data, error } = await this.client.rpc('settle_pick_atomic', {
      p_pick_id: input.pickId,
      p_settlement: {
        result: s.result ?? null,
        source: s.source,
        confidence: s.confidence,
        settled_by: s.settledBy,
        evidence_ref: s.evidenceRef,
        notes: s.notes ?? null,
        review_reason: s.reviewReason ?? null,
        payload: s.payload,
        settled_at: s.settledAt,
        corrects_id: s.correctsId ?? null,
      },
      p_lifecycle_from_state: input.lifecycleFromState,
      p_lifecycle_to_state: input.lifecycleToState,
      p_lifecycle_writer_role: input.lifecycleWriterRole,
      p_lifecycle_reason: input.lifecycleReason,
      p_audit_action: input.auditAction,
      p_audit_actor: input.auditActor,
      p_audit_payload: input.auditPayload,
    });

    if (error) {
      throw new Error(`settle_pick_atomic failed: ${error.message}`);
    }

    const result = data as {
      settlement: SettlementRecord;
      pick: PickRecord;
      lifecycleEvent: PickLifecycleRecord | null;
      duplicate: boolean;
    };

    return result;
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

  async listByType(runType: string, limit = 50): Promise<SystemRunRecord[]> {
    const { data, error } = await this.client
      .from('system_runs')
      .select('*')
      .eq('run_type', runType)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list system runs by type: ${error.message}`);
    }

    return data ?? [];
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
    // Deduplicate by idempotency_key before upsert — includeAltLine=true can produce
    // multiple entries with the same key in one batch, which Postgres rejects.
    const deduped = [...new Map(offers.map((o) => [o.idempotencyKey, o])).values()];
    const rows = deduped.map(mapProviderOfferInsertToRow);

    // Chunk upsert to avoid Supabase statement timeout on large MLB/NHL batches.
    const UPSERT_CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error } = await this.client
        .from('provider_offers')
        .upsert(chunk, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      if (error) {
        throw new Error(`Failed to upsert provider offers: ${error.message}`);
      }
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

  async findLatestByMarketKey(
    marketKey: string,
    providerKey?: string,
    providerParticipantId?: string | null,
  ): Promise<ProviderOfferRecord | null> {
    let query = this.client
      .from('provider_offers')
      .select('*')
      .eq('provider_market_key', marketKey)
      .order('snapshot_at', { ascending: false })
      .limit(1);

    if (providerKey) {
      query = query.eq('provider_key', providerKey);
    }

    if (providerParticipantId !== undefined) {
      query = query.eq('provider_participant_id', providerParticipantId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`Failed to find latest offer by market key: ${error.message}`);
    }

    return data;
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

  async listRecentOffers(since: string, limit = 10_000): Promise<ProviderOfferRecord[]> {
    const { data, error } = await this.client
      .from('provider_offers')
      .select('*')
      .gte('snapshot_at', since)
      .order('snapshot_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list recent provider offers: ${error.message}`);
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

    if (criteria.bookmakerKey !== undefined) {
      if (criteria.bookmakerKey === null) {
        query = query.is('bookmaker_key', null);
      } else {
        query = query.eq('bookmaker_key', criteria.bookmakerKey);
      }
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

  async findOpeningLine(
    criteria: ClosingLineLookupCriteria,
  ): Promise<ProviderOfferRecord | null> {
    let query = this.client
      .from('provider_offers')
      .select('*')
      .eq('provider_event_id', criteria.providerEventId)
      .eq('provider_market_key', criteria.providerMarketKey)
      .eq('is_opening', true);

    if (criteria.providerParticipantId === undefined || criteria.providerParticipantId === null) {
      query = query.is('provider_participant_id', null);
    } else {
      query = query.eq('provider_participant_id', criteria.providerParticipantId);
    }

    if (criteria.bookmakerKey !== undefined) {
      if (criteria.bookmakerKey === null) {
        query = query.is('bookmaker_key', null);
      } else {
        query = query.eq('bookmaker_key', criteria.bookmakerKey);
      }
    }

    const { data, error } = await query
      .order('snapshot_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find opening line: ${error.message}`);
    }

    return data;
  }

  async findExistingCombinations(
    providerEventIds: string[],
    options?: { includeBookmakerKey?: boolean; beforeSnapshotAt?: string },
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (providerEventIds.length === 0) return result;

    // Chunk to avoid URL length limits
    for (let i = 0; i < providerEventIds.length; i += 100) {
      const chunk = providerEventIds.slice(i, i + 100);
      let query = this.client
        .from('provider_offers')
        .select('provider_key, provider_event_id, provider_market_key, provider_participant_id, bookmaker_key, snapshot_at')
        .in('provider_event_id', chunk);
      if (options?.beforeSnapshotAt !== undefined) {
        query = query.lt('snapshot_at', options.beforeSnapshotAt);
      }
      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to find existing combinations: ${error.message}`);
      }

      for (const row of data ?? []) {
        const participantKey = row.provider_participant_id ?? '';
        const bookmakerKey = options?.includeBookmakerKey ? (row.bookmaker_key ?? '') : null;
        result.add(
          options?.includeBookmakerKey
            ? `${row.provider_key}:${row.provider_event_id}:${row.provider_market_key}:${participantKey}:${bookmakerKey}`
            : `${row.provider_key}:${row.provider_event_id}:${row.provider_market_key}:${participantKey}`,
        );
      }
    }

    return result;
  }

  async markClosingLines(
    events: Array<{ providerEventId: string; commenceTime: string }>,
    snapshotAt: string,
    options?: { includeBookmakerKey?: boolean },
  ): Promise<number> {
    const startedEvents = events.filter((e) => snapshotAt >= e.commenceTime);
    if (startedEvents.length === 0) return 0;

    // Scope to events that commenced within 48 hours of snapshotAt to avoid scanning stale data.
    const windowStart = new Date(new Date(snapshotAt).getTime() - 48 * 60 * 60 * 1000).toISOString();
    const recentEvents = startedEvents.filter((e) => e.commenceTime >= windowStart);
    const skipped = startedEvents.length - recentEvents.length;
    if (skipped > 0) {
      console.warn(`[markClosingLines] skipping ${skipped} event(s) outside the 48h window`);
    }
    if (recentEvents.length === 0) return 0;

    let totalUpdated = 0;

    for (const { providerEventId, commenceTime } of recentEvents) {
      // Fetch pre-commence offers for this event. Limit 5000 rows as a safety cap.
      const { data, error } = await this.client
        .from('provider_offers')
        .select('id, provider_key, provider_market_key, provider_participant_id, bookmaker_key, snapshot_at, is_closing')
        .eq('provider_event_id', providerEventId)
        .lt('snapshot_at', commenceTime)
        .eq('is_closing', false)
        .order('snapshot_at', { ascending: false })
        .limit(5000);

      if (error) {
        throw new Error(`Failed to fetch offers for closing line marking: ${error.message}`);
      }

      const rows = data ?? [];
      if (rows.length === 0) continue;

      // Find the latest snapshot per combination key
      const latestIdByKey = new Map<string, string>();
      for (const row of rows) {
        const participantKey = row.provider_participant_id ?? '';
        const bookmakerKey = options?.includeBookmakerKey ? (row.bookmaker_key ?? '') : null;
        const key = options?.includeBookmakerKey
          ? `${row.provider_key}:${row.provider_market_key}:${participantKey}:${bookmakerKey}`
          : `${row.provider_key}:${row.provider_market_key}:${participantKey}`;
        if (!latestIdByKey.has(key)) {
          // rows are ordered descending — first seen is latest
          latestIdByKey.set(key, row.id);
        }
      }

      const idsToMark = [...latestIdByKey.values()];
      if (idsToMark.length === 0) continue;

      // Batch update in chunks of 100
      for (let i = 0; i < idsToMark.length; i += 100) {
        const chunk = idsToMark.slice(i, i + 100);
        const { error: updateError, count } = await this.client
          .from('provider_offers')
          .update({ is_closing: true })
          .in('id', chunk);

        if (updateError) {
          throw new Error(`Failed to mark closing lines: ${updateError.message}`);
        }

        totalUpdated += count ?? chunk.length;
      }
    }

    return totalUpdated;
  }

  async resolveProviderMarketKey(canonicalKey: string, provider: string): Promise<string | null> {
    const { data, error } = await fromUntyped(this.client, 'provider_market_aliases')
      .select('provider_market_key')
      .eq('market_type_id', canonicalKey)
      .eq('provider', provider)
      .limit(1);

    if (error) {
      throw new Error(`Failed to resolve provider market key: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ provider_market_key: string }>;
    return rows[0]?.provider_market_key ?? null;
  }

  async resolveCanonicalMarketKey(providerMarketKey: string, provider: string): Promise<string | null> {
    const { data, error } = await fromUntyped(this.client, 'provider_market_aliases')
      .select('market_type_id')
      .eq('provider_market_key', providerMarketKey)
      .eq('provider', provider)
      .limit(1);

    if (error) {
      throw new Error(`Failed to resolve canonical market key: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ market_type_id: string }>;
    return rows[0]?.market_type_id ?? null;
  }

  async listAliasLookup(provider: string): Promise<ProviderMarketAliasRow[]> {
    const { data, error } = await fromUntyped(this.client, 'provider_market_aliases')
      .select('*')
      .eq('provider', provider);

    if (error) {
      throw new Error(`Failed to load alias lookup: ${error.message}`);
    }

    return (data ?? []) as ProviderMarketAliasRow[];
  }

  async listParticipantAliasLookup(provider: string): Promise<ProviderEntityAliasRow[]> {
    const { data, error } = await fromUntyped(this.client, 'provider_entity_aliases')
      .select('*')
      .eq('provider', provider)
      .eq('entity_kind', 'player');

    if (error) {
      throw new Error(`Failed to load participant alias lookup: ${error.message}`);
    }

    return (data ?? []) as unknown as ProviderEntityAliasRow[];
  }

  async listOpeningOffers(since: string, provider: string, limit = 500): Promise<ProviderOfferRecord[]> {
    const { data, error } = await this.client
      .from('provider_offers')
      .select('*')
      .eq('provider_key', provider)
      .eq('is_opening', true)
      .gte('snapshot_at', since)
      .not('over_odds', 'is', null)
      .not('under_odds', 'is', null)
      .not('line', 'is', null)
      .not('provider_participant_id', 'is', null)
      .order('snapshot_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list opening offers: ${error.message}`);
    }

    return (data ?? []) as ProviderOfferRecord[];
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

  async listRecentByEntityType(
    entityType: string,
    since: string,
    action?: string | undefined,
  ): Promise<AuditLogRow[]> {
    let query = this.client
      .from('audit_log')
      .select('*')
      .eq('entity_type', entityType)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (action !== undefined) {
      query = query.eq('action', action);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list audit log rows: ${error.message}`);
    }

    return data ?? [];
  }
}

export class DatabaseParticipantRepository implements ParticipantRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async upsertByExternalId(input: ParticipantUpsertInput): Promise<ParticipantRow> {
    // Preserve enrichment-only fields (headshot_url, logo_url) managed by the
    // enrichment service. The ingestor passes null for these — do not overwrite
    // a previously enriched value with null.
    const existing = await this.findByExternalId(input.externalId);
    const incomingMeta = input.metadata as Record<string, unknown>;
    const existingMeta = (existing?.metadata as Record<string, unknown>) ?? {};
    const mergedMeta: Record<string, unknown> = { ...incomingMeta };
    for (const field of ['headshot_url', 'logo_url']) {
      if (mergedMeta[field] == null && existingMeta[field] != null) {
        mergedMeta[field] = existingMeta[field];
      }
    }

    const row = {
      external_id: input.externalId,
      display_name: input.displayName,
      participant_type: input.participantType,
      sport: input.sport ?? null,
      league: input.league ?? null,
      metadata: toJsonObject(mergedMeta),
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
    // Supabase PostgREST enforces a server-side max-rows of 1000. Paginate to fetch all rows.
    const PAGE_SIZE = 1000;
    const allRows: ParticipantRow[] = [];
    let offset = 0;

    while (true) {
      let query = this.client
        .from('participants')
        .select('*')
        .eq('participant_type', participantType);
      if (sport) {
        query = query.eq('sport', sport);
      }
      const { data, error } = await query
        .order('display_name')
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to list participants by type: ${error.message}`);
      }

      const page = data ?? [];
      allRows.push(...page);

      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return allRows;
  }

  async updateMetadata(participantId: string, metadata: Record<string, unknown>): Promise<ParticipantRow> {
    const existing = await this.findById(participantId);
    if (!existing) {
      throw new Error(`Participant not found: ${participantId}`);
    }
    const merged = { ...(existing.metadata as Record<string, unknown> ?? {}), ...metadata };
    const { data, error } = await this.client
      .from('participants')
      .update({ metadata: toJsonObject(merged), updated_at: new Date().toISOString() })
      .eq('id', participantId)
      .select()
      .single();
    if (error || !data) {
      throw new Error(`Failed to update participant metadata: ${error?.message ?? 'unknown error'}`);
    }
    return data;
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

  async listByName(eventName: string): Promise<EventRow[]> {
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .ilike('event_name', eventName.trim());

    if (error) {
      throw new Error(`Failed to list events by name: ${error.message}`);
    }

    return data ?? [];
  }

  async listStartedBySnapshot(snapshotAt: string): Promise<EventRow[]> {
    const snapshotDate = snapshotAt.slice(0, 10); // YYYY-MM-DD
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .lte('event_date', snapshotDate);

    if (error) {
      throw new Error(`Failed to list started events: ${error.message}`);
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
    const { data, error } = await this.client
      .from('event_participants')
      .upsert(
        {
          event_id: input.eventId,
          participant_id: input.participantId,
          role: input.role,
        },
        { onConflict: 'event_id,participant_id', ignoreDuplicates: false },
      )
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to upsert event participant link: ${error?.message ?? 'unknown error'}`,
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

// Derives the high-level market category strings used by Smart Form from canonical
// market_type_id values in sport_market_type_availability. Preserves the display
// order: player-prop → moneyline → spread → total → team-total.
const MARKET_CATEGORY_PRIORITY: Record<string, number> = {
  'player-prop': 1,
  moneyline: 2,
  spread: 3,
  total: 4,
  'team-total': 5,
};

function marketTypeIdToCategory(id: string): string | null {
  if (id === 'moneyline') return 'moneyline';
  if (id === 'spread') return 'spread';
  if (id === 'game_total_ou') return 'total';
  if (id === 'team_total_ou') return 'team-total';
  if (id.startsWith('player_')) return 'player-prop';
  return null;
}

function deriveCatalogMarketCategories(marketTypeIds: string[]): string[] {
  const categories = Array.from(
    new Set(marketTypeIds.map(marketTypeIdToCategory).filter((c): c is string => c !== null)),
  );
  return categories.sort((a, b) => (MARKET_CATEGORY_PRIORITY[a] ?? 99) - (MARKET_CATEGORY_PRIORITY[b] ?? 99));
}

export class DatabaseReferenceDataRepository implements ReferenceDataRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async getCatalog(): Promise<ReferenceDataCatalog> {
    const [sportsRes, marketAvailRes, statTypesRes, comboStatTypesRes, sportsbooksRes, cappersRes, teamsRes] =
      await Promise.all([
        this.client.from('sports').select('*').eq('active', true).order('sort_order'),
        // UTV2-397: sport_market_types deprecated — query sport_market_type_availability instead
        this.client.from('sport_market_type_availability').select('sport_id,market_type_id,sort_order').eq('active', true).order('sort_order'),
        this.client.from('stat_types').select('*').eq('active', true).order('sort_order'),
        this.client.from('combo_stat_types').select('*').eq('active', true).order('sort_order'),
        this.client.from('sportsbooks').select('*').eq('active', true).order('sort_order'),
        this.client.from('cappers').select('*').eq('active', true),
        this.client
          .from('participants')
          .select('external_id,display_name,sport')
          .eq('participant_type', 'team'),
      ]);

    if (sportsRes.error) throw new Error(`Failed to load sports: ${sportsRes.error.message}`);
    if (marketAvailRes.error) throw new Error(`Failed to load market type availability: ${marketAvailRes.error.message}`);
    if (statTypesRes.error) throw new Error(`Failed to load stat types: ${statTypesRes.error.message}`);
    if (comboStatTypesRes.error) throw new Error(`Failed to load combo stat types: ${comboStatTypesRes.error.message}`);
    if (sportsbooksRes.error) throw new Error(`Failed to load sportsbooks: ${sportsbooksRes.error.message}`);
    if (cappersRes.error) throw new Error(`Failed to load cappers: ${cappersRes.error.message}`);
    if (teamsRes.error) throw new Error(`Failed to load teams: ${teamsRes.error.message}`);

    const sports = (sportsRes.data ?? []).map((sport) => {
      const fallbackSport = V1_REFERENCE_DATA.sports.find((entry) => entry.id === sport.id);

      return {
        id: sport.id as string,
        name: sport.display_name as string,
        marketTypes: deriveCatalogMarketCategories(
          (marketAvailRes.data ?? []).filter((row) => row.sport_id === sport.id).map((row) => row.market_type_id as string),
        ) as ReferenceDataCatalog['sports'][number]['marketTypes'],
        statTypes: Array.from(
          new Set([
            ...(statTypesRes.data ?? [])
              .filter((st) => st.sport_id === sport.id)
              .map((st) => st.name as string),
            ...(comboStatTypesRes.data ?? [])
              .filter((combo) => combo.sport_id === sport.id)
              .map((combo) => combo.display_name as string),
            ...(fallbackSport?.statTypes ?? []),
          ]),
        ),
        teams: (teamsRes.data ?? [])
          .filter((t) => t.sport === sport.id)
          .map((t) => t.display_name as string),
      };
    });

    const sportsbooks = (sportsbooksRes.data ?? []).map((sb) => ({
      id: sb.id as string,
      name: sb.display_name as string,
    }));

      const cappers = (cappersRes.data ?? []).map((capper) => ({
        id: capper.id as string,
        displayName:
          typeof capper.display_name === 'string' && capper.display_name.trim().length > 0
            ? capper.display_name
            : (capper.id as string),
      }));

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

  private fromUntyped(table: string) {
    return (this.client as unknown as UntypedSupabaseClient).from(table);
  }

  async listLeagues(sportId: string): Promise<LeagueBrowseResult[]> {
    const { data, error } = await this.fromUntyped('leagues')
      .select('id,sport_id,display_name,sort_order,active')
      .eq('sport_id', sportId)
      .eq('active', true)
      .order('sort_order');

    if (error) throw new Error(`Failed to list leagues: ${error.message}`);

    const leagueRows = (data ?? []) as CanonicalLeagueRow[];

    return leagueRows.map((row) => ({
      id: row.id as string,
      sportId: row.sport_id as string,
      displayName: row.display_name as string,
    }));
  }

  async listMatchups(sportId: string, date: string): Promise<MatchupBrowseResult[]> {
    const { data: events, error: eventsError } = await this.client
      .from('events')
      .select('id,event_name,event_date,status,sport_id,external_id,metadata')
      .eq('sport_id', sportId)
      .eq('event_date', date)
      .order('event_name');

    if (eventsError) throw new Error(`Failed to list matchups: ${eventsError.message}`);
    if (!events || events.length === 0) {
      return [];
    }

    const eventIds = events.map((row) => row.id as string);
    const { data: eventParticipants, error: eventParticipantsError } = await this.client
      .from('event_participants')
      .select('event_id,participant_id,role')
      .in('event_id', eventIds);
    if (eventParticipantsError) {
      throw new Error(`Failed to load matchup participants: ${eventParticipantsError.message}`);
    }

    const participantIds = Array.from(
      new Set((eventParticipants ?? []).map((row) => row.participant_id as string)),
    );
    const participantMap = await this.loadParticipantsMap(participantIds);
    const teamMap = await this.loadCanonicalTeamsByParticipantIds(participantIds);
    const eventParticipantRows = eventParticipants ?? [];

    // Detect doubleheaders: group events by event_name to find duplicates
    const eventsByName = new Map<string, typeof events>();
    for (const event of events) {
      const name = event.event_name as string;
      const group = eventsByName.get(name) ?? [];
      group.push(event);
      eventsByName.set(name, group);
    }
    // For each duplicate group, sort by external_id (alphabetical) for deterministic ordering
    const gameLabelMap = new Map<string, string>();
    for (const [, group] of eventsByName) {
      if (group.length >= 2) {
        const sorted = [...group].sort((a, b) =>
          ((a.external_id as string) ?? '').localeCompare((b.external_id as string) ?? ''),
        );
        sorted.forEach((event, index) => {
          gameLabelMap.set(event.id as string, ` · Game ${index + 1}`);
        });
      }
    }

    return events.map((event) => {
      const teams = eventParticipantRows
        .filter(
          (row) =>
            row.event_id === event.id &&
            (row.role === 'home' || row.role === 'away'),
        )
        .map((row) => {
          const participant = participantMap.get(row.participant_id as string);
          const team = teamMap.get(row.participant_id as string) ?? null;
          return {
            participantId: row.participant_id as string,
            teamId: team?.id ?? null,
            displayName: participant?.display_name ?? 'Unknown Team',
            role: row.role as 'home' | 'away',
          };
        })
        .sort((left, right) => roleSortOrder(left.role) - roleSortOrder(right.role));

      const leagueId = teams
        .map((team) => teamMap.get(team.participantId)?.league_id ?? null)
        .find((value) => value !== null) ?? null;

      const eventId = event.id as string;
      const baseEventName = event.event_name as string;
      const gameLabel = gameLabelMap.get(eventId) ?? '';

      return {
        eventId,
        externalId: (event.external_id as string | null) ?? null,
        eventName: baseEventName + gameLabel,
        eventDate: event.event_date as string,
        startTime: extractStartsAt(event.metadata),
        status: event.status as string,
        sportId: event.sport_id as string,
        leagueId,
        teams,
      };
    });
  }

  async getEventBrowse(eventId: string): Promise<EventBrowseResult | null> {
    const { data: event, error: eventError } = await this.client
      .from('events')
      .select('id,event_name,event_date,status,sport_id,external_id,metadata')
      .eq('id', eventId)
      .maybeSingle();

    if (eventError) throw new Error(`Failed to load event browse: ${eventError.message}`);
    if (!event) {
      return null;
    }

    const { data: eventParticipants, error: eventParticipantsError } = await this.client
      .from('event_participants')
      .select('event_id,participant_id,role')
      .eq('event_id', eventId);
    if (eventParticipantsError) {
      throw new Error(`Failed to load event browse participants: ${eventParticipantsError.message}`);
    }

    const eventParticipantRows = eventParticipants ?? [];
    const participantIds = Array.from(
      new Set(eventParticipantRows.map((row) => row.participant_id as string)),
    );
    const participantMap = await this.loadParticipantsMap(participantIds);
    const teamMap = await this.loadCanonicalTeamsByParticipantIds(participantIds);
    const currentAssignments = await this.loadCurrentAssignments(participantIds);
    const teamNameMap = new Map<string, string>(
      Array.from(teamMap.values()).map((team) => [team.id, team.display_name]),
    );

    const participants: EventParticipantBrowseResult[] = [];
    for (const row of eventParticipantRows) {
      const participant = participantMap.get(row.participant_id as string);
      if (!participant) {
        continue;
      }

      if (participant.participant_type === 'team') {
        const team = teamMap.get(participant.id) ?? null;
        participants.push({
          participantId: participant.id,
          canonicalId: team?.id ?? null,
          participantType: 'team',
          displayName: participant.display_name,
          role: row.role as string,
          teamId: team?.id ?? null,
          teamName: team?.display_name ?? null,
        });
        continue;
      }

      const assignment = currentAssignments.get(participant.id) ?? null;
      participants.push({
        participantId: participant.id,
        canonicalId: participant.id,
        participantType: 'player',
        displayName: participant.display_name,
        role: row.role as string,
        teamId: assignment?.teamId ?? null,
        teamName: assignment?.teamId ? teamNameMap.get(assignment.teamId) ?? null : null,
      });
    }

    const offers = await this.loadEventOffers(
      (event.external_id as string | null) ?? null,
      participants,
      event.sport_id as string,
    );

    const leagueId = participants
      .map((participant) =>
        participant.participantType === 'team'
          ? teamMap.get(participant.participantId)?.league_id ?? null
          : currentAssignments.get(participant.participantId)?.leagueId ?? null,
      )
      .find((value) => value !== null) ?? null;

    return {
      eventId: event.id as string,
      externalId: (event.external_id as string | null) ?? null,
      eventName: event.event_name as string,
      eventDate: event.event_date as string,
      startTime: extractStartsAt(event.metadata),
      status: event.status as string,
      sportId: event.sport_id as string,
      leagueId,
      participants,
      offers,
    };
  }

  async searchTeams(sportId: string, query: string, limit = 20): Promise<TeamSearchResult[]> {
    const leagues = await this.listLeagues(sportId);
    const leagueIds = leagues.map((league) => league.id);
    if (leagueIds.length === 0) {
      return [];
    }

    const { data, error } = await this.fromUntyped('teams')
      .select('id,display_name,league_id')
      .in('league_id', leagueIds)
      .ilike('display_name', `%${query}%`)
      .limit(limit);

    if (error) throw new Error(`Failed to search teams: ${error.message}`);

    const teamRows = (data ?? []) as CanonicalTeamRow[];

    return teamRows.map((row) => ({
      participantId: row.id as string,
      displayName: row.display_name as string,
      sport: sportId,
    }));
  }

  async searchPlayers(sportId: string, query: string, limit = 20): Promise<PlayerSearchResult[]> {
    const { data, error } = await this.fromUntyped('players')
      .select('id,display_name')
      .ilike('display_name', `%${query}%`)
      .limit(limit * 5);

    if (error) throw new Error(`Failed to search players: ${error.message}`);

    const playerRows = (data ?? []) as CanonicalPlayerRow[];
    const candidateIds = playerRows.map((row) => row.id as string);
    const currentAssignments = await this.loadCurrentAssignments(candidateIds);

    return playerRows
      .filter((row) => currentAssignments.get(row.id as string)?.sportId === sportId)
      .slice(0, limit)
      .map((row) => ({
        participantId: row.id as string,
        displayName: row.display_name as string,
        sport: sportId,
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

  async searchBrowse(sportId: string, date: string, query: string, limit = 20): Promise<BrowseSearchResult[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const matchups = await this.listMatchups(sportId, date);
    if (matchups.length === 0) {
      return [];
    }

    const results: BrowseSearchResult[] = [];
    const seen = new Set<string>();
    const matchupByEventId = new Map(matchups.map((matchup) => [matchup.eventId, matchup]));
    const eventIds = matchups.map((matchup) => matchup.eventId);

    for (const matchup of matchups) {
      const matchupLabel = formatBrowseMatchup(matchup);
      if (
        matchesBrowseQuery(
          normalizedQuery,
          matchup.eventName,
          matchupLabel,
          matchup.teams.map((team) => team.displayName),
        )
      ) {
        pushBrowseSearchResult(results, seen, {
          resultType: 'matchup',
          participantId: null,
          displayName: matchupLabel,
          contextLabel: buildMatchupContext(matchup),
          teamId: null,
          teamName: null,
          matchup,
        });
      }

      for (const team of matchup.teams) {
        if (!matchesBrowseQuery(normalizedQuery, team.displayName)) {
          continue;
        }

        const opponent = matchup.teams.find((candidate) => candidate.participantId !== team.participantId);
        pushBrowseSearchResult(results, seen, {
          resultType: 'team',
          participantId: team.teamId ?? team.participantId,
          displayName: team.displayName,
          contextLabel: `${opponent ? `vs ${opponent.displayName} · ` : ''}${buildMatchupContext(matchup)}`,
          teamId: team.teamId ?? team.participantId,
          teamName: team.displayName,
          matchup,
        });
      }
    }

    const { data: eventParticipants, error: eventParticipantsError } = await this.client
      .from('event_participants')
      .select('event_id,participant_id')
      .in('event_id', eventIds);
    if (eventParticipantsError) {
      throw new Error(`Failed to load search event participants: ${eventParticipantsError.message}`);
    }

    const playerParticipantRows = (eventParticipants ?? []).filter((row) => {
      const matchup = matchupByEventId.get(row.event_id as string);
      return Boolean(matchup);
    });
    const participantIds = Array.from(new Set(playerParticipantRows.map((row) => row.participant_id as string)));
    const participantMap = await this.loadParticipantsMap(participantIds);
    const playerIds = Array.from(
      new Set(
        participantIds.filter((participantId) => participantMap.get(participantId)?.participant_type === 'player'),
      ),
    );
    const assignments = await this.loadCurrentAssignments(playerIds);
    const teamIds = Array.from(
      new Set(
        Array.from(assignments.values())
          .map((assignment) => assignment.teamId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    );
    const teamNameMap = new Map<string, string>();
    if (teamIds.length > 0) {
      const { data: teams, error: teamsError } = await this.fromUntyped('teams')
        .select('id,display_name')
        .in('id', teamIds);
      if (teamsError) {
        throw new Error(`Failed to load search teams: ${teamsError.message}`);
      }

      for (const row of (teams ?? []) as CanonicalTeamRow[]) {
        teamNameMap.set(row.id as string, row.display_name as string);
      }
    }

    for (const row of playerParticipantRows) {
      const participant = participantMap.get(row.participant_id as string);
      if (!participant || participant.participant_type !== 'player') {
        continue;
      }
      if (!matchesBrowseQuery(normalizedQuery, participant.display_name)) {
        continue;
      }

      const matchup = matchupByEventId.get(row.event_id as string);
      if (!matchup) {
        continue;
      }

      const assignment = assignments.get(participant.id) ?? null;
      const matchupLabel = formatBrowseMatchup(matchup);
      pushBrowseSearchResult(results, seen, {
        resultType: 'player',
        participantId: participant.id,
        displayName: participant.display_name,
        contextLabel: `${assignment?.teamId ? teamNameMap.get(assignment.teamId) ?? 'Unassigned' : 'Unassigned'} · ${matchupLabel} · ${buildMatchupContext(matchup)}`,
        teamId: assignment?.teamId ?? null,
        teamName: assignment?.teamId ? teamNameMap.get(assignment.teamId) ?? null : null,
        matchup,
      });
    }

    return results.slice(0, limit);
  }

  private async loadParticipantsMap(participantIds: string[]) {
    if (participantIds.length === 0) {
      return new Map<string, ParticipantRow>();
    }

    const { data, error } = await this.client
      .from('participants')
      .select('*')
      .in('id', participantIds);
    if (error) throw new Error(`Failed to load participants: ${error.message}`);
    return new Map((data ?? []).map((row) => [row.id as string, row as ParticipantRow]));
  }

  private async loadCanonicalTeamsByParticipantIds(participantIds: string[]) {
    if (participantIds.length === 0) {
      return new Map<string, CanonicalTeamRow>();
    }

    const { data: aliasData, error: aliasError } = await this.fromUntyped('provider_entity_aliases')
      .select('participant_id,team_id')
      .eq('entity_kind', 'team')
      .in('participant_id', participantIds);
    if (aliasError) {
      throw new Error(`Failed to load canonical team aliases: ${aliasError.message}`);
    }

    const aliasRows = (aliasData ?? []) as ProviderEntityAliasRow[];
    const teamIds = Array.from(
      new Set(
        aliasRows
          .map((row) => row.team_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    );
    if (teamIds.length === 0) {
      return new Map<string, CanonicalTeamRow>();
    }

    const { data: teamData, error: teamError } = await this.fromUntyped('teams')
      .select('id,league_id,display_name,metadata')
      .in('id', teamIds);
    if (teamError) {
      throw new Error(`Failed to load canonical teams: ${teamError.message}`);
    }

    const teamMap = new Map<string, CanonicalTeamRow>(
      ((teamData ?? []) as CanonicalTeamRow[]).map((row) => [row.id, row]),
    );

    return new Map<string, CanonicalTeamRow>(
      aliasRows.flatMap((row) => {
        if (!row.participant_id || !row.team_id) {
          return [];
        }
        const team = teamMap.get(row.team_id);
        return team ? [[row.participant_id, team] as [string, CanonicalTeamRow]] : [];
      }),
    );
  }

  private async loadCurrentAssignments(playerIds: string[]) {
    if (playerIds.length === 0) {
      return new Map<string, { teamId: string; leagueId: string; sportId: string | null }>();
    }

    const { data: assignments, error: assignmentsError } = await this.fromUntyped('player_team_assignments')
      .select('player_id,team_id,league_id,effective_until')
      .in('player_id', playerIds)
      .is('effective_until', null);
    if (assignmentsError) {
      throw new Error(`Failed to load player assignments: ${assignmentsError.message}`);
    }

    const assignmentRows = (assignments ?? []) as PlayerTeamAssignmentRow[];
    const leagueIds = Array.from(new Set(assignmentRows.map((row) => row.league_id as string)));
    const { data: leagues, error: leaguesError } = await this.fromUntyped('leagues')
      .select('id,sport_id')
      .in('id', leagueIds);
    if (leaguesError) {
      throw new Error(`Failed to load assignment leagues: ${leaguesError.message}`);
    }

    const leagueRows = (leagues ?? []) as CanonicalLeagueRow[];
    const leagueSportMap = new Map<string, string>(
      leagueRows.map((row) => [row.id as string, row.sport_id as string]),
    );
    return new Map<string, { teamId: string; leagueId: string; sportId: string | null }>(
      assignmentRows.map((row) => [
        row.player_id as string,
        {
          teamId: row.team_id as string,
          leagueId: row.league_id as string,
          sportId: leagueSportMap.get(row.league_id as string) ?? null,
        },
      ]),
    );
  }

  private async loadEventOffers(
    providerEventId: string | null,
    participants: EventParticipantBrowseResult[],
    sportId: string,
  ): Promise<EventOfferBrowseResult[]> {
    if (!providerEventId) {
      return [];
    }

    // Split into two queries to bypass Supabase PostgREST's 1000-row page cap.
    // A single query ordered by snapshot_at fills the 1000 slots with player-prop
    // rows, silently dropping all game-level markets (ML, spread, total, 1H, F5,
    // innings, team total). Separating by provider_participant_id guarantees both
    // categories are always represented regardless of row counts.
    const recentSince = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const [gameLevelResult, playerPropResult] = await Promise.all([
      // Game-level: ML, spread, totals, halves, innings, team totals (~200 rows max)
      this.client
        .from('provider_offers')
        .select('*')
        .eq('provider_event_id', providerEventId)
        .gte('snapshot_at', recentSince)
        .is('provider_participant_id', null)
        .order('snapshot_at', { ascending: false })
        .limit(1000),
      // Player props: batting, pitching, etc. (~1000 rows, one snapshot cycle)
      this.client
        .from('provider_offers')
        .select('*')
        .eq('provider_event_id', providerEventId)
        .gte('snapshot_at', recentSince)
        .not('provider_participant_id', 'is', null)
        .order('snapshot_at', { ascending: false })
        .limit(1000),
    ]);

    if (gameLevelResult.error) {
      throw new Error(`Failed to load game-level offers: ${gameLevelResult.error.message}`);
    }
    if (playerPropResult.error) {
      throw new Error(`Failed to load player-prop offers: ${playerPropResult.error.message}`);
    }

    const offers = [
      ...(gameLevelResult.data ?? []),
      ...(playerPropResult.data ?? []),
    ];

    if (offers.length === 0) {
      return [];
    }

    const providerMarketKeys = Array.from(new Set(offers.map((row) => row.provider_market_key as string)));
    const { data: marketAliases, error: marketAliasesError } = await this.fromUntyped('provider_market_aliases')
      .select('provider,provider_market_key,provider_display_name,market_type_id,sport_id')
      .in('provider_market_key', providerMarketKeys);
    if (marketAliasesError) {
      throw new Error(`Failed to load market aliases: ${marketAliasesError.message}`);
    }

    const marketAliasRows = (marketAliases ?? []) as ProviderMarketAliasRow[];
    const marketTypeIds = Array.from(
      new Set(
        marketAliasRows
          .map((row) => row.market_type_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    );
    const { data: marketTypes, error: marketTypesError } = await this.fromUntyped('market_types')
      .select('id,display_name')
      .in('id', marketTypeIds);
    if (marketTypesError) {
      throw new Error(`Failed to load market types: ${marketTypesError.message}`);
    }
    const marketTypeRows = (marketTypes ?? []) as MarketTypeRow[];

    const providerParticipantIds = Array.from(
      new Set(
        offers
          .map((row) => row.provider_participant_id as string | null)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const { data: entityAliases, error: entityAliasesError } = await this.fromUntyped('provider_entity_aliases')
      .select('provider,entity_kind,provider_entity_key,team_id,player_id')
      .in('provider_entity_key', providerParticipantIds);
    if (entityAliasesError) {
      throw new Error(`Failed to load entity aliases: ${entityAliasesError.message}`);
    }
    const entityAliasRows = (entityAliases ?? []) as ProviderEntityAliasRow[];

    const bookAliasKeys = Array.from(
      new Set(
        offers
          .map((row) => {
            const explicitBookmakerKey = typeof row.bookmaker_key === 'string'
              ? row.bookmaker_key
              : null;
            if (explicitBookmakerKey && explicitBookmakerKey.length > 0) {
              return explicitBookmakerKey;
            }

            return splitProviderBookKey(row.provider_key as string).bookKey;
          })
          .filter((value): value is string => value.length > 0),
      ),
    );
    const { data: bookAliases, error: bookAliasesError } = await this.fromUntyped('provider_book_aliases')
      .select('provider,provider_book_key,sportsbook_id')
      .in('provider_book_key', bookAliasKeys);
    if (bookAliasesError) {
      throw new Error(`Failed to load book aliases: ${bookAliasesError.message}`);
    }
    const bookAliasRows = (bookAliases ?? []) as ProviderBookAliasRow[];

    const sportsbookIds = Array.from(
      new Set(
        bookAliasRows
          .map((row) => row.sportsbook_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    );
    const { data: sportsbooks, error: sportsbooksError } = await this.client
      .from('sportsbooks')
      .select('id,display_name')
      .in('id', sportsbookIds);
    if (sportsbooksError) {
      throw new Error(`Failed to load sportsbooks: ${sportsbooksError.message}`);
    }

    const participantNameMap = new Map(
      participants
        .flatMap((participant) => {
          const pairs: Array<[string, string]> = [[participant.participantId, participant.displayName]];
          if (participant.canonicalId) {
            pairs.push([participant.canonicalId, participant.displayName]);
          }
          return pairs;
        }),
    );

    const marketAliasMap = new Map(
      marketAliasRows
        .filter((row) => !row.sport_id || row.sport_id === sportId)
        .map((row) => [`${row.provider}:${row.provider_market_key}`, row]),
    );
    const marketTypeMap = new Map<string, string>(
      marketTypeRows.map((row) => [row.id as string, row.display_name as string]),
    );
    const entityAliasMap = new Map(
      entityAliasRows.map((row) => [`${row.provider}:${row.provider_entity_key}`, row]),
    );
    const bookAliasMap = new Map<string, string | null>(
      bookAliasRows.map((row) => [`${row.provider}:${row.provider_book_key}`, row.sportsbook_id]),
    );
    const sportsbookMap = new Map((sportsbooks ?? []).map((row) => [row.id as string, row.display_name as string]));

    const grouped = new Map<string, EventOfferBrowseResult>();
    for (const offer of offers) {
      const providerKey = offer.provider_key as string;
      const { provider, bookKey: providerFallbackBookKey } = splitProviderBookKey(providerKey);
      const explicitBookmakerKey = typeof offer.bookmaker_key === 'string'
        ? offer.bookmaker_key
        : null;
      const resolvedBookKey = explicitBookmakerKey && explicitBookmakerKey.length > 0
        ? explicitBookmakerKey
        : providerFallbackBookKey;
      const providerMarketKey = offer.provider_market_key as string;
      const providerParticipantId = (offer.provider_participant_id as string | null) ?? null;
      const marketAlias = marketAliasMap.get(`${provider}:${providerMarketKey}`);
      const entityAlias = providerParticipantId
        ? entityAliasMap.get(`${provider}:${providerParticipantId}`)
        : null;
      const sportsbookId =
        bookAliasMap.get(`${provider}:${resolvedBookKey}`) ??
        (resolvedBookKey && resolvedBookKey !== 'sgo' ? resolvedBookKey : null);
      const participantId =
        entityAlias?.player_id ??
        entityAlias?.team_id ??
        null;
      const key = [
        sportsbookId ?? providerKey,
        marketAlias?.market_type_id ?? providerMarketKey,
        participantId ?? providerParticipantId ?? 'all',
        offer.line ?? 'null',
      ].join(':');
      const existing = grouped.get(key);
      if (existing && existing.snapshotAt >= (offer.snapshot_at as string)) {
        continue;
      }

      grouped.set(key, {
        sportsbookId,
        // Null-bookmaker "consensus" offers come from SGO with no specific book.
        // Display as "Consensus" rather than the raw provider key.
        sportsbookName: sportsbookId
          ? (sportsbookMap.get(sportsbookId) ?? sportsbookId)
          : (providerKey === 'sgo' || providerKey.startsWith('sgo:') ? 'Consensus' : providerKey),
        marketTypeId: (marketAlias?.market_type_id as string | null) ?? null,
        marketDisplayName:
          (marketAlias?.market_type_id
            ? marketTypeMap.get(marketAlias.market_type_id as string)
            : null) ??
          (marketAlias?.provider_display_name as string | null) ??
          providerMarketKey,
        participantId,
        participantName: participantId ? participantNameMap.get(participantId) ?? null : null,
        line: (offer.line as number | null) ?? null,
        overOdds: (offer.over_odds as number | null) ?? null,
        underOdds: (offer.under_odds as number | null) ?? null,
        snapshotAt: offer.snapshot_at as string,
        providerKey,
        providerMarketKey,
        providerParticipantId,
      });
    }

    return Array.from(grouped.values()).sort((left, right) => {
      const sportsbookCompare = (left.sportsbookName ?? '').localeCompare(right.sportsbookName ?? '');
      if (sportsbookCompare !== 0) return sportsbookCompare;
      const marketCompare = left.marketDisplayName.localeCompare(right.marketDisplayName);
      if (marketCompare !== 0) return marketCompare;
      const participantCompare = (left.participantName ?? '').localeCompare(right.participantName ?? '');
      if (participantCompare !== 0) return participantCompare;
      return (left.line ?? 0) - (right.line ?? 0);
    });
  }
}

function extractStartsAt(metadata: unknown): string | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const raw = (metadata as Record<string, unknown>)['starts_at'];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  }
  return null;
}

function splitProviderBookKey(providerKey: string) {
  const [provider, bookKey] = providerKey.includes(':')
    ? providerKey.split(':', 2)
    : [providerKey, providerKey];
  return { provider, bookKey };
}

function matchesBrowseQuery(
  query: string,
  ...values: Array<string | string[] | null | undefined>
) {
  return values.some((value) => {
    if (Array.isArray(value)) {
      return value.some((entry) => entry.toLowerCase().includes(query));
    }

    return value?.toLowerCase().includes(query);
  });
}

function formatBrowseMatchup(matchup: MatchupBrowseResult) {
  const orderedTeams = [...matchup.teams].sort(
    (left, right) => roleSortOrder(left.role) - roleSortOrder(right.role),
  );

  if (orderedTeams.length >= 2) {
    return `${orderedTeams[1]?.displayName ?? 'Away'} @ ${orderedTeams[0]?.displayName ?? 'Home'}`;
  }

  return matchup.eventName;
}

function buildMatchupContext(matchup: MatchupBrowseResult) {
  const parsed = Date.parse(matchup.eventDate);
  const timeLabel = Number.isNaN(parsed)
    ? matchup.status
    : new Date(parsed).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

  return matchup.leagueId ? `${matchup.leagueId.toUpperCase()} · ${timeLabel}` : timeLabel;
}

function pushBrowseSearchResult(
  results: BrowseSearchResult[],
  seen: Set<string>,
  result: BrowseSearchResult,
) {
  const dedupeKey = [
    result.resultType,
    result.participantId ?? 'matchup',
    result.matchup.eventId,
  ].join(':');

  if (seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  results.push(result);
}

function roleSortOrder(role: string) {
  return role === 'home' ? 0 : role === 'away' ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Pick Review repositories
// ---------------------------------------------------------------------------

export class InMemoryPickReviewRepository implements PickReviewRepository {
  private reviews: PickReviewRecord[] = [];

  async createReview(input: PickReviewCreateInput): Promise<PickReviewRecord> {
    const record: PickReviewRecord = {
      id: crypto.randomUUID(),
      pick_id: input.pickId,
      decision: input.decision,
      reason: input.reason,
      decided_by: input.decidedBy,
      decided_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    this.reviews.push(record);
    return record;
  }

  async listByPick(pickId: string): Promise<PickReviewRecord[]> {
    return this.reviews
      .filter((r) => r.pick_id === pickId)
      .sort((a, b) => b.decided_at.localeCompare(a.decided_at));
  }

  async listByDecision(decision: PickReviewRecord['decision'], limit = 50): Promise<PickReviewRecord[]> {
    return this.reviews
      .filter((r) => r.decision === decision)
      .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
      .slice(0, limit);
  }

  async listRecent(limit = 50): Promise<PickReviewRecord[]> {
    return this.reviews
      .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
      .slice(0, limit);
  }
}

export class DatabasePickReviewRepository implements PickReviewRepository {
  private client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async createReview(input: PickReviewCreateInput): Promise<PickReviewRecord> {
    const { data, error } = await this.client
      .from('pick_reviews')
      .insert({
        pick_id: input.pickId,
        decision: input.decision,
        reason: input.reason,
        decided_by: input.decidedBy,
      })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to create pick review: ${error.message}`);
    return data as unknown as PickReviewRecord;
  }

  async listByPick(pickId: string): Promise<PickReviewRecord[]> {
    const { data, error } = await this.client
      .from('pick_reviews')
      .select('*')
      .eq('pick_id', pickId)
      .order('decided_at', { ascending: false });

    if (error) throw new Error(`Failed to list reviews for pick: ${error.message}`);
    return (data ?? []) as unknown as PickReviewRecord[];
  }

  async listByDecision(decision: PickReviewRecord['decision'], limit = 50): Promise<PickReviewRecord[]> {
    const { data, error } = await this.client
      .from('pick_reviews')
      .select('*')
      .eq('decision', decision)
      .order('decided_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list reviews by decision: ${error.message}`);
    return (data ?? []) as unknown as PickReviewRecord[];
  }

  async listRecent(limit = 50): Promise<PickReviewRecord[]> {
    const { data, error } = await this.client
      .from('pick_reviews')
      .select('*')
      .order('decided_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list recent reviews: ${error.message}`);
    return (data ?? []) as unknown as PickReviewRecord[];
  }
}

export class DatabaseModelRegistryRepository implements ModelRegistryRepository {
  constructor(private readonly client: UnitTalkSupabaseClient) {}

  async create(input: ModelRegistryCreateInput): Promise<ModelRegistryRecord> {
    const now = new Date().toISOString();
    const status = input.status ?? 'staged';
    if (status === 'champion') {
      await this.archiveChampionForSlot(input.sport, input.marketFamily, null, now);
    }

    const { data, error } = await this.client
      .from('model_registry')
      .insert({
        model_name: input.modelName,
        version: input.version,
        sport: input.sport,
        market_family: input.marketFamily,
        status,
        champion_since: status === 'champion' ? now : null,
        metadata: toJsonObject(input.metadata ?? {}),
        updated_at: now,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create model registry record: ${error?.message ?? 'unknown error'}`);
    }

    return data as ModelRegistryRecord;
  }

  async findById(id: string): Promise<ModelRegistryRecord | null> {
    const { data, error } = await this.client
      .from('model_registry')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find model registry record: ${error.message}`);
    }

    return (data as ModelRegistryRecord | null) ?? null;
  }

  async findChampion(sport: string, marketFamily: string): Promise<ModelRegistryRecord | null> {
    const { data, error } = await this.client
      .from('model_registry')
      .select('*')
      .eq('sport', sport)
      .eq('market_family', marketFamily)
      .eq('status', 'champion')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find champion model: ${error.message}`);
    }

    return (data as ModelRegistryRecord | null) ?? null;
  }

  async listBySport(sport: string): Promise<ModelRegistryRecord[]> {
    const { data, error } = await this.client
      .from('model_registry')
      .select('*')
      .eq('sport', sport)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list model registry records by sport: ${error.message}`);
    }

    return (data ?? []) as ModelRegistryRecord[];
  }

  async updateStatus(
    id: string,
    status: ModelRegistryRecord['status'],
    championSince?: string,
  ): Promise<ModelRegistryRecord> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Model registry record not found: ${id}`);
    }

    const now = new Date().toISOString();
    if (status === 'champion') {
      await this.archiveChampionForSlot(existing.sport, existing.market_family, id, now);
    }

    const { data, error } = await this.client
      .from('model_registry')
      .update({
        status,
        champion_since: status === 'champion' ? (championSince ?? now) : null,
        updated_at: now,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update model registry status: ${error?.message ?? 'unknown error'}`);
    }

    return data as ModelRegistryRecord;
  }

  private async archiveChampionForSlot(
    sport: string,
    marketFamily: string,
    excludeId: string | null,
    now: string,
  ) {
    let query = this.client
      .from('model_registry')
      .update({
        status: 'archived',
        champion_since: null,
        updated_at: now,
      })
      .eq('sport', sport)
      .eq('market_family', marketFamily)
      .eq('status', 'champion');

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { error } = await query;
    if (error) {
      throw new Error(`Failed to archive existing champion: ${error.message}`);
    }
  }
}

export class DatabaseExperimentLedgerRepository implements ExperimentLedgerRepository {
  constructor(private readonly client: UnitTalkSupabaseClient) {}

  async create(input: ExperimentLedgerCreateInput): Promise<ExperimentLedgerRecord> {
    const { data, error } = await this.client
      .from('experiment_ledger')
      .insert({
        model_id: input.modelId,
        run_type: input.runType,
        sport: input.sport,
        market_family: input.marketFamily,
        status: 'running',
        metrics: toJsonObject({}),
        notes: input.notes ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create experiment ledger record: ${error?.message ?? 'unknown error'}`);
    }

    return data as ExperimentLedgerRecord;
  }

  async findById(id: string): Promise<ExperimentLedgerRecord | null> {
    const { data, error } = await this.client
      .from('experiment_ledger')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find experiment ledger record: ${error.message}`);
    }

    return (data as ExperimentLedgerRecord | null) ?? null;
  }

  async listByModelId(modelId: string): Promise<ExperimentLedgerRecord[]> {
    const { data, error } = await this.client
      .from('experiment_ledger')
      .select('*')
      .eq('model_id', modelId)
      .order('started_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list experiment ledger records by model: ${error.message}`);
    }

    return (data ?? []) as ExperimentLedgerRecord[];
  }

  async complete(
    id: string,
    metrics: Record<string, unknown>,
  ): Promise<ExperimentLedgerRecord> {
    const { data, error } = await this.client
      .from('experiment_ledger')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        metrics: toJsonObject(metrics),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to complete experiment ledger record: ${error?.message ?? 'unknown error'}`);
    }

    return data as ExperimentLedgerRecord;
  }

  async fail(id: string, notes?: string): Promise<ExperimentLedgerRecord> {
    const updates: {
      status: 'failed';
      finished_at: string;
      notes?: string;
    } = {
      status: 'failed',
      finished_at: new Date().toISOString(),
    };

    if (notes !== undefined) {
      updates.notes = notes;
    }

    const { data, error } = await this.client
      .from('experiment_ledger')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to fail experiment ledger record: ${error?.message ?? 'unknown error'}`);
    }

    return data as ExperimentLedgerRecord;
  }
}

export class DatabaseModelHealthSnapshotRepository implements ModelHealthSnapshotRepository {
  constructor(private readonly client: UnitTalkSupabaseClient) {}

  async create(
    input: ModelHealthSnapshotCreateInput,
  ): Promise<ModelHealthSnapshotRecord> {
    const { data, error } = await this.client
      .from('model_health_snapshots')
      .insert({
        model_id: input.modelId,
        sport: input.sport,
        market_family: input.marketFamily,
        win_rate: input.winRate ?? null,
        roi: input.roi ?? null,
        sample_size: input.sampleSize ?? 0,
        drift_score: input.driftScore ?? null,
        calibration_score: input.calibrationScore ?? null,
        alert_level: input.alertLevel ?? 'none',
        metadata: toJsonObject(input.metadata ?? {}),
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create model health snapshot: ${error?.message ?? 'unknown error'}`);
    }

    return data as ModelHealthSnapshotRecord;
  }

  async findLatestByModel(modelId: string): Promise<ModelHealthSnapshotRecord | null> {
    const { data, error } = await this.client
      .from('model_health_snapshots')
      .select('*')
      .eq('model_id', modelId)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find latest model health snapshot: ${error.message}`);
    }

    return (data as ModelHealthSnapshotRecord | null) ?? null;
  }

  async listByModel(modelId: string, limit?: number): Promise<ModelHealthSnapshotRecord[]> {
    let query = this.client
      .from('model_health_snapshots')
      .select('*')
      .eq('model_id', modelId)
      .order('snapshot_at', { ascending: false });

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list model health snapshots: ${error.message}`);
    }

    return (data ?? []) as ModelHealthSnapshotRecord[];
  }

  async listAlerted(level?: 'warning' | 'critical'): Promise<ModelHealthSnapshotRecord[]> {
    let query = this.client
      .from('model_health_snapshots')
      .select('*')
      .order('snapshot_at', { ascending: false });

    query = level ? query.eq('alert_level', level) : query.neq('alert_level', 'none');

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list alerted model health snapshots: ${error.message}`);
    }

    return (data ?? []) as ModelHealthSnapshotRecord[];
  }
}

export class DatabaseExecutionQualityRepository implements ExecutionQualityRepository {
  constructor(private readonly client: UnitTalkSupabaseClient) {}

  async summarizeByProvider(sport?: string): Promise<ExecutionQualityReport[]> {
    let query = this.client
      .from('provider_offers')
      .select('provider_key, sport_key, provider_market_key, line, is_opening, is_closing');

    if (sport !== undefined) {
      query = query.eq('sport_key', sport);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to summarize execution quality by provider: ${error.message}`);
    }

    return buildExecutionQualityReports(data ?? []);
  }

  async summarizeByMarketFamily(providerKey: string): Promise<ExecutionQualityReport[]> {
    const { data, error } = await this.client
      .from('provider_offers')
      .select('provider_key, sport_key, provider_market_key, line, is_opening, is_closing')
      .eq('provider_key', providerKey);

    if (error) {
      throw new Error(`Failed to summarize execution quality by market family: ${error.message}`);
    }

    return buildExecutionQualityReports(data ?? []);
  }
}

export function createModelRegistryRepositories(
  client?: SupabaseClient,
): { modelRegistry: ModelRegistryRepository; experimentLedger: ExperimentLedgerRepository } {
  if (!client) {
    return {
      modelRegistry: new InMemoryModelRegistryRepository(),
      experimentLedger: new InMemoryExperimentLedgerRepository(),
    };
  }

  const typedClient = client as UnitTalkSupabaseClient;
  return {
    modelRegistry: new DatabaseModelRegistryRepository(typedClient),
    experimentLedger: new DatabaseExperimentLedgerRepository(typedClient),
  };
}

export function createModelOpsRepositories(
  client?: SupabaseClient,
): {
  modelRegistry: ModelRegistryRepository;
  experimentLedger: ExperimentLedgerRepository;
  modelHealthSnapshots: ModelHealthSnapshotRepository;
  executionQuality: ExecutionQualityRepository;
} {
  if (!client) {
    return {
      modelRegistry: new InMemoryModelRegistryRepository(),
      experimentLedger: new InMemoryExperimentLedgerRepository(),
      modelHealthSnapshots: new InMemoryModelHealthSnapshotRepository(),
      executionQuality: new InMemoryExecutionQualityRepository(),
    };
  }

  const typedClient = client as UnitTalkSupabaseClient;
  return {
    modelRegistry: new DatabaseModelRegistryRepository(typedClient),
    experimentLedger: new DatabaseExperimentLedgerRepository(typedClient),
    modelHealthSnapshots: new DatabaseModelHealthSnapshotRepository(typedClient),
    executionQuality: new DatabaseExecutionQualityRepository(typedClient),
  };
}

// ---------------------------------------------------------------------------
// market_universe repository implementations (Phase 2 UTV2-461)
// ---------------------------------------------------------------------------

/**
 * InMemoryMarketUniverseRepository — in-process store for unit tests.
 *
 * Keyed by the natural key string:
 *   "providerKey:providerEventId:COALESCE(participantId,''):marketKey"
 *
 * Opening/closing immutability: once set (non-null) on an existing row,
 * those fields are never overwritten.
 */
export class InMemoryMarketUniverseRepository implements IMarketUniverseRepository {
  private readonly rows = new Map<string, MarketUniverseRow>();

  private naturalKey(row: MarketUniverseUpsertInput): string {
    return [
      row.provider_key,
      row.provider_event_id,
      row.provider_participant_id ?? '',
      row.provider_market_key,
    ].join(':');
  }

  async upsertMarketUniverse(rows: MarketUniverseUpsertInput[]): Promise<void> {
    const now = new Date().toISOString();
    for (const row of rows) {
      const key = this.naturalKey(row);
      const existing = this.rows.get(key);
      if (existing) {
        // Opening immutability: do not overwrite once set
        const opening_line = existing.opening_line !== null ? existing.opening_line : row.opening_line;
        const opening_over_odds = existing.opening_over_odds !== null ? existing.opening_over_odds : row.opening_over_odds;
        const opening_under_odds = existing.opening_under_odds !== null ? existing.opening_under_odds : row.opening_under_odds;
        // Closing immutability: do not overwrite once set
        const closing_line = existing.closing_line !== null ? existing.closing_line : row.closing_line;
        const closing_over_odds = existing.closing_over_odds !== null ? existing.closing_over_odds : row.closing_over_odds;
        const closing_under_odds = existing.closing_under_odds !== null ? existing.closing_under_odds : row.closing_under_odds;

        this.rows.set(key, {
          ...existing,
          ...row,
          id: existing.id,         // preserve generated id
          created_at: existing.created_at,  // preserve created_at
          updated_at: now,
          opening_line,
          opening_over_odds,
          opening_under_odds,
          closing_line,
          closing_over_odds,
          closing_under_odds,
        });
      } else {
        // INSERT: generate id and timestamps; all other fields come from input
        this.rows.set(key, {
          ...row,
          id: crypto.randomUUID(),
          refreshed_at: now,
          created_at: now,
          updated_at: now,
        });
      }
    }
  }

  async listForScan(limit: number): Promise<MarketUniverseRow[]> {
    return Array.from(this.rows.values()).slice(0, limit);
  }

  async findByIds(ids: string[]): Promise<MarketUniverseRow[]> {
    const idSet = new Set(ids);
    return Array.from(this.rows.values()).filter(r => idSet.has(r.id));
  }

  /** Test helper: return all rows. */
  listAll(): MarketUniverseRow[] {
    return Array.from(this.rows.values());
  }

  /** Test helper: look up by natural key. */
  findByNaturalKey(
    providerKey: string,
    providerEventId: string,
    providerParticipantId: string | null,
    providerMarketKey: string,
  ): MarketUniverseRow | undefined {
    return this.rows.get(
      [providerKey, providerEventId, providerParticipantId ?? '', providerMarketKey].join(':'),
    );
  }
}

/**
 * DatabaseMarketUniverseRepository — Supabase implementation.
 *
 * Uses .upsert() with onConflict targeting the natural key columns.
 * ignoreDuplicates: false ensures UPDATE is applied on conflict.
 *
 * Opening/closing immutability is enforced via a Supabase RPC or manual
 * fetch-then-merge strategy: we fetch existing rows for the batch first,
 * then apply the immutability rule before calling upsert.
 */
export class DatabaseMarketUniverseRepository implements IMarketUniverseRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async upsertMarketUniverse(rows: MarketUniverseUpsertInput[]): Promise<void> {
    if (rows.length === 0) return;

    // Fetch existing rows for the batch to enforce opening/closing immutability.
    // We match on (provider_key, provider_event_id, provider_market_key) and then
    // do provider_participant_id matching in JS (COALESCE semantics).
    const providerEventIds = [...new Set(rows.map((r) => r.provider_event_id))];
    const { data: existingRows, error: fetchError } = await this.client
      .from('market_universe')
      .select('provider_key,provider_event_id,provider_participant_id,provider_market_key,opening_line,opening_over_odds,opening_under_odds,closing_line,closing_over_odds,closing_under_odds')
      .in('provider_event_id', providerEventIds);

    if (fetchError) {
      throw new Error(`market_universe fetch for immutability check failed: ${fetchError.message}`);
    }

    // Build a lookup keyed by natural key string
    const existingMap = new Map<string, {
      opening_line: number | null;
      opening_over_odds: number | null;
      opening_under_odds: number | null;
      closing_line: number | null;
      closing_over_odds: number | null;
      closing_under_odds: number | null;
    }>();

    for (const existing of (existingRows ?? [])) {
      const k = [
        existing.provider_key,
        existing.provider_event_id,
        existing.provider_participant_id ?? '',
        existing.provider_market_key,
      ].join(':');
      existingMap.set(k, {
        opening_line: existing.opening_line as number | null,
        opening_over_odds: existing.opening_over_odds as number | null,
        opening_under_odds: existing.opening_under_odds as number | null,
        closing_line: existing.closing_line as number | null,
        closing_over_odds: existing.closing_over_odds as number | null,
        closing_under_odds: existing.closing_under_odds as number | null,
      });
    }

    const now = new Date().toISOString();
    const upsertRows = rows.map((row) => {
      const k = [
        row.provider_key,
        row.provider_event_id,
        row.provider_participant_id ?? '',
        row.provider_market_key,
      ].join(':');
      const ex = existingMap.get(k);

      // Apply opening immutability: keep existing non-null values
      const opening_line = (ex && ex.opening_line !== null) ? ex.opening_line : row.opening_line;
      const opening_over_odds = (ex && ex.opening_over_odds !== null) ? ex.opening_over_odds : row.opening_over_odds;
      const opening_under_odds = (ex && ex.opening_under_odds !== null) ? ex.opening_under_odds : row.opening_under_odds;
      // Apply closing immutability: keep existing non-null values
      const closing_line = (ex && ex.closing_line !== null) ? ex.closing_line : row.closing_line;
      const closing_over_odds = (ex && ex.closing_over_odds !== null) ? ex.closing_over_odds : row.closing_over_odds;
      const closing_under_odds = (ex && ex.closing_under_odds !== null) ? ex.closing_under_odds : row.closing_under_odds;

      return {
        sport_key: row.sport_key,
        league_key: row.league_key,
        event_id: row.event_id,
        participant_id: row.participant_id,
        market_type_id: row.market_type_id,
        canonical_market_key: row.canonical_market_key,
        provider_key: row.provider_key,
        provider_event_id: row.provider_event_id,
        provider_participant_id: row.provider_participant_id,
        provider_market_key: row.provider_market_key,
        current_line: row.current_line,
        current_over_odds: row.current_over_odds,
        current_under_odds: row.current_under_odds,
        opening_line,
        opening_over_odds,
        opening_under_odds,
        closing_line,
        closing_over_odds,
        closing_under_odds,
        fair_over_prob: row.fair_over_prob,
        fair_under_prob: row.fair_under_prob,
        is_stale: row.is_stale,
        last_offer_snapshot_at: row.last_offer_snapshot_at,
        refreshed_at: now,
        updated_at: now,
      };
    });

    // ON CONFLICT matches the market_universe_natural_key UNIQUE NULLS NOT DISTINCT constraint
    // (provider_key, provider_event_id, provider_participant_id, provider_market_key)
    // NULLS NOT DISTINCT treats NULL=NULL, semantically equivalent to COALESCE(provider_participant_id,'')
    const { error } = await this.client
      .from('market_universe')
      .upsert(upsertRows, {
        onConflict: 'provider_key,provider_event_id,provider_participant_id,provider_market_key',
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(`market_universe upsert failed: ${error.message}`);
    }
  }

  async listForScan(limit: number): Promise<MarketUniverseRow[]> {
    const { data, error } = await this.client
      .from('market_universe')
      .select('*')
      .order('refreshed_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`market_universe listForScan failed: ${error.message}`);
    }

    return (data ?? []) as unknown as MarketUniverseRow[];
  }

  async findByIds(ids: string[]): Promise<MarketUniverseRow[]> {
    if (ids.length === 0) return [];
    // Chunk to avoid URL length limits on large IN clauses (Supabase REST uses query params)
    const CHUNK_SIZE = 100;
    const results: MarketUniverseRow[] = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const { data, error } = await fromUntyped(this.client, 'market_universe')
        .select('*')
        .in('id', chunk);
      if (error) throw new Error(`Failed to find market universe by ids: ${error.message}`);
      results.push(...((data ?? []) as MarketUniverseRow[]));
    }
    return results;
  }
}

// =============================================================================
// PickCandidateRepository — Phase 2 UTV2-463
// Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md §5
//
// Hard Phase 2 invariants enforced here:
//   - pick_id is NEVER set — it stays NULL
//   - shadow_mode is NEVER set to false — it stays DB DEFAULT true
//   - model_score / model_tier / model_confidence are NEVER set
// =============================================================================

/**
 * InMemoryPickCandidateRepository — in-process store for unit tests.
 *
 * Keyed by universe_id (unique index — one active candidate per market row).
 * Upsert: INSERT or UPDATE on conflict with universe_id.
 */
export class InMemoryPickCandidateRepository implements IPickCandidateRepository {
  private readonly rows = new Map<string, PickCandidateRow>();

  async upsertCandidates(inputs: PickCandidateUpsertInput[]): Promise<void> {
    const now = new Date().toISOString();
    for (const input of inputs) {
      const existing = this.rows.get(input.universe_id);
      if (existing) {
        // UPDATE on conflict — preserve created_at, update the rest
        this.rows.set(input.universe_id, {
          ...existing,
          status: input.status,
          rejection_reason: input.rejection_reason,
          filter_details: input.filter_details,
          scan_run_id: input.scan_run_id,
          provenance: input.provenance,
          expires_at: input.expires_at,
          updated_at: now,
          // Phase 2 invariants: never set these
          // pick_id: remains null
          // shadow_mode: remains true (DB default)
          // model_score / model_tier / model_confidence: remain null
        });
      } else {
        // INSERT
        this.rows.set(input.universe_id, {
          id: crypto.randomUUID(),
          universe_id: input.universe_id,
          status: input.status,
          rejection_reason: input.rejection_reason,
          filter_details: input.filter_details,
          model_score: null,           // Phase 3 placeholder — never set in Phase 2
          model_tier: null,            // Phase 3 placeholder — never set in Phase 2
          model_confidence: null,      // Phase 3 placeholder — never set in Phase 2
          selection_rank: null,        // Phase 4 placeholder — set by ranked selection service
          is_board_candidate: false,   // Phase 4 placeholder — set by ranked selection service
          shadow_mode: true,           // must remain true in Phase 2
          pick_id: null,               // must remain null in Phase 2
          scan_run_id: input.scan_run_id,
          provenance: input.provenance,
          expires_at: input.expires_at,
          created_at: now,
          updated_at: now,
        });
      }
    }
  }

  async findByStatus(status: string): Promise<PickCandidateRow[]> {
    return Array.from(this.rows.values()).filter((r) => r.status === status);
  }

  async updateModelScoreBatch(updates: ModelScoreUpdate[]): Promise<void> {
    // InMemory rows are keyed by universe_id, so find by scanning values for matching id
    for (const u of updates) {
      for (const [key, existing] of this.rows.entries()) {
        if (existing.id === u.id) {
          this.rows.set(key, {
            ...existing,
            model_score: u.model_score,
            model_tier: u.model_tier,
            model_confidence: u.model_confidence,
          });
          break;
        }
      }
    }
  }

  async updateSelectionRankBatch(updates: SelectionRankUpdate[]): Promise<void> {
    for (const u of updates) {
      // InMemory stores candidates keyed by universe_id — find by id field
      for (const [key, row] of this.rows.entries()) {
        if (row.id === u.id) {
          this.rows.set(key, { ...row, selection_rank: u.selection_rank, is_board_candidate: u.is_board_candidate });
          break;
        }
      }
    }
  }

  async resetSelectionRanks(): Promise<void> {
    for (const [key, row] of this.rows.entries()) {
      this.rows.set(key, { ...row, selection_rank: null, is_board_candidate: false });
    }
  }

  async findByIds(ids: string[]): Promise<PickCandidateRow[]> {
    const idSet = new Set(ids);
    return Array.from(this.rows.values()).filter((r) => idSet.has(r.id));
  }

  async updatePickIdBatch(updates: PickIdUpdate[]): Promise<void> {
    const now = new Date().toISOString();
    for (const u of updates) {
      for (const [key, row] of this.rows.entries()) {
        if (row.id === u.id) {
          this.rows.set(key, { ...row, pick_id: u.pick_id, shadow_mode: false, updated_at: now });
          break;
        }
      }
    }
  }

  /** Test helper: return all rows. */
  listAll(): PickCandidateRow[] {
    return Array.from(this.rows.values());
  }
}

/**
 * DatabasePickCandidateRepository — Supabase implementation.
 *
 * Uses .upsert() with onConflict: 'universe_id' (unique index on pick_candidates).
 * ignoreDuplicates: false ensures UPDATE is applied on conflict.
 *
 * Phase 2 invariants: pick_id, model_score, model_tier, model_confidence are
 * NEVER passed in the upsert payload. shadow_mode is NEVER set to false.
 * These fields default to their DB values (NULL / true) and must not be mutated.
 */
export class DatabasePickCandidateRepository implements IPickCandidateRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async upsertCandidates(inputs: PickCandidateUpsertInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const now = new Date().toISOString();
    const rows = inputs.map((input) => ({
      universe_id: input.universe_id,
      status: input.status,
      rejection_reason: input.rejection_reason,
      filter_details: input.filter_details as unknown as Record<string, unknown>,
      scan_run_id: input.scan_run_id,
      provenance: input.provenance,
      expires_at: input.expires_at,
      updated_at: now,
      // Phase 2 invariants — these are deliberately omitted from the upsert payload:
      // pick_id          → remains NULL (DB default; Phase 4+ only)
      // shadow_mode      → remains true  (DB default; must not be set false in Phase 2)
      // model_score      → remains NULL  (Phase 3 placeholder)
      // model_tier       → remains NULL  (Phase 3 placeholder)
      // model_confidence → remains NULL  (Phase 3 placeholder)
    }));

    const { error } = await this.client
      .from('pick_candidates')
      .upsert(rows, {
        onConflict: 'universe_id',
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(`pick_candidates upsert failed: ${error.message}`);
    }
  }

  async findByStatus(status: string): Promise<PickCandidateRow[]> {
    const { data, error } = await this.client
      .from('pick_candidates')
      .select('*')
      .eq('status', status);

    if (error) {
      throw new Error(`pick_candidates findByStatus failed: ${error.message}`);
    }

    return (data ?? []) as unknown as PickCandidateRow[];
  }

  async updateModelScoreBatch(updates: ModelScoreUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    for (const u of updates) {
      const { error } = await fromUntyped(this.client, 'pick_candidates')
        .update({
          model_score: u.model_score,
          model_tier: u.model_tier,
          model_confidence: u.model_confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', u.id);
      if (error) throw new Error(`Failed to update model score for ${u.id}: ${error.message}`);
    }
  }

  async updateSelectionRankBatch(updates: SelectionRankUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    for (const u of updates) {
      const { error } = await fromUntyped(this.client, 'pick_candidates')
        .update({
          selection_rank: u.selection_rank,
          is_board_candidate: u.is_board_candidate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', u.id);
      if (error) throw new Error(`Failed to update selection rank for ${u.id}: ${error.message}`);
    }
  }

  async resetSelectionRanks(): Promise<void> {
    const { error } = await fromUntyped(this.client, 'pick_candidates')
      .update({
        selection_rank: null,
        is_board_candidate: false,
        updated_at: new Date().toISOString(),
      })
      .not('id', 'is', null); // matches all rows
    if (error) throw new Error(`Failed to reset selection ranks: ${error.message}`);
  }

  async findByIds(ids: string[]): Promise<PickCandidateRow[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client
      .from('pick_candidates')
      .select('*')
      .in('id', ids);
    if (error) throw new Error(`pick_candidates findByIds failed: ${error.message}`);
    return (data ?? []) as unknown as PickCandidateRow[];
  }

  async updatePickIdBatch(updates: PickIdUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const now = new Date().toISOString();
    for (const u of updates) {
      const { error } = await fromUntyped(this.client, 'pick_candidates')
        .update({ pick_id: u.pick_id, shadow_mode: false, updated_at: now })
        .eq('id', u.id);
      if (error) throw new Error(`Failed to link pick_id for candidate ${u.id}: ${error.message}`);
    }
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
    hedgeOpportunities: new InMemoryHedgeOpportunityRepository(),
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
    tiers: new InMemoryMemberTierRepository(),
    reviews: new InMemoryPickReviewRepository(),
    marketUniverse: new InMemoryMarketUniverseRepository(),
    pickCandidates: new InMemoryPickCandidateRepository(),
    syndicateBoard: new InMemorySyndicateBoardRepository(),
    marketFamilyTrust: new InMemoryMarketFamilyTrustRepository(),
    modelRegistry: new InMemoryModelRegistryRepository(),
    experimentLedger: new InMemoryExperimentLedgerRepository(),
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
    hedgeOpportunities: new DatabaseHedgeOpportunityRepository(connection),
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
    tiers: new DatabaseMemberTierRepository(connection),
    reviews: new DatabasePickReviewRepository(connection),
    marketUniverse: new DatabaseMarketUniverseRepository(connection),
    pickCandidates: new DatabasePickCandidateRepository(connection),
    syndicateBoard: new DatabaseSyndicateBoardRepository(connection),
    marketFamilyTrust: new DatabaseMarketFamilyTrustRepository(connection),
    modelRegistry: new DatabaseModelRegistryRepository(createDatabaseClientFromConnection(connection)),
    experimentLedger: new DatabaseExperimentLedgerRepository(createDatabaseClientFromConnection(connection)),
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

function asJsonObjectRecord(value: Json): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

type CanonicalLeagueRow = {
  id: string;
  sport_id: string;
  display_name: string;
  sort_order?: number | null;
  active?: boolean | null;
};

type CanonicalTeamRow = {
  id: string;
  league_id: string;
  display_name: string;
  metadata: unknown;
};

type CanonicalPlayerRow = {
  id: string;
  display_name: string;
};

type PlayerTeamAssignmentRow = {
  player_id: string;
  team_id: string;
  league_id: string;
  effective_until: string | null;
};

type ProviderBookAliasRow = {
  provider: string;
  provider_book_key: string;
  sportsbook_id: string | null;
};

type MarketTypeRow = {
  id: string;
  display_name: string;
};

type UntypedQueryResult = {
  data: unknown | null;
  error: { message: string } | null;
};

type UntypedQueryBuilder = PromiseLike<UntypedQueryResult> & {
  select(columns?: string): UntypedQueryBuilder;
  insert(values: Record<string, unknown> | readonly Record<string, unknown>[]): UntypedQueryBuilder;
  update(values: Record<string, unknown>): UntypedQueryBuilder;
  eq(column: string, value: unknown): UntypedQueryBuilder;
  neq(column: string, value: unknown): UntypedQueryBuilder;
  in(column: string, values: readonly unknown[]): UntypedQueryBuilder;
  is(column: string, value: unknown): UntypedQueryBuilder;
  not(column: string, operator: string, value: unknown): UntypedQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): UntypedQueryBuilder;
  ilike(column: string, pattern: string): UntypedQueryBuilder;
  limit(count: number): UntypedQueryBuilder;
  single(): UntypedQueryBuilder;
  maybeSingle(): UntypedQueryBuilder;
};

type UntypedSupabaseClient = {
  from(table: string): UntypedQueryBuilder;
};

function fromUntyped(client: UnitTalkSupabaseClient, table: string) {
  return (client as unknown as UntypedSupabaseClient).from(table);
}

function isRecord(value: unknown): value is Record<string, Json | undefined> {
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

function compareModelHealthSnapshotsDescending(
  left: ModelHealthSnapshotRecord,
  right: ModelHealthSnapshotRecord,
) {
  const snapshotComparison = right.snapshot_at.localeCompare(left.snapshot_at);
  if (snapshotComparison !== 0) {
    return snapshotComparison;
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
    bookmaker_key: offer.bookmakerKey ?? null,
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
    bookmaker_key: offer.bookmakerKey ?? null,
  };
}

type ExecutionQualityOfferRow = Pick<
  ProviderOfferRecord,
  'provider_key' | 'sport_key' | 'provider_market_key' | 'line' | 'is_opening' | 'is_closing'
>;

function buildExecutionQualityReports(
  offers: ExecutionQualityOfferRow[],
): ExecutionQualityReport[] {
  const grouped = new Map<string, ExecutionQualityOfferRow[]>();

  for (const offer of offers) {
    const key = `${offer.provider_key}::${offer.sport_key ?? ''}::${offer.provider_market_key}`;
    const group = grouped.get(key);
    if (group) {
      group.push(offer);
    } else {
      grouped.set(key, [offer]);
    }
  }

  return Array.from(grouped.values())
    .map((group) => {
      const first = group[0]!;
      const avgEntryLine = averageNumbers(
        group
          .filter((offer) => offer.is_opening)
          .map((offer) => offer.line)
          .filter((line): line is number => line !== null),
      );
      const avgClosingLine = averageNumbers(
        group
          .filter((offer) => offer.is_closing)
          .map((offer) => offer.line)
          .filter((line): line is number => line !== null),
      );

      return {
        providerKey: first.provider_key,
        sportKey: first.sport_key,
        marketFamily: first.provider_market_key,
        sampleSize: group.length,
        avgEntryLine,
        avgClosingLine,
        avgLineDelta:
          avgEntryLine !== null && avgClosingLine !== null
            ? avgEntryLine - avgClosingLine
            : null,
        winRate: null,
        roi: null,
      };
    })
    .sort((left, right) =>
      left.providerKey.localeCompare(right.providerKey) ||
      (left.sportKey ?? '').localeCompare(right.sportKey ?? '') ||
      left.marketFamily.localeCompare(right.marketFamily),
    );
}

function averageNumbers(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// =============================================================================
// MemberTierRepository implementations
// =============================================================================

export class InMemoryMemberTierRepository implements MemberTierRepository {
  private readonly rows: MemberTierRecord[] = [];
  private nextId = 1;

  private makeId(): string {
    return `mem-tier-${this.nextId++}`;
  }

  async activateTier(input: MemberTierActivateInput): Promise<MemberTierRecord> {
    // Idempotent: if an active row already exists for (discordId, tier), return it.
    // A row is considered active if effective_until is null or in the future.
    const now = new Date().toISOString();
    const existing = this.rows.find(
      (r) =>
        r.discord_id === input.discordId &&
        r.tier === input.tier &&
        (r.effective_until === null || r.effective_until > now),
    );
    if (existing) {
      return existing;
    }

    const row: MemberTierRecord = {
      id: this.makeId(),
      discord_id: input.discordId,
      discord_username: input.discordUsername ?? null,
      tier: input.tier,
      effective_from: now,
      effective_until: input.effectiveUntil ? input.effectiveUntil.toISOString() : null,
      source: input.source,
      changed_by: input.changedBy,
      reason: input.reason ?? null,
      metadata: toJsonObject(input.metadata ?? {}),
      created_at: now,
    };

    this.rows.push(row);
    return row;
  }

  async deactivateTier(input: MemberTierDeactivateInput): Promise<void> {
    const now = new Date().toISOString();
    const row = this.rows.find(
      (r) =>
        r.discord_id === input.discordId &&
        r.tier === input.tier &&
        (r.effective_until === null || r.effective_until > now),
    );
    if (!row) {
      return; // no-op
    }
    row.effective_until = now;
    row.changed_by = input.changedBy;
    if (input.reason) {
      row.reason = input.reason;
    }
  }

  async getActiveTiers(discordId: string): Promise<MemberTierRecord[]> {
    const now = new Date().toISOString();
    return this.rows.filter(
      (r) =>
        r.discord_id === discordId &&
        (r.effective_until === null || r.effective_until > now),
    );
  }

  async getTierHistory(discordId: string): Promise<MemberTierRecord[]> {
    return this.rows
      .filter((r) => r.discord_id === discordId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async getActiveMembersForTier(tier: MemberTier): Promise<MemberTierRecord[]> {
    const now = new Date().toISOString();
    return this.rows.filter(
      (r) =>
        r.tier === tier &&
        (r.effective_until === null || r.effective_until > now),
    );
  }

  async getTierCounts(): Promise<Record<MemberTier, number>> {
    const now = new Date().toISOString();
    const counts = Object.fromEntries(memberTiers.map((t) => [t, 0])) as Record<MemberTier, number>;
    for (const row of this.rows) {
      if (row.effective_until === null || row.effective_until > now) {
        const t = row.tier as MemberTier;
        if (t in counts) {
          counts[t]++;
        }
      }
    }
    return counts;
  }

  async getExpiredTrials(now: string): Promise<MemberTierRecord[]> {
    return this.rows.filter(
      (r) =>
        r.tier === 'trial' &&
        r.effective_until !== null &&
        r.effective_until <= now,
    );
  }
}

export class DatabaseMemberTierRepository implements MemberTierRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async activateTier(input: MemberTierActivateInput): Promise<MemberTierRecord> {
    // Check if an active row already exists (idempotent)
    const { data: existing } = await this.client
      .from('member_tiers')
      .select('*')
      .eq('discord_id', input.discordId)
      .eq('tier', input.tier)
      .is('effective_until', null)
      .maybeSingle();

    if (existing) {
      return existing as MemberTierRecord;
    }

    const { data, error } = await this.client
      .from('member_tiers')
      .insert({
        discord_id: input.discordId,
        discord_username: input.discordUsername ?? null,
        tier: input.tier,
        source: input.source,
        changed_by: input.changedBy,
        reason: input.reason ?? null,
        metadata: toJsonObject(input.metadata ?? {}),
        ...(input.effectiveUntil != null
          ? { effective_until: input.effectiveUntil.toISOString() }
          : {}),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to activate member tier: ${error?.message ?? 'unknown error'}`);
    }

    return data as MemberTierRecord;
  }

  async deactivateTier(input: MemberTierDeactivateInput): Promise<void> {
    const { error } = await this.client
      .from('member_tiers')
      .update({
        effective_until: new Date().toISOString(),
        changed_by: input.changedBy,
        reason: input.reason ?? null,
      })
      .eq('discord_id', input.discordId)
      .eq('tier', input.tier)
      .is('effective_until', null);

    if (error) {
      throw new Error(`Failed to deactivate member tier: ${error.message}`);
    }
  }

  async getActiveTiers(discordId: string): Promise<MemberTierRecord[]> {
    const { data, error } = await this.client
      .from('member_tiers')
      .select('*')
      .eq('discord_id', discordId)
      .is('effective_until', null);

    if (error) {
      throw new Error(`Failed to get active tiers: ${error.message}`);
    }

    return (data ?? []) as MemberTierRecord[];
  }

  async getTierHistory(discordId: string): Promise<MemberTierRecord[]> {
    const { data, error } = await this.client
      .from('member_tiers')
      .select('*')
      .eq('discord_id', discordId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to get tier history: ${error.message}`);
    }

    return (data ?? []) as MemberTierRecord[];
  }

  async getActiveMembersForTier(tier: MemberTier): Promise<MemberTierRecord[]> {
    const { data, error } = await this.client
      .from('member_tiers')
      .select('*')
      .eq('tier', tier)
      .is('effective_until', null);

    if (error) {
      throw new Error(`Failed to get active members for tier: ${error.message}`);
    }

    return (data ?? []) as MemberTierRecord[];
  }

  async getTierCounts(): Promise<Record<MemberTier, number>> {
    const { data, error } = await this.client
      .from('member_tiers')
      .select('tier')
      .is('effective_until', null);

    if (error) {
      throw new Error(`Failed to get tier counts: ${error.message}`);
    }

    const counts = Object.fromEntries(memberTiers.map((t) => [t, 0])) as Record<MemberTier, number>;
    for (const row of data ?? []) {
      const t = row.tier as MemberTier;
      if (t in counts) {
        counts[t]++;
      }
    }

    return counts;
  }

  async getExpiredTrials(now: string): Promise<MemberTierRecord[]> {
    const { data, error } = await this.client
      .from('member_tiers')
      .select('*')
      .eq('tier', 'trial')
      .not('effective_until', 'is', null)
      .lte('effective_until', now);

    if (error) {
      throw new Error(`Failed to get expired trials: ${error.message}`);
    }

    return (data ?? []) as MemberTierRecord[];
  }
}
