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
      body: JSON.stringify({ target: 'not-a-real-target', killed: true, actor: 'test-op' }),
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
      body: JSON.stringify({ target: 'best-bets', killed: true, actor: 'test-op', reason: 'incident drill' }),
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

test('an unreleased target defaults to killed (fail closed) even without an explicit row', async () => {
  const repositories = createInMemoryRepositoryBundle();
  assert.ok(repositories.killSwitch);
  const killed = await repositories.killSwitch!.isKilled('trader-insights');
  assert.equal(killed, true, 'a target never explicitly toggled must default to killed');
});
