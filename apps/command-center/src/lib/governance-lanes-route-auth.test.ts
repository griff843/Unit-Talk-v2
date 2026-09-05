/**
 * Authentication behaviour of the `/api/governance/lanes` route.
 *
 * These assertions live here rather than beside the route because
 * `src/app/api/governance/lanes/route.test.ts` is not reachable from any
 * package script — it is a reviewed entry in
 * `docs/05_operations/executable-wiring-baseline.json`, and wiring it would
 * require editing that baseline, which is outside this lane's file scope. A
 * test that does not run cannot pin a security control, so the control is
 * pinned from a file the `test` script actually executes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { GET, createGovernanceLanesHandler } from '../app/api/governance/lanes/route';

const AUTH_ENV_KEYS = [
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
] as const;

async function withAuthEnv(
  values: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  // `process.env.NODE_ENV` is typed read-only, so the save/restore goes through a
  // mutable view of the same object rather than casting at each assignment.
  const env = process.env as Record<string, string | undefined>;
  const previous = new Map(AUTH_ENV_KEYS.map((key) => [key as string, env[key]]));
  for (const key of AUTH_ENV_KEYS) delete env[key];
  Object.assign(env, values);
  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

test('governance lanes route refuses forged actor headers without credentials', async () => {
  await withAuthEnv(
    {
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'real-token',
    },
    async () => {
      const response = await GET(
        new Request('http://localhost/api/governance/lanes', {
          headers: { 'x-command-center-actor': 'attacker' },
        }),
      );
      assert.equal(response.status, 401);
    },
  );
});

test('governance lanes route serves the snapshot once authentication is satisfied', async () => {
  await withAuthEnv({ NODE_ENV: 'test', COMMAND_CENTER_AUTH_MODE: 'disabled' }, async () => {
    const response = await createGovernanceLanesHandler(async () => ({
      observedAt: '2026-07-14T13:00:00.000Z',
      sourceStatus: 'degraded',
      missingSources: [],
      activeLanes: [],
      blockedLanes: [],
      awaitingPmVerdict: [],
    }))(new Request('http://localhost/api/governance/lanes'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('governance lanes route declares no write handlers', async () => {
  const route = await import('../app/api/governance/lanes/route');
  assert.equal('POST' in route, false);
  assert.equal('PUT' in route, false);
  assert.equal('PATCH' in route, false);
  assert.equal('DELETE' in route, false);
});
