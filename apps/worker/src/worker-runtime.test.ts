import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  PromotionBoardStateSnapshot,
  PromotionDecisionPersistenceInput,
  PromotionHistoryInsertInput,
  PromotionHistoryRecord,
  PromotionPersistenceResult,
  AuditLogRepository,
  AuditLogRow,
  OutboxRecord,
  OutboxRepository,
  PickLifecycleRecord,
  PickRecord,
  PickRepository,
  ReceiptRecord,
  ReceiptRepository,
  RepositoryBundle,
  SystemRunRecord,
  SystemRunRepository,
} from '@unit-talk/db';
import type { CanonicalPick, LifecycleEvent } from '@unit-talk/contracts';
import {
  createDeliveryAdapter,
  createDiscordDeliveryAdapter,
  createSimulationDeliveryAdapter,
  createStubDeliveryAdapter,
} from './delivery-adapters.js';
import {
  createWorkerRuntimeDependencies,
  readCircuitBreakerCooldownMs,
  readCircuitBreakerThreshold,
  readSimulationMode,
  readWorkerHeartbeatIntervalMs,
} from './runtime.js';
import { processNextDistributionWork } from './distribution-worker.js';
import { runWorkerCycles } from './runner.js';
import { DeliveryCircuitBreaker } from './circuit-breaker.js';

interface CapturedRequest {
  url: string;
  method: string | undefined;
  body: string | undefined;
}

interface DiscordRequestBody {
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    fields?: Array<{
      name?: string;
      value?: string;
      inline?: boolean;
    }>;
    footer?: {
      text?: string;
    };
  }>;
}

class FakeOutboxRepository implements OutboxRepository {
  constructor(private readonly entries: OutboxRecord[]) {}

  async enqueue(): Promise<OutboxRecord> {
    throw new Error('enqueue is not used in this test');
  }

  async enqueueDistributionAtomic(): Promise<null> {
    throw new Error('enqueueDistributionAtomic is not supported in test mode');
  }

  async claimNextAtomic(): Promise<OutboxRecord | null> {
    throw new Error('claimNextAtomic is not supported in test mode');
  }

  async confirmDeliveryAtomic(): Promise<never> {
    throw new Error('confirmDeliveryAtomic is not supported in test mode');
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
    const entry = this.entries.find(
      (candidate) =>
        candidate.target === target &&
        candidate.status === 'pending' &&
        candidate.claimed_at === null &&
        candidate.claimed_by === null,
    );

    if (!entry) {
      return null;
    }

    entry.status = 'processing';
    entry.claimed_at = new Date().toISOString();
    entry.claimed_by = workerId;
    return entry;
  }

  async touchClaim(outboxId: string, workerId: string): Promise<OutboxRecord | null> {
    const entry = this.entries.find((candidate) => candidate.id === outboxId);

    if (!entry || entry.status !== 'processing' || entry.claimed_by !== workerId) {
      return null;
    }

    entry.claimed_at = new Date().toISOString();
    return entry;
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
      reaped.push(entry);
    }

    return reaped;
  }

  async markSent(outboxId: string): Promise<OutboxRecord> {
    const entry = this.requireEntry(outboxId);
    entry.status = 'sent';
    return entry;
  }

  async markFailed(
    outboxId: string,
    errorMessage: string,
    nextAttemptAt?: string | undefined,
  ): Promise<OutboxRecord> {
    const entry = this.requireEntry(outboxId);
    entry.status = 'pending';
    entry.last_error = errorMessage;
    entry.next_attempt_at = nextAttemptAt ?? null;
    entry.attempt_count += 1;
    entry.claimed_at = null;
    entry.claimed_by = null;
    return entry;
  }

  async markDeadLetter(
    outboxId: string,
    errorMessage: string,
  ): Promise<OutboxRecord> {
    const entry = this.requireEntry(outboxId);
    entry.status = 'dead_letter';
    entry.last_error = errorMessage;
    entry.next_attempt_at = null;
    entry.claimed_at = null;
    entry.claimed_by = null;
    return entry;
  }

  async listByPickId(pickId: string): Promise<OutboxRecord[]> {
    return this.entries.filter((e) => e.pick_id === pickId);
  }

  async resetForRetry(outboxId: string): Promise<OutboxRecord> {
    const entry = this.requireEntry(outboxId);
    entry.status = 'pending';
    entry.attempt_count = 0;
    entry.last_error = null;
    entry.claimed_at = null;
    entry.claimed_by = null;
    return entry;
  }

  private requireEntry(outboxId: string) {
    const entry = this.entries.find((candidate) => candidate.id === outboxId);
    if (!entry) {
      throw new Error(`Outbox record not found: ${outboxId}`);
    }

    return entry;
  }
}

class FakeReceiptRepository implements ReceiptRepository {
  readonly records: ReceiptRecord[] = [];

  async record(input: {
    outboxId: string;
    receiptType: string;
    status: string;
    channel?: string | undefined;
    externalId?: string | undefined;
    idempotencyKey?: string | undefined;
    payload: Record<string, unknown>;
  }): Promise<ReceiptRecord> {
    const record: ReceiptRecord = {
      id: randomUUID(),
      outbox_id: input.outboxId,
      external_id: input.externalId ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      receipt_type: input.receiptType,
      status: input.status,
      channel: input.channel ?? null,
      payload: JSON.parse(JSON.stringify(input.payload)),
      recorded_at: new Date().toISOString(),
    };

    this.records.push(record);
    return record;
  }

  async findLatestByOutboxId(
    outboxId: string,
    receiptType?: string | undefined,
  ): Promise<ReceiptRecord | null> {
    return (
      [...this.records]
        .filter(
          (record) =>
            record.outbox_id === outboxId &&
            (receiptType === undefined || record.receipt_type === receiptType),
        )
        .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null
    );
  }
}

class FakePickRepository implements PickRepository {
  readonly picks = new Map<string, PickRecord>();
  readonly lifecycleEvents: PickLifecycleRecord[] = [];

  constructor(entries: OutboxRecord[]) {
    const now = new Date().toISOString();
    for (const entry of entries) {
      this.picks.set(entry.pick_id, {
        id: entry.pick_id,
        submission_id: randomUUID(),
        participant_id: null,
        player_id: null,
        capper_id: null,
        market_type_id: null,
        sport_id: null,
        market: 'Player points',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -110,
        stake_units: 1,
        confidence: 0.74,
        source: 'smart-form',
        approval_status: 'approved',
        promotion_status: isGovernedTarget(entry.target) ? 'qualified' : 'not_eligible',
        promotion_target: isGovernedTarget(entry.target)
          ? entry.target.replace('discord:', '')
          : null,
        promotion_score: isGovernedTarget(entry.target) ? 88 : null,
        promotion_reason:
          isGovernedTarget(entry.target) ? 'test qualification' : null,
        promotion_version: entry.target === 'discord:trader-insights'
          ? 'trader-insights-v2'
          : entry.target === 'discord:best-bets'
            ? 'best-bets-v2'
            : null,
        promotion_decided_at: isGovernedTarget(entry.target) ? now : null,
        promotion_decided_by: isGovernedTarget(entry.target) ? 'test' : null,
        status: 'queued',
        posted_at: null,
        settled_at: null,
        idempotency_key: null,
        metadata: {},
        created_at: now,
        updated_at: now,
      });
    }
  }

