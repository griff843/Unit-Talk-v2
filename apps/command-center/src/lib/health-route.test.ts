import assert from 'node:assert/strict';
import test from 'node:test';
import { createHealthHandler } from '../app/api/health/route';
import { retainPrivilegedHealthAcrossPublicLiveness } from './global-health';

test('anonymous health is liveness-only even after privileged cache population', async () => {
  await withAuthEnv(
    { UNIT_TALK_APP_ENV: 'production', COMMAND_CENTER_AUTH_TOKEN: 'real-token' },
    async () => {
      let reads = 0;
      const handler = createHealthHandler(async () => {
        reads += 1;
        return {
          status: 'degraded',
          degradedSignals: ['private database signal'],
          observedAt: '2026-09-05T12:00:00.000Z',
        };
      });

      const privileged = await handler(new Request('http://localhost/api/health', {
        headers: { authorization: 'Bearer real-token' },
      }));
      assert.equal(privileged.status, 200);
      assert.deepEqual(await privileged.json(), {
        status: 'degraded',
        degradedSignals: ['private database signal'],
        observedAt: '2026-09-05T12:00:00.000Z',
      });

      const anonymous = await handler(new Request('http://localhost/api/health'));
      const body = await anonymous.json() as Record<string, unknown>;
      assert.equal(anonymous.status, 200);
      assert.deepEqual(body, { ok: true, service: 'command-center' });
      assert.equal('status' in body, false);
      assert.equal('degradedSignals' in body, false);
      assert.equal('observedAt' in body, false);
      assert.equal(reads, 1, 'anonymous liveness must not read or reuse privileged health');
    },
  );
});

test('public liveness does not expose auth misconfiguration guidance', async () => {
  await withAuthEnv({ UNIT_TALK_APP_ENV: 'production' }, async () => {
    const response = await createHealthHandler(async () => {
      throw new Error('must not run');
    })(new Request('http://localhost/api/health'));

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, service: 'command-center' });
    assert.doesNotMatch(JSON.stringify(body), /COMMAND_CENTER_AUTH|configure|username|password/i);
  });
});

test('bearer health pill retains its server-rendered privileged snapshot on public refresh', () => {
  const initial = {
    status: 'degraded' as const,
    degradedSignals: ['database lag'],
    observedAt: '2026-09-05T12:00:00.000Z',
  };

  assert.equal(
    retainPrivilegedHealthAcrossPublicLiveness(
      initial,
      { ok: true, service: 'command-center' },
    ),
    initial,
  );
});

async function withAuthEnv(
  values: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const keys = [
    'NODE_ENV',
    'UNIT_TALK_APP_ENV',
    'COMMAND_CENTER_AUTH_MODE',
    'COMMAND_CENTER_AUTH_TOKEN',
    'COMMAND_CENTER_AUTH_USERNAME',
    'COMMAND_CENTER_AUTH_PASSWORD',
    'UNIT_TALK_COMMAND_CENTER_AUTH_MODE',
    'UNIT_TALK_COMMAND_CENTER_AUTH_TOKEN',
    'UNIT_TALK_COMMAND_CENTER_AUTH_USERNAME',
    'UNIT_TALK_COMMAND_CENTER_AUTH_PASSWORD',
    'UNIT_TALK_OPERATOR_RUNTIME_MODE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);

  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
