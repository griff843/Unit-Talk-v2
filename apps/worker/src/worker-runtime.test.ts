import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
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
  createStubDeliveryAdapter,
} from './delivery-adapters.js';
import { processNextDistributionWork } from './distribution-worker.js';
import { runWorkerCycles } from './runner.js';

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
    entry.status = 'failed';
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
          ? 'trader-insights-v1'
          : entry.target === 'discord:best-bets'
            ? 'best-bets-v1'
            : null,
        promotion_decided_at: isGovernedTarget(entry.target) ? now : null,
        promotion_decided_by: isGovernedTarget(entry.target) ? 'test' : null,
        status: 'queued',
        posted_at: null,
        settled_at: null,
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

  async findPickById(pickId: string): Promise<PickRecord | null> {
    return this.picks.get(pickId) ?? null;
  }

  async listByLifecycleState(
    _lifecycleState: CanonicalPick['lifecycleState'],
    _limit?: number | undefined,
  ): Promise<PickRecord[]> {
    return [];
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
      settlements: {} as RepositoryBundle['settlements'],
      providerOffers: {} as RepositoryBundle['providerOffers'],
      participants: {} as RepositoryBundle['participants'],
      events: {} as RepositoryBundle['events'],
      eventParticipants: {} as RepositoryBundle['eventParticipants'],
      gradeResults: {} as RepositoryBundle['gradeResults'],
      runs,
      audit,
      referenceData: {} as RepositoryBundle['referenceData'],
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
  );

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.outbox.status, 'failed');
    assert.equal(result.outbox.attempt_count, 1);
  }
  assert.equal(runs.records[0]?.status, 'failed');
  assert.ok(runs.records[0]?.finished_at != null, 'finished_at must be set on failed run');
  assert.ok(
    new Date(runs.records[0]!.finished_at!) >= new Date(runs.records[0]!.started_at),
    `finished_at must not be earlier than started_at (clock skew regression)`,
  );
  assert.equal(audit.records[0]?.action, 'distribution.failed');
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

test('processNextDistributionWork keeps the row failed before the dead_letter threshold', async () => {
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
  );

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.outbox.status, 'failed');
    assert.equal(result.outbox.attempt_count, 2);
    assert.equal(result.outbox.last_error, 'retryable failure');
  }
  assert.equal(audit.records[0]?.action, 'distribution.failed');
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
  });

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0]?.results.length, 2);
  assert.ok(
    cycles[0]?.results.every((r) => r.status === 'sent'),
    'all results should be sent',
  );
  assert.equal(receipts.records.length, 2);
  assert.equal(runs.records.length, 2);
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
  assert.equal(receipt.idempotencyKey, `${outbox.id}:discord:dry-receipt`);
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
  assert.equal(embed?.footer?.text, 'Target: discord:canary');
  assert.deepEqual(
    embed?.fields?.map((field) => [field.name, field.value]),
    [
      ['Market', 'Player points'],
      ['Pick', 'Over 24.5 @ +24.5 (-110)'],
      ['Capper', 'griff843'],
      ['Source', 'smart-form'],
      ['State', 'queued'],
      ['Pick ID', `\`${outbox.pick_id}\``],
    ],
  );
  assert.equal(receipt.receiptType, 'discord.message');
  assert.equal(receipt.channel, 'discord:1234567890');
  assert.equal(receipt.externalId, 'discord-message-1');
  assert.equal(
    receipt.idempotencyKey,
    `${outbox.id}:discord:1234567890:receipt`,
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
  });

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0]?.results.length, 1);
  assert.equal(cycles[0]?.results[0]?.status, 'idle');
});

test('createDiscordDeliveryAdapter dry-run with mapped target uses discord:{channelId} channel format', async () => {
  const outbox = createOutboxRecord('discord:canary');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: true,
    targetMap: { 'discord:canary': '1296531122234327100' },
  });

  const receipt = await adapter(outbox);

  assert.equal(receipt.channel, 'discord:1296531122234327100');
  assert.equal(receipt.receiptType, 'discord.message');
  assert.equal(receipt.idempotencyKey, `${outbox.id}:discord:dry-receipt`);
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

test('createDiscordDeliveryAdapter throws descriptively on non-200 Discord response', async () => {
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

  await assert.rejects(() => adapter(outbox), /Discord delivery failed: 403/);
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
  assert.equal(body.embeds?.[0]?.footer?.text, 'Target: discord:best-bets | Curated lane preview');
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
    'Target: discord:trader-insights | Market-alerts lane preview',
  );
  assert.equal(body.embeds?.[0]?.fields?.[0]?.name, 'Trader Insights Purpose');
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
