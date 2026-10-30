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
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    observed.push({ method: request.method, url });
    if (url.pathname.endsWith('/settlement_records')) return Response.json([
      { id: rootId, pick_id: pickId, status: 'settled', result: 'loss', confidence: 'confirmed', corrects_id: null, settled_at: '2026-10-29T12:00:00Z', created_at: '2026-10-29T12:00:00Z', payload: {} },
      { id: correctionId, pick_id: pickId, status: 'settled', result: 'win', confidence: 'confirmed', corrects_id: rootId, settled_at: '2026-10-28T12:00:00Z', created_at: '2026-10-28T12:00:00Z', payload: {} },
      { id: '00000000-0000-4000-8000-000000000005', pick_id: reviewPickId, status: 'manual_review', result: 'win', confidence: 'pending', corrects_id: null, settled_at: '2026-10-28T12:00:00Z', created_at: '2026-10-28T12:00:00Z', payload: {} },
      { id: '00000000-0000-4000-8000-000000000006', pick_id: '00000000-0000-4000-8000-000000000007', status: 'settled', result: 'win', confidence: 'confirmed', corrects_id: null, settled_at: '2026-10-28T12:00:00Z', created_at: '2026-10-28T12:00:00Z', payload: {} },
      { id: '00000000-0000-4000-8000-000000000008', pick_id: '00000000-0000-4000-8000-000000000009', status: 'settled', result: 'win', confidence: 'confirmed', corrects_id: null, settled_at: '2026-10-28T12:00:00Z', created_at: '2026-10-28T12:00:00Z', payload: {} },
    ], { headers: { 'content-range': '0-4/5' } });
    if (request.method === 'HEAD') return new Response(null, { headers: { 'content-range': '*/3' } });
    return Response.json([{ id: pickId, selection: 'example', settlement_result: 'loss', metadata: { distributionMode: 'track-only' } }]);
  };
  try {
    const { searchPicks } = await import('./queues');
    const result = await withRequestContext({ authorization: 'Bearer result-filter-test' }, () => searchPicks({ result: 'win', limit: '2', offset: '2', capper: 'Kingro623' }));
    assert.equal(result.total, 3);
    assert.equal(result.picks[0]?.settlement_result, 'win');
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
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN; else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
});
