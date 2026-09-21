import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('recap reads isolate the exact pick and effective settlement and refuse partial evidence', async () => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'recap-test';
  const originalFetch = globalThis.fetch;
  const { getSettlementRecapStatus } = await import('./recap');
  let missingCount = false;
  let count = 0;
  globalThis.fetch = async (input, init) => {
    count++;
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.pathname, '/rest/v1/system_runs');
    assert.equal(url.searchParams.get('run_type'), 'eq.recap.post');
    assert.equal(url.searchParams.get('details->>recapKind'), 'eq.settlement-pick');
    assert.equal(url.searchParams.get('details->>pickId'), 'eq.pick-1');
    assert.equal(url.searchParams.get('details->>settlementRecordId'), 'eq.correction-2');
    return Response.json([{ id: 'run-1', status: 'succeeded', started_at: '2026-09-20T00:00:00Z', finished_at: '2026-09-20T00:00:01Z', details: { posted: true, channel: 'channel-1' } }], { headers: missingCount ? {} : { 'content-range': '0-0/1' } });
  };
  const read = () => withRequestContext({ authorization: 'Bearer recap-test' }, () => getSettlementRecapStatus('pick-1', 'correction-2', false));
  try {
    const outcome = await read();
    assert.equal(outcome.state, 'posted');
    assert.equal(count, 1);
    missingCount = true;
    await assert.rejects(read(), /authoritative count unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN; else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
});
