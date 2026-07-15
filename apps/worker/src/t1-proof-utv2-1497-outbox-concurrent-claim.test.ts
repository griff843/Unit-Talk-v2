/**
 * T1 Live-DB Proof: UTV2-1497 Atomic Outbox Concurrent Claim
 *
 * Spins up N concurrent claimNextAtomic() calls against real Postgres rows
 * for the same target and asserts the claimed set is disjoint and covers
 * every row exactly once — no double-claim, no dropped row.
 *
 * Scope note: this test only exercises the existing claim_next_outbox RPC
 * (SELECT FOR UPDATE SKIP LOCKED). No production code change is made here.
 * If a race were surfaced, the plan is to stop and report rather than
 * alter claim logic in this lane.
 *
 * Fixtures prefixed utv2-1497-* are NOT deleted per T1 proof policy.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts
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
const TARGET = `utv2-1497-canary-${RUN_ID}`;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
});

// ---------------------------------------------------------------------------
// Helper — creates a pick (satisfies distribution_outbox FK) and enqueues it
// ---------------------------------------------------------------------------

async function createPickAndEnqueue(label: string, target: string): Promise<{ pickId: string; outboxId: string }> {
  const now = new Date().toISOString();
  const submissionId = randomUUID();

  const submissionPayload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection: `UTV2-1497 CONCURRENT CLAIM ${label}`,
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
    selection: `UTV2-1497 CONCURRENT CLAIM ${label}`,
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
  await repositories.picks.savePick(pick, `utv2-1497-${label}`);

  const outboxRow = await repositories.outbox.enqueue({
    pickId,
    target,
    payload: { testRun: RUN_ID, label },
    idempotencyKey: `utv2-1497-${label}-${RUN_ID}`,
  });

  return { pickId, outboxId: outboxRow.id };
}

// ---------------------------------------------------------------------------
// Test: N concurrent claimNextAtomic calls against M rows for one target —
// no double-claim, no dropped row
// ---------------------------------------------------------------------------

test('[live-db] concurrent claimNextAtomic calls never double-claim or drop a row', { skip: skipReason }, async () => {
  const ROW_COUNT = 8;
  const WORKER_COUNT = 12; // more workers than rows to force contention losers

  const created = await Promise.all(
    Array.from({ length: ROW_COUNT }, (_, i) => createPickAndEnqueue(`row-${i}-${RUN_ID}`, TARGET)),
  );
  const enqueuedOutboxIds = new Set(created.map((c) => c.outboxId));
  assert.equal(enqueuedOutboxIds.size, ROW_COUNT, 'sanity: all enqueued outbox ids are distinct');

  const workerIds = Array.from({ length: WORKER_COUNT }, (_, i) => `utv2-1497-worker-${i}-${RUN_ID}`);

  const claims = await Promise.all(
    workerIds.map((workerId) => repositories.outbox.claimNextAtomic(TARGET, workerId)),
  );

  const successfulClaims = claims.filter((c): c is NonNullable<typeof c> => c !== null);

  // No dropped row: every enqueued row was claimed by exactly one worker.
  const claimedOutboxIds = successfulClaims.map((c) => c.id);
  assert.equal(claimedOutboxIds.length, ROW_COUNT, 'every enqueued row was claimed exactly once across all concurrent callers');

  // No double-claim: the claimed set has no duplicates.
  const claimedIdSet = new Set(claimedOutboxIds);
  assert.equal(claimedIdSet.size, ROW_COUNT, 'no outbox row was claimed by more than one concurrent caller');

  // The claimed set is exactly the enqueued set — disjoint coverage, nothing extra, nothing missing.
  for (const id of claimedIdSet) {
    assert.ok(enqueuedOutboxIds.has(id), `claimed outbox id ${id} corresponds to a row this test enqueued`);
  }
  for (const id of enqueuedOutboxIds) {
    assert.ok(claimedIdSet.has(id), `enqueued outbox id ${id} was claimed by some worker`);
  }

  // Excess workers (WORKER_COUNT > ROW_COUNT) correctly found nothing left to claim.
  const nullClaimCount = claims.filter((c) => c === null).length;
  assert.equal(nullClaimCount, WORKER_COUNT - ROW_COUNT, 'workers beyond the row count receive null (no row left), never a duplicate claim');

  // Each successful claim recorded a distinct worker as claimant and moved the row to processing.
  for (const claim of successfulClaims) {
    assert.equal(claim.status, 'processing', 'claimed row transitions to processing');
    assert.ok(claim.claimed_by && workerIds.includes(claim.claimed_by), 'claimed row records one of this test\'s worker ids');
  }
});
