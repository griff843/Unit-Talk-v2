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
    const prefix = lifecycle ? 'pick.' : '';
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
      if (params.has('settlement_status')) {
        assert.equal(params.get('settlement_status'), 'eq.manual_review'); count = 3;
      }
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
    assert.ok(params.getAll('or').some((filter) => filter.includes('Lions')), 'search and fixture filters both survive');
    return Response.json([{ id: 'pick-1', selection: 'Lions', metadata: { distributionMode: 'track-only' } }]);
  };
  const run = () => withRequestContext({ authorization: 'Bearer operations-home-test' }, getOperationsMetrics);
  try {
    await t.test('exact counts are independent and manual review reads the current state', async () => {
      const result = await run();
      assert.equal(result.total, 1250);
      assert.equal(result.submittedToday, 2);
      assert.equal(result.manualReview, 3);
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
