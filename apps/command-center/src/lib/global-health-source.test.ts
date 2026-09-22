import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from './test-support/request-context';
import { getPrivilegedGlobalHealth } from './global-health';

test('the shell reads the actual API health and never queries business tables', async () => {
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'health-source-test';
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let status = 'healthy';
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(new URL(String(input)).pathname, '/health');
    assert.ok(init?.signal);
    return Response.json({ status, warnings: status === 'degraded' ? ['queue delayed'] : [] }, { status: status === 'degraded' ? 503 : 200 });
  };
  try {
    const run = () => withRequestContext({ authorization: 'Bearer health-source-test' }, getPrivilegedGlobalHealth);
    assert.equal((await run()).status, 'healthy');
    status = 'degraded';
    assert.deepEqual((await run()).degradedSignals, ['queue delayed']);
    status = 'down';
    assert.equal((await run()).status, 'down');
    status = 'invalid';
    await assert.rejects(run(), /recognized status/);
    const before = calls;
    await assert.rejects(() => withRequestContext({}, getPrivilegedGlobalHealth));
    assert.equal(calls, before, 'anonymous requests cannot drive the health probe');
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
  }
});
