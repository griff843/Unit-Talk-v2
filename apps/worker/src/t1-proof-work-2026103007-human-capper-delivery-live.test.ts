/** WORK-2026103007 worker half: real staging claim/confirm, SIMULATED Discord. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvironment } from '@unit-talk/config';
import { createDatabaseRepositoryBundle, createServiceRoleDatabaseConnectionConfig } from '@unit-talk/db';
import { runWorkerCycles, type DeliveryAdapter } from './runner.js';

const environment = loadEnvironment();
const supabaseUrl = environment.SUPABASE_URL ?? '';
const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? '';
const fixtureRun = process.env['CI_FIXTURE_RUN_ID'];
const host = new URL(supabaseUrl || 'http://localhost').hostname;
const stagingHost = 'xskgrzbteyqdufktjrjx.supabase.co';
const skip = !fixtureRun && host !== stagingHost
  ? 'no approved staging target configured; CI staging receipt required'
  : false;
const namespace = (fixtureRun ?? 'local-unconfigured').replace(/[^A-Za-z0-9-]/g, '-').slice(0, 48);
const capperId = `work3007-${namespace}`.toLowerCase();
const targetKey = `work3007-${namespace}`;
const target = `discord:${targetKey}`;
const actor = `proof-worker:${namespace}`;

async function rest<T>(path: string, method = 'GET', body?: unknown): Promise<T[]> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method, headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.ok, true, `staging ${method} failed (${response.status})`);
  return await response.json() as T[];
}

test('WORK-2026103007 live staging: real atomic claim/confirm, exactly once and owned kill control with SIMULATED Discord adapter', { skip }, async () => {
  assert.equal(new URL(supabaseUrl).protocol, 'https:');
  assert.equal(host, stagingHost, 'refusing any other database before client construction');
  assert.ok(serviceRoleKey);
  assert.ok(fixtureRun, 'shared CI fixture namespace is required');
  const repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(environment));
  assert.ok(repositories.killSwitch);
  const picks = await rest<{ id: string; status: string; metadata: Record<string, unknown> }>(
    `picks?capper_id=eq.${capperId}&select=id,status,metadata`);
  const deliveryPicks = picks.filter((pick) => pick.metadata['proof_role'] === 'delivery');
  assert.equal(deliveryPicks.length, 1, 'API proof must leave one indexed, run-owned delivery pick');
  const pick = deliveryPicks[0]!;
  assert.equal(pick.status, 'queued');
  const outbox = await repositories.outbox.listByPickId(pick.id);
  assert.equal(outbox.length, 1);
  const original = outbox[0]!;
  assert.equal(original.target, 'discord:official-picks');
  assert.equal(original.status, 'pending');
  const destination = (original.payload as Record<string, unknown>)['deliveryDestination'] as Record<string, unknown>;
  assert.equal(destination['capperId'], capperId);
  assert.equal(destination['channelId'], '100000000000000002');
  const ownedSwitch = await rest<{ actor: string | null }>(`delivery_kill_switch?target=eq.${targetKey}&select=actor`);
  assert.equal(ownedSwitch.length, 0, 'do not overwrite an existing switch, even under the fixture namespace');

  let calls = 0;
  const deliver: DeliveryAdapter = async (row) => {
    calls++;
    assert.equal(row.id, original.id);
    assert.equal(row.pick_id, pick.id);
    assert.equal(row.target, target);
    return { receiptType: 'discord.message', status: 'sent', channel: '100000000000000002',
      externalId: '100000000000000005', dispatch: 'delivered',
      payload: { adapter: 'SIMULATED-discord-stub', simulated: true, dryRun: true,
        channelId: '100000000000000002', guildId: '100000000000000001', capperId,
        target, outboxId: row.id, messageId: '100000000000000005' } };
  };
  const cycle = () => runWorkerCycles({ repositories, workerId: actor, targets: [target], deliver,
    persistenceMode: 'database', maxCycles: 1, workerHeartbeatIntervalMs: 0,
    autoRecoveryEnabled: false, sleep: async () => {} });

  await repositories.killSwitch.setKilled({ target: targetKey, killed: true, actor, reason: 'WORK3007 fixture-owned switch' });
  try {
    // Move only the pending API-created fixture row to a unique target. Its
    // canonical payload/pin stays intact; no shared target switch is touched.
    const moved = await rest<{ id: string }>(
      `distribution_outbox?id=eq.${original.id}&pick_id=eq.${pick.id}&status=eq.pending`, 'PATCH', { target });
    assert.equal(moved.length, 1);
    const killed = await cycle();
    assert.equal(killed[0]?.results[0]?.status, 'kill-switch-engaged');
    assert.equal(calls, 0);
    assert.equal((await repositories.outbox.listByPickId(pick.id)).find((row) => row.id === original.id)?.status, 'pending');

    await repositories.killSwitch.setKilled({ target: targetKey, killed: false, actor, reason: 'release only owned simulated target' });
    const sent = await cycle();
    assert.equal(sent[0]?.results[0]?.status, 'sent');
    assert.equal(calls, 1);
    assert.equal((await repositories.picks.findPickById(pick.id))?.status, 'posted');
    const receipts = await rest<{ status: string; receipt_type: string; channel: string; external_id: string; payload: Record<string, unknown> }>(
      `distribution_receipts?outbox_id=eq.${original.id}&select=status,receipt_type,channel,external_id,payload`);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]!.status, 'sent');
    assert.equal(receipts[0]!.receipt_type, 'discord.message');
    assert.equal(receipts[0]!.external_id, '100000000000000005');
    assert.equal(receipts[0]!.channel, destination['channelId']);
    assert.equal(receipts[0]!.payload['channelId'], destination['channelId']);
    assert.equal(receipts[0]!.payload['simulated'], true);
    const repeated = await cycle();
    assert.equal(repeated[0]?.results[0]?.status, 'idle');
    assert.equal(calls, 1, 'second real claim cycle must not invoke adapter again');
    // Dispatch-ledger coverage is NOT claimed: real worker classifies this
    // unique target as ungoverned. Central packet resolution is still required.
  } finally {
    const rows = await rest<{ actor: string | null }>(`delivery_kill_switch?target=eq.${targetKey}&select=actor`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actor, actor, 'cleanup must not delete another owner\'s switch');
    await rest(`delivery_kill_switch?target=eq.${targetKey}&actor=eq.${encodeURIComponent(actor)}`, 'DELETE');
  }
});
