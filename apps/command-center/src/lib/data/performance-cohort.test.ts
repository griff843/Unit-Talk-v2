import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('performance reconciles paginated operator records and complete correction chains', async (t) => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'performance-reader-test';
  const { getOperatorPerformance } = await import('./operator-performance');
  const { getPerformanceData, getLeaderboard } = await import('./analytics');
  const originalFetch = globalThis.fetch;
  const recent = new Date(Date.now() - 86_400_000).toISOString();
  const old = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const pick = (id: string, capper: string, odds: number, stake: number, mode = 'member') => ({
    id, capper_id: capper, capper_display_name: capper, odds, stake_units: stake,
    source: 'smart-form', market: 'moneyline', selection: id,
    metadata: { distributionMode: mode }, status: 'validated', created_at: recent,
    review_decision: null, promotion_score: null, sport_display_name: 'NFL',
  });
  const picks = [pick('a', 'griff', 150, 2), pick('b', 'other', 100, 1), pick('c', 'griff', -110, 3, 'track-only'), pick('d', 'griff', -110, 1), pick('e', 'griff', 100, 1)];
  picks[0]!.created_at = old;
  const settlement = (id: string, pickId: string, result: string, corrects: string | null = null, date = recent) => ({
    id, pick_id: pickId, result, status: 'settled', confidence: 'confirmed',
    corrects_id: corrects, created_at: date, settled_at: date, payload: {}, source: 'operator', settled_by: 'operator:test',
  });
  const records = [settlement('a-original', 'a', 'win', null, old), settlement('a-correction', 'a', 'loss', 'a-original'), settlement('b-record', 'b', 'win'), settlement('c-record', 'c', 'loss'), settlement('e-record', 'e', 'void')];
  let failure: 'none' | 'count' | 'change' | 'query' | 'orphan' = 'none';
  let pages = 0;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const params = url.searchParams;
    assert.match(request.headers.get('prefer') ?? '', /count=exact/);
    const from = Number(params.get('offset') ?? 0);
    if (from > 0) pages++;
    const isPicks = url.pathname.endsWith('/picks_current_state');
    if (isPicks) {
      assert.equal(params.get('metadata->distributionMode'), 'not.is.null');
      for (const key of ['testRun', 'proof_issue', 'proof_fixture_id', 'proof_script', 'test_key']) assert.equal(params.get(`metadata->>${key}`), 'is.null');
      assert.equal(params.get('or'), '(selection.is.null,selection.not.ilike.*proof*)');
    } else {
      assert.equal(url.pathname.endsWith('/settlement_records'), true);
      assert.equal(params.has('corrects_id'), false, 'corrections must not be excluded');
      assert.equal(params.has('status'), false, 'manual-review corrections must supersede an old result too');
      assert.match(params.get('pick_id') ?? '', /in\./);
    }
    if (failure === 'query') return Response.json({ message: 'private backend failure' }, { status: 503 });
    const data = isPicks ? picks : failure === 'orphan' ? records.slice(1) : records;
    const page = data.slice(from, from + 2); // Simulate a server cap below the requested page size.
    const count = data.length + (failure === 'change' && from > 0 ? 1 : 0);
    return Response.json(page, { headers: failure === 'count' ? {} : { 'content-range': `${from}-${from + page.length - 1}/${count}` } });
  };
  const run = () => withRequestContext({ authorization: 'Bearer performance-reader-test' }, () => getOperatorPerformance(null));
  try {
    await t.test('one effective result per pick, Track Only split, void and unsettled counts, capper sums', async () => {
      const result = await run();
      assert.equal(result.aggregate.total, 5);
      assert.equal(result.aggregate.wins, 1);
      assert.equal(result.aggregate.losses, 2);
      assert.equal(result.aggregate.voids, 1);
      assert.equal(result.aggregate.unsettled, 1);
      assert.equal(result.aggregate.corrections, 1);
      assert.equal(result.aggregate.unitsStaked, 6);
      assert.equal(result.aggregate.unitsNet, -4);
      assert.equal(result.aggregate.unitsReturned, 2);
      assert.equal(result.aggregate.refundUnits, 1);
      assert.equal(result.aggregate.flatBetRoiPct, -33.3);
      assert.equal(result.modes.find((mode) => mode.id === 'track-only')?.stats.losses, 1);
      assert.equal(result.cappers.reduce((sum, capper) => sum + capper.stats.total, 0), 5);
      assert.ok(pages >= 4, 'both picks and settlement history must traverse the server cap');
    });
    await t.test('the existing published aggregate and leaderboard also use corrections', async () => {
      const performance = await withRequestContext({ authorization: 'Bearer performance-reader-test' }, getPerformanceData);
      assert.ok(performance);
      assert.equal(performance.unitTalkAggregate.wins, 1);
      assert.equal(performance.unitTalkAggregate.losses, 1);
      assert.equal(performance.trackOnly.stats.losses, 1);
      const board = await withRequestContext({ authorization: 'Bearer performance-reader-test' }, () => getLeaderboard(30));
      assert.equal(board.error, null);
      assert.equal(board.rows.find((row) => row.capper === 'griff')?.losses, 1);
      assert.equal(board.rows.find((row) => row.capper === 'griff')?.wins, 0);
    });
    for (const mode of ['count', 'change', 'query', 'orphan'] as const) {
      await t.test(`refuses ${mode} instead of presenting partial performance`, async () => {
        failure = mode;
        await assert.rejects(run());
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
});