  async savePick(pick: CanonicalPick): Promise<PickRecord> {
    const now = new Date().toISOString();
    const record: PickRecord = {
      id: pick.id,
      submission_id: pick.submissionId,
      participant_id: null,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
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
      idempotency_key: null,
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    this.picks.set(record.id, record);
    return record;
  }

  async saveLifecycleEvent(event: LifecycleEvent): Promise<PickLifecycleRecord> {
    const record: PickLifecycleRecord = {
      id: randomUUID(),
      pick_id: event.pickId,
      from_state: event.fromState ?? null,
      to_state: event.toState,
      writer_role: event.writerRole,
      reason: event.reason,
      payload: {},
      created_at: event.createdAt,
    };

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

    const now = new Date().toISOString();
    const updated: PickRecord = {
      ...existing,
      status: lifecycleState,
      posted_at: lifecycleState === 'posted' ? now : existing.posted_at,
      settled_at: lifecycleState === 'settled' ? now : existing.settled_at,
      updated_at: now,
    };

    this.picks.set(pickId, updated);
    return updated;
  }

  async updateApprovalStatus(pickId: string, approvalStatus: string): Promise<PickRecord> {
    const existing = this.picks.get(pickId);
    if (!existing) throw new Error(`Pick not found: ${pickId}`);
    const updated: PickRecord = { ...existing, approval_status: approvalStatus, updated_at: new Date().toISOString() };
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
    _lifecycleState: CanonicalPick['lifecycleState'],
    _limit?: number | undefined,
  ): Promise<PickRecord[]> {
    return [];
  }

  async listByLifecycleStates(
    _lifecycleStates: CanonicalPick['lifecycleState'][],
    _limit?: number | undefined,
  ): Promise<PickRecord[]> {
    return [];
  }

  async listBySource(
    source: string,
    limit?: number | undefined,
  ): Promise<PickRecord[]> {
    const records = [...this.picks.values()].filter((pick) => pick.source === source);
    return limit !== undefined ? records.slice(0, limit) : records;
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
    };

    this.picks.set(input.pickId, updated);

    return {
      pick: updated,
      history: {
        id: randomUUID(),
        pick_id: input.pickId,
        target: input.target,
        status: input.promotionStatus,
        score: input.promotionScore ?? null,
        reason: input.promotionReason ?? null,
        version: input.promotionVersion,
        decided_at: input.promotionDecidedAt,
        decided_by: input.promotionDecidedBy,
        override_action: input.overrideAction ?? null,
        payload: JSON.parse(JSON.stringify(input.payload)),
        created_at: input.promotionDecidedAt,
      },
    };
  }

  async getPromotionBoardState(): Promise<PromotionBoardStateSnapshot> {
    return {
      currentBoardCount: 0,
      sameSportCount: 0,
      sameGameCount: 0,
      duplicateCount: 0,
    };
  }

  async claimPickTransition(): Promise<{ claimed: boolean }> {
    return { claimed: false };
  }

  async findPickByIdempotencyKey(_key: string): Promise<PickRecord | null> {
    return null;
  }

  async insertPromotionHistoryRow(
    input: PromotionHistoryInsertInput,
  ): Promise<PromotionHistoryRecord> {
    return {
      id: randomUUID(),
      pick_id: input.pickId,
      target: input.target,
      status: input.promotionStatus,
      score: input.promotionScore ?? null,
      reason: input.promotionReason ?? null,
      version: input.promotionVersion,
      decided_at: input.promotionDecidedAt,
      decided_by: input.promotionDecidedBy,
      override_action: input.overrideAction ?? null,
      payload: JSON.parse(JSON.stringify(input.payload)),
      created_at: input.promotionDecidedAt,
    };
  }

  async transitionPickLifecycleAtomic(_input: any): Promise<any> {
    throw new Error('transitionPickLifecycleAtomic is not supported in FakePickRepository');
  }
}

class FakeSystemRunRepository implements SystemRunRepository {
  readonly records: SystemRunRecord[] = [];

  async startRun(input: {
    runType: string;
    actor?: string | undefined;
    details: Record<string, unknown>;
    idempotencyKey?: string | undefined;
  }): Promise<SystemRunRecord> {
    const record: SystemRunRecord = {
      id: randomUUID(),
      run_type: input.runType,
      status: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      actor: input.actor ?? null,
      details: JSON.parse(JSON.stringify(input.details)),
      created_at: new Date().toISOString(),
      idempotency_key: input.idempotencyKey ?? null,
    };

    this.records.push(record);
    return record;
  }

  async completeRun(input: {
    runId: string;
    status: 'succeeded' | 'failed' | 'cancelled';
    details?: Record<string, unknown> | undefined;
  }): Promise<SystemRunRecord> {
    const record = this.records.find((candidate) => candidate.id === input.runId);
    if (!record) {
      throw new Error(`Run not found: ${input.runId}`);
    }

    record.status = input.status;
    record.finished_at = new Date().toISOString();
    record.details = JSON.parse(JSON.stringify(input.details ?? {}));
    return record;
  }

  async listByType(runType: string, limit?: number): Promise<SystemRunRecord[]> {
    const filtered = this.records.filter((r) => r.run_type === runType);
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }
}

class FakeAuditLogRepository implements AuditLogRepository {
  readonly records: AuditLogRow[] = [];

  async record(input: {
    entityType: string;
    entityId?: string | null | undefined;
    entityRef?: string | null | undefined;
    action: string;
    actor?: string | undefined;
    payload: Record<string, unknown>;
  }): Promise<AuditLogRow> {
    const record: AuditLogRow = {
      id: randomUUID(),
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_ref: input.entityRef ?? null,
      action: input.action,
      actor: input.actor ?? null,
      payload: JSON.parse(JSON.stringify(input.payload)),
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
    return this.records.filter(
      (record) =>
        record.entity_type === entityType &&
        record.created_at >= since &&
        (action === undefined || record.action === action),
    );
  }
}

function createWorkerTestRepositories(entries: OutboxRecord[]): {
  repositories: RepositoryBundle;
  picks: FakePickRepository;
  receipts: FakeReceiptRepository;
  runs: FakeSystemRunRepository;
  audit: FakeAuditLogRepository;
} {
  const outbox = new FakeOutboxRepository(entries);
  const picks = new FakePickRepository(entries);
  const receipts = new FakeReceiptRepository();
  const runs = new FakeSystemRunRepository();
  const audit = new FakeAuditLogRepository();

  return {
    repositories: {
      submissions: {} as RepositoryBundle['submissions'],
      picks,
      outbox,
      receipts,
      alertDetections: {} as RepositoryBundle['alertDetections'],
      hedgeOpportunities: {} as RepositoryBundle['hedgeOpportunities'],
      settlements: {} as RepositoryBundle['settlements'],
      providerOffers: {} as RepositoryBundle['providerOffers'],
      participants: {} as RepositoryBundle['participants'],
      events: {} as RepositoryBundle['events'],
      eventParticipants: {} as RepositoryBundle['eventParticipants'],
      gradeResults: {} as RepositoryBundle['gradeResults'],
      runs,
      audit,
      referenceData: {} as RepositoryBundle['referenceData'],
      tiers: {} as RepositoryBundle['tiers'],
      reviews: {} as RepositoryBundle['reviews'],
      marketUniverse: {} as RepositoryBundle['marketUniverse'],
      pickCandidates: {} as RepositoryBundle['pickCandidates'],
      syndicateBoard: {} as RepositoryBundle['syndicateBoard'],
    },
    picks,
    receipts,
    runs,
    audit,
  };
}

function createOutboxRecord(
  target: string,
  overrides: Partial<Pick<OutboxRecord, 'status' | 'attempt_count' | 'last_error' | 'next_attempt_at'>> = {},
): OutboxRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    pick_id: randomUUID(),
    target,
    status: overrides.status ?? 'pending',
    attempt_count: overrides.attempt_count ?? 0,
    next_attempt_at: overrides.next_attempt_at ?? null,
    last_error: overrides.last_error ?? null,
    payload: JSON.parse(
      JSON.stringify({
        market: 'Player points',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -110,
        source: 'smart-form',
        lifecycleState: 'queued',
        metadata: {
          sport: 'NBA',
          eventName: 'Lakers vs Celtics',
          capper: 'griff843',
        },
      }),
    ),
    claimed_at: null,
    claimed_by: null,
    idempotency_key: `${target}:idempotent`,
    created_at: now,
    updated_at: now,
  };
}

