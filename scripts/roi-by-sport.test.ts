import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProfitUnits,
  computeRoiPercent,
  fetchRoiRows,
  printReport,
  summarizeStakeIntegrity,
  type RoiBySportRow,
} from './roi-by-sport.js';
import {
  fetchChainRows,
  formatUnresolvedSummary,
  loadEffectiveSettlements,
  PICK_ID_CHUNK_SIZE,
  resolveChain,
  type ChainRow,
  type ReadClient,
  type ReadQuery,
} from './effective-settlements.js';
import {
  buildClvDashboardReport,
  formatClvDashboardMarkdown,
  loadClvDashboardRows,
} from './clv-dashboard.js';
import { fetchBandRows, summarizeBands } from './band-accuracy.js';
import {
  fetchPeriodSettlements,
  summarizeChampionSettlements,
  toSettlementSampleRows,
} from './portfolio-review.js';
import {
  fetchRecentSettlements,
  summarizeAutoGrade,
  toCoverageRecords,
} from './scoring-provenance.js';

const rows: RoiBySportRow[] = [
  {
    result: 'win',
    sport: 'NBA',
    marketType: 'player_points',
    odds: -110,
    stakeUnits: 2,
    clvStatus: 'computed',
    settledAt: '2026-05-18T00:00:00.000Z',
  },
  {
    result: 'loss',
    sport: 'NBA',
    marketType: 'player_points',
    odds: -105,
    stakeUnits: 1,
    clvStatus: null,
    settledAt: '2026-05-18T00:00:00.000Z',
  },
  {
    result: 'win',
    sport: 'MLB',
    marketType: 'moneyline',
    odds: 120,
    stakeUnits: null,
    clvStatus: null,
    settledAt: '2026-05-18T00:00:00.000Z',
  },
];

test('summarizeStakeIntegrity labels null stake rows separately', () => {
  assert.deepEqual(summarizeStakeIntegrity(rows), {
    canonicalStakeRows: 2,
    historicalUnknownStakeRows: 1,
    totalRows: 3,
  });
});

test('computeProfitUnits uses persisted stake and odds without flat fallback', () => {
  assert.equal(computeProfitUnits(rows[0]!), 1.82);
  assert.equal(computeProfitUnits(rows[1]!), -1);
  assert.equal(computeProfitUnits(rows[2]!), null);
});

test('computeRoiPercent excludes historical unknown stake rows', () => {
  assert.equal(Number(computeRoiPercent(rows)?.toFixed(2)), 27.33);
});

test('printReport emits stake-based ROI and historical unknown stake labels', () => {
  const output = printReport(rows, '2026-05-10', '2026-05-18T04:04:47.263Z');

  assert.match(output, /ROI \(stake-based\)/);
  assert.match(output, /Historical unknown-stake rows \| 1/);
  assert.match(output, /Rows with stake_units IS NULL are labeled historical_unknown/);
  assert.doesNotMatch(output, /flat -110 assumption/i);
});

// ---------------------------------------------------------------------------
// Effective settlements: the shared reader and every script that uses it.
// ---------------------------------------------------------------------------

type FakeRow = Record<string, unknown>;

interface FakeCall {
  table: string;
  inSizes: number[];
  ordered: boolean;
}

/**
 * An in-memory PostgREST stand-in. It serves at most 1000 rows per response
 * whatever the range asks for, and it serves an UNORDERED read in a different
 * order on every call, as Postgres is free to — so paging without ORDER BY
 * duplicates and drops rows here exactly as it can in production.
 */
