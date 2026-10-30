import test from 'node:test';
import assert from 'node:assert/strict';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';
import { SEARCH_PICKS_FILTER_COLUMNS, SEARCH_PICKS_RESULT_FILTER_COLUMNS, VIEW_DERIVED_COLUMNS } from './queues';

/**
 * `searchPicks` renders its page from `picks_current_state` but takes its total
 * from `picks`. That split is only correct because two things hold, and this
 * file exists because the second one is easy to break by accident later.
 *
 * 1. Row counts agree. Structural: every join in the view is a LEFT JOIN, and
 *    the three correlated ones are `LEFT JOIN LATERAL (... LIMIT 1) ON true`,
 *    so none can drop a `picks` row or emit two. Measured against production
 *    2026-09-18: 107866/107866 unfiltered, 62629/62629 on source='smart-form',
 *    18287/18287 on settled since 2026-01-01.
 *
 * 2. No filter reads a joined column. Not structural -- a future filter on,
 *    say, `settlement_result` or `review_decision` would narrow the page but
 *    not the count, and the explorer would report a total larger than the set
 *    it is paginating with nothing to indicate it. That is the failure this
 *    test converts from silent into red.
 */
test('base search filters do not depend on the joined view', () => {
  const derived = new Set<string>(VIEW_DERIVED_COLUMNS);
  const offenders = SEARCH_PICKS_FILTER_COLUMNS.filter((column) => derived.has(column));

  assert.deepEqual(
    offenders,
    [],
    `searchPicks filters on view-derived column(s): ${offenders.join(', ')}. ` +
      'Counting `picks` would then return a total larger than the filtered page. ' +
      'Either move the filter onto a base column, or count the view and accept its cost.',
  );
});

test('the two column sets are non-empty, so the guard above cannot pass vacuously', () => {
  assert.ok(VIEW_DERIVED_COLUMNS.length > 0);
  assert.ok(SEARCH_PICKS_FILTER_COLUMNS.length > 0);
});

test('result filtering uses base pick IDs rather than the view-derived result', () => {
  assert.deepEqual(SEARCH_PICKS_RESULT_FILTER_COLUMNS, ['id']);
  assert.ok(SEARCH_PICKS_RESULT_FILTER_COLUMNS.every((column) => !(VIEW_DERIVED_COLUMNS as readonly string[]).includes(column)));
});

