/**
 * WORK-2026110305 (carried WORK-2026103007) worker half: real staging
 * claim/confirm with SIMULATED Discord. Retargeting the API row is a test-fixture
 * step authorized by the contract author; the official-picks claim path and
 * governed-target dispatch ledger are not exercised.
 */
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

test('WORK-2026103007 live staging: test-fixture retarget, real atomic claim/confirm, exactly once and owned kill control with SIMULATED Discord adapter; no official-picks claim', { skip }, async () => {
  assert.equal(new URL(supabaseUrl).protocol, 'https:');
  assert.equal(host, stagingHost, 'refusing any other database before client construction');
  assert.ok(serviceRoleKey);
  assert.ok(fixtureRun, 'shared CI fixture namespace is required');
  const repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(environment));
  assert.ok(repositories.killSwitch);
  const cappers = await rest<{ id: string; metadata: Record<string, unknown> }>(
    `cappers?id=eq.${capperId}&select=id,metadata`);
  assert.equal(cappers.length, 1, `missing fixture capper ${capperId}`);
  const pickId = cappers[0]!.metadata['proofDeliveryPickId'];
  assert.ok(typeof pickId === 'string' && /^[0-9a-f-]{36}$/i.test(pickId),
    'API proof must persist its pick-ID handoff');
  const picks = await rest<{ id: string; capper_id: string | null; status: string; metadata: Record<string, unknown> }>(
    `picks?id=eq.${pickId}&select=id,capper_id,status,metadata`);
  const diagnostic = JSON.stringify({ pickId, picks });
  assert.equal(picks.length, 1, diagnostic);
  const pick = picks[0]!;
  assert.equal(pick.capper_id, capperId, diagnostic);
  assert.equal(pick.metadata['proof_role'], 'delivery', diagnostic);
  assert.equal(pick.status, 'queued');
  const outbox = await repositories.outbox.listByPickId(pick.id);
  assert.equal(outbox.length, 1);
  const original = outbox[0]!;
  assert.equal(original.target, 'discord:official-picks');
  assert.equal(original.status, 'pending');
  assert.equal(original.claimed_at, null);
  assert.equal(original.claimed_by, null);
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
    // Authorized test-fixture step, not a production delivery operation. Move
    // only this unclaimed pending row away from official-picks. Never remap the
    // namespaced target onto a governed target to manufacture ledger coverage.
    const moved = await rest<{ id: string }>(
      `distribution_outbox?id=eq.${original.id}&pick_id=eq.${pick.id}&status=eq.pending&claimed_at=is.null&claimed_by=is.null`, 'PATCH', { target });
    assert.equal(moved.length, 1);
    assert.equal(moved[0]!.id, original.id);
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
    const lifecycle = await rest<{ from_state: string | null; to_state: string }>(
      `pick_lifecycle?pick_id=eq.${pick.id}&select=from_state,to_state`);
    assert.equal(lifecycle.filter((row) => row.from_state === 'queued' && row.to_state === 'posted').length, 1);
    const finalReceipts = await rest<{ id: string }>(
      `distribution_receipts?outbox_id=eq.${original.id}&select=id`);
    assert.equal(finalReceipts.length, 1, 'second cycle must not create another receipt');
    // The real ungoverned-target contract is zero dispatch-ledger entries.
    // Governed-target coverage remains with in-memory tests and the canary.
    const ledger = await rest<{ id: string }>(
      `audit_log?entity_ref=eq.${pick.id}&action=like.distribution.dispatch_*&select=id`);
    assert.equal(ledger.length, 0, 'namespaced target must not write governed dispatch ledger rows');
  } finally {
    const rows = await rest<{ actor: string | null }>(`delivery_kill_switch?target=eq.${targetKey}&select=actor`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actor, actor, 'cleanup must not delete another owner\'s switch');
    await rest(`delivery_kill_switch?target=eq.${targetKey}&actor=eq.${encodeURIComponent(actor)}`, 'DELETE');
  }
});