function createFakeClient(tables: Record<string, FakeRow[]>): { client: ReadClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let seed = 1;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  function query(table: string): ReadQuery {
    const filters: Array<(row: FakeRow) => boolean> = [];
    const orders: Array<{ column: string; ascending: boolean }> = [];
    const inSizes: number[] = [];
    let range: { from: number; to: number } | null = null;

    const builder: ReadQuery = {
      is(column, value) {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      gte(column, value) {
        filters.push((row) => typeof row[column] === 'string' && (row[column] as string) >= value);
        return builder;
      },
      lt(column, value) {
        filters.push((row) => typeof row[column] === 'string' && (row[column] as string) < value);
        return builder;
      },
      in(column, values) {
        const set = new Set(values);
        inSizes.push(values.length);
        filters.push((row) => set.has(row[column] as string));
        return builder;
      },
      order(column, options) {
        orders.push({ column, ascending: options?.ascending ?? true });
        return builder;
      },
      range(from, to) {
        range = { from, to };
        return builder;
      },
      then(onFulfilled, onRejected) {
        calls.push({ table, inSizes, ordered: orders.length > 0 });
        let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (orders.length === 0) {
          rows = rows
            .map((row) => ({ row, key: nextRandom() }))
            .sort((left, right) => left.key - right.key)
            .map(({ row }) => row);
        } else {
          rows = [...rows].sort((left, right) => {
            for (const { column, ascending } of orders) {
              const l = String(left[column] ?? '');
              const r = String(right[column] ?? '');
              if (l !== r) return (l < r ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
        }
        const start = range?.from ?? 0;
        const end = range ? range.to + 1 : rows.length;
        const page = rows.slice(start, end).slice(0, 1000);
        return Promise.resolve({ data: page, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    client: { from: (table: string) => ({ select: () => query(table) }) },
    calls,
  };
}

function rec(overrides: Partial<FakeRow> & { id: string; pick_id: string }): FakeRow {
  return {
    status: 'settled',
    result: 'loss',
    confidence: 'confirmed',
    corrects_id: null,
    settled_at: '2026-05-12T00:00:00.000Z',
    created_at: '2026-05-12T00:00:00.000Z',
    source: 'operator',
    payload: {},
    stake_units: null,
    picks: { id: overrides.pick_id, stake_units: 1, odds: 100, metadata: { sport: 'NBA', band: 'A' } },
    ...overrides,
  };
}

function chainRow(row: FakeRow): ChainRow {
  return {
    id: row['id'] as string,
    pick_id: row['pick_id'] as string,
    status: row['status'] as string,
    result: (row['result'] as string | null) ?? null,
    confidence: row['confidence'] as string,
    corrects_id: (row['corrects_id'] as string | null) ?? null,
    settled_at: row['settled_at'] as string,
    created_at: (row['created_at'] as string | null) ?? null,
    raw: row,
  };
}

/**
 * The shared fixture every script test reads:
 *   p-corrected   root loss (in window) -> correction win (payload carries CLV)
 *   p-plain       root win, no correction
 *   p-partial     root + a correction whose target is absent -> unresolved
 *   p-old-root    root BEFORE the window, correction inside it -> not a candidate
 */
function scriptFixture(): FakeRow[] {
  return [
    rec({ id: 's-c0', pick_id: 'p-corrected', result: 'loss', source: 'auto-sgo', settled_at: '2026-05-12T00:00:00.000Z', created_at: '2026-05-12T00:00:00.000Z', payload: { clvStatus: 'missing' } }),
    rec({
      id: 's-c1',
      pick_id: 'p-corrected',
      result: 'win',
      corrects_id: 's-c0',
      source: 'operator',
      settled_at: '2026-05-14T00:00:00.000Z',
      created_at: '2026-05-14T00:00:00.000Z',
      payload: { clvStatus: 'computed', clvPercent: 2.5, clvRaw: 0.025, beatsClosingLine: true },
    }),
    rec({ id: 's-p0', pick_id: 'p-plain', result: 'win', settled_at: '2026-05-13T00:00:00.000Z', created_at: '2026-05-13T00:00:00.000Z' }),
    rec({ id: 's-x0', pick_id: 'p-partial', result: 'loss', settled_at: '2026-05-13T00:00:00.000Z', created_at: '2026-05-13T00:00:00.000Z' }),
    rec({ id: 's-x2', pick_id: 'p-partial', result: 'win', corrects_id: 's-x1-missing', settled_at: '2026-05-15T00:00:00.000Z', created_at: '2026-05-15T00:00:00.000Z' }),
    rec({ id: 's-o0', pick_id: 'p-old-root', result: 'loss', settled_at: '2026-04-01T00:00:00.000Z', created_at: '2026-04-01T00:00:00.000Z' }),
    rec({ id: 's-o1', pick_id: 'p-old-root', result: 'win', corrects_id: 's-o0', settled_at: '2026-05-20T00:00:00.000Z', created_at: '2026-05-20T00:00:00.000Z' }),
  ];
}

test('resolveChain: a corrected pick resolves to its tip, not its root', () => {
  const resolution = resolveChain([
    chainRow(rec({ id: 'a0', pick_id: 'p', result: 'loss' })),
    chainRow(rec({ id: 'a1', pick_id: 'p', result: 'push', corrects_id: 'a0' })),
    chainRow(rec({ id: 'a2', pick_id: 'p', result: 'win', corrects_id: 'a1' })),
  ]);
  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.row.id, 'a2');
    assert.equal(resolution.row.result, 'win');
    assert.equal(resolution.correctionDepth, 2);
  }
});

test('resolveChain: a lone correction whose target is absent is unresolved', () => {
  // resolveEffectiveSettlement accepts a single record without reading corrects_id.
  const resolution = resolveChain([chainRow(rec({ id: 'b1', pick_id: 'p', result: 'win', corrects_id: 'b0' }))]);
  assert.deepEqual(resolution, { ok: false, reason: 'MISSING_CORRECTION_TARGET' });
});

test('resolveChain: a partial chain (middle link missing) is unresolved, not answered with its root', () => {
  // The walk from root never reaches c2, so the domain resolver alone returns the root.
  const resolution = resolveChain([
    chainRow(rec({ id: 'c0', pick_id: 'p', result: 'loss' })),
    chainRow(rec({ id: 'c2', pick_id: 'p', result: 'win', corrects_id: 'c1' })),
  ]);
  assert.deepEqual(resolution, { ok: false, reason: 'MISSING_CORRECTION_TARGET' });
});

test('resolveChain: a branched chain (depth + 1 != row count) is unresolved', () => {
  const resolution = resolveChain([
    chainRow(rec({ id: 'd0', pick_id: 'p', result: 'loss' })),
    chainRow(rec({ id: 'd1', pick_id: 'p', result: 'win', corrects_id: 'd0' })),
    chainRow(rec({ id: 'd2', pick_id: 'p', result: 'push', corrects_id: 'd0' })),
  ]);
  assert.deepEqual(resolution, { ok: false, reason: 'CHAIN_DEPTH_MISMATCH' });
});

test('resolveChain: an orphan correction loop beside a root is unresolved', () => {
  const resolution = resolveChain([
    chainRow(rec({ id: 'e0', pick_id: 'p', result: 'loss' })),
    chainRow(rec({ id: 'e1', pick_id: 'p', result: 'win', corrects_id: 'e2' })),
    chainRow(rec({ id: 'e2', pick_id: 'p', result: 'win', corrects_id: 'e1' })),
  ]);
  assert.deepEqual(resolution, { ok: false, reason: 'CHAIN_DEPTH_MISMATCH' });
});

test('loadEffectiveSettlements selects by root window and loads the whole chain', async () => {
  const { client } = createFakeClient({ settlement_records: scriptFixture() });
  const load = await loadEffectiveSettlements(client, { dateColumn: 'settled_at', after: '2026-05-10' });
  const byPick = new Map(load.effective.map((row) => [row.pick_id, row]));
  assert.equal(load.candidatePickCount, 3);
  assert.equal(byPick.get('p-corrected')?.result, 'win');
  assert.equal(byPick.get('p-corrected')?.correctionDepth, 1);
  assert.equal(byPick.get('p-plain')?.result, 'win');
  assert.equal(byPick.has('p-old-root'), false, 'a pick is selected by its root, not by a correction');
  assert.deepEqual(load.unresolved, [{ pickId: 'p-partial', reason: 'MISSING_CORRECTION_TARGET', rowCount: 2 }]);
  assert.equal(formatUnresolvedSummary(load.unresolved), '1 (MISSING_CORRECTION_TARGET=1)');
});

test('loadEffectiveSettlements: a chain whose correction falls after the window is still resolved to its tip', async () => {
  const { client } = createFakeClient({
    settlement_records: [
      rec({ id: 'w0', pick_id: 'p-w', result: 'loss', settled_at: '2026-05-12T00:00:00.000Z' }),
      rec({ id: 'w1', pick_id: 'p-w', result: 'win', corrects_id: 'w0', settled_at: '2026-06-30T00:00:00.000Z' }),
    ],
  });
  const load = await loadEffectiveSettlements(client, { dateColumn: 'settled_at', after: '2026-05-10', until: '2026-05-20' });
  assert.equal(load.effective.length, 1);
  assert.equal(load.effective[0]?.result, 'win');
});

test('loadEffectiveSettlements pages past the 1000-row cap with an ordered range', async () => {
  // 1500 candidate roots (two root pages), each with a 5-deep correction chain, so
  // every 200-pick chain chunk is 1200 rows (two chain pages). The fake serves
  // unordered reads unstably, so dropping ORDER BY loses or duplicates rows.
  const rows: FakeRow[] = [];
  for (let pick = 0; pick < 1500; pick += 1) {
    const pickId = `pg-${String(pick).padStart(4, '0')}`;
    const day = String(1 + (pick % 28)).padStart(2, '0');
    for (let depth = 0; depth <= 5; depth += 1) {
      rows.push(
        rec({
          id: `${pickId}-r${depth}`,
          pick_id: pickId,
          result: depth === 5 ? 'win' : 'loss',
          corrects_id: depth === 0 ? null : `${pickId}-r${depth - 1}`,
          settled_at: `2026-05-${day}T00:00:00.000Z`,
          created_at: `2026-05-${day}T00:00:00.000Z`,
        }),
      );
    }
  }
  const { client, calls } = createFakeClient({ settlement_records: rows });
  const load = await loadEffectiveSettlements(client, { dateColumn: 'settled_at', after: '2026-05-01' });
  assert.equal(load.candidatePickCount, 1500);
  assert.equal(new Set(load.effective.map((row) => row.pick_id)).size, 1500);
  assert.deepEqual(load.unresolved, []);
  assert.ok(load.effective.every((row) => row.result === 'win' && row.correctionDepth === 5));
  assert.ok(calls.every((call) => call.ordered), 'every settlement read is ordered');
});

test('fetchChainRows chunks pick ids at 200 per request', async () => {
  const rows = Array.from({ length: 450 }, (_, index) => rec({ id: `k-${index}`, pick_id: `pk-${index}` }));
  const { client, calls } = createFakeClient({ settlement_records: rows });
  const chainRows = await fetchChainRows(client, rows.map((row) => row['pick_id'] as string));
  assert.equal(chainRows.length, 450);
  assert.equal(PICK_ID_CHUNK_SIZE, 200);
  assert.deepEqual(
    calls.flatMap((call) => call.inSizes),
    [200, 200, 50],
  );
});

test('roi-by-sport counts each pick by its effective settlement', async () => {
  const { client } = createFakeClient({ settlement_records: scriptFixture(), pick_promotion_history: [] });
  const { rows: roiRows, unresolved } = await fetchRoiRows(client, '2026-05-10');
  assert.equal(roiRows.length, 2);
  assert.deepEqual(roiRows.map((row) => row.result).sort(), ['win', 'win']);
  assert.ok(roiRows.some((row) => row.clvStatus === 'computed'), 'payload is read from the effective record');
  assert.equal(unresolved.length, 1);
  const output = printReport(roiRows, '2026-05-10', '2026-05-18T00:00:00.000Z', { unresolved });
  assert.match(output, /\| Wins \| 2 /);
  assert.match(output, /\| Losses \| 0 /);
  assert.match(output, /Unresolved correction chains \(excluded\) \| 1 \(MISSING_CORRECTION_TARGET=1\)/);
});

test('clv-dashboard reads result and CLV from the effective settlement', async () => {
  const { client } = createFakeClient({ settlement_records: scriptFixture() });
  const options = { after: '2026-05-10', until: null };
  const { rows: dashRows, unresolved } = await loadClvDashboardRows(client, options);
  const corrected = dashRows.find((row) => row.pickId === 'p-corrected');
  assert.equal(corrected?.result, 'win');
  assert.equal(corrected?.settlementId, 's-c1');
  assert.equal(corrected?.clvPercent, 2.5);
  const report = buildClvDashboardReport(dashRows, options, '2026-05-18T00:00:00.000Z', unresolved);
  assert.equal(report.unresolvedPickCount, 1);
  const overall = report.summaries.find((summary) => summary.segment === 'overall');
  assert.equal(overall?.clvRows, 1);
  assert.equal(overall?.roiPercent, 100);
  assert.match(formatClvDashboardMarkdown(report), /Unresolved correction chains \(excluded\): 1/);
});

test('band-accuracy counts wins and losses from effective results', async () => {
  const { client } = createFakeClient({ settlement_records: scriptFixture() });
  const { rows: bandRows, unresolved } = await fetchBandRows(client, '2026-05-10');
  assert.equal(unresolved.length, 1);
  assert.deepEqual(summarizeBands(bandRows).get('A'), { settled: 2, wins: 2, losses: 0 });
});

test('portfolio-review champion stats use effective results and CLV payloads', async () => {
  const { client } = createFakeClient({ settlement_records: scriptFixture() });
  const load = await fetchPeriodSettlements(client, '2026-05-10T00:00:00.000Z');
  assert.equal(load.unresolved.length, 1);
  const stats = summarizeChampionSettlements(toSettlementSampleRows(load));
  assert.equal(stats.wins, 2);
  assert.equal(stats.losses, 0);
  assert.equal(stats.winRate, 100);
  assert.equal(stats.withCLV.length, 1);
  assert.equal(stats.clvBeatRate, 100);
});

test('scoring-provenance coverage reads source and payload from the effective settlement', async () => {
  const { client } = createFakeClient({ settlement_records: scriptFixture() });
  const load = await fetchRecentSettlements(client);
  // No window: every pick with a root is a candidate, including p-old-root.
  assert.equal(load.candidatePickCount, 4);
  assert.equal(load.unresolved.length, 1);
  const recs = toCoverageRecords(load);
  const corrected = recs.find((record) => record.pick_id === 'p-corrected');
  assert.equal(corrected?.source, 'operator');
  assert.equal(corrected?.result, 'win');
  const { bySrc, autoCount } = summarizeAutoGrade(recs);
  assert.deepEqual(bySrc, { operator: 3 });
  assert.equal(autoCount, 0);
});
