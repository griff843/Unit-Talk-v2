import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOptions,
  type RollbackDbClient,
  runRollbackValidate,
  type RollbackValidateOptions,
} from './rollback-validate.js';

interface FakeTable {
  count?: number | undefined;
  error?: string | undefined;
  rows?: Record<string, unknown>[] | undefined;
}

class FakeQueryBuilder implements PromiseLike<{
  data: Record<string, unknown>[] | null;
  count?: number | null;
  error: { message: string } | null;
}> {
  private inFilter: { column: string; values: Set<string> } | null = null;
  private notNullColumn: string | null = null;
  private rangeStart = 0;
  private rangeEnd = Number.POSITIVE_INFINITY;

  constructor(
    private readonly table: FakeTable | undefined,
    private readonly columns: string,
    private readonly head: boolean,
  ) {}

  in(column: string, values: readonly string[]): FakeQueryBuilder {
    this.inFilter = { column, values: new Set(values) };
    return this;
  }

  not(column: string, operator: string, value: unknown): FakeQueryBuilder {
    assert.equal(operator, 'is');
    assert.equal(value, null);
    this.notNullColumn = column;
    return this;
  }

  range(from: number, to: number): FakeQueryBuilder {
    this.rangeStart = from;
    this.rangeEnd = to;
    return this;
  }

  then<TResult1 = {
    data: Record<string, unknown>[] | null;
    count?: number | null;
    error: { message: string } | null;
  }, TResult2 = never>(
    onfulfilled?: ((value: {
      data: Record<string, unknown>[] | null;
      count?: number | null;
      error: { message: string } | null;
    }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  private resolve(): {
    data: Record<string, unknown>[] | null;
    count?: number | null;
    error: { message: string } | null;
  } {
    if (!this.table) {
      return { data: null, count: null, error: { message: 'relation does not exist' } };
    }
    if (this.table.error) {
      return { data: null, count: null, error: { message: this.table.error } };
    }
    if (this.head) {
      return { data: null, count: this.table.count ?? this.table.rows?.length ?? 0, error: null };
    }

    const selectedColumns = this.columns.split(',').map((column) => column.trim());
    let rows = [...(this.table.rows ?? [])];
    if (this.notNullColumn) {
      rows = rows.filter((row) => row[this.notNullColumn as string] !== null && row[this.notNullColumn as string] !== undefined);
    }
    if (this.inFilter) {
      rows = rows.filter((row) => {
        const value = row[this.inFilter?.column ?? ''];
        return typeof value === 'string' && this.inFilter?.values.has(value);
      });
    }
    rows = rows.slice(this.rangeStart, this.rangeEnd + 1);

    return {
      data: rows.map((row) => Object.fromEntries(selectedColumns.map((column) => [column, row[column]]))),
      error: null,
    };
  }
}

class FakeDbClient implements RollbackDbClient {
  readonly tables: Record<string, FakeTable>;
  queryCount = 0;

  constructor(tables: Record<string, FakeTable>) {
    this.tables = tables;
  }

  from(table: string) {
    this.queryCount += 1;
    return {
      select: (columns: string, options?: { count?: 'exact'; head?: boolean }) =>
        new FakeQueryBuilder(this.tables[table], columns, options?.head === true),
    };
  }
}

function baseOptions(overrides: Partial<RollbackValidateOptions> = {}): RollbackValidateOptions {
  return {
    tables: ['picks', 'audit_log'],
    minRows: new Map(),
    checkFk: false,
    dryRun: false,
    allowProdRollbackValidate: false,
    ...overrides,
  };
}

test('buildOptions parses required tables, min rows, and optional flags', () => {
  const options = buildOptions([
    '--tables=picks,audit_log',
    '--min-rows=picks:100,audit_log:1',
    '--check-fk',
    '--dry-run',
  ], {});

  assert.deepEqual(options.tables, ['picks', 'audit_log']);
  assert.equal(options.minRows.get('picks'), 100);
  assert.equal(options.minRows.get('audit_log'), 1);
  assert.equal(options.checkFk, true);
  assert.equal(options.dryRun, true);
});

test('runRollbackValidate passes when required tables exist and row counts meet bounds', async () => {
  const client = new FakeDbClient({
    picks: { count: 150 },
    audit_log: { count: 20 },
  });

  const { exitCode, result } = await runRollbackValidate(
    baseOptions({ minRows: new Map([['picks', 100]]) }),
    () => client,
  );

  assert.equal(exitCode, 0);
  assert.equal(result.passed, true);
  assert.equal(result.failed, false);
  assert.deepEqual(result.tables_checked, ['picks', 'audit_log']);
  assert.deepEqual(result.errors, []);
});

test('runRollbackValidate detects missing required tables', async () => {
  const client = new FakeDbClient({
    picks: { count: 150 },
  });

  const { exitCode, result } = await runRollbackValidate(baseOptions(), () => client);

  assert.equal(exitCode, 1);
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /audit_log/);
  assert.match(result.errors.join('\n'), /missing or unreadable/);
});

test('runRollbackValidate fails when a table is below its minimum row count', async () => {
  const client = new FakeDbClient({
    picks: { count: 99 },
    audit_log: { count: 20 },
  });

  const { exitCode, result } = await runRollbackValidate(
    baseOptions({ minRows: new Map([['picks', 100]]) }),
    () => client,
  );

  assert.equal(exitCode, 1);
  assert.match(result.errors.join('\n'), /expected at least 100, found 99/);
});

test('runRollbackValidate dry-run does not create a database client', async () => {
  let createdClient = false;

  const { exitCode, result } = await runRollbackValidate(
    baseOptions({ dryRun: true, minRows: new Map([['picks', 100]]) }),
    () => {
      createdClient = true;
      return new FakeDbClient({});
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(result.passed, true);
  assert.equal(createdClient, false);
});

test('runRollbackValidate production guard rejects the production project ref', async () => {
  let createdClient = false;

  const { exitCode, result } = await runRollbackValidate(
    baseOptions({
      supabaseDbUrl: 'postgresql://postgres:secret@db.zfzdnfwdarxucxtaojxm.supabase.co:5432/postgres',
    }),
    () => {
      createdClient = true;
      return new FakeDbClient({});
    },
  );

  assert.equal(exitCode, 1);
  assert.equal(createdClient, false);
  assert.match(result.errors.join('\n'), /production Supabase project/);
});

test('runRollbackValidate check-fk detects orphaned references for configured checks', async () => {
  const client = new FakeDbClient({
    picks: {
      count: 2,
      rows: [{ id: 'pick-1' }],
    },
    pick_lifecycle: {
      count: 2,
      rows: [{ pick_id: 'pick-1' }, { pick_id: 'missing-pick' }],
    },
  });

  const { exitCode, result } = await runRollbackValidate(
    baseOptions({ tables: ['pick_lifecycle'], checkFk: true }),
    () => client,
  );

  assert.equal(exitCode, 1);
  assert.match(result.errors.join('\n'), /Orphaned FK references/);
  assert.match(result.errors.join('\n'), /pick_lifecycle\.pick_id/);
});