test('corrected result filtering counts the full population on a later page', async () => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const originalFetch = globalThis.fetch;
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'result-filter-test';
  const observed: Array<{ method: string; url: URL }> = [];
  const pickId = '00000000-0000-4000-8000-000000000001';
  const rootId = '00000000-0000-4000-8000-000000000002';
  const correctionId = '00000000-0000-4000-8000-000000000003';
  const reviewPickId = '00000000-0000-4000-8000-000000000004';
  let changePageResult = false;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    observed.push({ method: request.method, url });
    if (url.pathname.endsWith('/settlement_records')) {
      const history = [
      { id: rootId, pick_id: pickId, status: 'settled', result: 'loss', confidence: 'confirmed', corrects_id: null, settled_at: '2026-10-29T12:00:00Z', created_at: '2026-10-29T12:00:00Z', payload: {} },
      { id: correctionId, pick_id: pickId, status: 'settled', result: 'win', confidence: 'confirmed', corrects_id: rootId, settled_at: '2026-10-28T12:00:00Z', created_at: '2026-10-28T12:00:00Z', payload: {} },
      { id: '00000000-0000-4000-8000-000000000005', pick_id: reviewPickId, status: 'manual_review', result: 'win', confidence: 'pending', corrects_id: null, settled_at: '2026-10-28T12:00:00Z', created_at: '2026-10-28T12:00:00Z', payload: {} },
      { id: '00000000-0000-4000-8000-000000000006', pick_id: '00000000-0000-4000-8000-000000000007', status: 'settled', result: 'win', confidence: 'confirmed', corrects_id: null, settled_at: '2026-10-28T12:00:00Z', created_at: '2026-10-28T12:00:00Z', payload: {} },
      { id: '00000000-0000-4000-8000-000000000008', pick_id: '00000000-0000-4000-8000-000000000009', status: 'settled', result: 'win', confidence: 'confirmed', corrects_id: null, settled_at: '2026-10-28T12:00:00Z', created_at: '2026-10-28T12:00:00Z', payload: {} },
      ];
      const pickFilter = url.searchParams.get('pick_id');
      const rows = pickFilter
        ? (changePageResult ? history.slice(0, 1) : history).filter((row) => pickFilter.includes(row.pick_id))
        : history;
      return Response.json(rows, { headers: { 'content-range': `*/${rows.length}` } });
    }
    if (request.method === 'HEAD') return new Response(null, { headers: { 'content-range': '*/3' } });
    const pending = url.searchParams.get('id')?.startsWith('not.in.');
    return Response.json([{ id: pending ? reviewPickId : pickId, selection: 'example', settlement_result: 'loss', metadata: { distributionMode: 'track-only' } }]);
  };
  try {
    const { searchPicks } = await import('./queues');
    const result = await withRequestContext({ authorization: 'Bearer result-filter-test' }, () => searchPicks({ result: 'win', limit: '2', offset: '2', capper: 'Kingro623' }));
    assert.equal(result.total, 3);
    assert.equal(result.picks[0]?.settlement_result, 'win');
    assert.equal(result.picks[0]?.settlement_corrected, true);
    const pickRequests = observed.filter(({ url }) => !url.pathname.endsWith('/settlement_records'));
    assert.equal(pickRequests.length, 2);
    for (const { url } of pickRequests) {
      assert.match(url.searchParams.get('id') ?? '', /^in\./);
      assert.match(url.searchParams.get('id') ?? '', new RegExp(pickId));
      assert.equal(url.searchParams.get('capper_id'), 'eq.kingro623');
      assert.equal(url.searchParams.get('metadata->distributionMode'), 'not.is.null');
    }
    assert.equal(pickRequests.find((request) => request.method !== 'HEAD')?.url.searchParams.get('offset'), '2');
    observed.length = 0;
    await withRequestContext({ authorization: 'Bearer result-filter-test' }, () => searchPicks({ result: 'pending', limit: '2' }));
    for (const { url } of observed.filter(({ url }) => !url.pathname.endsWith('/settlement_records'))) {
      assert.match(url.searchParams.get('id') ?? '', /^not\.in\./);
      assert.doesNotMatch(url.searchParams.get('id') ?? '', new RegExp(reviewPickId));
      assert.equal(url.searchParams.get('status'), 'neq.voided');
    }
    const unfiltered = await withRequestContext({ authorization: 'Bearer result-filter-test' }, () => searchPicks({ limit: '2' }));
    assert.equal(unfiltered.picks[0]?.settlement_result, 'win');
    assert.equal(unfiltered.picks[0]?.settlement_corrected, true);
    changePageResult = true;
    await assert.rejects(
      withRequestContext({ authorization: 'Bearer result-filter-test' }, () => searchPicks({ result: 'win' })),
      /Pick settlement changed while filtering results/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN; else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
});

type HistoryRequest = { url: URL; signal: AbortSignal | null | undefined };
type PickRow = Record<string, unknown>;

async function withPageHistoryFixture(
  rows: PickRow[],
  respond: (url: URL) => Response,
  check: (search: () => ReturnType<typeof import('./queues').searchPicks>, requests: HistoryRequest[]) => Promise<void>,
) {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const originalFetch = globalThis.fetch;
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'page-history-test';
  const requests: HistoryRequest[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/settlement_records')) {
      requests.push({ url, signal: init?.signal });
      return respond(url);
    }
    if (request.method === 'HEAD') return new Response(null, { headers: { 'content-range': `*/${rows.length}` } });
    return Response.json(rows);
  };
  try {
    const { searchPicks } = await import('./queues');
    await check(async () => withRequestContext({ authorization: 'Bearer page-history-test' }, () => searchPicks({ limit: '25' })), requests);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
}

const pagePick = { id: 'page-pick', selection: 'Real selection', settlement_result: 'loss', metadata: { distributionMode: 'track-only' } };

test('unfiltered corrected pick uses the chain tip instead of the view result', async () => {
  const history = [
    { id: 'original', pick_id: pagePick.id, status: 'settled', result: 'loss', created_at: '2026-10-29T00:00:00Z', corrects_id: null },
    { id: 'corrected', pick_id: pagePick.id, status: 'settled', result: 'win', created_at: '2026-10-28T00:00:00Z', corrects_id: 'original' },
  ];
  await withPageHistoryFixture([pagePick], () => Response.json(history, { headers: { 'content-range': '*/2' } }), async (search, requests) => {
    const result = await search();
    assert.equal(result.picks[0]?.settlement_result, 'win');
    assert.equal(result.picks[0]?.settlement_corrected, true);
    assert.equal(result.total, 1);
    assert.equal(requests.length, 1);
  });
});

