import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('delivery readers scope every count, attempt and receipt to operator picks', async (t) => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'delivery-reader-test';
  const { getOutboxOverview } = await import('./outbox');
  const { getDiscordOpsSnapshot } = await import('./discord-ops');
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  let failure: 'none' | 'count' | 'receipt' | 'range' = 'none';
  const run = () => withRequestContext({ authorization: 'Bearer delivery-reader-test' }, getOutboxOverview);
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push(url);
    const receipts = url.pathname.endsWith('/distribution_receipts');
    const prefix = receipts ? 'outbox.pick.' : 'pick.';
    const params = url.searchParams;
    assert.equal(params.get(`${prefix}metadata->distributionMode`), 'not.is.null');
    for (const key of ['testRun', 'proof_issue', 'proof_fixture_id', 'proof_script', 'test_key']) {
      assert.equal(params.get(`${prefix}metadata->>${key}`), 'is.null');
    }
    assert.equal(params.get(`${prefix}or`), '(selection.is.null,selection.not.ilike.*proof*)');
    assert.match(params.get(receipts ? 'outbox.target' : 'target') ?? '', /discord:official-picks/);
    assert.match(params.get('select') ?? '', /pick:picks!inner/);
    if (failure === 'range' && request.method !== 'HEAD' && params.has('offset')) return Response.json({ code: 'PGRST103', message: 'Requested range not satisfiable' }, { status: 416 });
    if (receipts) {
      assert.match(params.get('select') ?? '', /outbox:distribution_outbox!inner/);
      if (failure === 'receipt') return Response.json({ message: 'private query failure' }, { status: 503 });
      if (request.method === 'HEAD') return new Response(null, { headers: { 'content-range': '*/1250' } });
      return Response.json([{ id: 'receipt-1', outbox_id: 'outbox-1', channel: 'official', status: 'sent', receipt_type: 'discord', recorded_at: '2026-09-20T00:00:00Z' }], { headers: { 'content-range': '0-0/1250' } });
    }
    if (request.method === 'HEAD') {
      assert.match(request.headers.get('prefer') ?? '', /count=exact/);
      return new Response(null, { headers: failure === 'count' ? {} : { 'content-range': '*/1250' } });
    }
    return Response.json([{ id: 'outbox-1', pick_id: 'pick-1', target: 'discord:official-picks', status: 'sent', attempt_count: 1, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z' }], { headers: { 'content-range': '0-0/1250' } });
  };
  try {
    await t.test('exact counts are independent of displayed samples', async () => {
      const result = await run();
      assert.equal(result.counts.sent, 1250);
      assert.equal(result.rows.length, 1);
      assert.equal(result.recentReceipts.length, 1);
      assert.ok(result.targets.includes('discord:official-picks'));
      const delivery = await withRequestContext({ authorization: 'Bearer delivery-reader-test' }, getDiscordOpsSnapshot);
      assert.equal(delivery.receiptsSampled, 1);
      assert.equal(delivery.channelStats[0]?.successCount, 1);
    });
    await t.test('later pages retain database filters and deterministic ordering for attempts and receipts', async () => {
      requests.length = 0;
      const result = await withRequestContext({ authorization: 'Bearer delivery-reader-test' }, () => getOutboxOverview({ status: 'sent', target: 'discord:official-picks', page: 3, receiptPage: 2 }));
      assert.equal(result.totalRows, 1250);
      assert.equal(result.totalReceipts, 1250);
      assert.equal(result.page, 3);
      assert.equal(result.receiptPage, 2);
      const attempts = requests.find((url) => url.searchParams.get('select')?.includes('attempt_count'))!;
      assert.equal(attempts.searchParams.get('offset'), '50');
      assert.equal(attempts.searchParams.get('limit'), '25');
      assert.equal(attempts.searchParams.get('order'), 'updated_at.desc,id.desc');
      assert.equal(attempts.searchParams.get('status'), 'eq.sent');
      assert.ok(attempts.searchParams.getAll('target').includes('eq.discord:official-picks'));
      const receipts = requests.find((url) => url.pathname.endsWith('/distribution_receipts'))!;
      assert.equal(receipts.searchParams.get('offset'), '25');
      assert.equal(receipts.searchParams.get('limit'), '25');
      assert.equal(receipts.searchParams.get('order'), 'recorded_at.desc,id.desc');
      assert.equal(receipts.searchParams.has('outbox.status'), false, 'receipt history is independent of the attempt filter');
    });
    await t.test('out-of-range pages keep verified totals and an empty page instead of reporting a backend outage', async () => {
      failure = 'range';
      const result = await withRequestContext({ authorization: 'Bearer delivery-reader-test' }, () => getOutboxOverview({ page: 10001, receiptPage: 10001 }));
      assert.equal(result.totalRows, 1250);
      assert.equal(result.totalReceipts, 1250);
      assert.equal(result.page, 10001);
      assert.equal(result.receiptPage, 10001);
      assert.equal(result.rows.length, 0);
      assert.equal(result.recentReceipts.length, 0);
      failure = 'none';
    });
    await t.test('missing counts cannot appear as zero', async () => {
      failure = 'count';
      await assert.rejects(run(), /authoritative count unavailable/);
    });
    await t.test('failed receipt reads cannot appear as an empty successful delivery view', async () => {
      failure = 'receipt';
      await assert.rejects(run(), /delivery receipts/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget();
    restoreDefaults();
  }
});