test('processNextDistributionWork returns idle when no work is available', async () => {
  const { repositories } = createWorkerTestRepositories([]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:idle',
    'worker-1',
    async () => {
      throw new Error('should not be called');
    },
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'idle');
});

test('processNextDistributionWork marks work sent, records receipt, and posts the pick', async () => {
  const { repositories, picks, receipts, runs, audit } = createWorkerTestRepositories([
    createOutboxRecord('discord:send'),
  ]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:send',
    'worker-2',
    async (outbox) => ({
      receiptType: 'discord.message',
      status: 'sent',
      channel: 'discord:#worker',
      externalId: `msg:${outbox.id}`,
      payload: {
        delivered: true,
      },
    }),
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'sent');
  if (result.status === 'sent') {
    assert.equal(result.outbox.status, 'sent');
    assert.equal(result.receipt.receipt_type, 'discord.message');
  }
  const pick = await picks.findPickById(result.status === 'sent' ? result.outbox.pick_id : '');
  assert.equal(pick?.status, 'posted');
  assert.equal(picks.lifecycleEvents.at(-1)?.to_state, 'posted');
  assert.equal(picks.lifecycleEvents.at(-1)?.from_state, 'queued');
  assert.equal(picks.lifecycleEvents.at(-1)?.writer_role, 'poster');
  assert.equal(receipts.records.length, 1);
  assert.equal(runs.records[0]?.status, 'succeeded');
  assert.ok(runs.records[0]?.finished_at != null, 'finished_at must be set on succeeded run');
  assert.ok(
    new Date(runs.records[0]!.finished_at!) >= new Date(runs.records[0]!.started_at),
    `finished_at must not be earlier than started_at (clock skew regression)`,
  );
  assert.equal(audit.records[0]?.action, 'distribution.sent');
});

test('processNextDistributionWork marks work failed and records audit', async () => {
  const { repositories, runs, audit } = createWorkerTestRepositories([
    createOutboxRecord('discord:fail'),
  ]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:fail',
    'worker-3',
    async () => {
      throw new Error('discord down');
    },
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.outbox.status, 'pending');
    assert.equal(result.outbox.attempt_count, 1);
    assert.equal(result.outbox.claimed_by, null);
    assert.equal(result.outbox.claimed_at, null);
    assert.ok(result.outbox.next_attempt_at, 'next_attempt_at must be set for retry backoff');
  }
  assert.equal(runs.records[0]?.status, 'failed');
  assert.ok(runs.records[0]?.finished_at != null, 'finished_at must be set on failed run');
  assert.ok(
    new Date(runs.records[0]!.finished_at!) >= new Date(runs.records[0]!.started_at),
    `finished_at must not be earlier than started_at (clock skew regression)`,
  );
  assert.equal(audit.records[0]?.action, 'distribution.retry_scheduled');
});

test('processNextDistributionWork immediately dead-letters terminal delivery failures', async () => {
  const outboxRecord = createOutboxRecord('discord:terminal', { attempt_count: 1 });
  const { repositories, picks, runs, audit } = createWorkerTestRepositories([outboxRecord]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:terminal',
    'worker-terminal',
    async () => ({
      receiptType: 'discord.message',
      status: 'terminal-failure',
      reason: 'HTTP 403: Missing Access',
      channel: 'discord:1234567890',
      payload: {
        adapter: 'discord',
      },
    }),
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.outbox.status, 'dead_letter');
    assert.equal(result.outbox.attempt_count, 1);
    assert.equal(result.outbox.last_error, 'HTTP 403: Missing Access');
  }
  const pick = await picks.findPickById(outboxRecord.pick_id);
  assert.equal(pick?.status, 'queued', 'pick must remain queued on terminal failure');
  assert.equal(runs.records[0]?.status, 'failed');
  assert.equal(
    (runs.records[0]?.details as Record<string, unknown> | undefined)?.terminalFailure,
    true,
  );
  assert.equal(audit.records[0]?.action, 'distribution.dead_lettered');
});

test('processNextDistributionWork retries normally on retryable delivery failures', async () => {
  const outboxRecord = createOutboxRecord('discord:retryable', { attempt_count: 1 });
  const { repositories, picks, runs, audit } = createWorkerTestRepositories([outboxRecord]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:retryable',
    'worker-retryable',
    async () => ({
      receiptType: 'discord.message',
      status: 'retryable-failure',
      reason: 'HTTP 429: rate limited',
      channel: 'discord:1234567890',
      payload: {
        adapter: 'discord',
      },
    }),
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.outbox.status, 'pending');
    assert.equal(result.outbox.attempt_count, 2);
    assert.equal(result.outbox.last_error, 'HTTP 429: rate limited');
    assert.equal(result.outbox.claimed_by, null);
    assert.equal(result.outbox.claimed_at, null);
    assert.ok(result.outbox.next_attempt_at, 'next_attempt_at must be set for retry backoff');
  }
  const pick = await picks.findPickById(outboxRecord.pick_id);
  assert.equal(pick?.status, 'queued', 'pick must remain queued on retryable failure');
  assert.equal(runs.records[0]?.status, 'failed');
  assert.equal(audit.records[0]?.action, 'distribution.retry_scheduled');
});

test('processNextDistributionWork promotes the outbox row to dead_letter after the third failure', async () => {
  const { repositories, audit } = createWorkerTestRepositories([
    createOutboxRecord('discord:dead-letter', { attempt_count: 2 }),
  ]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:dead-letter',
    'worker-4',
    async () => {
      throw new Error('delivery exploded');
    },
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.outbox.status, 'dead_letter');
    assert.equal(result.outbox.attempt_count, 3);
    assert.equal(result.outbox.last_error, 'delivery exploded');
  }
  assert.equal(audit.records[0]?.action, 'distribution.dead_lettered');
  assert.equal(
    (audit.records[0]?.payload as Record<string, unknown> | undefined)?.deadLettered,
    true,
  );
});

