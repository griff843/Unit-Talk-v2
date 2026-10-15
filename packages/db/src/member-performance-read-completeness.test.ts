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
} from './runtime-repositories.js';

// Exercise the actual readers with a PostgREST-cap-emulating query boundary.
// These doubles cannot mutate persistence and never open a database connection.
interface Row {
  id: string;
  created_at: string;
  status: string;
  pick_id: string;
  corrects_id: string | null;
}
interface Result {
  data: Row[] | null;
  error: { message: string } | null;
  count: number | null;
}
interface Request {
  table: string;
  from: number;
  to: number;
  order: Array<[string, boolean]>;
  exact: boolean;
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
    status: 'settled',
    pick_id: 'pick-public',
    corrects_id: i ? `row-${String(i - 1).padStart(7, '0')}` : null,
  }));
}
function client(population: Row[], options: Options = {}) {
  const requests: Request[] = [];
  return {
    requests,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const ordering: Array<[string, boolean]> = [];
      let exact = false;
      const query = {
        select(_columns?: string, config?: { count?: string }) {
          exact = config?.count === 'exact';
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
        async range(from: number, to: number): Promise<Result> {
          assert.ok(
            to - from + 1 <= POSTGREST_MAX_ROWS,
            'each request respects server cap',
          );
          const selected = population
            .filter((row) => filters.every((filter) => filter(row)))
            .sort((a, b) => {
              for (const [key, ascending] of ordering) {
                const comparison = String(a[key as keyof Row]).localeCompare(
                  String(b[key as keyof Row]),
                );
                if (comparison) return ascending ? comparison : -comparison;
              }
              return 0;
            });
          const request = { table, from, to, order: [...ordering], exact };
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
            ),
            error: null,
            count: exact ? selected.length : null,
          };
          return options.mutate ? options.mutate(result, request) : result;
        },
      };
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
    assert.deepEqual(c.requests.map((request) => request.from), [0, POSTGREST_MAX_ROWS]);

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
    })), /non-progressing|inconsistent page order/);
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
          (request) => request.table === reader.table && request.exact,
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
        req.from >= 1000 ? { ...result, count: result.count! + 1 } : result,
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
          mutate: (result) => ({ ...result, count: 2600 }),
        }),
      ),
      /truncated/,
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
      assert.equal(c.requests.length, Math.max(1, Math.ceil(count / POSTGREST_MAX_ROWS)));
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
