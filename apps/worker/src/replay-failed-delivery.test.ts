import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReplayArgs,
  replayFailedDeliveries,
  type ReplayDatabaseClient,
  type ReplayOptions,
} from './replay-failed-delivery.js';

interface FakeOutboxRow {
  id: string;
  target: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  updated_at: string;
  pick_id?: string;
  created_at?: string;
  [key: string]: unknown;
}

class FakeReplayDatabase implements ReplayDatabaseClient {
  updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  failUpdates = false;

  constructor(readonly rows: FakeOutboxRow[]) {}

  from(table: 'distribution_outbox') {
    assert.equal(table, 'distribution_outbox');
    return {
      select: (_columns: string) => new FakeSelectQuery(this.rows),
      update: (values: Record<string, unknown>) => new FakeUpdateQuery(this, values),
    };
  }
}

class FakeSelectQuery implements PromiseLike<{ data: FakeOutboxRow[]; error: null }> {
  private filters: Array<(row: FakeOutboxRow) => boolean> = [];
  private limitCount = Number.POSITIVE_INFINITY;
  readonly eqCalls: Array<{ column: string; value: unknown }> = [];
  readonly ltCalls: Array<{ column: string; value: unknown }> = [];

  constructor(private readonly rows: FakeOutboxRow[]) {}

  eq(column: string, value: unknown) {
    this.eqCalls.push({ column, value });
    this.filters.push((row) => row[column as keyof FakeOutboxRow] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column as keyof FakeOutboxRow]));
    return this;
  }

  lt(column: string, value: unknown) {
    this.ltCalls.push({ column, value });
    this.filters.push((row) => String(row[column as keyof FakeOutboxRow]) < String(value));
    return this;
  }

  order(_column: string, _options: { ascending: boolean }) {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  then<TResult1 = { data: FakeOutboxRow[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeOutboxRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.rows.filter((row) => this.filters.every((filter) => filter(row))).slice(0, this.limitCount),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

class FakeUpdateQuery implements PromiseLike<{ data: FakeOutboxRow | null; error: { message: string } | null }> {
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
    TResult1 = { data: FakeOutboxRow | null; error: { message: string } | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
          value: { data: FakeOutboxRow | null; error: { message: string } | null },
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.db.failUpdates) {
      return Promise.resolve({ data: null, error: { message: 'write failed' } }).then(
        onfulfilled,
        onrejected,
      );
    }

    const row = this.db.rows.find(
      (candidate) =>
        candidate.id === this.id &&
        (this.requiredStatus === null || candidate.status === this.requiredStatus),
    );

    if (!row) {
      return Promise.resolve({ data: null, error: { message: 'not found' } }).then(
        onfulfilled,
        onrejected,
      );
    }

    Object.assign(row, this.values);
    this.db.updates.push({ id: row.id, values: this.values });
    return Promise.resolve({ data: row, error: null }).then(onfulfilled, onrejected);
  }
}

const NOW = new Date('2026-05-14T12:00:00.000Z');

test('dry-run mode prints candidate rows without DB mutations', async () => {
  const db = new FakeReplayDatabase([
    makeRow('outbox-1', { updated_at: '2026-05-14T10:00:00.000Z' }),
  ]);

  const result = await replayFailedDeliveries(db, replayOptions({ dryRun: true }), NOW);

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'outbox-1');
  assert.deepEqual(db.updates, []);
});

test('production cap enforcement rejects more than 50 candidate rows before writes', async () => {
  const rows = Array.from({ length: 51 }, (_unused, index) =>
    makeRow(`outbox-${index}`, { updated_at: '2026-05-14T10:00:00.000Z' }),
  );
  const db = new FakeReplayDatabase(rows);

  await assert.rejects(
    replayFailedDeliveries(db, replayOptions({ limit: 50 }), NOW),
    /Refusing to process more than 50 rows/,
  );
  assert.deepEqual(db.updates, []);
});

test('min-age-hours filters rows by updated_at cutoff', async () => {
  const db = new FakeReplayDatabase([
    makeRow('old', { updated_at: '2026-05-14T09:59:59.000Z' }),
    makeRow('new', { updated_at: '2026-05-14T10:30:00.000Z' }),
  ]);

  const result = await replayFailedDeliveries(
    db,
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

  const result = await replayFailedDeliveries(db, replayOptions(), NOW);

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

test('DB write failures are reported for non-zero CLI exit handling', async () => {
  const db = new FakeReplayDatabase([
    makeRow('outbox-1', { updated_at: '2026-05-14T10:00:00.000Z' }),
  ]);
  db.failUpdates = true;

  const result = await replayFailedDeliveries(db, replayOptions(), NOW);

  assert.ok(!Array.isArray(result));
  assert.equal(result.replayed, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.errors, ['Failed to replay outbox outbox-1: write failed']);
});

test('parseReplayArgs enforces max limit', () => {
  assert.throws(() => parseReplayArgs(['--limit', '51']), /--limit must be 50 or less/);
});

function replayOptions(overrides: Partial<ReplayOptions> = {}): ReplayOptions {
  return {
    limit: 10,
    dryRun: false,
    minAgeHours: 1,
    target: 'discord:canary',
    ...overrides,
  };
}

function makeRow(id: string, overrides: Partial<FakeOutboxRow> = {}): FakeOutboxRow {
  return {
    id,
    target: 'discord:canary',
    status: 'failed',
    attempt_count: 0,
    last_error: 'failed',
    updated_at: '2026-05-14T10:00:00.000Z',
    ...overrides,
  };
}