test('processNextDistributionWork resets row to pending with backoff before the dead_letter threshold', async () => {
  const { repositories, audit } = createWorkerTestRepositories([
    createOutboxRecord('discord:retry', { attempt_count: 1 }),
  ]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:retry',
    'worker-5',
    async () => {
      throw new Error('retryable failure');
    },
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.outbox.status, 'pending');
    assert.equal(result.outbox.attempt_count, 2);
    assert.equal(result.outbox.last_error, 'retryable failure');
    assert.equal(result.outbox.claimed_by, null);
    assert.equal(result.outbox.claimed_at, null);
    assert.ok(result.outbox.next_attempt_at, 'next_attempt_at must be set for retry backoff');
  }
  assert.equal(audit.records[0]?.action, 'distribution.retry_scheduled');
});

test('processNextDistributionWork marks dead_letter rows without delivering again once promotion occurs', async () => {
  const { repositories } = createWorkerTestRepositories([
    createOutboxRecord('discord:dead-letter-audit', { attempt_count: 2 }),
  ]);

  let deliverCalls = 0;
  const result = await processNextDistributionWork(
    repositories,
    'discord:dead-letter-audit',
    'worker-6',
    async () => {
      deliverCalls += 1;
      throw new Error('delivery exploded again');
    },
    { persistenceMode: 'in_memory' },
  );

  assert.equal(deliverCalls, 1);
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.outbox.status, 'dead_letter');
  }
});

test('runWorkerCycles processes configured targets across cycles', async () => {
  const { repositories, receipts, runs } = createWorkerTestRepositories([
    createOutboxRecord('discord:cycle-a'),
    createOutboxRecord('discord:cycle-b'),
  ]);

  const cycles = await runWorkerCycles({
    repositories,
    workerId: 'worker-cycles',
    targets: ['discord:cycle-a', 'discord:cycle-b'],
    deliver: createStubDeliveryAdapter(),
    maxCycles: 1,
    persistenceMode: 'in_memory',
  });

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0]?.results.length, 2);
  assert.ok(
    cycles[0]?.results.every((r) => r.status === 'sent'),
    'all results should be sent',
  );
  assert.equal(receipts.records.length, 2);
  // 2 distribution.process runs + 1 worker.heartbeat run per cycle
  assert.equal(runs.records.filter((r) => r.run_type !== 'worker.heartbeat').length, 2);
  assert.equal(runs.records.filter((r) => r.run_type === 'worker.heartbeat').length, 1);
});

test('createStubDeliveryAdapter returns deterministic dry-run receipt metadata', async () => {
  const outbox = createOutboxRecord('discord:dry-run');
  const adapter = createStubDeliveryAdapter();

  const receipt = await adapter(outbox);

  assert.equal(receipt.receiptType, 'worker.dry-run');
  assert.equal(receipt.status, 'sent');
  assert.equal(receipt.channel, `stub:${outbox.target}`);
  assert.equal(receipt.externalId, `dry:${outbox.id}`);
  assert.equal(receipt.idempotencyKey, undefined);
});

test('createDiscordDeliveryAdapter returns dry-run Discord-shaped receipt metadata', async () => {
  const outbox = createOutboxRecord('discord:vip');
  const adapter = createDiscordDeliveryAdapter();

  const receipt = await adapter(outbox);

  assert.equal(receipt.receiptType, 'discord.message');
  assert.equal(receipt.status, 'sent');
  assert.equal(receipt.channel, outbox.target);
  assert.equal(receipt.externalId, `discord-dry:${outbox.id}`);
  assert.equal(receipt.idempotencyKey, `${outbox.id}:${outbox.target}:dry-receipt`);
});

test('createDiscordDeliveryAdapter sends a live Discord embed when configured', async () => {
  const outbox = createOutboxRecord('discord:canary');
  let capturedRequest: CapturedRequest | null = null;

  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: {
      'discord:canary': '1234567890',
    },
    fetchImpl: async (url, init) => {
      capturedRequest = {
        url: String(url),
        method: init?.method,
        body: String(init?.body ?? ''),
      };

      return new Response(JSON.stringify({ id: 'discord-message-1' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    },
  });

  const receipt = await adapter(outbox);

  const request = requireCapturedRequest(capturedRequest);
  const body = parseDiscordRequestBody(request.body);
  const embed = body.embeds?.[0];
  assert.equal(
    request.url,
    'https://discord.com/api/v10/channels/1234567890/messages',
  );
  assert.equal(request.method, 'POST');
  assert.equal(
    body.content,
    'Canary delivery active. Validate formatting before expanding routing.',
  );
  assert.equal(embed?.title, 'Unit Talk V2 Canary');
  assert.equal(embed?.description, 'NBA | Lakers vs Celtics');
  assert.equal(embed?.footer?.text, 'Unit Talk');
  // Spec-compliant fields: no pick_id, no State, no Source
  const fieldNames = embed?.fields?.map((f: Record<string, unknown>) => f.name) ?? [];
  assert.ok(fieldNames.includes('Pick'), 'must have Pick field');
  assert.ok(fieldNames.includes('Odds'), 'must have Odds field');
  assert.ok(fieldNames.includes('Capper'), 'must have Capper field');
  assert.ok(!fieldNames.includes('Pick ID'), 'must NOT show Pick ID');
  assert.ok(!fieldNames.includes('State'), 'must NOT show State');
  assert.ok(!fieldNames.includes('Source'), 'must NOT show Source');
  assert.equal(receipt.receiptType, 'discord.message');
  assert.equal(receipt.channel, outbox.target);
  assert.equal(receipt.externalId, 'discord-message-1');
  assert.equal(
    receipt.idempotencyKey,
    `${outbox.id}:${outbox.target}:receipt`,
  );
});

test('createDiscordDeliveryAdapter rejects live mode without target mapping', async () => {
  const outbox = createOutboxRecord('discord:unmapped');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: {},
    fetchImpl: async () => {
      throw new Error('should not be called');
    },
  });

  await assert.rejects(
    () => adapter(outbox),
    /No Discord channel mapping found/,
  );
});

test('createDeliveryAdapter selects the requested adapter kind', async () => {
  const outbox = createOutboxRecord('discord:selected');

  const stubReceipt = await createDeliveryAdapter({
    kind: 'stub',
    dryRun: true,
  })(outbox);
  const discordReceipt = await createDeliveryAdapter({
    kind: 'discord',
    dryRun: true,
  })(outbox);

  assert.equal(stubReceipt.receiptType, 'worker.dry-run');
  assert.equal(discordReceipt.receiptType, 'discord.message');
});

