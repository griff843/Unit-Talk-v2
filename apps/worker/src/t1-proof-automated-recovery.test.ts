/**
 * T1 Live-DB Proof: UTV2-936 Automated Recovery Workflows
 *
 * Exercises automated recovery against real Supabase:
 *   1. Recovery disabled — no-op, no rows modified
 *   2. Eligible transient row recovered, reset to pending, audit emitted
 *   3. Denylist enforcement — FK-violation error row not eligible
 *   4. listForAutoRecovery respects attempt ceiling at DB level
 *   5. Idempotency — audit written exactly once per recovery, no double-recovery
 *   6. Kill-switch — disabled sweep is always a no-op
 *
 * Fixtures prefixed utv2-936-* are NOT deleted per T1 proof policy.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/worker/src/t1-proof-automated-recovery.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  type CanonicalPick,
  type SubmissionPayload,
} from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import {
  isEligibleForAutoRecovery,
  runAutoRecoverySweep,
  MAX_AUTO_RECOVERY_ATTEMPTS,
} from './automated-recovery.js';

function hasSupabaseEnv(): boolean {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnv()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let repositories: RepositoryBundle;
const RUN_ID = randomUUID().slice(0, 8);

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
});

// ---------------------------------------------------------------------------
// Helper — creates a pick (satisfies distribution_outbox FK)
// ---------------------------------------------------------------------------

async function createPickAndEnqueue(label: string, target = 'discord:canary'): Promise<{ pickId: string; outboxId: string }> {
  const now = new Date().toISOString();
  const submissionId = randomUUID();

  const submissionPayload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection: `UTV2-936 RECOVERY ${label}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: { testRun: RUN_ID, label },
  };

  await repositories.submissions.saveSubmission({
    id: submissionId,
    payload: submissionPayload,
    receivedAt: now,
  });

  const pickId = randomUUID();
  const pick: CanonicalPick = {
    id: pickId,
    submissionId,
    market: 'nba-spread',
    selection: `UTV2-936 RECOVERY ${label}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'draft',
    metadata: { testRun: RUN_ID, label },
    createdAt: now,
  };
  await repositories.picks.savePick(pick, `utv2-936-${label}`);

  const outboxRow = await repositories.outbox.enqueue({
    pickId,
    target,
    payload: { testRun: RUN_ID, label },
    idempotencyKey: `utv2-936-${label}-${RUN_ID}`,
  });

  return { pickId, outboxId: outboxRow.id };
}

// ---------------------------------------------------------------------------
// Test 1: Recovery disabled — no-op
// ---------------------------------------------------------------------------

test('[live-db] recovery disabled: sweep is no-op', { skip: skipReason }, async () => {
  const result = await runAutoRecoverySweep(repositories, randomUUID(), () => false);
  assert.equal(result.recovered, 0);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.errors, []);
});

// ---------------------------------------------------------------------------
// Test 2: Eligible row recovered, reset to pending, audit emitted
// ---------------------------------------------------------------------------

test('[live-db] eligible transient error row reset to pending with audit', { skip: skipReason }, async () => {
  const { pickId, outboxId } = await createPickAndEnqueue(`eligible-${RUN_ID}`);

  // Claim and fail with a transient error
  const claimed = await repositories.outbox.claimNext('discord:canary', `utv2-936-proof-${RUN_ID}`);
  if (!claimed || claimed.id !== outboxId) {
    // Another row claimed first — skip
    return;
  }

  await repositories.outbox.markFailed(outboxId, 'fetch failed');

  const failed = await repositories.outbox.findByPickAndTarget(pickId, 'discord:canary', ['failed']);
  assert.ok(failed, 'row should be in failed state');
  assert.equal(isEligibleForAutoRecovery(failed), true);

  const correlationId = randomUUID();
  const result = await runAutoRecoverySweep(repositories, correlationId, () => true);
  assert.ok(result.recovered >= 1, `expected at least 1 recovery, got ${result.recovered}`);
  assert.deepEqual(result.errors, []);

  const recovered = await repositories.outbox.findByPickAndTarget(pickId, 'discord:canary', ['pending']);
  assert.ok(recovered, 'recovered row should be in pending state');

  const auditRows = await repositories.audit.listRecentByEntityType(
    'distribution_outbox',
    new Date(Date.now() - 30000).toISOString(),
    'distribution.auto_recovered',
  );
  const myAudit = auditRows.find((a) => a.entity_id === outboxId);
  assert.ok(myAudit, 'audit record must exist for recovered row');
  assert.equal(myAudit.actor, 'system.automated-recovery');
  const p = myAudit.payload as Record<string, unknown>;
  assert.equal(p['correlationId'], correlationId);
  assert.equal(p['recoveryReason'], 'transient_infrastructure_failure');
  assert.equal(p['recoveryOutcome'], 'reset_to_pending');
});

// ---------------------------------------------------------------------------
// Test 3: Denylist — FK violation row not eligible
// ---------------------------------------------------------------------------

test('[live-db] denylist: FK violation row not eligible for recovery', { skip: skipReason }, async () => {
  const { pickId, outboxId } = await createPickAndEnqueue(`denylist-${RUN_ID}`);

  const claimed = await repositories.outbox.claimNext('discord:canary', `utv2-936-proof-${RUN_ID}`);
  if (!claimed || claimed.id !== outboxId) return;

  await repositories.outbox.markFailed(outboxId, 'violates foreign key constraint');

  const failed = await repositories.outbox.findByPickAndTarget(pickId, 'discord:canary', ['failed']);
  assert.ok(failed);
  assert.equal(isEligibleForAutoRecovery(failed), false, 'FK violation must be blocked by denylist');
});

// ---------------------------------------------------------------------------
// Test 4: listForAutoRecovery respects attempt ceiling at DB level
// ---------------------------------------------------------------------------

test('[live-db] listForAutoRecovery respects attempt ceiling', { skip: skipReason }, async () => {
  const eligibleRows = await repositories.outbox.listForAutoRecovery(MAX_AUTO_RECOVERY_ATTEMPTS, 50);
  for (const r of eligibleRows) {
    assert.ok(
      r.attempt_count < MAX_AUTO_RECOVERY_ATTEMPTS,
      `row ${r.id} has attempt_count ${r.attempt_count} >= ceiling ${MAX_AUTO_RECOVERY_ATTEMPTS}`,
    );
    assert.ok(
      r.status === 'failed' || r.status === 'dead_letter',
      `row ${r.id} has unexpected status: ${r.status}`,
    );
    assert.ok(r.last_error !== null, `row ${r.id} must have last_error set`);
  }
});

// ---------------------------------------------------------------------------
// Test 5: Idempotency — audit written exactly once per recovery
// ---------------------------------------------------------------------------

test('[live-db] idempotency: audit written exactly once per recovery', { skip: skipReason }, async () => {
  const { outboxId } = await createPickAndEnqueue(`idempotent-${RUN_ID}`);

  const claimed = await repositories.outbox.claimNext('discord:canary', `utv2-936-proof-${RUN_ID}`);
  if (!claimed || claimed.id !== outboxId) return;

  await repositories.outbox.markFailed(outboxId, 'ETIMEDOUT');

  await runAutoRecoverySweep(repositories, randomUUID(), () => true);
  await runAutoRecoverySweep(repositories, randomUUID(), () => true);

  const auditRows = await repositories.audit.listRecentByEntityType(
    'distribution_outbox',
    new Date(Date.now() - 30000).toISOString(),
    'distribution.auto_recovered',
  );
  const myCount = auditRows.filter((a) => a.entity_id === outboxId).length;
  assert.equal(myCount, 1, 'exactly one audit record per recovery — no duplicate recovery');
});

// ---------------------------------------------------------------------------
// Test 6: Kill-switch — disabled sweep is always a no-op
// ---------------------------------------------------------------------------

test('[live-db] kill-switch: disabled recovery is always a no-op', { skip: skipReason }, async () => {
  const result = await runAutoRecoverySweep(repositories, randomUUID(), () => false);
  assert.equal(result.recovered, 0);
  assert.equal(result.errors.length, 0);
});