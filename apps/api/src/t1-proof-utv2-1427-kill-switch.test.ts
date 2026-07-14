/**
 * T1 Pre-Merge Proof: UTV2-1427 delivery kill switch
 *
 * Exercises DatabaseDeliveryKillSwitchRepository against the live Supabase
 * database — the InMemory implementation is what apps/worker's unit tests
 * cover, but this class of change (UTV2-519, UTV2-521) has shipped broken
 * before because InMemory semantics passed while the real Postgres upsert /
 * fail-closed-on-error path diverged.
 *
 * Fixture target is a deterministic, non-production target name
 * (`t1-proof-utv2-1427-kill-switch`) so it never collides with a real
 * governed Discord target and is easy to find after the run. The row is
 * left in place (not deleted) — T1 proofs never mutate/delete unrelated
 * live data, and this fixture's own target name can never match a real
 * governed target.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1427-kill-switch.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  DatabaseDeliveryKillSwitchRepository,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';

function hasSupabaseSmokeEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseSmokeEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

const FIXTURE_TARGET = 't1-proof-utv2-1427-kill-switch';
const UNKNOWN_TARGET = 't1-proof-utv2-1427-kill-switch-unknown-target';

let repository: DatabaseDeliveryKillSwitchRepository;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repository = new DatabaseDeliveryKillSwitchRepository(connection);
});

test('UTV2-1427 setKilled persists to real Postgres and isKilled reads it back', { skip: skipReason }, async () => {
  const row = await repository.setKilled({
    target: FIXTURE_TARGET,
    killed: true,
    actor: 't1-proof-runner',
    reason: 'UTV2-1427 live-DB proof — engaging fixture target',
  });

  assert.equal(row.target, FIXTURE_TARGET);
  assert.equal(row.killed, true);
  assert.equal(row.actor, 't1-proof-runner');

  const killed = await repository.isKilled(FIXTURE_TARGET);
  assert.equal(killed, true, 'isKilled must read the persisted killed=true state from real Postgres');

  console.log(`  setKilled/isKilled round-trip OK — target=${FIXTURE_TARGET}`);
});

test('UTV2-1427 setKilled upserts (release) rather than duplicating rows', { skip: skipReason }, async () => {
  const released = await repository.setKilled({
    target: FIXTURE_TARGET,
    killed: false,
    actor: 't1-proof-runner',
    reason: 'UTV2-1427 live-DB proof — releasing fixture target',
  });

  assert.equal(released.killed, false);

  const killed = await repository.isKilled(FIXTURE_TARGET);
  assert.equal(killed, false, 'isKilled must reflect the released state, not a stale duplicate row');

  const all = await repository.listAll();
  const fixtureRows = all.filter((r) => r.target === FIXTURE_TARGET);
  assert.equal(
    fixtureRows.length,
    1,
    'setKilled must upsert on target — exactly one row for the fixture target, not one per call',
  );

  console.log(`  upsert-not-insert OK — ${fixtureRows.length} row for target=${FIXTURE_TARGET}`);
});

test('UTV2-1427 isKilled fails closed for a target with no row', { skip: skipReason }, async () => {
  const killed = await repository.isKilled(UNKNOWN_TARGET);
  assert.equal(
    killed,
    true,
    'a target with no delivery_kill_switch row must be treated as killed (fail closed) against the real database',
  );

  console.log(`  fail-closed-on-unknown-target OK — target=${UNKNOWN_TARGET}`);
});

test('UTV2-1427 listAll surfaces the fixture row with correct field mapping', { skip: skipReason }, async () => {
  const all = await repository.listAll();
  const fixtureRow = all.find((r) => r.target === FIXTURE_TARGET);

  assert.ok(fixtureRow, 'listAll must include the fixture row');
  assert.equal(fixtureRow!.actor, 't1-proof-runner');
  assert.equal(fixtureRow!.killed, false);
  assert.equal(typeof fixtureRow!.updatedAt, 'string');

  console.log(`  listAll field mapping OK — target=${FIXTURE_TARGET} updatedAt=${fixtureRow!.updatedAt}`);
});

// Left in place at killed=false (released, inert) — never deleted. This
// fixture's target name can never collide with a real governed target.