test('createWorkerRuntimeDependencies reads worker config from loaded environment values', () => {
  const runtime = createWorkerRuntimeDependencies({
    environment: {
      NODE_ENV: 'test',
      UNIT_TALK_APP_ENV: 'ci',
      UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\dev\\unit-talk-v2',
      UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
      LINEAR_TEAM_KEY: 'UTV2',
      LINEAR_TEAM_NAME: 'unit-talk-v2',
      NOTION_WORKSPACE_NAME: 'unit-talk-v2',
      SLACK_WORKSPACE_NAME: 'unit-talk-v2',
      UNIT_TALK_WORKER_ID: 'worker-live',
      UNIT_TALK_DISTRIBUTION_TARGETS: 'discord:canary,discord:best-bets',
      UNIT_TALK_WORKER_ADAPTER: 'discord',
      UNIT_TALK_WORKER_POLL_MS: '2500',
      UNIT_TALK_WORKER_MAX_CYCLES: '9',
      UNIT_TALK_WORKER_DRY_RUN: 'false',
      UNIT_TALK_WORKER_AUTORUN: 'true',
      UNIT_TALK_WORKER_STALE_CLAIM_MS: '60000',
      UNIT_TALK_WORKER_HEARTBEAT_MS: '1500',
      UNIT_TALK_WORKER_WATCHDOG_MS: '9000',
      UNIT_TALK_SIMULATION_MODE: 'true',
      WORKER_HEARTBEAT_INTERVAL_MS: '45000',
    },
  });

  assert.equal(runtime.workerId, 'worker-live');
  assert.deepEqual(runtime.distributionTargets, ['discord:canary', 'discord:best-bets']);
  assert.equal(runtime.adapterKind, 'discord');
  assert.equal(runtime.pollIntervalMs, 2500);
  assert.equal(runtime.maxCyclesPerRun, 9);
  assert.equal(runtime.dryRun, false);
  assert.equal(runtime.autorun, true);
  assert.equal(runtime.staleClaimMs, 60000);
  assert.equal(runtime.heartbeatMs, 1500);
  assert.equal(runtime.watchdogMs, 9000);
  assert.equal(runtime.workerHeartbeatIntervalMs, 45000);
  assert.equal(runtime.simulationMode, true);
});

test('createWorkerRuntimeDependencies defaults workerHeartbeatIntervalMs to 30000', () => {
  const runtime = createWorkerRuntimeDependencies({
    environment: {
      NODE_ENV: 'test',
      UNIT_TALK_APP_ENV: 'ci',
      UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\dev\\unit-talk-v2',
      UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
      LINEAR_TEAM_KEY: 'UTV2',
      LINEAR_TEAM_NAME: 'unit-talk-v2',
      NOTION_WORKSPACE_NAME: 'unit-talk-v2',
      SLACK_WORKSPACE_NAME: 'unit-talk-v2',
    },
  });

  assert.equal(runtime.workerHeartbeatIntervalMs, 30000);
});

test('worker runtime helper readers honor loaded environment values', () => {
  const environment = {
    NODE_ENV: 'test' as const,
    UNIT_TALK_APP_ENV: 'ci' as const,
    UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\dev\\unit-talk-v2',
    UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
    LINEAR_TEAM_KEY: 'UTV2',
    LINEAR_TEAM_NAME: 'unit-talk-v2',
    NOTION_WORKSPACE_NAME: 'unit-talk-v2',
    SLACK_WORKSPACE_NAME: 'unit-talk-v2',
    UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD: '7',
    UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS: '120000',
    WORKER_HEARTBEAT_INTERVAL_MS: '45000',
    UNIT_TALK_SIMULATION_MODE: 'true',
  };

  assert.equal(readCircuitBreakerThreshold(environment), 7);
  assert.equal(readCircuitBreakerCooldownMs(environment), 120000);
  assert.equal(readWorkerHeartbeatIntervalMs(environment), 45000);
  assert.equal(readSimulationMode(environment), true);
});

test('processNextDistributionWork does not advance pick lifecycle on delivery failure', async () => {
  const outboxRecord = createOutboxRecord('discord:fail-lifecycle');
  const { repositories, picks } = createWorkerTestRepositories([outboxRecord]);

  await processNextDistributionWork(
    repositories,
    'discord:fail-lifecycle',
    'worker-fail-lifecycle',
    async () => {
      throw new Error('delivery error');
    },
    { persistenceMode: 'in_memory' },
  );

  const pick = await picks.findPickById(outboxRecord.pick_id);
  assert.equal(pick?.status, 'queued', 'pick must remain queued on delivery failure');
  assert.equal(picks.lifecycleEvents.length, 0, 'no lifecycle events must be recorded on failure');
});

test('processNextDistributionWork receipt is linked to outbox and carries idempotency key', async () => {
  const outboxRecord = createOutboxRecord('discord:receipt-link');
  const { repositories, receipts } = createWorkerTestRepositories([outboxRecord]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:receipt-link',
    'worker-link',
    async (outbox) => ({
      receiptType: 'discord.message',
      status: 'sent',
      channel: 'discord:#test',
      externalId: `msg:${outbox.id}`,
      idempotencyKey: `${outbox.id}:discord:test-channel:receipt`,
      payload: {},
    }),
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'sent');
  const receipt = receipts.records[0];
  assert.ok(receipt != null);
  assert.equal(
    receipt.outbox_id,
    outboxRecord.id,
    'receipt must be linked to the correct outbox id',
  );
  assert.equal(
    receipt.idempotency_key,
    `${outboxRecord.id}:discord:test-channel:receipt`,
    'idempotency key must be stored on the receipt',
  );
});

test('processNextDistributionWork skips terminal picks and completes outbox without delivery', async () => {
  const outboxRecord = createOutboxRecord('discord:skip-terminal');
  const { repositories, picks, receipts, runs, audit } = createWorkerTestRepositories([
    outboxRecord,
  ]);
  await picks.updatePickLifecycleState(outboxRecord.pick_id, 'settled');

  let deliverCalled = false;
  const result = await processNextDistributionWork(
    repositories,
    'discord:skip-terminal',
    'worker-skip',
    async () => {
      deliverCalled = true;
      throw new Error('deliver must not run for settled picks');
    },
    { persistenceMode: 'in_memory' },
  );

  assert.equal(result.status, 'skipped');
  if (result.status === 'skipped') {
    assert.equal(result.outbox.status, 'sent');
  }
  assert.equal(deliverCalled, false);
  assert.equal(receipts.records.length, 0, 'no receipt should be recorded for skipped work');
  assert.equal(runs.records[0]?.status, 'succeeded');
  assert.equal(audit.records[0]?.action, 'distribution.skipped');
});

test('runWorkerCycles returns idle results when targets have no pending work', async () => {
  const { repositories } = createWorkerTestRepositories([]);

  const cycles = await runWorkerCycles({
    repositories,
    workerId: 'worker-idle-cycle',
    targets: ['discord:no-work'],
    deliver: createStubDeliveryAdapter(),
    maxCycles: 1,
    persistenceMode: 'in_memory',
  });

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0]?.results.length, 1);
  assert.equal(cycles[0]?.results[0]?.status, 'idle');
});

test('runWorkerCycles reaps stale processing claims before claiming fresh work', async () => {
  const staleClaimedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const stale = createOutboxRecord('discord:stale', { status: 'processing', attempt_count: 1 });
  stale.claimed_at = staleClaimedAt;
  stale.claimed_by = 'worker-old';

  const { repositories, audit } = createWorkerTestRepositories([stale]);

  const cycles = await runWorkerCycles({
    repositories,
    workerId: 'worker-reaper',
    targets: ['discord:stale'],
    deliver: createStubDeliveryAdapter(),
    maxCycles: 1,
    staleClaimMs: 60_000,
    persistenceMode: 'in_memory',
  });

  assert.equal(cycles[0]?.reapedOutboxIds.includes(stale.id), true);
  assert.equal(cycles[0]?.results[0]?.status, 'sent');
  assert.equal(audit.records.some((record) => record.action === 'distribution.reaped_stale_claim'), true);
});

