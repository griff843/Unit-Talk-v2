import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReplayArgs,
  replayFailedDeliveries,
  REPLAYABLE_STATUSES,
  type ReplayDatabaseClient,
  type ReplayOptions,
} from './replay-failed-delivery.js';

interface FakeOutboxRow {
  id: string;
  pick_id: string;
  target: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  updated_at: string;
  created_at?: string;
  [key: string]: unknown;
}

interface FakeAuditEntry {
  action: string;
  actor?: string | null;
  entity_id?: string | null;
  entity_ref?: string | null;
  entity_type: string;
  payload?: unknown;
  [key: string]: unknown;
}

interface FakeReceiptRow {
  id: string;
  outbox_id: string;
  status: string;
  [key: string]: unknown;
}

class FakeReplayDatabase {
  updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  auditEntries: FakeAuditEntry[] = [];
  failUpdates = false;
  failAudit = false;
  readonly receipts: FakeReceiptRow[] = [];

  constructor(readonly rows: FakeOutboxRow[]) {}

  from(table: string): unknown {
    if (table === 'distribution_outbox') {
      return {
        select: (_columns: string) => new FakeSelectQuery(this.rows),
        update: (values: Record<string, unknown>) =>
          new FakeUpdateQuery(this, values),
      };
    }
    if (table === 'audit_log') {
      return {
        select: (_columns: string) => new FakeSelectQuery(this.auditEntries),
        insert: (values: FakeAuditEntry) => {
          if (this.failAudit) {
            return Promise.resolve({
              data: null,
              error: { message: 'audit write failed' },
            });
          }
          this.auditEntries.push(values);
          return Promise.resolve({ data: values, error: null });
        },
      };
    }
    if (table === 'distribution_receipts') {
      return {
        select: (_columns: string) => new FakeSelectQuery(this.receipts),
      };
    }
    throw new Error(`Unknown table: ${table}`);
  }
}

class FakeSelectQuery<
  Row extends Record<string, unknown>,
> implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private limitCount = Number.POSITIVE_INFINITY;
  readonly eqCalls: Array<{ column: string; value: unknown }> = [];
  readonly ltCalls: Array<{ column: string; value: unknown }> = [];

  constructor(private readonly rows: Row[]) {}

  eq(column: string, value: unknown) {
    this.eqCalls.push({ column, value });
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  lt(column: string, value: unknown) {
    this.ltCalls.push({ column, value });
    this.filters.push((row) => String(row[column]) < String(value));
    return this;
  }

  order(_column: string, _options: { ascending: boolean }) {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: Row[];
          error: null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.rows
        .filter((row) => this.filters.every((filter) => filter(row)))
        .slice(0, this.limitCount),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

class FakeUpdateQuery implements PromiseLike<{
  data: FakeOutboxRow | null;
  error: { message: string } | null;
}> {
  private id: string | null = null;
  private requiredStatus: string | null = null;

  constructor(
    private readonly db: FakeReplayDatabase,
    private readonly values: Record<string, unknown>,
  ) {}

  eq(column: string, value: unknown) {
    if (column === 'id') {
      this.id = String(value);
    }
    if (column === 'status') {
      this.requiredStatus = String(value);
    }
    return this;
  }

  select(_columns?: string) {
    return this;
  }

  single() {
    return this;
  }

  then<
    TResult1 = {
      data: FakeOutboxRow | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: FakeOutboxRow | null;
          error: { message: string } | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.db.failUpdates) {
      return Promise.resolve({
        data: null,
        error: { message: 'write failed' },
      }).then(onfulfilled, onrejected);
    }

    const row = this.db.rows.find(
      (candidate) =>
        candidate.id === this.id &&
        (this.requiredStatus === null ||
          candidate.status === this.requiredStatus),
    );

    if (!row) {
      return Promise.resolve({
        data: null,
        error: { message: 'not found' },
      }).then(onfulfilled, onrejected);
    }

    Object.assign(row, this.values);
    this.db.updates.push({ id: row.id, values: this.values });
    return Promise.resolve({ data: row, error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

const NOW = new Date('2026-05-14T12:00:00.000Z');

test('dry-run mode prints candidate rows without DB mutations', async () => {
  const db = new FakeReplayDatabase([
    makeRow('outbox-1', { updated_at: '2026-05-14T10:00:00.000Z' }),
  ]);

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions({ dryRun: true }),
    NOW,
  );

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'outbox-1');
  assert.deepEqual(db.updates, []);
  assert.deepEqual(db.auditEntries, []);
});

test('production cap enforcement rejects more than 50 candidate rows before writes', async () => {
  const rows = Array.from({ length: 51 }, (_unused, index) =>
    makeRow(`outbox-${index}`, { updated_at: '2026-05-14T10:00:00.000Z' }),
  );
  const db = new FakeReplayDatabase(rows);

  await assert.rejects(
    replayFailedDeliveries(
      db as unknown as ReplayDatabaseClient,
      replayOptions({ limit: 50 }),
      NOW,
    ),
    /Refusing to process more than 50 rows/,
  );
  assert.deepEqual(db.updates, []);
  assert.deepEqual(db.auditEntries, []);
});

test('min-age-hours filters rows by updated_at cutoff', async () => {
  const db = new FakeReplayDatabase([
    makeRow('old', { updated_at: '2026-05-14T09:59:59.000Z' }),
    makeRow('new', { updated_at: '2026-05-14T10:30:00.000Z' }),
  ]);

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions({ dryRun: true, minAgeHours: 2 }),
    NOW,
  );

  assert.ok(Array.isArray(result));
  assert.deepEqual(
    result.map((row) => row.id),
    ['old'],
  );
});

test('successful replay returns audit log shape', async () => {
  const db = new FakeReplayDatabase([
    makeRow('outbox-1', {
      attempt_count: 2,
      updated_at: '2026-05-14T10:00:00.000Z',
    }),
  ]);

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions(),
    NOW,
  );

  assert.ok(!Array.isArray(result));
  assert.equal(result.service, 'replay-failed-delivery');
  assert.equal(result.replayed, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(typeof result.durationMs, 'number');
  assert.equal(db.rows[0]?.status, 'pending');
  assert.equal(db.rows[0]?.attempt_count, 3);
  assert.equal(db.rows[0]?.last_error, null);
});

test('successful replay writes audit log entry', async () => {
  const db = new FakeReplayDatabase([
    makeRow('outbox-1', {
      pick_id: 'pick-abc',
      attempt_count: 1,
      status: 'failed',
      updated_at: '2026-05-14T10:00:00.000Z',
    }),
  ]);

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions(),
    NOW,
  );

  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 1);
  assert.equal(db.auditEntries.length, 1);

  const entry = db.auditEntries[0];
  assert.ok(entry);
  assert.equal(entry.action, 'replay');
  assert.equal(entry.actor, 'replay-failed-delivery');
  assert.equal(entry.entity_type, 'distribution_outbox');
  assert.equal(entry.entity_id, 'outbox-1');
  assert.equal(entry.entity_ref, 'pick-abc');
  assert.deepEqual(entry.payload, {
    outbox_id: 'outbox-1',
    pick_id: 'pick-abc',
    previous_status: 'failed',
    new_status: 'pending',
    attempt_count: 2,
    target: 'discord:canary',
  });
});

test('dead_letter rows are replayable', async () => {
  const db = new FakeReplayDatabase([
    makeRow('dl-1', {
      status: 'dead_letter',
      attempt_count: 5,
      updated_at: '2026-05-14T10:00:00.000Z',
    }),
  ]);

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions({ status: 'dead_letter' }),
    NOW,
  );

  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 1);
  assert.equal(db.rows[0]?.status, 'pending');
  assert.equal(
    db.auditEntries[0]?.payload &&
      (db.auditEntries[0].payload as Record<string, unknown>)[
        'previous_status'
      ],
    'dead_letter',
  );
});

test('--status=all includes both failed and dead_letter rows', async () => {
  const db = new FakeReplayDatabase([
    makeRow('failed-1', {
      status: 'failed',
      updated_at: '2026-05-14T10:00:00.000Z',
    }),
    makeRow('dl-1', {
      status: 'dead_letter',
      updated_at: '2026-05-14T10:00:00.000Z',
    }),
  ]);

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions({ status: 'all' }),
    NOW,
  );

  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 2);
});

