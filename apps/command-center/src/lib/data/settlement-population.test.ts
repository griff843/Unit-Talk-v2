import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('settlement reader scopes rows and counts to real operator picks before pagination', async (t) => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'settlement-reader-test';
  const { getResultsOpsSnapshot } = await import('./results-ops');
  const originalFetch = globalThis.fetch;
  const run = () => withRequestContext({ authorization: 'Bearer settlement-reader-test' }, getResultsOpsSnapshot);
  const requests: URL[] = [];
  let fail: 'none' | 'settlement' | 'game' | 'count' = 'none';
  const postedAt = new Date(Date.now() - 30 * 3_600_000).toISOString();
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push(url);
    const table = url.pathname.split('/').at(-1);
    const params = url.searchParams;
    const head = request.method === 'HEAD';
    if ((fail === 'settlement' && table === 'settlement_records') || (fail === 'game' && table === 'game_results')) {
      return Response.json({ message: 'private backend failure' }, { status: 503 });
    }
    if (table === 'settlement_records' || table === 'picks_current_state') {
      const prefix = table === 'settlement_records' ? 'pick.' : '';
      assert.equal(params.get(`${prefix}metadata->distributionMode`), 'not.is.null');
      for (const key of ['testRun', 'proof_issue', 'proof_fixture_id', 'proof_script', 'test_key']) {
        assert.equal(params.get(`${prefix}metadata->>${key}`), 'is.null', `missing fixture exclusion ${key}`);
      }
      assert.equal(params.get(`${prefix}or`), '(selection.is.null,selection.not.ilike.*proof*)');
      if (table === 'settlement_records') assert.match(params.get('select') ?? '', /pick:picks!inner\(id\)/);
      if (!head) assert.equal(params.get('limit'), '50', 'display reads stay bounded');
    }
    if (head) {
      assert.match(request.headers.get('prefer') ?? '', /count=exact/);
      const count = table === 'game_results' ? 0 : 1250;
      return new Response(null, { headers: fail === 'count' && table === 'settlement_records' ? {} : { 'content-range': `*/${count}` } });
    }
    if (table === 'game_results') return Response.json([]);
    if (table === 'settlement_records') return Response.json([{
      id: 'settlement-1', pick_id: 'operator-pick', status: 'settled', result: 'loss',
      source: 'operator', confidence: 'high', settled_by: 'griff843', corrects_id: null,
      settled_at: postedAt, created_at: postedAt, payload: {}, pick: { id: 'operator-pick' },
    }]);
    assert.equal(table, 'picks_current_state');
    if (params.has('posted_at')) assert.equal(params.get('posted_at')?.startsWith('lte.'), true);
    return Response.json([{
      id: 'operator-pick', status: 'posted', posted_at: postedAt,
      created_at: new Date(Date.now() - 100 * 3_600_000).toISOString(),
      selection: 'A real pick', market: 'moneyline', odds: -110, stake_units: 2,
    }]);
  };
  try {
    await t.test('exact totals are independent of the bounded display rows and age uses posting time', async () => {
      const result = await run();
      assert.equal(result.recentSettlements.length, 1);
      assert.equal(result.counts.corrections, 1250);
      assert.equal(result.counts.stuckPosted, 1250);
      assert.equal(result.counts.deliveredAwaitingSettlement, 1250);
      assert.equal(result.deliveredAwaitingSettlement.length, 1);
      assert.equal(result.stuckPosted[0]?.ageHours, 30);
      assert.equal(result.recentSettlements[0]?.settledBy, 'griff843');
      assert.ok(requests.some((url) => url.searchParams.get('posted_at')?.startsWith('lte.')));
    });
    await t.test('a missing authoritative count is refused rather than replaced by zero or the sample length', async () => {
      fail = 'count';
      await assert.rejects(run(), /authoritative count unavailable/);
    });
    await t.test('a settlement read failure cannot turn into an empty successful queue', async () => {
      fail = 'settlement';
      await assert.rejects(run());
    });
    await t.test('unavailable provider results do not blank the operator settlement history', async () => {
      fail = 'game';
      const result = await run();
      assert.equal(result.recentSettlements.length, 1);
      assert.equal(result.gameResults.unavailable, true);
      assert.equal(result.gameResults.count24h, null);
      assert.equal(result.gameResults.latestSourcedAt, null);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget();
    restoreDefaults();
  }
});