test('processNextDistributionWork heartbeats active claims during long delivery', async () => {
  const outbox = createOutboxRecord('discord:heartbeat');
  const { repositories } = createWorkerTestRepositories([outbox]);

  let touched = 0;
  const originalTouchClaim = repositories.outbox.touchClaim.bind(repositories.outbox);
  repositories.outbox.touchClaim = async (outboxId, workerId) => {
    const row = await originalTouchClaim(outboxId, workerId);
    if (row) {
      touched += 1;
    }
    return row;
  };

  const result = await processNextDistributionWork(
    repositories,
    'discord:heartbeat',
    'worker-heartbeat',
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        receiptType: 'discord.message',
        status: 'sent',
        payload: {},
      };
    },
    {
      heartbeatMs: 5,
      watchdogMs: 100,
      persistenceMode: 'in_memory',
    },
  );

  assert.equal(result.status, 'sent');
  assert.equal(touched > 0, true);
});

test('processNextDistributionWork fails hung deliveries when watchdog expires', async () => {
  const outbox = createOutboxRecord('discord:watchdog');
  const { repositories } = createWorkerTestRepositories([outbox]);

  const result = await processNextDistributionWork(
    repositories,
    'discord:watchdog',
    'worker-watchdog',
    async () => new Promise<never>(() => {}),
    {
      heartbeatMs: 5,
      watchdogMs: 20,
      persistenceMode: 'in_memory',
    },
  );

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.match(result.outbox.last_error ?? '', /watchdog exceeded/i);
  }
});

test('createDiscordDeliveryAdapter dry-run with mapped target preserves canonical target key', async () => {
  const outbox = createOutboxRecord('discord:canary');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: true,
    targetMap: { 'discord:canary': '1296531122234327100' },
  });

  const receipt = await adapter(outbox);

  assert.equal(receipt.channel, outbox.target);
  assert.equal(receipt.receiptType, 'discord.message');
  assert.equal(receipt.idempotencyKey, `${outbox.id}:${outbox.target}:dry-receipt`);
});

test('createDiscordDeliveryAdapter resolves discord:<numericId> target directly without target map', async () => {
  const outbox = createOutboxRecord('discord:9876543210');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: true,
    targetMap: {},
  });

  const receipt = await adapter(outbox);

  assert.equal(receipt.channel, 'discord:9876543210');
  assert.equal(receipt.receiptType, 'discord.message');
});

test('createDiscordDeliveryAdapter classifies 4xx responses as terminal failures', async () => {
  const outbox = createOutboxRecord('discord:canary');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:canary': '1234567890' },
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: 'Missing Access' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const result = await adapter(outbox);

  assert.equal(result.status, 'terminal-failure');
  assert.equal(result.channel, outbox.target);
  assert.equal(result.reason, 'HTTP 403: {"message":"Missing Access"}');
});

test('createDiscordDeliveryAdapter classifies 429 responses as retryable failures', async () => {
  const outbox = createOutboxRecord('discord:canary');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:canary': '1234567890' },
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const result = await adapter(outbox);

  assert.equal(result.status, 'retryable-failure');
  assert.equal(result.channel, outbox.target);
  assert.equal(result.reason, 'HTTP 429: {"message":"rate limited"}');
});

test('createDiscordDeliveryAdapter classifies network errors as retryable failures', async () => {
  const outbox = createOutboxRecord('discord:canary');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:canary': '1234567890' },
    fetchImpl: async () => {
      throw new Error('socket hang up');
    },
  });

  const result = await adapter(outbox);

  assert.equal(result.status, 'retryable-failure');
  assert.equal(result.channel, outbox.target);
  assert.equal(result.reason, 'socket hang up');
});

