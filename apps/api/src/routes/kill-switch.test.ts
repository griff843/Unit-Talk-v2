import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../server.js';
import { createInMemoryRepositoryBundle } from '../persistence.js';

test('GET /api/discord/kill-switch returns an empty list before any toggle', async () => {
  const server = createApiServer({ repositories: createInMemoryRepositoryBundle() });
  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/discord/kill-switch`);
    const body = (await response.json()) as { ok: boolean; targets: unknown[] };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.targets, []);
  } finally {
    server.close();
  }
});

test('POST /api/discord/kill-switch rejects an invalid target', async () => {
  const server = createApiServer({ repositories: createInMemoryRepositoryBundle() });
  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/discord/kill-switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'not-a-real-target', killed: true }),
    });
    const body = (await response.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'INVALID_TARGET');
  } finally {
    server.close();
  }
});

test('POST /api/discord/kill-switch engages the switch, records audit, and GET reflects it', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  try {
    const postResponse = await fetch(`http://127.0.0.1:${address.port}/api/discord/kill-switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'best-bets', killed: true, reason: 'incident drill' }),
    });
    const postBody = (await postResponse.json()) as { ok: boolean; target: string; killed: boolean };
    assert.equal(postResponse.status, 200);
    assert.equal(postBody.ok, true);
    assert.equal(postBody.target, 'best-bets');
    assert.equal(postBody.killed, true);

    const auditRows = await repositories.audit.listRecentByEntityType(
      'delivery_target',
      new Date(Date.now() - 60_000).toISOString(),
    );
    assert.ok(
      auditRows.some((row) => row.action === 'discord_kill_switch.engaged' && row.entity_ref === 'best-bets'),
      'engaging the kill switch must write an audit_log row',
    );

    const getResponse = await fetch(`http://127.0.0.1:${address.port}/api/discord/kill-switch`);
    const getBody = (await getResponse.json()) as {
      ok: boolean;
      targets: Array<{ target: string; killed: boolean }>;
    };
    assert.equal(getBody.targets.find((t) => t.target === 'best-bets')?.killed, true);
  } finally {
    server.close();
  }
});

test('POST /api/discord/kill-switch ignores a client-supplied actor and derives it from the authenticated context', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  try {
    // No API keys configured on this server -> auth runs in fail_open bypass
    // mode with a fixed bypass identity. Even if a client tries to spoof an
    // actor in the body, the audit trail must record the real (bypass)
    // authenticated identity, never the client-supplied value.
    const response = await fetch(`http://127.0.0.1:${address.port}/api/discord/kill-switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'best-bets', killed: true, actor: 'attacker-spoofed-identity' }),
    });
    assert.equal(response.status, 200);

    const auditRows = await repositories.audit.listRecentByEntityType(
      'delivery_target',
      new Date(Date.now() - 60_000).toISOString(),
    );
    const engaged = auditRows.find((row) => row.action === 'discord_kill_switch.engaged');
    assert.ok(engaged, 'expected an audit row for the engage action');
    assert.notEqual(engaged?.actor, 'attacker-spoofed-identity');
  } finally {
    server.close();
  }
});

test('GET /api/discord/kill-switch requires authentication when API keys are configured', async () => {
  const previousOperatorKey = process.env.UNIT_TALK_API_KEY_OPERATOR;
  process.env.UNIT_TALK_API_KEY_OPERATOR = 'test-operator-key';

  const server = createApiServer({ repositories: createInMemoryRepositoryBundle() });
  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  try {
    const unauthenticated = await fetch(`http://127.0.0.1:${address.port}/api/discord/kill-switch`);
    assert.equal(unauthenticated.status, 401);

    const authenticated = await fetch(`http://127.0.0.1:${address.port}/api/discord/kill-switch`, {
      headers: { authorization: 'Bearer test-operator-key' },
    });
    assert.equal(authenticated.status, 200);
  } finally {
    server.close();
    if (previousOperatorKey === undefined) {
      delete process.env.UNIT_TALK_API_KEY_OPERATOR;
    } else {
      process.env.UNIT_TALK_API_KEY_OPERATOR = previousOperatorKey;
    }
  }
});

test('an unreleased target defaults to killed (fail closed) even without an explicit row', async () => {
  const repositories = createInMemoryRepositoryBundle();
  assert.ok(repositories.killSwitch);
  const killed = await repositories.killSwitch!.isKilled('trader-insights');
  assert.equal(killed, true, 'a target never explicitly toggled must default to killed');
});
