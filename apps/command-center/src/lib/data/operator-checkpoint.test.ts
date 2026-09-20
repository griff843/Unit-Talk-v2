import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('operator checkpoint uses canonical relations and complete counts', async (t) => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'checkpoint-test';
  const { getPickDetail } = await import('./queues');
  const { getNonGovernedDeliveryRows } = await import('./picks');
  const originalFetch = globalThis.fetch;
  const run = <T>(fn: () => T) => withRequestContext({ authorization: 'Bearer checkpoint-test' }, fn);
  const requests: URL[] = [];
  let submissionId: string | null = 'submission-1';
  let delivered = true;
  let failedTable: string | null = null;
  const tables: Record<string, Record<string, unknown>[]> = {
    picks_current_state: [{ id: 'pick-1', status: 'validated', metadata: { distributionMode: 'track-only' } }],
    pick_lifecycle: [{ id: 'life-1', pick_id: 'pick-1', to_state: 'validated' }],
    pick_promotion_history: [{ id: 'promotion-1', pick_id: 'pick-1', target: 'best-bets', version: 'policy-v2', score: 75, status: 'qualified' }],
    distribution_outbox: [{ id: 'outbox-1', pick_id: 'pick-1', target: 'discord:official-picks', status: 'sent' }],
    distribution_receipts: [{ id: 'receipt-1', outbox_id: 'outbox-1', external_id: 'message-1' }],
    settlement_records: [{ id: 'correction-1', pick_id: 'pick-1', corrects_id: 'settlement-1', result: 'loss', payload: {} }, { id: 'settlement-1', pick_id: 'pick-1', result: 'win', payload: {} }],
    audit_log: [{ id: 'audit-1', entity_ref: 'pick-1', action: 'settlement.recorded', actor: 'operator' }],
    submissions: [{ id: 'submission-1', payload: { selection: 'Lions' } }],
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    const table = url.pathname.split('/').at(-1)!;
    if (table === failedTable) return Response.json({ message: 'database unavailable' }, { status: 503 });
    const select = url.searchParams.get('select') ?? '';
    if (table === 'pick_promotion_history') {
      assert.doesNotMatch(select, /promotion_target|policy_version/);
      assert.ok(select.split(',').map((s) => s.trim()).includes('target'));
      assert.ok(select.split(',').map((s) => s.trim()).includes('version'));
    }
    if (table === 'submissions') {
      assert.doesNotMatch(select, /pick_id/);
      assert.equal(url.searchParams.get('id'), 'eq.submission-1');
      assert.equal(url.searchParams.has('pick_id'), false);
    }
    const rows = table === 'distribution_outbox' && !delivered ? [] : tables[table];
    assert.ok(rows, `unexpected table ${table}`);
    if (table === 'picks_current_state') return Response.json({ ...rows[0], submission_id: submissionId });
    if (table === 'submissions') return Response.json(rows[0]);
    return Response.json(rows);
  };
  try {
    await t.test('opens lifecycle, promotion, receipt, settlement corrections, submission and audit', async () => {
      const result = await run(() => getPickDetail('pick-1'));
      assert.ok(result);
      assert.equal(result.promotionHistory[0]?.target, 'best-bets');
      assert.equal(result.promotionHistory[0]?.version, 'policy-v2');
      assert.equal(result.lifecycle[0]?.toState, 'validated');
      assert.equal(result.receipts[0]?.externalId, 'message-1');
      assert.equal(result.settlements[0]?.correctsId, 'settlement-1');
      assert.equal(result.settlements.length, 2);
      assert.equal(result.auditTrail[0]?.actor, 'operator');
      assert.equal(result.submission?.id, 'submission-1');
      assert.equal(result.pick.submissionId, 'submission-1');
    });
    await t.test('preserves absent delivery and optional submission without invalid queries', async () => {
      delivered = false;
      submissionId = null;
      requests.length = 0;
      const result = await run(() => getPickDetail('pick-1'));
      assert.ok(result);
      assert.deepEqual(result.outboxRows, []);
      assert.deepEqual(result.receipts, []);
      assert.equal(result.submission, null);
      assert.equal(result.pick.metadata['distributionMode'], 'track-only');
      assert.ok(requests.every((url) => !/submissions|distribution_receipts/.test(url.pathname)));
    });
    await t.test('query failure remains a failure instead of invented empty history', async () => {
      failedTable = 'pick_promotion_history';
      await assert.rejects(run(() => getPickDetail('pick-1')), /promotion history: database unavailable/);
    });
    const population = [
      ...Array.from({ length: 2195 }, (_, i) => ({ id: `sent-${i}`, target: 'discord:canary', status: 'sent' })),
      ...Array.from({ length: 1614 }, (_, i) => ({ id: `dead-${i}`, target: 'discord:canary', status: 'dead_letter' })),
      ...Array.from({ length: 32 }, (_, i) => ({ id: `processing-${i}`, target: 'test-target', status: 'processing' })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `pending-${i}`, target: 'test-target', status: 'pending' })),
    ];
    let unavailableCount = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.match(url.searchParams.get('target') ?? '', /^not\.in\./);
      assert.match(url.searchParams.get('target') ?? '', /discord:official-picks/);
      const status = url.searchParams.get('status')?.replace('eq.', '');
      if (init?.method === 'HEAD') {
        assert.match(new Headers(init.headers).get('prefer') ?? '', /count=exact/);
        const count = population.filter((row) => row.status === status).length;
        return new Response(null, { headers: unavailableCount ? {} : { 'content-range': `*/${count}` } });
      }
      const limit = Number(url.searchParams.get('limit') ?? 1000);
      assert.equal(limit, 50);
      return Response.json(population.slice(0, limit));
    };
    await t.test('3844-row population has exact status totals independent of 50 displayed rows', async () => {
      const result = await run(getNonGovernedDeliveryRows);
      assert.equal(result.total, 3844);
      assert.equal(result.rows.length, 50);
      assert.deepEqual(result.statusCounts, { pending: 3, processing: 32, sent: 2195, failed: 0, dead_letter: 1614 });
    });
    await t.test('missing count cannot become a false zero', async () => {
      unavailableCount = true;
      await assert.rejects(run(getNonGovernedDeliveryRows), /authoritative count unavailable/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreDefaults();
    restoreTarget();
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
  }
});