test('buildDiscordMessagePayload omits content field for non-canary targets', async () => {
  const outbox = createOutboxRecord('discord:best-bets');
  let rawBody: string | undefined;

  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:best-bets': '1288613037539852329' },
    fetchImpl: async (_url, init) => {
      rawBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ id: 'discord-message-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await adapter(outbox);

  const body = parseDiscordRequestBody(rawBody);
  assert.equal(body.content, undefined, 'content field must be absent for non-canary targets');
  assert.ok(body.embeds?.[0] != null, 'embed must still be present');
  assert.equal(body.embeds?.[0]?.title, 'Unit Talk V2 Best Bet');
  assert.equal(body.embeds?.[0]?.footer?.text, 'Unit Talk');
  assert.equal(
    body.embeds?.[0]?.fields?.[0]?.name,
    'Best Bets Purpose',
  );
});

test('createDiscordDeliveryAdapter renders trader-insights target-specific embed', async () => {
  const outbox = createOutboxRecord('discord:trader-insights');
  let rawBody: string | undefined;

  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:trader-insights': '1356613995175481405' },
    fetchImpl: async (_url, init) => {
      rawBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ id: 'discord-message-ti' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await adapter(outbox);

  const body = parseDiscordRequestBody(rawBody);
  assert.equal(body.content, undefined);
  assert.equal(body.embeds?.[0]?.title, 'Unit Talk V2 Trader Insight');
  assert.equal(
    body.embeds?.[0]?.footer?.text,
    'Unit Talk',
  );
  assert.equal(body.embeds?.[0]?.fields?.[0]?.name, 'Trader Insights Purpose');
});

// ---------------------------------------------------------------------------
// Circuit breaker unit tests
// ---------------------------------------------------------------------------

test('DeliveryCircuitBreaker opens after N consecutive failures', () => {
  const cb = new DeliveryCircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
  const target = 'discord:circuit-test';

  assert.equal(cb.isOpen(target), false, 'circuit must start closed');
  cb.recordFailure(target);
  cb.recordFailure(target);
  assert.equal(cb.isOpen(target), false, 'circuit must remain closed before threshold');
  cb.recordFailure(target);
  assert.equal(cb.isOpen(target), true, 'circuit must open at threshold');
  assert.ok(cb.resumeAt(target) !== null, 'resumeAt must be set when open');
  assert.ok(
    cb.openTargets().includes(target),
    'openTargets() must include the tripped target',
  );
});

test('DeliveryCircuitBreaker blocks delivery when open, allows after cooldown', () => {
  const cb = new DeliveryCircuitBreaker({ threshold: 1, cooldownMs: 50 });
  const target = 'discord:cooldown-test';

  cb.recordFailure(target);
  assert.equal(cb.isOpen(target), true, 'circuit must be open immediately after threshold');

  return new Promise<void>((resolve) => {
    setTimeout(() => {
      assert.equal(cb.isOpen(target), false, 'circuit must auto-reset after cooldown window');
      assert.deepEqual(cb.openTargets(), [], 'openTargets must be empty after reset');
      resolve();
    }, 60);
  });
});

test('DeliveryCircuitBreaker resets on success', () => {
  const cb = new DeliveryCircuitBreaker({ threshold: 2, cooldownMs: 60_000 });
  const target = 'discord:reset-test';

  cb.recordFailure(target);
  cb.recordFailure(target);
  assert.equal(cb.isOpen(target), true);
  cb.recordSuccess(target);
  assert.equal(cb.isOpen(target), false, 'circuit must close after success');
  assert.equal(cb.resumeAt(target), null, 'resumeAt must be null after reset');
});

test('runWorkerCycles skips target with open circuit and returns circuit-open result', async () => {
  // Three outbox rows for discord:best-bets — force threshold=2 failures to open the circuit,
  // then the third cycle should return circuit-open without calling deliver.
  const entries = [
    createOutboxRecord('discord:best-bets'),
    createOutboxRecord('discord:best-bets'),
    createOutboxRecord('discord:best-bets'),
  ];
  const { repositories } = createWorkerTestRepositories(entries);

  let deliverCallCount = 0;
  const alwaysFail = async () => {
    deliverCallCount += 1;
    throw new Error('discord down');
  };

  const cb = new DeliveryCircuitBreaker({ threshold: 2, cooldownMs: 60_000 });

  // 3 cycles: cycle 1 fails (count=1), cycle 2 fails → circuit opens (count=2), cycle 3 is skipped
  const cycles = await runWorkerCycles({
    repositories,
    workerId: 'worker-cb',
    targets: ['discord:best-bets'],
    deliver: alwaysFail,
    maxCycles: 3,
    sleep: async () => {},
    circuitBreaker: cb,
    persistenceMode: 'in_memory',
  });

  // Cycle 3 should have circuit-open because circuit opens at threshold=2
  const cycle3 = cycles[2];
  assert.ok(cycle3 !== undefined, 'must have 3 cycles');
  const circuitOpenResult = cycle3.results.find((r) => r.status === 'circuit-open');
  assert.ok(circuitOpenResult !== undefined, 'cycle 3 must include a circuit-open result');
  assert.equal(circuitOpenResult.target, 'discord:best-bets');
  // Deliver must only have been called twice (cycles 1 and 2 — cycle 3 was skipped)
  assert.equal(deliverCallCount, 2, 'deliver must not be called when circuit is open');
});

test('runWorkerCycles writes system_runs row when circuit opens', async () => {
  const entry = createOutboxRecord('discord:trader-insights');
  const { repositories, runs } = createWorkerTestRepositories([entry]);

  const cb = new DeliveryCircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
  const alwaysFail = async () => {
    throw new Error('delivery failed');
  };

  await runWorkerCycles({
    repositories,
    workerId: 'worker-cb-run',
    targets: ['discord:trader-insights'],
    deliver: alwaysFail,
    maxCycles: 1,
    circuitBreaker: cb,
    persistenceMode: 'in_memory',
  });

  const circuitRun = runs.records.find((r) => r.run_type === 'worker.circuit-open');
  assert.ok(circuitRun !== undefined, 'a worker.circuit-open system_run must be written');
  assert.equal(circuitRun.status, 'running', 'run must remain running (open) until circuit closes');
  const details = circuitRun.details as Record<string, unknown> | null;
  assert.equal(typeof details?.target, 'string', 'details.target must be set');
  assert.equal(typeof details?.resumeAt, 'string', 'details.resumeAt must be set');
});

// ---------------------------------------------------------------------------
// Target registry unit tests
// ---------------------------------------------------------------------------

test('runWorkerCycles skips disabled target — outbox row stays pending', async () => {
  const outbox = createOutboxRecord('discord:exclusive-insights');
  const { repositories } = createWorkerTestRepositories([outbox]);
  const cycles = await runWorkerCycles({
    repositories,
    workerId: 'worker-disabled-target',
    targets: ['discord:exclusive-insights'],
    deliver: createStubDeliveryAdapter(),
    maxCycles: 1,
    persistenceMode: 'in_memory',
    targetRegistry: [
      { target: 'best-bets', enabled: true, rolloutPct: 100 },
      { target: 'trader-insights', enabled: true, rolloutPct: 100 },
      { target: 'exclusive-insights', enabled: false, disabledReason: 'Activation contract required', rolloutPct: 100 },
    ],
  });
  assert.equal(cycles[0]?.results[0]?.status, 'target-disabled');
  assert.equal(outbox.status, 'pending');
});

test('resolveTargetRegistry with UNIT_TALK_ENABLED_TARGETS=best-bets disables all other targets', async () => {
  const { resolveTargetRegistry } = await import('@unit-talk/contracts');
  const registry = resolveTargetRegistry({ UNIT_TALK_ENABLED_TARGETS: 'best-bets' });
  assert.equal(registry.find(e => e.target === 'best-bets')?.enabled, true);
  assert.equal(registry.find(e => e.target === 'trader-insights')?.enabled, false);
  assert.equal(registry.find(e => e.target === 'exclusive-insights')?.enabled, false);
  assert.ok(registry.find(e => e.target === 'trader-insights')?.disabledReason?.includes('UNIT_TALK_ENABLED_TARGETS'));
});

// ---------------------------------------------------------------------------
// Worker heartbeat tests (UTV2-120)
// ---------------------------------------------------------------------------

test('runWorkerCycles writes a worker.heartbeat system_run per cycle', async () => {
  const { repositories, runs } = createWorkerTestRepositories([
    createOutboxRecord('discord:hb-target'),
  ]);

  await runWorkerCycles({
    repositories,
    workerId: 'worker-hb',
    targets: ['discord:hb-target'],
    deliver: createStubDeliveryAdapter(),
    maxCycles: 1,
    persistenceMode: 'in_memory',
    workerHeartbeatIntervalMs: 30000,
  });

  const heartbeatRuns = runs.records.filter((r) => r.run_type === 'worker.heartbeat');
  assert.equal(heartbeatRuns.length, 1, 'exactly one worker.heartbeat run must be written per cycle');
  assert.equal(heartbeatRuns[0]?.status, 'succeeded', 'heartbeat run must be completed as succeeded');
  assert.ok(heartbeatRuns[0]?.finished_at != null, 'heartbeat run must have a finished_at timestamp');
});

test('createWorkerRuntimeDependencies reads worker settings from local.env', () => {
  const originalCwd = process.cwd();
  const originalEnv = {
    UNIT_TALK_WORKER_ID: process.env.UNIT_TALK_WORKER_ID,
    UNIT_TALK_DISTRIBUTION_TARGETS: process.env.UNIT_TALK_DISTRIBUTION_TARGETS,
    UNIT_TALK_WORKER_ADAPTER: process.env.UNIT_TALK_WORKER_ADAPTER,
    UNIT_TALK_WORKER_POLL_MS: process.env.UNIT_TALK_WORKER_POLL_MS,
    UNIT_TALK_WORKER_MAX_CYCLES: process.env.UNIT_TALK_WORKER_MAX_CYCLES,
    UNIT_TALK_WORKER_DRY_RUN: process.env.UNIT_TALK_WORKER_DRY_RUN,
    UNIT_TALK_WORKER_AUTORUN: process.env.UNIT_TALK_WORKER_AUTORUN,
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-worker-runtime-'));

  fs.writeFileSync(
    path.join(tempDir, '.env.example'),
    [
      'NODE_ENV=development',
      'UNIT_TALK_APP_ENV=local',
      'UNIT_TALK_ACTIVE_WORKSPACE=C:\\\\dev\\\\unit-talk-v2',
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UT',
      'LINEAR_TEAM_NAME=Unit Talk',
      'NOTION_WORKSPACE_NAME=Unit Talk',
      'SLACK_WORKSPACE_NAME=Unit Talk',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(tempDir, 'local.env'),
    [
      'UNIT_TALK_WORKER_ID=worker-from-local-env',
      'UNIT_TALK_DISTRIBUTION_TARGETS=discord:best-bets,discord:canary',
      'UNIT_TALK_WORKER_ADAPTER=discord',
      'UNIT_TALK_WORKER_POLL_MS=9000',
      'UNIT_TALK_WORKER_MAX_CYCLES=7',
      'UNIT_TALK_WORKER_DRY_RUN=false',
      'UNIT_TALK_WORKER_AUTORUN=true',
    ].join('\n'),
    'utf8',
  );

  try {
    process.chdir(tempDir);
    delete process.env.UNIT_TALK_WORKER_ID;
    delete process.env.UNIT_TALK_DISTRIBUTION_TARGETS;
    delete process.env.UNIT_TALK_WORKER_ADAPTER;
    delete process.env.UNIT_TALK_WORKER_POLL_MS;
    delete process.env.UNIT_TALK_WORKER_MAX_CYCLES;
    delete process.env.UNIT_TALK_WORKER_DRY_RUN;
    delete process.env.UNIT_TALK_WORKER_AUTORUN;

    const runtime = createWorkerRuntimeDependencies();

    assert.equal(runtime.persistenceMode, 'in_memory');
    assert.equal(runtime.workerId, 'worker-from-local-env');
    assert.deepEqual(runtime.distributionTargets, ['discord:best-bets', 'discord:canary']);
    assert.equal(runtime.adapterKind, 'discord');
    assert.equal(runtime.pollIntervalMs, 9000);
    assert.equal(runtime.maxCyclesPerRun, 7);
    assert.equal(runtime.dryRun, false);
    assert.equal(runtime.autorun, true);
  } finally {
    process.env.UNIT_TALK_WORKER_ID = originalEnv.UNIT_TALK_WORKER_ID;
    process.env.UNIT_TALK_DISTRIBUTION_TARGETS = originalEnv.UNIT_TALK_DISTRIBUTION_TARGETS;
    process.env.UNIT_TALK_WORKER_ADAPTER = originalEnv.UNIT_TALK_WORKER_ADAPTER;
    process.env.UNIT_TALK_WORKER_POLL_MS = originalEnv.UNIT_TALK_WORKER_POLL_MS;
    process.env.UNIT_TALK_WORKER_MAX_CYCLES = originalEnv.UNIT_TALK_WORKER_MAX_CYCLES;
    process.env.UNIT_TALK_WORKER_DRY_RUN = originalEnv.UNIT_TALK_WORKER_DRY_RUN;
    process.env.UNIT_TALK_WORKER_AUTORUN = originalEnv.UNIT_TALK_WORKER_AUTORUN;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runWorkerCycles writes one heartbeat per cycle for multiple cycles', async () => {
  const { repositories, runs } = createWorkerTestRepositories([]);

  await runWorkerCycles({
    repositories,
    workerId: 'worker-hb-multi',
    targets: ['discord:hb-multi'],
    deliver: createStubDeliveryAdapter(),
    maxCycles: 3,
    sleep: async () => {},
    persistenceMode: 'in_memory',
    workerHeartbeatIntervalMs: 30000,
  });

  const heartbeatRuns = runs.records.filter((r) => r.run_type === 'worker.heartbeat');
  assert.equal(heartbeatRuns.length, 3, 'one worker.heartbeat run must be written per cycle');
  assert.ok(heartbeatRuns.every((r) => r.status === 'succeeded'), 'all heartbeat runs must be succeeded');
});

test('runWorkerCycles skips heartbeat write when workerHeartbeatIntervalMs is 0', async () => {
  const { repositories, runs } = createWorkerTestRepositories([
    createOutboxRecord('discord:hb-skip'),
  ]);

  await runWorkerCycles({
    repositories,
    workerId: 'worker-hb-skip',
    targets: ['discord:hb-skip'],
    deliver: createStubDeliveryAdapter(),
    maxCycles: 1,
    persistenceMode: 'in_memory',
    workerHeartbeatIntervalMs: 0,
  });

  const heartbeatRuns = runs.records.filter((r) => r.run_type === 'worker.heartbeat');
  assert.equal(heartbeatRuns.length, 0, 'no worker.heartbeat runs must be written when interval is 0');
});

function isGovernedTarget(target: string) {
  return target === 'discord:best-bets' || target === 'discord:trader-insights';
}

function requireCapturedRequest(value: CapturedRequest | null): CapturedRequest {
  if (!value) {
    throw new Error('Expected Discord request to be captured');
  }

  return value;
}

function parseDiscordRequestBody(value: string | undefined): DiscordRequestBody {
  if (!value) {
    throw new Error('Expected Discord request body to be present');
  }

  return JSON.parse(value) as DiscordRequestBody;
}

// --- Simulation adapter tests ---

test('simulation adapter returns correct receipt shape', async () => {
  const adapter = createSimulationDeliveryAdapter();
  const outbox: OutboxRecord = {
    id: 'outbox-sim-1',
    pick_id: 'pick-sim-1',
    target: 'discord:best-bets',
    status: 'processing',
    attempt_count: 0,
    next_attempt_at: null,
    last_error: null,
    payload: { market: 'NBA points' },
    claimed_at: '2026-03-20T12:00:00.000Z',
    claimed_by: 'worker-sim',
    idempotency_key: 'sim-key-1',
    created_at: '2026-03-20T12:00:00.000Z',
    updated_at: '2026-03-20T12:00:00.000Z',
  };

  const receipt = await adapter(outbox);

  assert.equal(receipt.receiptType, 'worker.simulation');
  assert.equal(receipt.status, 'sent');
  assert.equal(receipt.externalId, 'sim:outbox-sim-1');
  assert.equal((receipt.payload as Record<string, unknown>).simulated, true);
});

test('simulation adapter channel format is simulated:<target>', async () => {
  const adapter = createSimulationDeliveryAdapter();
  const outbox: OutboxRecord = {
    id: 'outbox-sim-2',
    pick_id: 'pick-sim-2',
    target: 'discord:trader-insights',
    status: 'processing',
    attempt_count: 0,
    next_attempt_at: null,
    last_error: null,
    payload: { market: 'MLB hits' },
    claimed_at: '2026-03-20T12:00:00.000Z',
    claimed_by: 'worker-sim',
    idempotency_key: 'sim-key-2',
    created_at: '2026-03-20T12:00:00.000Z',
    updated_at: '2026-03-20T12:00:00.000Z',
  };

  const receipt = await adapter(outbox);

  assert.equal(receipt.channel, 'simulated:discord:trader-insights');
});

test('simulation adapter always succeeds', async () => {
  const adapter = createSimulationDeliveryAdapter();
  const outbox: OutboxRecord = {
    id: 'outbox-sim-3',
    pick_id: 'pick-sim-3',
    target: 'discord:canary',
    status: 'processing',
    attempt_count: 5,
    next_attempt_at: null,
    last_error: 'previous failure',
    payload: {},
    claimed_at: '2026-03-20T12:00:00.000Z',
    claimed_by: 'worker-sim',
    idempotency_key: 'sim-key-3',
    created_at: '2026-03-20T12:00:00.000Z',
    updated_at: '2026-03-20T12:00:00.000Z',
  };

  const receipt = await adapter(outbox);

  assert.equal(receipt.status, 'sent');
  assert.equal(receipt.receiptType, 'worker.simulation');
});
