import test from 'node:test';
import assert from 'node:assert/strict';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';
import { SEARCH_PICKS_FILTER_COLUMNS, SEARCH_PICKS_RESULT_FILTER_COLUMNS, VIEW_DERIVED_COLUMNS, searchPicksCountRelation } from './queues';

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

test('view-derived result filters count the same view as the rows', () => {
  assert.ok(SEARCH_PICKS_RESULT_FILTER_COLUMNS.every((column) => (VIEW_DERIVED_COLUMNS as readonly string[]).includes(column)));
  for (const result of ['win', 'loss', 'push', 'void', 'pending']) assert.equal(searchPicksCountRelation(result), 'picks_current_state');
  assert.equal(searchPicksCountRelation(''), 'picks');
});

test('result pagination uses the same governed view and filter for count and rows', async () => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const originalFetch = globalThis.fetch;
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'result-filter-test';
  const observed: Array<{ method: string; url: URL }> = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    observed.push({ method: request.method, url });
    if (request.method === 'HEAD') return new Response(null, { headers: { 'content-range': '*/3' } });
    return Response.json([{ id: 'corrected-pick', selection: 'example', settlement_result: 'win', metadata: { distributionMode: 'track-only' } }]);
  };
  try {
    const { searchPicks } = await import('./queues');
    const result = await withRequestContext({ authorization: 'Bearer result-filter-test' }, () => searchPicks({ result: 'win', limit: '2', offset: '2', capper: 'Kingro623' }));
    assert.equal(result.total, 3);
    assert.equal(result.picks[0]?.settlement_result, 'win');
    assert.equal(observed.length, 2);
    for (const { url } of observed) {
      assert.ok(url.pathname.endsWith('/picks_current_state'));
      assert.equal(url.searchParams.get('settlement_result'), 'eq.win');
      assert.equal(url.searchParams.get('capper_id'), 'eq.kingro623');
      assert.equal(url.searchParams.get('metadata->distributionMode'), 'not.is.null');
    }
    assert.equal(observed.find((request) => request.method !== 'HEAD')?.url.searchParams.get('offset'), '2');
    observed.length = 0;
    await withRequestContext({ authorization: 'Bearer result-filter-test' }, () => searchPicks({ result: 'pending', limit: '2' }));
    for (const { url } of observed) {
      assert.equal(url.searchParams.get('settlement_result'), 'is.null');
      assert.equal(url.searchParams.get('status'), 'neq.voided');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN; else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
});