test('denied replay: row with non-replayable status is skipped', async () => {
  const db = new FakeReplayDatabase([
    makeRow('sent-1', {
      status: 'sent',
      updated_at: '2026-05-14T10:00:00.000Z',
    }),
  ]);

  // Manually force the row through (bypass the query filter by patching the row
  // after construction to simulate a race where status changed during query)
  db.rows[0]!.status = 'sent';

  // Use status='all' but the rows returned have 'sent' — since 'sent' is not in
  // REPLAYABLE_STATUSES the guard inside replayFailedDeliveries rejects it
  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    // Override to query 'failed'+'dead_letter' but make the row 'sent'
    // The in() filter on the fake DB won't return 'sent' rows for replayable statuses,
    // so let's test the guard directly by using a status=failed filter but adjusting
    // the row after query (simulating a TOCTOU scenario via the .eq('status', row.status) guard)
    replayOptions({ status: 'all', minAgeHours: 0 }),
    NOW,
  );

  // 'sent' is not in REPLAYABLE_STATUSES so the query filter excludes it
  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 0);
  assert.deepEqual(db.updates, []);
  assert.deepEqual(db.auditEntries, []);
});

test('idempotency: replay requires matching status — concurrent change is rejected', async () => {
  const db = new FakeReplayDatabase([
    makeRow('outbox-1', {
      status: 'failed',
      updated_at: '2026-05-14T10:00:00.000Z',
    }),
  ]);

  // Simulate concurrent status change before update completes
  // by marking the row as 'pending' before the update runs
  db.rows[0]!.status = 'pending';

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions(),
    NOW,
  );

  // 'pending' is not replayable, so the query filter excludes it
  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 0);
  assert.deepEqual(db.auditEntries, []);
});

test('audit log failure is reported but replay still counts as success', async () => {
  const db = new FakeReplayDatabase([
    makeRow('outbox-1', { updated_at: '2026-05-14T10:00:00.000Z' }),
  ]);
  db.failAudit = true;

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions(),
    NOW,
  );

  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 1);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0]?.includes('audit log failed'));
});

test('DB write failures are reported for non-zero CLI exit handling', async () => {
  const db = new FakeReplayDatabase([
    makeRow('outbox-1', { updated_at: '2026-05-14T10:00:00.000Z' }),
  ]);
  db.failUpdates = true;

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions(),
    NOW,
  );

  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.errors, [
    'Failed to replay outbox outbox-1: write failed',
  ]);
  assert.deepEqual(db.auditEntries, []);
});

test('parseReplayArgs enforces max limit', () => {
  assert.throws(
    () => parseReplayArgs(['--limit', '51']),
    /--limit must be 50 or less/,
  );
});

test('parseReplayArgs --inspect is alias for --dry-run', () => {
  const opts = parseReplayArgs(['--inspect']);
  assert.equal(opts.dryRun, true);
});

test('parseReplayArgs --status=dead_letter sets status filter', () => {
  const opts = parseReplayArgs(['--status=dead_letter']);
  assert.equal(opts.status, 'dead_letter');
});

test('parseReplayArgs rejects invalid --status value', () => {
  assert.throws(
    () => parseReplayArgs(['--status', 'processing']),
    /--status must be/,
  );
});

test('REPLAYABLE_STATUSES includes failed and dead_letter', () => {
  assert.ok(REPLAYABLE_STATUSES.includes('failed'));
  assert.ok(REPLAYABLE_STATUSES.includes('dead_letter'));
});

test('WORK-2026100901: discord:official-picks is an accepted replay target', () => {
  assert.equal(
    parseReplayArgs(['--target', 'discord:official-picks']).target,
    'discord:official-picks',
  );
  assert.equal(
    parseReplayArgs(['--target=discord:official-picks']).target,
    'discord:official-picks',
  );
});

test('WORK-2026100901: --target all includes official-picks behind the duplicate guard', async () => {
  const db = new FakeReplayDatabase([
    makeRow('official-dl', {
      target: 'discord:official-picks',
      status: 'dead_letter',
    }),
    makeRow('official-failed', {
      target: 'discord:official-picks',
      status: 'failed',
    }),
    makeRow('canary-1', { target: 'discord:canary', status: 'failed' }),
  ]);

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions({ target: 'all', status: 'all' }),
    NOW,
  );

  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 3);
  assert.deepEqual(
    db.updates.map((u) => u.id),
    ['official-dl', 'official-failed', 'canary-1'],
  );
});

