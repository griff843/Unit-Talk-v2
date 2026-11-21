import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DatabasePickRepository,
  DatabaseSettlementRepository,
  DatabaseOutboxRepository,
  InMemoryPickRepository,
  InMemorySettlementRepository,
  InMemoryOutboxRepository,
  POSTGREST_MAX_ROWS,
  readAllOrderedPages,
  applyOrderedPageCursor,
} from './runtime-repositories.js';

// Exercise the actual readers with a PostgREST-cap-emulating query boundary.
// These doubles cannot mutate persistence and never open a database connection.
interface Row {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  pick_id: string;
  corrects_id: string | null;
}
interface Result {
  data: Row[] | null;
  error: { message: string; code?: string; status?: number } | null;
  status?: number;
  count: number | null;
}
interface Request {
  table: string;
  from: number;
  to: number;
  order: Array<[string, boolean]>;
  exact: boolean;
  kind?: 'watermark' | 'data' | 'range-change' | 'beyond' | 'population';
}
interface Options {
  cap?: number;
  mutate?: (result: Result, request: Request) => Result;
}
function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${String(i).padStart(7, '0')}`,
    created_at: new Date(
      Date.UTC(2026, 9, 1, 0, 0, Math.floor(i / 7)),
    ).toISOString(),
    updated_at: '2026-11-03T12:34:56.123456+00:00',
    status: 'settled',
    pick_id: 'pick-public',
    corrects_id: i ? `row-${String(i - 1).padStart(7, '0')}` : null,
  }));
}
function instant(value: string) {
  return BigInt(Date.parse(value)) * 1000n + BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
}
function client(population: Row[], options: Options = {}) {
  const requests: Request[] = [];
  let headRequests = 0;
  const allRequests: Request[] = [];
  return {
    requests, allRequests,
    get headRequests() { return headRequests; },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const ordering: Array<[string, boolean]> = [];
      let exact = false;
      let head = false;
      let columns = '*';
      let changedRange = false;
      let cursor: { timestamp: string; id: string; ascending: boolean } | undefined;
      const query = {
        select(_columns?: string, config?: { count?: string; head?: boolean }) {
          columns = _columns ?? '*';
          exact = config?.count === 'exact';
          head = config?.head ?? false;
          return query;
        },
        in(column: keyof Row, values: readonly string[]) {
          filters.push((row) => values.includes(String(row[column])));
          return query;
        },
        eq(column: keyof Row, value: string) {
          filters.push((row) => row[column] === value);
          return query;
        },
        order(column: string, config: { ascending: boolean }) {
          ordering.push([column, config.ascending]);
          return query;
        },
        gt(column: keyof Row, value: string) {
          changedRange = true;
          filters.push(row => instant(String(row[column])) > instant(value));
          return query;
        },
        gte(column: keyof Row, value: string) {
          if (column === 'updated_at') { changedRange = true; filters.push(row => instant(row.updated_at) >= instant(value)); }
          return query;
        },
        lte(column: keyof Row, value: string) {
          filters.push(row => cursor !== undefined || instant(String(row[column])) <= instant(value));
          return query;
        },
        limit(value: number) { rangeTo = value - 1; return query; },
        or(expression: string) {
          const match = expression.match(/^created_at\.(gt|lt)\.(.*),and\(created_at\.eq\.(.*),id\.(gt|lt)\.(.*)\)$/);
          assert.ok(match, 'cursor includes timestamp and id tie break');
          assert.equal(match[2], match[3]);
          cursor = { timestamp: match[2]!, id: match[5]!, ascending: match[1] === 'gt' };
          return query;
        },
        range(from: number, to: number) {
          rangeFrom = from;
          rangeTo = to;
          return query;
        },
        then(resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) {
          return execute(rangeFrom, rangeTo).then(resolve, reject);
        },
      };
      let rangeFrom = 0;
      let rangeTo = POSTGREST_MAX_ROWS - 1;
      async function execute(from: number, to: number): Promise<Result> {
          assert.ok(
            to - from + 1 <= POSTGREST_MAX_ROWS,
            'each request respects server cap',
          );
          const selected = population
            .filter((row) => filters.every((filter) => filter(row)))
            .sort((a, b) => {
              for (const [key, ascending] of ordering) {
                const instant = (value: string) => BigInt(Date.parse(value)) * 1000n + BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
                const comparison = key === 'created_at' || key === 'updated_at'
                  ? (instant(a[key]) < instant(b[key]) ? -1 : instant(a[key]) > instant(b[key]) ? 1 : 0)
                  : String(a[key as keyof Row]).localeCompare(String(b[key as keyof Row]));
                if (comparison) return ascending ? comparison : -comparison;
              }
              return 0;
            });
          const skipped = cursor ? selected.filter(row =>
            cursor!.ascending
              ? instant(row.created_at) < instant(cursor!.timestamp) || (instant(row.created_at) === instant(cursor!.timestamp) && row.id <= cursor!.id)
              : instant(row.created_at) > instant(cursor!.timestamp) || (instant(row.created_at) === instant(cursor!.timestamp) && row.id >= cursor!.id)
          ).length : 0;
          if (cursor) {
            assert.equal(from, 0, 'cursor pages never use deep offsets');
            selected.splice(0, skipped);
          }
          const kind = columns === 'updated_at' ? 'watermark' : head
            ? changedRange ? 'range-change' : cursor ? 'beyond' : 'population' : 'data';
          const request: Request = { table, from: head ? kind === 'population' ? -1 : -2 : from + skipped,
            to: head ? -1 : to + skipped, order: [...ordering], exact, kind };
          allRequests.push(request);
          if (head) {
            headRequests++;
            const result: Result = { data: null, error: null, count: selected.length };
            return options.mutate ? options.mutate(result, request) : result;
          }
          if (kind === 'watermark') {
            const result: Result = { data: selected.slice(0, 1), error: null, count: null };
            return options.mutate ? options.mutate(result, request) : result;
          }
          requests.push(request);
          // PostgREST with an exact count refuses a range starting at/after
          // a positive population's EOF (PGRST103/HTTP416). An empty response
          // here would conceal an invalid extra page request by the reader.
          // See https://github.com/PostgREST/postgrest/issues/2824.
          if (exact && selected.length > 0 && from >= selected.length) {
            return {
              data: null,
              error: { message: 'PGRST103: Requested range not satisfiable (416)' },
              count: selected.length,
            };
          }
          const result: Result = {
            data: selected.slice(
              from,
              Math.min(to + 1, from + (options.cap ?? POSTGREST_MAX_ROWS)),
            ).map(row => ({ ...row })),
            error: null,
            count: exact ? selected.length : null,
          };
          return options.mutate ? options.mutate(result, request) : result;
      }
      return query;
    },
  };
}
const readers = [
  {
    name: 'pick lifecycle states',
    table: 'picks',
    ascending: true,
    database(c: ReturnType<typeof client>, limit?: number, offset?: number) {
      const repo = Object.create(DatabasePickRepository.prototype, {
        client: { value: c },
      }) as DatabasePickRepository;
      return repo.listByLifecycleStates(['settled'], limit, offset);
    },
    memory(population: Row[]) {
      const repo = new InMemoryPickRepository();
      Object.defineProperty(repo, 'picks', {
        value: new Map(population.map((row) => [row.id, row])),
      });
      return repo.listByLifecycleStates(['settled']);
    },
  },
  {
    name: 'full settlement correction history',
    table: 'settlement_records',
    ascending: false,
    database(c: ReturnType<typeof client>) {
      const repo = Object.create(DatabaseSettlementRepository.prototype, {
        client: { value: c },
      }) as DatabaseSettlementRepository;
      return repo.listByPick('pick-public');
    },
    memory(population: Row[]) {
      const repo = new InMemorySettlementRepository();
      Object.defineProperty(repo, 'settlements', { value: population });
      return repo.listByPick('pick-public');
    },
  },
  {
    name: 'full outbox history',
    table: 'distribution_outbox',
    ascending: false,
    database(c: ReturnType<typeof client>) {
      const repo = Object.create(DatabaseOutboxRepository.prototype, {
        client: { value: c },
      }) as DatabaseOutboxRepository;
      return repo.listByPickId('pick-public');
    },
    memory(population: Row[]) {
      const repo = new InMemoryOutboxRepository();
      Object.defineProperty(repo, 'entries', { value: population });
      return repo.listByPickId('pick-public');
    },
  },
];
for (const reader of readers) {
  test(`${reader.name}: PostgreSQL timestamp precision and equivalent UTC offsets retain chronological order across pages`, async () => {
    const template = rows(1)[0]!;
    // Hand-authored chronological order: never derive this oracle from either
    // the production comparator or the query double's lexical timestamp sort.
    // IDs deliberately oppose the two microsecond instants, so Date.parse's
    // millisecond truncation plus an ID tie-break cannot pass this proof.
    const chronological = [
      { ...template, id: 'instant-base', created_at: '2026-10-01T00:00:00+00:00' },
      { ...template, id: 'micro-z', created_at: '2026-10-01T00:00:00.000001+00:00' },
      { ...template, id: 'micro-a', created_at: '2026-10-01T00:00:00.000002Z' },
      { ...template, id: 'milli-a', created_at: '2026-10-01T00:00:00.001Z' },
      { ...template, id: 'milli-b', created_at: '2026-10-01T01:00:00.001000+01:00' },
      { ...template, id: 'milli-c', created_at: '2026-09-30T19:00:00.001-05:00' },
    ];
    const fillers = Array.from({ length: POSTGREST_MAX_ROWS - 2 }, (_, index) => ({
      ...template,
      id: `filler-${String(index).padStart(4, '0')}`,
      created_at: reader.ascending
        ? '2026-09-29T00:00:00Z'
        : '2026-10-02T00:00:00Z',
    }));
    const expected = reader.ascending
      ? [...fillers, ...chronological]
      : [...fillers.reverse(), ...chronological.reverse()];
    // Reverse insertion order also makes the InMemory assertion discriminating.
    const population = [...expected].reverse();
    const c = client(population, {
      mutate: (result, request) => ({
        ...result,
        data: expected.slice(request.from, request.to + 1),
      }),
    });
    const expectedIds = expected.map((row) => row.id);
    assert.deepEqual((await reader.database(c)).map((row) => row.id), expectedIds);
    assert.deepEqual((await reader.memory(population)).map((row) => row.id), expectedIds);
    assert.deepEqual(c.requests.map((request) => request.from), reader === readers[0] ? [0, 0, POSTGREST_MAX_ROWS] : [0, POSTGREST_MAX_ROWS]);

    // A strict chronological guard must still reject reversed microseconds,
    // even though both instants collapse to the same Date.parse millisecond
    // and their deliberately chosen IDs would otherwise look correctly sorted.
    const reversedMicros = [...expected];
    const first = reversedMicros.findIndex((row) => row.id === 'micro-z');
    const second = reversedMicros.findIndex((row) => row.id === 'micro-a');
    [reversedMicros[first], reversedMicros[second]] = [
      reversedMicros[second]!, reversedMicros[first]!,
    ];
    await assert.rejects(reader.database(client(population, {
      mutate: (result, request) => ({
        ...result,
        data: reversedMicros.slice(request.from, request.to + 1),
      }),
    })), /non-progressing|inconsistent page order|population count changed|truncated/);
  });
}
for (const reader of readers) {
  for (const count of [0, 1, 999, 1000, 1001, 2000, 2501]) {
    test(`${reader.name}: complete ${count} rows with equal timestamp boundaries and Database/InMemory parity`, async () => {
      const population = rows(count).reverse();
      population.push({
        ...rows(1)[0]!,
        id: 'other-pick',
        status: 'queued',
        pick_id: 'other-pick',
      });
      const c = client(population);
      const result = await reader.database(c);
      assert.equal(result.length, count);
      assert.equal(new Set(result.map((row) => row.id)).size, count);
      assert.deepEqual(
        result.map((row) => row.id),
        (await reader.memory(population)).map((row) => row.id),
      );
      assert.ok(
        c.requests.every(
          (request) => request.table === reader.table && (reader.name === 'pick lifecycle states' ? request.exact === (request.from === 0) : request.exact),
        ),
      );
      assert.ok(
        c.requests.every(
          (request) =>
            JSON.stringify(request.order) ===
            JSON.stringify([
              ['created_at', reader.ascending],
              ['id', reader.ascending],
            ]),
        ),
      );
      if (count > POSTGREST_MAX_ROWS)
        assert.ok(
          c.requests.length >= 2,
          'must read more than first capped response',
        );
      if (reader.table === 'settlement_records' && count) {
        assert.ok(
          result.some((row) => row.id === 'row-0000000'),
          'oldest correction root is retained',
        );
      }
    });
  }
  const badCases: Array<[string, NonNullable<Options['mutate']>]> = [
    [
      'first query error',
      (result) => ({ ...result, error: { message: 'query unavailable' } }),
    ],
    [
      'later query error',
      (result, req) =>
        req.from >= 1000
          ? { ...result, error: { message: 'second page unavailable' } }
          : result,
    ],
    ['missing exact count', (result) => ({ ...result, count: null })],
    ['fractional exact count', (result) => ({ ...result, count: 1.5 })],
    ['negative exact count', (result) => ({ ...result, count: -1 })],
    [
      'nonfinite exact count',
      (result) => ({ ...result, count: Number.POSITIVE_INFINITY }),
    ],
    ['missing data', (result) => ({ ...result, data: null })],
    [
      'short first page',
      (result) => ({ ...result, data: result.data!.slice(0, 500) }),
    ],
    [
      'empty later page',
      (result, req) => (req.from >= 1000 ? { ...result, data: [] } : result),
    ],
    [
      'changed population count',
      (result, req) =>
        (reader.name === 'pick lifecycle states' ? req.from === -1 : req.from >= 1000) ? { ...result, count: result.count! + 1 } : result,
    ],
    [
      'duplicate identity',
      (result) => ({
        ...result,
        data: [result.data![0]!, ...result.data!.slice(0, -1)],
      }),
    ],
    [
      'reversed order',
      (result) => ({ ...result, data: [...result.data!].reverse() }),
    ],
    [
      'invalid ordering timestamp',
      (result) => ({
        ...result,
        data: result.data!.map((row, i) =>
          i ? row : { ...row, created_at: 'unknown' },
        ),
      }),
    ],
    [
      'invalid row identity',
      (result) => ({
        ...result,
        data: result.data!.map((row, i) => (i ? row : { ...row, id: '' })),
      }),
    ],
    [
      'wrong filter row',
      (result) => ({
        ...result,
        data: result.data!.map((row, i) =>
          i ? row : { ...row, pick_id: 'private-other', status: 'queued' },
        ),
      }),
    ],
    ['100001 safety budget', (result) => ({ ...result, count: 100001 })],
  ];
  for (const [reason, mutate] of badCases) {
    test(`${reader.name}: ${reason} rejects instead of partial success`, async () => {
      await assert.rejects(
        reader.database(client(rows(2501), { mutate })),
        /Failed to/,
      );
    });
  }
  test(`${reader.name}: lower server cap fails rather than treating a short page as end`, async () => {
    await assert.rejects(
      reader.database(client(rows(2501), { cap: 500 })),
      /truncated/,
    );
  });
  test(`${reader.name}: repeated/overlapping next page fails`, async () => {
    let firstPage: Row[] | null = null;
    const c = client(rows(2501), {
      mutate(result, request) {
        if (request.from === 0) firstPage = result.data;
        else if (request.from === 1000) return { ...result, data: firstPage };
        return result;
      },
    });
    await assert.rejects(
      reader.database(c),
      /duplicate|overlap|non-progressing/,
    );
  });
  test(`${reader.name}: oversize page fails`, async () => {
    await assert.rejects(
      reader.database(
        client(rows(2501), {
          mutate: (result) => ({
            ...result,
            data: [...result.data!, result.data![0]!],
          }),
        }),
      ),
      /truncated/,
    );
  });
  test(`${reader.name}: exact count beyond fetched rows fails`, async () => {
    await assert.rejects(
      reader.database(
        client(rows(2501), {
          mutate: (result, request) => ({ ...result, count: 2600 - Math.max(0, request.from) }),
        }),
      ),
      /truncated|population membership changed/,
    );
  });
}

test('pick bounded limit/offset reads retain explicit slicing even across server pages', async () => {
  const population = rows(2501).reverse();
  const sorted = [...population].reverse();
  for (const [limit, offset] of [
    [0, 0],
    [3, 7],
    [1000, 0],
    [1500, 7],
    [1000, 1000],
  ] as const) {
    const c = client(population);
    assert.deepEqual(
      (await readers[0]!.database(c, limit, offset)).map((row) => row.id),
      sorted.slice(offset, offset + limit).map((row) => row.id),
    );
    if (limit === 0) assert.equal(c.requests.length, 0);
  }
  assert.deepEqual(
    (await readers[0]!.database(client(population), undefined, 1000)).map(
      (row) => row.id,
    ),
    sorted.slice(1000).map((row) => row.id),
  );
});
test('pick bounded 300-row request still works when total population exceeds full-read budget', async () => {
  const c = client(rows(1000), {
    mutate: (result) => ({ ...result, count: 100001 }),
  });
  assert.equal((await readers[0]!.database(c, 300)).length, 300);
});
test('pick limit/offset validation rejects negative, fractional and unsafe values for both implementations', async () => {
  const repo = new InMemoryPickRepository();
  for (const invalid of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    await assert.rejects(
      readers[0]!.database(client(rows(2)), invalid),
      /safe integer/,
    );
    await assert.rejects(
      readers[0]!.database(client(rows(2)), 1, invalid),
      /safe integer/,
    );
    await assert.rejects(
      repo.listByLifecycleStates(['settled'], invalid),
      /safe integer/,
    );
    await assert.rejects(
      repo.listByLifecycleStates(['settled'], 1, invalid),
      /safe integer/,
    );
  }
});

for (const reader of readers) {
  for (const count of [0, 1, 1000, 2000]) {
    test(`${reader.name}: count-aware completion never requests positive EOF (${count} rows)`, async () => {
      const c = client(rows(count));
      const result = await reader.database(c);
      assert.equal(result.length, count);
      assert.equal(c.requests.length, Math.max(1, Math.ceil(count / POSTGREST_MAX_ROWS)) + (reader === readers[0] && count > POSTGREST_MAX_ROWS ? 1 : 0));
      if (count > 0) assert.ok(c.requests.every(request => request.from < count));
    });
  }
  test(`${reader.name}: unrelated PGRST103 error remains a failure`, async () => {
    await assert.rejects(reader.database(client(rows(1000), {
      mutate: result => ({ ...result, data: null, error: { message: 'PGRST103: unexpected 416' } }),
    })), /PGRST103/);
  });
}
test('pick explicit EOF or beyond-EOF offset propagates PostgREST416, never an invented successful empty page', async () => {
  for (const offset of [1000, 5000]) {
    const c = client(rows(1000));
    await assert.rejects(readers[0]!.database(c, 200, offset), /PGRST103/);
    assert.equal(c.requests.length, 1);
  }
});


test('keyset cursor preserves exact timestamp text across a duplicate timestamp boundary', async () => {
  const population = rows(5).map(row => ({ ...row, created_at: '2026-11-03T12:34:56.123456+00:00' }));
  const cursors: unknown[] = [];
  const result = await readAllOrderedPages<Row>(async (_from, to, cursor) => {
    assert.ok(cursors.length < 3, 'cursor must progress');
    cursors.push(cursor);
    const remaining = cursor ? population.filter(row => row.created_at > cursor.created_at || (row.created_at === cursor.created_at && row.id > cursor.id)) : population;
    return { data: remaining.slice(0, to - _from + 1), error: null };
  }, 2);
  assert.deepEqual(result, population);
  assert.deepEqual(cursors, [undefined, population[1], population[3]]);
});

for (const always of [false, true]) {
  test(`population drift ${always ? 'fails after three attempts' : 'restarts with one coherent population'}`, async () => {
    let attempts = 0;
    let drifted = false;
    const population = rows(2001);
    const c = client(population, {
      mutate(result, request) {
        if (request.from === 0 && request.kind === 'data') attempts++;
        if (request.from === -1 && (always || !drifted)) {
          drifted = true;
          // Remove a row BEHIND the cursor, so remaining-count arithmetic
          // alone cannot detect the changed full population.
          population.shift();
          return { ...result, count: population.length };
        }
        return result;
      },
    });
    if (always) await assert.rejects(readers[0]!.database(c), /population count changed while paging/);
    else assert.deepEqual((await readers[0]!.database(c)).map(row => row.id), population.map(row => row.id));
    assert.equal(attempts, always ? 4 : 3);
  });
}

// Use the installed SDK's real URL encoding, with an HTTP boundary only.
// This checks every cursor producer, including both promotion query branches.
for (const kind of ['states', 'track-only', 'promoted', 'settlements', 'outbox'] as const) {
  test(`${kind}: real SDK cursor encodes UTC plus and retains microseconds and id`, async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const population = rows(1001).map(row => ({
      ...row, created_at: '2026-11-03T12:34:56.123456+00:00',
      promotion_status: 'promoted', promotion_target: 'test-only',
      metadata: { distributionMode: 'track-only' },
    }));
    const descending = kind === 'settlements' || kind === 'outbox';
    if (descending) population.reverse();
    let cursorRequests = 0;
    const sdk = createClient('https://example.supabase.co', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        if (url.searchParams.get('select') === 'updated_at') return new Response(JSON.stringify([{ updated_at: '2026-11-03T12:34:56.123456+00:00' }]), { headers: { 'content-type': 'application/json' } });
        if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-range': `*/${url.searchParams.has('updated_at') || url.searchParams.has('or') ? 0 : population.length}` } });
        let page = population.slice(Number(url.searchParams.get('offset') ?? 0));
        const cursor = url.searchParams.get('or');
        if (cursor) {
          cursorRequests++;
          const op = descending ? 'lt' : 'gt';
          const last = population[999]!;
          assert.equal(url.searchParams.get('created_at'), `${descending ? 'lte' : 'gte'}.${last.created_at}`);
          if (kind === 'states') assert.ok(!headers.get('prefer')?.includes('count=exact'), 'cursor pages omit exact remainder count');
          assert.equal(cursor, `(created_at.${op}.${last.created_at},and(created_at.eq.${last.created_at},id.${op}.${last.id}))`);
          assert.ok(url.search.includes('%2B00%3A00'), 'URL encodes plus, exactly once');
          assert.ok(!url.search.includes('%252B'), 'no double encoding');
          assert.equal(url.searchParams.get('offset') ?? '0', '0');
          page = population.slice(1000);
        }
        const count = cursor ? page.length : population.length;
        const limit = Number(url.searchParams.get('limit') ?? 1000);
        const wantsCount = headers.get('prefer')?.includes('count=exact');
        return new Response(JSON.stringify(page.slice(0, limit)), {
          headers: { 'content-type': 'application/json', ...(wantsCount ? { 'content-range': `0-${Math.min(limit, count) - 1}/${count}` } : {}) },
        });
      } },
    });
    const repository = <T>(prototype: object): T => Object.create(prototype, { client: { value: sdk } }) as T;
    let result;
    if (kind === 'states') result = await repository<DatabasePickRepository>(DatabasePickRepository.prototype).listByLifecycleStates(['settled']);
    else if (kind === 'track-only') result = await repository<DatabasePickRepository>(DatabasePickRepository.prototype).listTrackOnlyByLifecycleState('settled');
    else if (kind === 'promoted') result = await repository<DatabasePickRepository>(DatabasePickRepository.prototype).listPromotedByLifecycleStates(['settled'], ['promoted']);
    else if (kind === 'settlements') result = await repository<DatabaseSettlementRepository>(DatabaseSettlementRepository.prototype).listByPick('pick-public');
    else result = await repository<DatabaseOutboxRepository>(DatabaseOutboxRepository.prototype).listByPickId('pick-public');
    assert.deepEqual(result.map(row => row.id), population.map(row => row.id));
    assert.equal(cursorRequests, kind === 'promoted' ? 2 : 1);
  });
}

for (const ascending of [true, false]) {
  test(`cursor helper emits index bound and tuple predicate: ascending=${ascending}`, () => {
    const calls: unknown[] = [];
    const query = {
      gte(column: string, value: string) { calls.push(['gte', column, value]); return query; },
      lte(column: string, value: string) { calls.push(['lte', column, value]); return query; },
      or(filter: string) { calls.push(['or', filter]); return query; },
    };
    const timestamp = '2026-11-03T12:34:56.123456+00:00';
    applyOrderedPageCursor(query, { created_at: timestamp, id: 'boundary-id' }, ascending);
    const op = ascending ? 'gt' : 'lt';
    assert.deepEqual(calls, [
      [ascending ? 'gte' : 'lte', 'created_at', timestamp],
      ['or', `created_at.${op}.${timestamp},and(created_at.eq.${timestamp},id.${op}.boundary-id)`],
    ]);
  });
}
test('lifecycle read uses exactly one starting count and one ending count per attempt', async () => {
  const c = client(rows(2501));
  await readers[0]!.database(c);
  assert.equal(c.requests.filter(request => request.exact).length, 2);
  assert.equal(c.headRequests, 3);
});

for (const count of [0, 1, 999]) {
  test(`single-page lifecycle read uses one snapshot and no head count (${count} rows)`, async () => {
    const c = client(rows(count));
    assert.equal((await readers[0]!.database(c)).length, count);
    assert.equal(c.requests.length, 1);
    assert.equal(c.requests[0]!.exact, true);
    assert.equal(c.headRequests, 0);
  });
}

test('multi-page lifecycle end-count drift retries three whole reads and fails closed', async () => {
  const c = client(rows(1001), {
    mutate(result, request) {
      return request.from === -1 ? { ...result, count: result.count! + 1 } : result;
    },
  });
  await assert.rejects(readers[0]!.database(c), /population count changed while paging/);
  assert.equal(c.requests.filter(request => request.from === 0).length, 4);
  assert.equal(c.requests.length, 7);
  assert.equal(c.headRequests, 9);
});


// Membership controls use DB-text microseconds for both watermark and last row.
for (const scenario of ['ahead-swap', 'behind-swap', 'delete-insert', 'always'] as const) {
  test(`membership ${scenario}: discards drifted attempt and retries coherently`, async () => {
    const population = rows(3000).map(row => ({
      ...row, created_at: '2026-11-03T12:34:56.123456+00:00',
    }));
    const entrant = { ...population[0]!, id: scenario === 'behind-swap' ? 'older-member' : 'zz-new-member', status: 'validated' };
    if (scenario !== 'delete-insert') population.push(entrant);
    let attempts = 0;
    let dataPages = 0;
    let changed = false;
    const c = client(population, {
      mutate(result, request) {
        if (request.kind === 'watermark') { attempts++; dataPages = 0; }
        if (request.kind === 'data' && attempts > 0) {
          dataPages++;
          if (dataPages === 1 && (!changed || scenario === 'always')) {
            changed = true;
            if (scenario === 'delete-insert') {
              population.splice(population.findIndex(row => row.id === result.data![0]!.id), 1);
              entrant.status = 'settled';
              population.push(entrant);
              // Insert has an old created_at but a fresh updated_at, beyond L by id.
              // Use a later created_at to isolate the beyond-cursor guard.
              entrant.created_at = '2026-11-04T00:00:00.000000+00:00';
              entrant.updated_at = '2026-11-05T00:00:00.000001+00:00';
            } else {
              const departed = population.find(row => row.id === result.data![0]!.id)!;
              departed.status = 'validated';
              departed.updated_at = `2026-11-05T00:00:00.00000${attempts}+00:00`;
              if (scenario === 'behind-swap') { entrant.status = 'settled'; entrant.updated_at = departed.updated_at; }
              // Snapshot objects returned by the data statement do not mutate.
            }
          }
          if (dataPages === 2 && scenario === 'ahead-swap' && attempts === 1) {
            entrant.status = 'settled';
            entrant.updated_at = '2026-11-05T00:00:00.000002+00:00';
          }
        }
        return result;
      },
    });
    // Copy the page snapshot before mutations, like a real PostgREST response.
    // client.execute does this before invoking the mutation callback.
    if (scenario === 'always') {
      await assert.rejects(readers[0]!.database(c), /population membership changed while paging/);
      assert.equal(attempts, 3);
    } else {
      const actual = await readers[0]!.database(c);
      const expected = population.filter(row => row.status === 'settled')
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      assert.deepEqual(actual.map(row => row.id), expected.map(row => row.id));
      assert.equal(attempts, 2);
      assert.ok(!actual.some(row => row.id === 'row-0000000'));
    }
  });
}

test('bounded multi-page read omits beyond-cursor count and succeeds', async () => {
  const c = client(rows(3000));
  const result = await readers[0]!.database(c, 1500);
  assert.deepEqual(result.map(row => row.id), rows(3000).slice(0, 1500).map(row => row.id));
  assert.equal(c.allRequests.filter(request => request.kind === 'beyond').length, 0);
  assert.equal(c.allRequests.filter(request => request.kind === 'watermark').length, 1);
});

test('multi-page probe is discarded before watermark and fresh first count', async () => {
  const population = rows(2001);
  let probe = true;
  const c = client(population, { mutate(result, request) {
    if (probe && request.kind === 'data') {
      probe = false;
      population[0]!.status = 'validated';
      population[0]!.updated_at = '2026-11-05T00:00:00.000001+00:00';
    }
    return result;
  } });
  const result = await readers[0]!.database(c);
  assert.deepEqual(result.map(row => row.id), population.filter(row => row.status === 'settled').map(row => row.id));
  assert.ok(!result.some(row => row.id === 'row-0000000'));
  assert.deepEqual(c.allRequests.map(request => request.kind), [
    'data', 'watermark', 'data', 'data', 'range-change', 'beyond', 'population',
  ]);
  assert.equal(c.allRequests[2]!.exact, true);
});

test('stable microsecond watermark uses strict greater-than and exact DB text', async () => {
  const c = client(rows(2001));
  assert.equal((await readers[0]!.database(c)).length, 2001);
  assert.equal(c.allRequests.filter(request => request.kind === 'watermark').length, 1);
});

for (const kind of ['watermark', 'range-change', 'beyond', 'population'] as const) {
  for (const delivery of ['response', 'throw'] as const) {
    test(`guard ${kind} retries transient 57014 ${delivery} at statement level`, async () => {
      const population = rows(2001);
      let tries = 0;
      const c = client(population, { mutate(result, request) {
        if (request.kind === kind && ++tries === 1) {
          const error = { message: '', code: '57014' };
          if (delivery === 'throw') throw error;
          return { ...result, error, status: 500 };
        }
        return result;
      } });
      const actual = await readers[0]!.database(c);
      assert.deepEqual(actual.map(row => row.id), population.map(row => row.id));
      assert.equal(tries, 2);
      assert.equal(c.allRequests.filter(request => request.kind === 'watermark').length,
        kind === 'watermark' ? 2 : 1, 'count retries must reuse W');
      assert.equal(c.requests.length, 4, 'statement retry must not restart data pages');
    });
  }

  test(`guard ${kind} persistent 57014 fails closed after exactly three tries with code and status`, async () => {
    let tries = 0;
    let returned: unknown;
    const c = client(rows(2001), { mutate(result, request) {
      if (request.kind !== kind) return result;
      tries++;
      // A fourth try succeeds deliberately: an unbounded retry must fail this
      // rejection assertion promptly instead of hanging the test process.
      return tries <= 3 ? { ...result, error: { message: '', code: '57014' }, status: 500 } : result;
    } });
    await assert.rejects(async () => { returned = await readers[0]!.database(c); }, error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /57014/);
      assert.match(error.message, /HTTP 500/);
      assert.match(error.message, /after 3 tries/);
      return true;
    });
    assert.equal(tries, 3);
    assert.equal(returned, undefined, 'no rows from the failed attempt escape');
    assert.equal(c.allRequests.filter(request => request.kind === 'watermark').length,
      kind === 'watermark' ? 3 : 1);
    assert.equal(c.requests.length, kind === 'watermark' ? 1 : 4);
  });
}

test('guard error message remains nonempty when code, status and message are absent', async () => {
  let tries = 0;
  const c = client(rows(2001), { mutate(result, request) {
    if (request.kind === 'range-change' && ++tries <= 3)
      return { ...result, error: { message: '' } };
    return result;
  } });
  await assert.rejects(readers[0]!.database(c), /unknown statement error/);
  assert.equal(tries, 3);
});

test('guard retry retains stale W and detects a change made during the failed statement', async () => {
  const population = rows(2001);
  let tries = 0;
  const c = client(population, { mutate(result, request) {
    if (request.kind === 'range-change' && ++tries === 1) {
      population[0]!.status = 'validated';
      population[0]!.updated_at = '2026-11-05T00:00:00.000001+00:00';
      return { ...result, error: { message: '', code: '57014' }, status: 500 };
    }
    return result;
  } });
  const actual = await readers[0]!.database(c);
  assert.deepEqual(actual.map(row => row.id), population.filter(row => row.status === 'settled').map(row => row.id));
  assert.equal(tries, 3, 'second statement try detects drift; fresh attempt then passes');
  assert.equal(c.allRequests.filter(request => request.kind === 'watermark').length, 2);
  assert.ok(!actual.some(row => row.id === 'row-0000000'), 'drifted attempt rows are discarded');
});
