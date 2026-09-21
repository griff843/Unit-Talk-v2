import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('system provider telemetry reads only bounded provider sources and exact offer counts', async () => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'provider-telemetry-test';
  const originalFetch = globalThis.fetch;
  const { getSystemProviderTelemetry } = await import('./provider-telemetry');
  let failCounts = false;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const params = url.searchParams;
    assert.ok(request.signal);
    assert.ok(['/rest/v1/system_runs', '/rest/v1/provider_offer_current', '/rest/v1/provider_cycle_status'].includes(url.pathname), 'must not fan out into operational pick/audit/delivery tables');
    if (url.pathname.endsWith('/system_runs')) {
      assert.equal(params.get('run_type'), 'eq.ingestor.cycle');
      assert.match(params.get('started_at') ?? '', /^gte\./);
      assert.equal(params.get('limit'), '500');
      return Response.json([{ started_at: new Date().toISOString(), details: { quota: { provider: 'sgo', requestCount: 3, limit: 100, remaining: 5 } } }], { headers: { 'content-range': '0-0/1' } });
    }
    assert.match(params.get('or') ?? '', /provider_key.eq.(sgo|odds-api),provider_key.like./);
    if (url.pathname.endsWith('/provider_cycle_status')) {
      assert.equal(params.get('limit'), '12');
      assert.match(params.get('updated_at') ?? '', /^gte\./);
      return Response.json([{ updated_at: new Date().toISOString(), metadata: { latencyMs: { total: 250 } } }]);
    }
    if (request.method === 'HEAD') return new Response(null, { headers: failCounts ? {} : { 'content-range': `*/${params.has('created_at') ? 1200 : 4500}` } });
    assert.equal(params.get('limit'), '1');
    return Response.json([{ snapshot_at: new Date(Date.now() - 60_000).toISOString() }]);
  };
  const read = () => withRequestContext({ authorization: 'Bearer provider-telemetry-test' }, getSystemProviderTelemetry);
  try {
    const telemetry = await read();
    const sgo = telemetry.providers.find((row) => row.provider === 'sgo')!;
    assert.equal(sgo.totalOffers, 4500);
    assert.equal(sgo.createdOffers24h, 1200);
    assert.equal(sgo.quota?.requests, 3, 'offer volume must never become an API request count');
    assert.equal(sgo.quota?.quotaPct, 95);
    assert.equal(sgo.meanCycleMs, 250);
    assert.equal(sgo.freshness, 'fresh');
    failCounts = true;
    const degraded = await read();
    assert.equal(degraded.providers[0]?.totalOffers, null);
    assert.equal(degraded.providers[0]?.quota?.requests, 3);
    assert.match(degraded.problems.join(' '), /count unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN; else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
});
