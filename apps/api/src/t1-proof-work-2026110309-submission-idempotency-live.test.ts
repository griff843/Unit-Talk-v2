/** WORK-2026110309: staging-only real pipeline proof; no delivery adapter or target. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  transitionPickLifecycle,
} from '@unit-talk/db';
import { processSubmission } from './submission-service.js';
import { submitPickController } from './controllers/submit-pick-controller.js';

const fixtureRun = process.env['CI_FIXTURE_RUN_ID'];
const environment = loadEnvironment();
const url = environment.SUPABASE_URL ?? '';
const key = environment.SUPABASE_SERVICE_ROLE_KEY ?? '';
const stagingHost = 'xskgrzbteyqdufktjrjx.supabase.co';
const skip = !fixtureRun ? 'requires staging-ci and CI_FIXTURE_RUN_ID; no local DB writes' : false;

test('WORK0309 live staging: capper isolation, retry dedupe and immutable Track Only in both orders', { skip }, async (t) => {
  // Validate target before constructing any privileged client. Credentialed CI never skips.
  assert.equal(process.env['CI'], 'true', 'writable proof runs through CI only');
  assert.ok(fixtureRun);
  assert.equal(new URL(url).protocol, 'https:');
  assert.equal(new URL(url).hostname, stagingHost);
  assert.ok(key, 'staging CI service credential required');
  const namespace = `work0309-${fixtureRun.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 32)}-${randomUUID()}`;
  const cappers = [`${namespace}-a`, `${namespace}-b`].map((id) => id.toLowerCase());
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(environment));
  const ownedIds = new Set<string>();

  async function rows(table: string, query: string): Promise<Record<string, unknown>[]> {
    const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
    assert.equal(response.ok, true, `${table} read failed (${response.status})`);
    return await response.json() as Record<string, unknown>[];
  }
  async function byId(table: string, id: string) {
    const result = await rows(table, `id=eq.${encodeURIComponent(id)}&select=*`);
    assert.equal(result.length, 1, `${table} primary ID ${id}`);
    assert.equal(result[0]!.id, id);
    return result[0]!;
  }
  async function snapshot(id: string) {
    const pick = await byId('picks', id);
    const outbox = await rows('distribution_outbox', `pick_id=eq.${id}&select=*`);
    for (const row of outbox) assert.deepEqual(await byId('distribution_outbox', String(row.id)), row);
    return { pick, outbox };
  }
  function payload(capper: string, label: string, mode: string) {
    // Six legacy wager fields are namespaced too, avoiding prior-run collisions.
    return { source: 'api' as const, market: 'moneyline', selection: `${namespace} ${label}`,
      eventName: `${namespace} fixture`, odds: -110, stakeUnits: 1, submittedBy: capper,
      metadata: { distributionMode: mode, proof_issue: 'WORK-2026110309', proof_run: namespace } };
  }
  async function capture(id: string, capper: string) {
    ownedIds.add(id);
    const state = await snapshot(id);
    assert.equal(state.pick.capper_id, capper);
    assert.deepEqual(state.outbox, [], 'unqualified fixture must never touch a delivery target');
    await byId('submissions', String(state.pick.submission_id));
    for (const row of await rows('pick_lifecycle', `pick_id=eq.${id}&select=*`)) {
      assert.deepEqual(await byId('pick_lifecycle', String(row.id)), row);
    }
    return state;
  }
  // Preserve append-only audit history; void test-owned picks through the FSM.
  // Fixture rows and seeded cappers remain namespaced for CI evidence readback.
  t.after(async () => {
    for (const id of ownedIds) {
      const pick = await byId('picks', id);
      assert.ok(cappers.includes(String(pick.capper_id)));
      if (pick.status !== 'voided') {
        await transitionPickLifecycle(repositories.picks, id, 'voided', `WORK0309 cleanup ${namespace}`, 'operator_override');
      }
      assert.equal((await byId('picks', id)).status, 'voided');
      assert.deepEqual(await rows('distribution_outbox', `pick_id=eq.${id}&select=*`), []);
    }
  });
  const seeded = await fetch(`${url}/rest/v1/cappers`, { method: 'POST', headers,
    body: JSON.stringify(cappers.map((id) => ({ id, display_name: id, active: true, metadata: { proof_run: namespace } }))) });
  assert.equal(seeded.ok, true, `seed cappers failed (${seeded.status})`);
  for (const capper of cappers) await byId('cappers', capper);

  const first = await processSubmission(payload(cappers[0]!, 'shared', 'track-only'), repositories);
  await capture(first.pick.id, cappers[0]!);
  const second = await processSubmission(payload(cappers[1]!, 'shared', 'track-only'), repositories);
  await capture(second.pick.id, cappers[1]!);
  assert.notEqual(first.pick.id, second.pick.id);
  const beforeRetry = await snapshot(second.pick.id);
  const retry = await processSubmission(payload(cappers[1]!, 'shared', 'track-only'), repositories);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.pick.id, second.pick.id);
  assert.deepEqual(await snapshot(second.pick.id), beforeRetry);

  for (const modes of [['track-only', 'delivery-eligible'], ['delivery-eligible', 'track-only']] as const) {
    const label = modes.join('-');
    const a = await submitPickController(payload(cappers[0]!, label, modes[0]), repositories);
    assert.ok(a.body.ok);
    if (!a.body.ok) throw new Error('first controller submission failed');
    const before = await capture(a.body.data.pickId, cappers[0]!);
    const b = await submitPickController(payload(cappers[0]!, label, modes[1]), repositories);
    assert.ok(b.body.ok);
    if (!b.body.ok) throw new Error('second controller submission failed');
    await capture(b.body.data.pickId, cappers[0]!);
    assert.notEqual(a.body.data.pickId, b.body.data.pickId);
    assert.deepEqual(await snapshot(a.body.data.pickId), before);
  }
  const persisted = await rows('picks', `capper_id=in.(${cappers.join(',')})&select=id`);
  assert.deepEqual(persisted.map((row) => String(row.id)).sort(), [...ownedIds].sort());
  assert.equal(persisted.length, 6, 'retry inserted no seventh pick');
  for (const row of persisted) await byId('picks', String(row.id));
  t.diagnostic(JSON.stringify({ issue: 'WORK-2026110309', namespace,
    queries: ['picks?id=eq.<primary-id>', 'submissions?id=eq.<primary-id>',
      'pick_lifecycle?id=eq.<primary-id>', 'distribution_outbox?pick_id=eq.<primary-id>', 'cappers?id=eq.<primary-id>'],
    row_counts: { cappers: 2, picks: 6, outbox: 0 }, pick_ids: [...ownedIds] }));
});
