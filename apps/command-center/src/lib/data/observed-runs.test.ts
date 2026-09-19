import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchObservedRuns } from './snapshot';

/**
 * These tests pin the behaviour of the per-`run_type` fan-out that replaced the
 * global `system_runs` reads in `snapshot.ts`, `pipeline-health.ts` and
 * `intelligence.ts`.
 *
 * The defect they exist to prevent is not a crash. `select * from system_runs
 * order by started_at desc limit N` is a perfectly valid query that returns N
 * rows and no error. It is wrong because 97.5% of that table -- 3,429,120 of
 * 3,516,347 rows measured in production on 2026-09-18 -- is `worker.heartbeat`,
 * written every ~6 seconds since 2026-04-21 with no retention. Every one of
 * those N rows is therefore a heartbeat, and each consumer's
 * "latest distribution run", "latest ingestor run", "failed runs" and provider
 * quota summary is structurally empty while looking like a successful read.
 *
 * A test that asserts only "rows came back" cannot tell those two states apart,
 * so each case below asserts on a run type that the global ordering would have
 * buried.
 */

type Row = {
  run_type: string;
  started_at: string;
  created_at: string;
  status: string;
};

interface FakeCall {
  runType: string | null;
  since: string | null;
  limit: number | null;
  orderedBy: string | null;
  orderAscending: boolean | null;
}

/**
 * A minimal stand-in for the PostgREST builder, recording what was asked for.
 *
 * It applies `eq`/`gte`/`order`/`limit` to the seeded rows the way PostgREST
 * would, so a caller that forgot to filter by `run_type` fails here for the
 * same reason it fails against Postgres: it gets heartbeats.
 */
function createFakeClient(rows: Row[]) {
  const calls: FakeCall[] = [];

  const builder = (table: string) => {
    assert.equal(table, 'system_runs', 'fetchObservedRuns must only read system_runs');
    const call: FakeCall = {
      runType: null,
      since: null,
      limit: null,
      orderedBy: null,
      orderAscending: null,
    };
    calls.push(call);

    const self = {
      select: () => self,
      eq: (column: string, value: string) => {
        assert.equal(column, 'run_type');
        call.runType = value;
        return self;
      },
      gte: (column: string, value: string) => {
        assert.equal(column, 'created_at');
        call.since = value;
        return self;
      },
      order: (column: string, opts: { ascending: boolean }) => {
        call.orderedBy = column;
        call.orderAscending = opts.ascending;
        return self;
      },
      limit: (n: number) => {
        call.limit = n;
        return Promise.resolve({ data: resolve(call), error: null });
      },
    };
    return self;
  };

  const resolve = (call: FakeCall): Row[] => {
    let out = rows.slice();
    if (call.runType !== null) out = out.filter((r) => r.run_type === call.runType);
    if (call.since !== null) out = out.filter((r) => r.created_at >= call.since!);
    out.sort((a, b) =>
      call.orderAscending
        ? a.started_at.localeCompare(b.started_at)
        : b.started_at.localeCompare(a.started_at),
    );
    return call.limit === null ? out : out.slice(0, call.limit);
  };

  return { client: { from: builder }, calls };
}

/**
 * The production shape in miniature: heartbeats dominate by count and are also
 * the most recent rows, so they win a global `order by started_at desc` outright.
 */
function productionShapedRows(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 200; i += 1) {
    rows.push({
      run_type: 'worker.heartbeat',
      started_at: `2026-09-18T12:${String(i % 60).padStart(2, '0')}:00.000Z`,
      created_at: `2026-09-18T12:${String(i % 60).padStart(2, '0')}:00.000Z`,
      status: 'succeeded',
    });
  }
  rows.push(
    {
      run_type: 'distribution.process',
      started_at: '2026-09-18T09:00:00.000Z',
      created_at: '2026-09-18T09:00:00.000Z',
      status: 'succeeded',
    },
    {
      run_type: 'grading.run',
      started_at: '2026-09-18T08:00:00.000Z',
      created_at: '2026-09-18T08:00:00.000Z',
      status: 'failed',
    },
    {
      run_type: 'ingestor.cycle',
      started_at: '2026-09-17T23:00:00.000Z',
      created_at: '2026-09-17T23:00:00.000Z',
      status: 'succeeded',
    },
  );
  return rows;
}