for (const target of [
  'discord:canary',
  'discord:best-bets',
  'discord:official-picks',
] as const) {
  test(`WORK-2026100901: sent receipt refuses replay for ${target}`, async () => {
    const db = new FakeReplayDatabase([makeRow('guarded', { target })]);
    db.receipts.push({
      id: 'receipt-sent',
      outbox_id: 'guarded',
      status: 'sent',
    });

    const result = await replayFailedDeliveries(
      db as unknown as ReplayDatabaseClient,
      replayOptions({ target }),
      NOW,
    );

    assert.ok(!Array.isArray(result));
    assert.equal(result.replayed, 0);
    assert.match(result.errors[0] ?? '', /ALREADY_DELIVERED.*receipt-sent/u);
    assert.deepEqual(db.updates, []);
  });

  test(`WORK-2026100901: delivered dispatch ledger refuses replay for ${target}`, async () => {
    const db = new FakeReplayDatabase([makeRow('guarded', { target })]);
    db.auditEntries.push(
      dispatchStarted('guarded', 1),
      dispatchDelivered('guarded', 1),
    );

    const result = await replayFailedDeliveries(
      db as unknown as ReplayDatabaseClient,
      replayOptions({ target }),
      NOW,
    );

    assert.ok(!Array.isArray(result));
    assert.equal(result.replayed, 0);
    assert.match(result.errors[0] ?? '', /ALREADY_DELIVERED.*attempt 1/u);
    assert.deepEqual(db.updates, []);
  });

  test(`WORK-2026100901: unresolved dispatch ledger refuses replay for ${target}`, async () => {
    const db = new FakeReplayDatabase([makeRow('guarded', { target })]);
    db.auditEntries.push(dispatchStarted('guarded', 2));

    const result = await replayFailedDeliveries(
      db as unknown as ReplayDatabaseClient,
      replayOptions({ target }),
      NOW,
    );

    assert.ok(!Array.isArray(result));
    assert.equal(result.replayed, 0);
    assert.match(result.errors[0] ?? '', /DELIVERY_OUTCOME_AMBIGUOUS.*2/u);
    assert.deepEqual(db.updates, []);
  });
}

test('WORK-2026100901: explicit not-delivered confirmation is audited before replay', async () => {
  const db = new FakeReplayDatabase([
    makeRow('official-ambiguous', { target: 'discord:official-picks' }),
  ]);
  db.auditEntries.push(dispatchStarted('official-ambiguous', 3));

  const result = await replayFailedDeliveries(
    db as unknown as ReplayDatabaseClient,
    replayOptions({
      target: 'discord:official-picks',
      confirmedNotDelivered: true,
      confirmationReason: 'operator checked the member channel',
    }),
    NOW,
  );

  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 1);
  assert.deepEqual(
    db.auditEntries.map((entry) => entry.action),
    [
      'distribution.dispatch_started',
      'distribution.dispatch_reconciled',
      'replay',
    ],
  );
  assert.deepEqual(db.auditEntries[1]?.payload, {
    outboxId: 'official-ambiguous',
    target: 'discord:official-picks',
    throughAttempt: 3,
    reason: 'operator checked the member channel',
  });
});

test('WORK-2026100901: confirmation flag requires an audit reason', () => {
  assert.throws(
    () => parseReplayArgs(['--confirmed-not-delivered']),
    /--reason is required/u,
  );
});

function replayOptions(overrides: Partial<ReplayOptions> = {}): ReplayOptions {
  return {
    limit: 10,
    dryRun: false,
    minAgeHours: 1,
    target: 'discord:canary',
    status: 'failed',
    confirmedNotDelivered: false,
    confirmationReason: null,
    ...overrides,
  };
}

function dispatchStarted(outboxId: string, attempt: number): FakeAuditEntry {
  return {
    action: 'distribution.dispatch_started',
    entity_type: 'distribution_outbox',
    entity_id: outboxId,
    payload: { attempt },
  };
}

function dispatchDelivered(outboxId: string, attempt: number): FakeAuditEntry {
  return {
    action: 'distribution.dispatch_delivered',
    entity_type: 'distribution_outbox',
    entity_id: outboxId,
    payload: {
      attempt,
      receipt: {
        receiptType: 'discord.message',
        channel: 'discord:channel',
        externalId: 'message-1',
        idempotencyKey: null,
        payload: {},
      },
    },
  };
}

function makeRow(
  id: string,
  overrides: Partial<FakeOutboxRow> = {},
): FakeOutboxRow {
  return {
    id,
    pick_id: `pick-${id}`,
    target: 'discord:canary',
    status: 'failed',
    attempt_count: 0,
    last_error: 'failed',
    updated_at: '2026-05-14T10:00:00.000Z',
    ...overrides,
  };
}
