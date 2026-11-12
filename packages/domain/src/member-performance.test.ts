import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateMemberPerformance,
  resolvePublicPerformanceSettlement,
  type MemberPerformanceSettlement,
  type PublicPerformanceRecord,
  type MemberPerformanceOptions,
} from './member-performance.js';
const options: MemberPerformanceOptions = {
  window: 30,
  sport: null,
  capper: null,
  limit: 10,
  minPicks: 1,
  observedAt: '2026-10-14T12:00:00.000Z',
};
function settlement(
  overrides: Partial<MemberPerformanceSettlement> = {},
): MemberPerformanceSettlement {
  return {
    id: 's-p1',
    pick_id: 'p1',
    corrects_id: null,
    created_at: '2026-10-13T12:00:00Z',
    settled_at: '2026-10-13T12:00:00Z',
    status: 'settled',
    result: 'win',
    confidence: 'confirmed',
    stake_units: 2,
    payload: {},
    ...overrides,
  };
}
function record(
  id = 'p1',
  overrides: Partial<PublicPerformanceRecord> = {},
): PublicPerformanceRecord {
  return {
    pickId: id,
    capperId: 'c1',
    capperName: 'One',
    sport: 'NBA',
    odds: 150,
    stakeUnits: 2,
    settlement: settlement({ id: `s-${id}`, pick_id: id }),
    ...overrides,
  };
}
function result(
  id: string,
  value: string,
  at = '2026-10-13T12:00:00Z',
): PublicPerformanceRecord {
  return record(id, {
    settlement: settlement({
      id: `s-${id}`,
      pick_id: id,
      result: value,
      settled_at: at,
      created_at: at,
    }),
  });
}
test('complete correction chain selects effective node independent of input order without mutating history', () => {
  const root = settlement();
  const correction = settlement({
    id: 's2',
    corrects_id: root.id,
    result: 'loss',
    created_at: '2026-10-14T01:00:00Z',
    settled_at: '2026-10-14T01:00:00Z',
  });
  const last = settlement({
    id: 's3',
    corrects_id: correction.id,
    result: 'void',
    created_at: '2026-10-14T02:00:00Z',
    settled_at: '2026-10-14T02:00:00Z',
  });
  const rows = Object.freeze([
    Object.freeze(last),
    Object.freeze(root),
    Object.freeze(correction),
  ]);
  assert.equal(resolvePublicPerformanceSettlement('p1', rows), last);
  assert.equal(rows[0], last);
});
test('rejects empty, duplicate, missing-link, multiple-root and branched histories', () => {
  const root = settlement();
  for (const rows of [
    [],
    [root, root],
    [root, settlement({ id: 'x', corrects_id: 'absent' })],
    [root, settlement({ id: 'x' })],
    [
      root,
      settlement({ id: 'x', corrects_id: root.id }),
      settlement({ id: 'y', corrects_id: root.id }),
    ],
  ]) {
    assert.throws(() => resolvePublicPerformanceSettlement('p1', rows));
  }
});
test('rejects disconnected cycles, wrong picks, backwards dates and invalid dates', () => {
  const root = settlement();
  for (const rows of [
    [
      root,
      settlement({ id: 'x', corrects_id: 'y' }),
      settlement({ id: 'y', corrects_id: 'x' }),
    ],
    [settlement({ pick_id: 'other' })],
    [
      root,
      settlement({ id: 'x', corrects_id: root.id, created_at: '2020-01-01Z' }),
    ],
    [settlement({ settled_at: 'invalid' })],
    [settlement({ id: 'cycle', corrects_id: 'cycle' })],
  ]) {
    assert.throws(() => resolvePublicPerformanceSettlement('p1', rows));
  }
});
test('unverified historical or effective rows fail visibly', () => {
  for (const overrides of [
    { confidence: 'estimated' },
    { status: 'manual_review' },
    { result: null },
    { result: 'made-up' },
  ]) {
    assert.throws(() =>
      resolvePublicPerformanceSettlement('p1', [settlement(overrides)]),
    );
  }
});
test('authentic unequal stakes and American odds give units-weighted decided ROI', () => {
  const plus = record('a'); // +3 units
  const minus = record('b', {
    odds: -200,
    stakeUnits: 4,
    settlement: settlement({ id: 'b', pick_id: 'b', stake_units: 4 }),
  }); // +2
  const loss = result('c', 'loss'); // -2
  const { stats } = aggregateMemberPerformance([plus, minus, loss], options);
  assert.equal(stats.roiPct, 37.5); // 3/8, not flat 33.33%
  assert.equal(stats.winRate, 2 / 3);
});
test('missing or unusable decided prices/stakes never produce partially priced or flat-bet ROI', () => {
  for (const overrides of [
    { odds: null },
    { odds: 0 },
    { odds: 99 },
    { odds: Infinity },
    { odds: NaN },
    { stakeUnits: null },
    { stakeUnits: 0 },
    { stakeUnits: -1 },
    { stakeUnits: Infinity },
    { stakeUnits: NaN },
  ]) {
    assert.equal(
      aggregateMemberPerformance(
        [record('good'), record('bad', overrides)],
        options,
      ).stats.roiPct,
      null,
    );
  }
  assert.equal(
    aggregateMemberPerformance(
      [record('p1', { settlement: settlement({ stake_units: 3 }) })],
      options,
    ).stats.roiPct,
    null,
  );
});
test('void/cancelled remain in total record and refunds do not contaminate decided ROI', () => {
  const { stats, leaderboard } = aggregateMemberPerformance(
    [
      result('1', 'win'),
      result('2', 'push'),
      result('3', 'void'),
      result('4', 'cancelled'),
    ],
    options,
  );
  assert.equal(stats.picks, 4);
  assert.deepEqual([stats.wins, stats.losses, stats.pushes], [1, 0, 1]);
  assert.equal(stats.roiPct, 150);
  assert.deepEqual(stats.lastFive, ['W', 'P']);
  assert.equal(leaderboard.entries[0]!.streak, 0);
  assert.equal(
    aggregateMemberPerformance([result('1', 'win'), result('2', 'push')], {
      ...options,
      minPicks: 2,
    }).leaderboard.entries.length,
    1,
  );
});
test('empty and void-only cohorts have null rates without fabricated rankings', () => {
  for (const rows of [[], [result('1', 'void'), result('2', 'cancelled')]]) {
    const { stats, leaderboard } = aggregateMemberPerformance(rows, options);
    assert.equal(stats.winRate, null);
    assert.equal(stats.roiPct, null);
    assert.deepEqual(leaderboard.entries, []);
  }
  assert.deepEqual(aggregateMemberPerformance([], options).stats.lastFive, []);
});
test('canonical IDs keep identical names separate and ambiguous name filters fail', () => {
  const records = [record('a'), record('b', { capperId: 'c2' })];
  assert.equal(
    aggregateMemberPerformance(records, options).leaderboard.entries.length,
    2,
  );
  assert.throws(
    () => aggregateMemberPerformance(records, { ...options, capper: 'one' }),
    /Ambiguous/,
  );
  assert.equal(
    aggregateMemberPerformance(records, { ...options, capper: 'C2' }).stats
      .picks,
    1,
  );
});
test('case-insensitive filters and unmatched capper retain legitimate empty semantics', () => {
  assert.equal(
    aggregateMemberPerformance([record()], {
      ...options,
      sport: ' nba ',
      capper: ' ONE ',
    }).stats.picks,
    1,
  );
  assert.equal(
    aggregateMemberPerformance([record()], { ...options, sport: 'NFL' }).stats
      .picks,
    0,
  );
  const stats = aggregateMemberPerformance([record()], {
    ...options,
    capper: 'missing',
  }).stats;
  assert.equal(stats.scope, 'capper');
  assert.equal(stats.picks, 0);
  assert.equal(stats.capper, 'missing');
});
test('one exact UTC boundary excludes older and future effective settlements', () => {
  const rows = [
    result('lower', 'win', '2026-09-14T12:00:00.000Z'),
    result('old', 'loss', '2026-09-14T11:59:59.999Z'),
    result('now', 'push', options.observedAt),
    result('future', 'loss', '2026-10-14T12:00:00.001Z'),
  ];
  assert.equal(aggregateMemberPerformance(rows, options).stats.picks, 2);
});
test('last five chronology and streak are deterministic at tied timestamps', () => {
  const rows = ['win', 'loss', 'win', 'win', 'win', 'loss', 'loss'].map(
    (r, i) => result(String(i), r),
  );
  const forward = aggregateMemberPerformance(rows, options);
  assert.deepEqual(forward.stats.lastFive, ['W', 'W', 'W', 'L', 'L']);
  assert.equal(forward.leaderboard.entries[0]!.streak, -2);
  assert.deepEqual(
    aggregateMemberPerformance([...rows].reverse(), options),
    forward,
  );
});
test('stable rank uses win rate then authentic ROI then canonical identity with null last', () => {
  const rows = [
    record('a', { capperId: 'a', capperName: 'A' }),
    record('b', { capperId: 'b', capperName: 'B', odds: null }),
    record('c', { capperId: 'c', capperName: 'C', odds: 200 }),
    record('d', { capperId: 'd', capperName: 'D' }),
  ];
  const entries = aggregateMemberPerformance(rows, options).leaderboard.entries;
  assert.deepEqual(
    entries.map((e) => e.capper),
    ['C', 'A', 'D', 'B'],
  );
  assert.deepEqual(
    entries.map((e) => e.rank),
    [1, 2, 3, 4],
  );
  assert.equal(
    aggregateMemberPerformance(rows, { ...options, limit: 2 }).leaderboard
      .entries.length,
    2,
  );
});
test('raw payload CLV/payout is not trusted or exposed and input is immutable', () => {
  const input = record('p1', {
    settlement: settlement({
      payload: { profitLossUnits: 999, clvRaw: 777, beatsClosingLine: true },
    }),
  });
  const original = structuredClone(input);
  const output = aggregateMemberPerformance([input], options);
  assert.equal(output.stats.roiPct, 150);
  assert.equal(output.stats.avgClvPct, null);
  assert.equal(output.stats.beatsLine, null);
  assert.equal(output.stats.picksWithClv, 0);
  assert.deepEqual(input, original);
  assert.equal(JSON.stringify(output).includes('pickId'), false);
  assert.equal(JSON.stringify(output).includes('payload'), false);
  assert.deepEqual(
    Object.keys(output.stats).sort(),
    [
      'scope',
      'capper',
      'window',
      'sport',
      'picks',
      'wins',
      'losses',
      'pushes',
      'winRate',
      'roiPct',
      'avgClvPct',
      'beatsLine',
      'picksWithClv',
      'lastFive',
    ].sort(),
  );
});
test('duplicate picks, contradictory capper labels and invalid options fail visibly', () => {
  assert.throws(() =>
    aggregateMemberPerformance([record(), record()], options),
  );
  assert.throws(() =>
    aggregateMemberPerformance(
      [record('a'), record('b', { capperName: 'Renamed' })],
      options,
    ),
  );
  assert.throws(() =>
    aggregateMemberPerformance([], { ...options, observedAt: 'bad' }),
  );
  for (const overrides of [
    { limit: 0 },
    { limit: 26 },
    { minPicks: 0 },
    { minPicks: 1.5 },
  ]) {
    assert.throws(() =>
      aggregateMemberPerformance([], { ...options, ...overrides }),
    );
  }
});
test('overflow cannot turn into success with non-finite metrics', () => {
  const huge = record('p1', {
    odds: Number.MAX_VALUE,
    stakeUnits: Number.MAX_VALUE,
    settlement: settlement({ stake_units: Number.MAX_VALUE }),
  });
  assert.throws(() => aggregateMemberPerformance([huge], options), /overflow/);
});

test('pushes qualify settled minimum and all-push cappers rank null below decided records', () => {
  const mixed = [
    result('win', 'win'),
    result('push', 'push'),
    result('void', 'void'),
  ];
  assert.equal(
    aggregateMemberPerformance(mixed, { ...options, minPicks: 2 }).leaderboard
      .entries.length,
    1,
  );
  assert.equal(
    aggregateMemberPerformance(mixed, { ...options, minPicks: 3 }).leaderboard
      .entries.length,
    0,
  );
  const pushOnly = ['push1', 'push2'].map((id) => ({
    ...result(id, 'push'),
    capperId: 'c2',
    capperName: 'Push Only',
  }));
  const entries = aggregateMemberPerformance([...pushOnly, ...mixed], {
    ...options,
    minPicks: 2,
  }).leaderboard.entries;
  assert.deepEqual(
    entries.map((entry) => entry.capper),
    ['One', 'Push Only'],
  );
  assert.equal(entries[1]!.winRate, null);
  assert.equal(entries[1]!.roiPct, null);
  assert.equal(entries[1]!.streak, 0);
  assert.equal(entries[1]!.picks, 2);
});