test('surfaces run types that a global ordering buries under worker.heartbeat', async () => {
  const { client } = createFakeClient(productionShapedRows());

  const { data, error } = await fetchObservedRuns(client, undefined, 25);

  assert.equal(error, null);
  assert.ok(data);

  const seen = new Set(data.map((row) => (row as unknown as Row).run_type));

  // The three assertions that a global `limit 25` could not satisfy: every one
  // of those 25 rows would be a heartbeat, because heartbeats are both the most
  // numerous rows and the most recent ones.
  assert.ok(seen.has('distribution.process'), 'latest distribution run must be reachable');
  assert.ok(seen.has('ingestor.cycle'), 'latest ingestor run must be reachable');
  assert.ok(seen.has('grading.run'), 'failed grading runs must be reachable');

  // Heartbeats are still read -- they are what proves the worker is alive --
  // but they are now bounded to their own share rather than consuming the budget.
  assert.equal(data.filter((row) => (row as unknown as Row).run_type === 'worker.heartbeat').length, 25);
});

test('issues one run_type-filtered query per observed type, each with its own limit', async () => {
  const { client, calls } = createFakeClient(productionShapedRows());

  await fetchObservedRuns(client, undefined, 25);

  assert.ok(calls.length > 1, 'a single unfiltered query is the defect, not the fix');
  for (const call of calls) {
    assert.ok(call.runType, 'every query must pin a run_type, or it seq-scans the whole table');
    assert.equal(call.limit, 25);
    // `started_at`, matching the leading-column order of
    // system_runs_run_type_started_at_idx. Ordering by an unindexed column here
    // would restore the sequential scan this change exists to remove.
    assert.equal(call.orderedBy, 'started_at');
    assert.equal(call.orderAscending, false);
  }

  const runTypes = calls.map((c) => c.runType);
  assert.equal(new Set(runTypes).size, runTypes.length, 'no run_type is queried twice');
});

test('merges every type into one descending started_at ordering', async () => {
  const { client } = createFakeClient(productionShapedRows());

  const { data } = await fetchObservedRuns(client, undefined, 5);
  assert.ok(data);

  const startedAt = data.map((row) => String((row as unknown as Row).started_at));
  const sorted = startedAt.slice().sort((a, b) => b.localeCompare(a));
  assert.deepEqual(startedAt, sorted, 'callers read [0] as "the latest run"');
});

test('applies `since` to created_at only when one is given', async () => {
  const rows = productionShapedRows();

  const withoutSince = createFakeClient(rows);
  await fetchObservedRuns(withoutSince.client, undefined, 25);
  assert.ok(withoutSince.calls.every((c) => c.since === null));

  const withSince = createFakeClient(rows);
  const { data } = await fetchObservedRuns(withSince.client, '2026-09-18T00:00:00.000Z', 25);
  assert.ok(withSince.calls.every((c) => c.since === '2026-09-18T00:00:00.000Z'));
  assert.ok(data);
  assert.ok(
    !data.some((row) => (row as unknown as Row).run_type === 'ingestor.cycle'),
    'the 2026-09-17 ingestor row is outside the window and must be excluded',
  );
});

test('fails closed: one failing sub-query returns an error, never a partial read', async () => {
  const failure = { message: 'canceling statement due to statement timeout' };
  let queries = 0;

  const client = {
    from: () => {
      const index = queries;
      queries += 1;
      const self = {
        select: () => self,
        eq: () => self,
        gte: () => self,
        order: () => self,
        // Fail the third type only. A partial merge would silently drop one
        // run type and read exactly like a healthy system with nothing to show.
        limit: () =>
          Promise.resolve(index === 2 ? { data: null, error: failure } : { data: [], error: null }),
      };
      return self;
    },
  };

  const { data, error } = await fetchObservedRuns(client, undefined, 25);

  assert.equal(data, null);
  assert.equal(error, failure);
});
