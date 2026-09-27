import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

type SettlementFixture = {
  id: string; pick_id: string; status: 'settled' | 'manual_review'; result: string | null;
  source: string; confidence: string; review_reason: string | null; settled_by: string;
  corrects_id: string | null; settled_at: string; created_at: string;
  payload: Record<string, unknown>; pick: { id: string };
};

function settlement(id: string, pickId: string, status: SettlementFixture['status'], result: string | null, correctsId: string | null = null): SettlementFixture {
  const timestamp = '2026-09-27T00:00:00.000Z';
  return {
    id, pick_id: pickId, status, result, source: 'operator', confidence: 'confirmed',
    review_reason: status === 'manual_review' ? 'operator review required' : null,
    settled_by: 'griff843', corrects_id: correctsId, settled_at: timestamp,
    created_at: timestamp, payload: {}, pick: { id: pickId },
  };
}

test('settlement truth pages complete chains once and preserves one population across every display page', async (t) => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'settlement-reader-test';
  const { getResultsOpsSnapshot } = await import('./results-ops');
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  let fail: 'none' | 'settlement' | 'game' | 'count' | 'partial' = 'none';
  const postedAt = new Date(Date.now() - 30 * 3_600_000).toISOString();
  const history = Array.from({ length: 999 }, (_, index) => {
    const suffix = String(index).padStart(4, '0');
    return settlement(`root-${suffix}`, `pick-${suffix}`, 'settled', index % 2 === 0 ? 'win' : 'loss');
  });
  history.push(
    settlement('review-root', 'pick-resolved-review', 'manual_review', null),
    settlement('review-resolution', 'pick-resolved-review', 'settled', 'win', 'review-root'),
    settlement('current-root', 'pick-current-review', 'settled', 'loss'),
    settlement('current-review', 'pick-current-review', 'manual_review', null, 'current-root'),
  );
  history.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));

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
    if (table === 'settlement_records') {
      assert.equal(params.get('pick.metadata->distributionMode'), 'not.is.null');
      for (const key of ['testRun', 'proof_issue', 'proof_fixture_id', 'proof_script', 'test_key']) {
        assert.equal(params.get(`pick.metadata->>${key}`), 'is.null', `missing fixture exclusion ${key}`);
      }
      assert.equal(params.get('order'), 'created_at.asc,id.asc');
      assert.match(params.get('select') ?? '', /pick:picks!inner\(id\)/);
      const offset = Number(params.get('offset') ?? 0);
      const limit = Number(params.get('limit') ?? 1000);
      const source = fail === 'partial' ? history.filter((row) => row.id !== 'review-root') : history;
      const data = source.slice(offset, offset + limit);
      const total = fail === 'count' ? '*' : String(source.length);
      return Response.json(data, { headers: { 'content-range': `${offset}-${Math.max(offset, offset + data.length - 1)}/${total}` } });
    }
    if (table === 'picks_current_state') {
      assert.equal(params.get('metadata->distributionMode'), 'not.is.null');
      if (head) return new Response(null, { headers: { 'content-range': '*/1250' } });
      return Response.json([{ id: 'operator-pick', status: 'posted', posted_at: postedAt,
        created_at: new Date(Date.now() - 100 * 3_600_000).toISOString(), selection: 'A real pick',
        market: 'moneyline', odds: -110, stake_units: 2 }]);
    }
    if (table === 'game_results') {
      if (head) return new Response(null, { headers: { 'content-range': '*/0' } });
      return Response.json([]);
    }
    throw new Error(`Unexpected table ${table}`);
  };

  const run = (filter = {}) => withRequestContext(
    { authorization: 'Bearer settlement-reader-test' },
    () => getResultsOpsSnapshot(filter),
  );
  try {
    await t.test('effective rows replace stale roots and exact totals come from complete history', async () => {
      const result = await run();
      assert.equal(result.pagination.settlements.total, 1001);
      assert.equal(result.pagination.corrections.total, 2);
      assert.equal(result.pagination.manualReview.total, 1);
      assert.equal(result.counts.corrections, 2);
      assert.equal(result.counts.manualReviewOpen, 1);
      assert.equal(result.manualReview[0]?.id, 'current-review');
      assert.equal(result.recentSettlements.some((row) => row.id === 'review-root'), false);
      assert.equal(result.corrections.some((row) => row.id === 'review-resolution' && row.result === 'win'), true);
      assert.deepEqual([...new Set(requests.filter((url) => url.pathname.endsWith('/settlement_records')).map((url) => url.searchParams.get('offset')))], ['0', '1000']);
    });

    await t.test('independent pages have stable unions with no dropped or duplicated effective rows', async () => {
      const ids: string[] = [];
      for (let page = 1; page <= 41; page += 1) {
        const result = await run({ settlementsPage: page, correctionsPage: 2, manualReviewPage: 2 });
        ids.push(...result.recentSettlements.map((row) => row.id));
        assert.equal(result.pagination.corrections.page, 1);
        assert.equal(result.pagination.manualReview.page, 1);
      }
      assert.equal(ids.length, 1001);
      assert.equal(new Set(ids).size, 1001);
      assert.equal(ids.includes('review-resolution'), true);
      assert.equal(ids.includes('review-root'), false);
      const recovered = await run({ settlementsPage: 999 });
      assert.equal(recovered.pagination.settlements.page, 41);
      assert.equal(recovered.recentSettlements.length, 1);
    });

    await t.test('a partial chain is refused rather than resolved from the visible correction', async () => {
      fail = 'partial';
      await assert.rejects(run(), /missing a corrected record/);
      fail = 'none';
    });

    await t.test('missing exact counts and settlement failures cannot produce reassuring queues', async () => {
      fail = 'count';
      await assert.rejects(run(), /authoritative count unavailable/);
      fail = 'settlement';
      await assert.rejects(run(), /complete settlement history/);
      fail = 'none';
    });

    await t.test('unavailable provider results do not blank settlement truth', async () => {
      fail = 'game';
      const result = await run();
      assert.equal(result.pagination.settlements.total, 1001);
      assert.equal(result.gameResults.unavailable, true);
      fail = 'none';
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget();
    restoreDefaults();
  }
});
