/**
 * T1 Pre-Merge Proof: UTV2-982 Unsupported outbox target cleanup
 *
 * Verifies:
 * 1. All discord:qa-pick-delivery pending rows are dead-lettered with audit evidence
 * 2. Zero discord:qa-pick-delivery pending rows remain after cleanup
 * 3. UnsupportedDeliveryTargetError is thrown for unknown non-promotion targets
 * 4. discord:canary and discord:<numericId> targets are accepted by the gate
 *
 * Proof strategy:
 * - Connect to live Supabase
 * - Query for any remaining discord:qa-pick-delivery pending rows
 * - Dead-letter each with audit trace (PM disposition: non-production-critical, non-deliverable)
 * - Assert zero pending rows remain
 * - Assert UnsupportedDeliveryTargetError fires for the bad target
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Safe to run multiple times (idempotent on zero rows).
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-982-outbox-cleanup.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';
import {
  UnsupportedDeliveryTargetError,
  evaluateDistributionTargetGate,
} from './distribution-service.js';

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

let repositories: RepositoryBundle;
let supabase: UnitTalkSupabaseClient;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
  supabase = createDatabaseClientFromConnection(connection);
});

function testWithDb(name: string, fn: () => Promise<void>) {
  test(name, async () => {
    if (skipReason) {
      return;
    }
    await fn();
  });
}

// ── Test 1: quarantine all discord:qa-pick-delivery pending rows ──────────────

testWithDb('UTV2-982: quarantine all discord:qa-pick-delivery pending rows with audit evidence', async () => {
  const { data: strandedRows, error } = await supabase
    .from('distribution_outbox')
    .select('id, pick_id, target, status, created_at')
    .eq('target', 'discord:qa-pick-delivery')
    .eq('status', 'pending');

  assert.ok(!error, `Query failed: ${error?.message}`);

  const rows = strandedRows ?? [];

  for (const row of rows) {
    await repositories.outbox.markDeadLetter(
      row.id,
      'UTV2-982: unsupported target discord:qa-pick-delivery — dead-lettered with PM audit authorization. ' +
        'Target was never polled by the worker. Non-production-critical QA seed row.',
    );

    await repositories.audit.record({
      entityType: 'distribution_outbox',
      entityId: row.id,
      entityRef: row.pick_id,
      action: 'utv2-982:unsupported-target-quarantine',
      actor: 'utv2-982-proof',
      payload: {
        outboxId: row.id,
        pickId: row.pick_id,
        originalTarget: row.target,
        originalStatus: row.status,
        originalCreatedAt: row.created_at,
        disposition: 'dead_lettered',
        reason: 'unsupported-target-never-polled',
        pmAuthorization: 'UTV2-982 PM disposition approved',
      },
    });
  }

  if (rows.length > 0) {
    console.log(`UTV2-982: quarantined ${rows.length} stranded discord:qa-pick-delivery rows`);
  }
});

// ── Test 2: verify zero pending rows remain ───────────────────────────────────

testWithDb('UTV2-982: zero discord:qa-pick-delivery pending rows remain after cleanup', async () => {
  const { data, error } = await supabase
    .from('distribution_outbox')
    .select('id')
    .eq('target', 'discord:qa-pick-delivery')
    .eq('status', 'pending');

  assert.ok(!error, `Query failed: ${error?.message}`);
  assert.equal(
    (data ?? []).length,
    0,
    `Expected 0 pending discord:qa-pick-delivery rows, found ${(data ?? []).length}`,
  );
});

// ── Test 3: fail-closed gate rejects the bad target ───────────────────────────

test('UTV2-982: evaluateDistributionTargetGate throws UnsupportedDeliveryTargetError for discord:qa-pick-delivery', () => {
  assert.throws(
    () => evaluateDistributionTargetGate('discord:qa-pick-delivery', [], {}),
    (err: unknown) => {
      assert.ok(err instanceof UnsupportedDeliveryTargetError, 'expected UnsupportedDeliveryTargetError');
      assert.equal(err.target, 'discord:qa-pick-delivery');
      return true;
    },
  );
});

// ── Test 4: supported targets still pass ─────────────────────────────────────

test('UTV2-982: discord:canary passes the gate', () => {
  const gate = evaluateDistributionTargetGate('discord:canary', [], {});
  assert.equal(gate.ok, true);
});

test('UTV2-982: discord:<numericId> passes the gate (QA seed new target format)', () => {
  const gate = evaluateDistributionTargetGate('discord:1234567890123456789', [], {});
  assert.equal(gate.ok, true);
  assert.equal(gate.requestedPromotionTarget, null);
});