test('unfiltered manual-review and unsettled picks do not inherit a stale view result', async () => {
  const rows = [pagePick, { ...pagePick, id: 'unsettled-pick', settlement_result: 'win' }];
  const history = [
    { id: 'root', pick_id: pagePick.id, status: 'settled', result: 'loss', created_at: '2026-10-29T00:00:00Z', corrects_id: null },
    { id: 'review', pick_id: pagePick.id, status: 'manual_review', result: 'win', created_at: '2026-10-28T00:00:00Z', corrects_id: 'root' },
  ];
  await withPageHistoryFixture(rows, () => Response.json(history, { headers: { 'content-range': '*/2' } }), async (search, requests) => {
    const result = await search();
    assert.equal(result.total, 2);
    assert.deepEqual(result.picks.map((row) => row.settlement_result), [null, null]);
    assert.equal(requests.length, 1, 'one history read for the whole page, not one per pick');
    assert.equal(requests[0]?.url.searchParams.get('pick_id'), 'in.(page-pick,unsettled-pick)');
    assert.equal(requests[0]?.url.searchParams.get('order'), 'created_at.asc,id.asc');
    assert.ok(requests[0]?.signal, 'the history read carries an explicit cancellation signal');
  });
});

test('an empty pick page performs no settlement-history read', async () => {
  await withPageHistoryFixture([], () => { throw new Error('No history request expected'); }, async (search, requests) => {
    assert.deepEqual((await search()).picks, []);
    assert.equal(requests.length, 0);
  });
});

const paginatedHistory = [
  ...Array.from({ length: 1000 }, (_, index) => ({
    id: `root-${index}`, pick_id: pagePick.id, status: 'settled', result: 'loss', corrects_id: null,
    created_at: index === 0 ? '2026-10-29T00:00:00Z' : '2026-09-01T00:00:00Z',
  })),
  { id: 'correction', pick_id: pagePick.id, status: 'settled', result: 'win', corrects_id: 'root-0', created_at: '2026-10-28T00:00:00Z' },
];

test('page history crosses the server row cap and resolves the correcting tip', async () => {
  await withPageHistoryFixture([pagePick], (url) => {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return Response.json(paginatedHistory.slice(offset, offset + 1000), { headers: { 'content-range': '*/1001' } });
  }, async (search, requests) => {
    const result = await search();
    assert.equal(result.picks[0]?.settlement_result, 'win');
    assert.equal(result.picks[0]?.settlement_corrected, true);
    assert.deepEqual(requests.map(({ url }) => url.searchParams.get('offset')), ['0', '1000']);
    for (const { url, signal } of requests) {
      assert.equal(url.searchParams.get('pick_id'), 'in.(page-pick)');
      assert.equal(url.searchParams.get('limit'), '1000');
      assert.equal(url.searchParams.get('order'), 'created_at.asc,id.asc');
      assert.ok(signal);
    }
  });
});

test('a history count change during pagination fails closed', async () => {
  await withPageHistoryFixture([pagePick], (url) => {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return Response.json(paginatedHistory.slice(offset, offset + 1000), { headers: { 'content-range': offset ? '*/1002' : '*/1001' } });
  }, async (search) => {
    await assert.rejects(search(), /histories changed during pagination/);
  });
});

for (const scenario of [
  { name: 'missing authoritative count', response: () => Response.json([]), error: /authoritative count unavailable/ },
  { name: 'incomplete history', response: () => Response.json([], { headers: { 'content-range': '*/1' } }), error: /histories are incomplete/ },
  { name: 'database error', response: () => Response.json({ message: 'history read failed' }, { status: 500 }), error: /history read failed/ },
  { name: 'missing correction parent', response: () => Response.json([{ id: 'tip', pick_id: pagePick.id, corrects_id: 'missing' }], { headers: { 'content-range': '*/1' } }), error: /chain is incomplete/ },
  { name: 'duplicate records', response: () => Response.json([{ id: 'duplicate', pick_id: pagePick.id }, { id: 'duplicate', pick_id: pagePick.id }], { headers: { 'content-range': '*/2' } }), error: /duplicate IDs/ },
]) {
  test(`unfiltered page refuses ${scenario.name}`, async () => {
    await withPageHistoryFixture([pagePick], scenario.response, async (search) => {
      await assert.rejects(search(), scenario.error);
    });
  });
}
