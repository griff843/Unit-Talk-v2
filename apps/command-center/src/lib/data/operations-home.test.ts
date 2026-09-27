import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('operations home counts real operator states and reads bounded lifecycle activity', async (t) => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'operations-home-test';
  const { getOperationsMetrics, getOperationsActivity } = await import('./operations-home');
  const { searchPicks } = await import('./queues');
  const originalFetch = globalThis.fetch;
  let failCount = false;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const params = url.searchParams;
    const lifecycle = url.pathname.endsWith('/pick_lifecycle');
    const settlements = url.pathname.endsWith('/settlement_records');
    const prefix = lifecycle ? 'pick.' : '';
    if (settlements) {
      assert.equal(params.get('pick.metadata->distributionMode'), 'not.is.null');
      assert.equal(params.get('order'), 'created_at.asc,id.asc');
      const rows = [
        { id: 'old-review', pick_id: 'resolved-pick', status: 'manual_review', result: null, source: 'operator', confidence: 'pending', review_reason: 'review', settled_by: 'operator', corrects_id: null, settled_at: '2026-09-20T00:00:00Z', created_at: '2026-09-20T00:00:00Z', payload: {} },
        { id: 'resolved', pick_id: 'resolved-pick', status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', review_reason: null, settled_by: 'operator', corrects_id: null, settled_at: '2026-09-21T00:00:00Z', created_at: '2026-09-21T00:00:00Z', payload: {} },
        { id: 'old-settlement', pick_id: 'review-pick', status: 'settled', result: 'loss', source: 'operator', confidence: 'confirmed', review_reason: null, settled_by: 'operator', corrects_id: null, settled_at: '2026-09-22T00:00:00Z', created_at: '2026-09-22T00:00:00Z', payload: {} },
        { id: 'current-review', pick_id: 'review-pick', status: 'manual_review', result: null, source: 'operator', confidence: 'pending', review_reason: 'review', settled_by: 'operator', corrects_id: 'old-settlement', settled_at: '2026-09-23T00:00:00Z', created_at: '2026-09-23T00:00:00Z', payload: {} },
      ];
      return Response.json(rows, { headers: failCount ? {} : { 'content-range': '0-3/4' } });
    }
    assert.equal(params.get(`${prefix}metadata->distributionMode`), 'not.is.null');
    for (const key of ['testRun', 'proof_issue', 'proof_fixture_id', 'proof_script', 'test_key']) assert.equal(params.get(`${prefix}metadata->>${key}`), 'is.null');
    assert.ok(params.getAll(`${prefix}or`).includes('(selection.is.null,selection.not.ilike.*proof*)'));
    if (lifecycle) {
      assert.equal(params.get('limit'), '10');
      assert.match(params.get('select') ?? '', /pick:picks!inner/);
      return Response.json([{ id: 'event-1', pick_id: 'pick-1', from_state: 'queued', to_state: 'posted', writer_role: 'worker', reason: 'receipt persisted', created_at: '2026-09-20T00:00:00Z', pick: { id: 'pick-1', selection: 'A real selection' } }]);
    }
    if (request.method === 'HEAD') {
      assert.match(request.headers.get('prefer') ?? '', /count=exact/);
      let count = 1250;
      if (params.has('created_at')) count = 2;
      if (params.has('posted_at')) {
        assert.equal(params.has('created_at'), false, 'age uses posting time');
        assert.equal(params.get('settlement_recorded_at'), 'is.null'); count = 4;
      }
      if (params.has('metadata->deliveryAuthorization->>decision')) {
        assert.equal(params.get('status'), 'eq.posted');
        assert.equal(params.get('settlement_recorded_at'), 'is.null'); count = 5;
      }
      return new Response(null, { headers: failCount ? {} : { 'content-range': `*/${count}` } });
    }
    assert.equal(params.get('limit'), '10');
    assert.equal(params.get('offset'), '10');
    assert.equal(params.get('order'), 'created_at.desc,id.desc');
    assert.ok(request.signal, 'pick reads have a bounded cancellation signal');
    assert.ok(params.getAll('or').some((filter) => filter.includes('Lions')), 'search and fixture filters both survive');
    return Response.json([{ id: 'pick-1', selection: 'Lions', metadata: { distributionMode: 'track-only' } }]);
  };
  const run = () => withRequestContext({ authorization: 'Bearer operations-home-test' }, getOperationsMetrics);
  try {
    await t.test('exact counts are independent and manual review reads the current state', async () => {
      const result = await run();
      assert.equal(result.total, 1250);
      assert.equal(result.submittedToday, 2);
      assert.equal(result.manualReview, 1);
      assert.equal(result.agedPosted, 4);
      assert.equal(result.awaitingSettlement, 5);
      const activity = await withRequestContext({ authorization: 'Bearer operations-home-test' }, getOperationsActivity);
      assert.equal(activity.length, 1);
      assert.equal(activity[0]?.to_state, 'posted');
    });
    await t.test('pick search rows and totals use the same fixture exclusion before pagination', async () => {
      const result = await withRequestContext({ authorization: 'Bearer operations-home-test' }, () => searchPicks({ q: 'Lions', limit: '10', offset: '10' }));
      assert.equal(result.total, 1250);
      assert.equal(result.picks.length, 1);
    });
    await t.test('a missing count cannot produce a reassuring zero', async () => {
      failCount = true;
      await assert.rejects(run(), /authoritative count unavailable/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
});

test('Settlement, Exceptions, overview, and dashboard agree on effective manual-review truth', async () => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'cross-surface-settlement-test';
  const [{ getResultsOpsSnapshot }, { getOperationsMetrics }, { getExceptionQueues }, { getDashboardData }] = await Promise.all([
    import('./results-ops'), import('./operations-home'), import('./picks'), import('./dashboard'),
  ]);
  const originalFetch = globalThis.fetch;
  const rows = [
    { id: 'historical-review', pick_id: 'resolved-pick', status: 'manual_review', result: null, source: 'operator', confidence: 'pending', review_reason: 'old review', settled_by: 'operator', corrects_id: null, settled_at: '2026-09-20T00:00:00Z', created_at: '2026-09-20T00:00:00Z', payload: {} },
    { id: 'resolved-tip', pick_id: 'resolved-pick', status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', review_reason: null, settled_by: 'operator', corrects_id: null, settled_at: '2026-09-21T00:00:00Z', created_at: '2026-09-21T00:00:00Z', payload: {} },
    { id: 'settled-root', pick_id: 'open-review-pick', status: 'settled', result: 'loss', source: 'operator', confidence: 'confirmed', review_reason: null, settled_by: 'operator', corrects_id: null, settled_at: '2026-09-22T00:00:00Z', created_at: '2026-09-22T00:00:00Z', payload: {} },
    { id: 'open-review-tip', pick_id: 'open-review-pick', status: 'manual_review', result: null, source: 'operator', confidence: 'pending', review_reason: 'current review', settled_by: 'operator', corrects_id: 'settled-root', settled_at: '2026-09-23T00:00:00Z', created_at: '2026-09-23T00:00:00Z', payload: {} },
  ];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const table = url.pathname.split('/').at(-1);
    const select = url.searchParams.get('select') ?? '';
    if (table === 'settlement_records') {
      if (select.includes('pick:picks!inner')) {
        return Response.json(rows, { headers: { 'content-range': '0-3/4' } });
      }
      return Response.json(rows);
    }
    if (request.method === 'HEAD') return new Response(null, { headers: { 'content-range': '*/0' } });
    return Response.json([]);
  };
  const context = { authorization: 'Bearer cross-surface-settlement-test' };
  try {
    const [settlementView, overview, exceptions, dashboard] = await Promise.all([
      withRequestContext(context, getResultsOpsSnapshot),
      withRequestContext(context, getOperationsMetrics),
      withRequestContext(context, getExceptionQueues),
      withRequestContext(context, getDashboardData),
    ]);
    const dashboardReviews = dashboard.exceptions.filter((row) => row.title === 'Pending manual review');
    assert.equal(settlementView.counts.manualReviewOpen, 1);
    assert.equal(overview.manualReview, 1);
    assert.equal(exceptions.data.counts.pendingManualReview, 1);
    assert.equal(dashboardReviews.length, 1);
    assert.equal(settlementView.manualReview[0]?.pickId, 'open-review-pick');
    assert.equal(exceptions.data.pendingManualReview[0]?.['pick_id'], 'open-review-pick');
    assert.equal(dashboardReviews[0]?.pickId, 'open-review-pick');
    assert.equal(settlementView.manualReview.some((row) => row.pickId === 'resolved-pick'), false);
    assert.match(dashboard.signals.find((signal) => signal.signal === 'settlement')?.detail ?? '', /1 pending manual review/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
});
