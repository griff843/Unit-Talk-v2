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
import { defaultTargetRegistry, isPromotionTargetBlocked } from '@unit-talk/contracts';

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

test('UTV2-1427 bootstrap migration preserves the pre-existing production delivery posture', { skip: skipReason }, async () => {
  // Read-only against the real governed targets — this test must never call
  // setKilled on a real target name, since that would actually toggle live
  // production delivery. It only confirms the bootstrap migration's seeded
  // read-state matches the canonical registry it was derived from.
  const all = await repository.listAll();
  const byTarget = new Map(all.map((row) => [row.target, row]));

  for (const entry of defaultTargetRegistry) {
    const expectedKilled = !entry.enabled || isPromotionTargetBlocked(entry.target);
    const row = byTarget.get(entry.target);

    assert.ok(
      row,
      `bootstrap migration must seed a delivery_kill_switch row for governed target "${entry.target}"`,
    );
    assert.equal(
      row!.killed,
      expectedKilled,
      `"${entry.target}": defaultTargetRegistry says enabled=${entry.enabled} (blocked=${isPromotionTargetBlocked(entry.target)}) so bootstrap-seeded killed must be ${expectedKilled}, got ${row!.killed}`,
    );
    assert.equal(
      row!.actor,
      'system-bootstrap',
      `"${entry.target}": bootstrap-seeded row must carry actor="system-bootstrap" for provenance (unless an operator has since toggled it, in which case this assertion should fail loudly, not silently pass)`,
    );

    console.log(
      `  bootstrap posture OK — target=${entry.target} enabled=${entry.enabled} killed=${row!.killed}`,
    );
  }
});

// Fixture rows left in place (not deleted) — T1 proofs never mutate/delete
// unrelated live data, and the fixture's own target name can never collide
// with a real governed target. The bootstrap-seeded rows for real governed
// targets (best-bets, trader-insights, exclusive-insights) are never
// written to by this file — only read — so they are untouched by this test
// run regardless of outcome.
