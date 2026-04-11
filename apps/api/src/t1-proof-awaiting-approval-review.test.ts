/**
 * T1 Pre-Merge Proof: UTV2-521 governance-review lane — review controller
 * must accept decisions on awaiting_approval picks independent of approval_status.
 *
 * Reproduces the live Phase 7A brake path against Supabase: for each brake
 * source, submit a pick (which lands in awaiting_approval with the
 * post-promotion default approval_status='approved'), then call the review
 * controller in-process and assert the decision is accepted, the lifecycle
 * chain is correct, and audit + pick_reviews rows are written.
 *
 * Also includes a regression assertion that non-awaiting_approval picks whose
 * approval_status is not 'pending' still return HTTP 400 NOT_PENDING — the
 * relaxation must not open the guard any wider than necessary.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Fixtures are tagged with the prefix
 * `utv2-521-review-*` and are NOT deleted (T1 proofs do not mutate live data
 * beyond their own fixtures).
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-awaiting-approval-review.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { PickSource, SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from './controllers/submit-pick-controller.js';
import { reviewPickController } from './controllers/review-pick-controller.js';

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
let supabaseUrl: string;
let serviceRoleKey: string;
const createdPickIds: string[] = [];

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  supabaseUrl = env.SUPABASE_URL!;
  serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
});

function authHeaders() {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

async function restQuery<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: authHeaders(),
  });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  }
  return body as T[];
}

interface PickRow {
  id: string;
  status: string;
  approval_status: string;
  source: string;
}

interface LifecycleRow {
  id: string;
  pick_id: string;
  from_state: string | null;
  to_state: string;
  writer_role: string;
  reason: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  entity_type: string;
  entity_id: string;
  entity_ref: string | null;
}

interface PickReviewRow {
  id: string;
  pick_id: string;
  decision: string;
  reason: string;
  decided_by: string;
}

type Decision = 'approve' | 'deny' | 'hold';

async function submitBrakePick(source: PickSource, decision: Decision): Promise<string> {
  const runId = randomUUID();
  const fixtureId = `utv2-521-review-${decision}-${source}-${runId}`;
  const payload: SubmissionPayload = {
    source,
    market: 'nba-spread',
    selection: `UTV2-521 REVIEW ${decision} ${source} ${runId}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: {
      proof_fixture_id: fixtureId,
      proof_issue: 'UTV2-521',
    },
  };

  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `submit ${source}/${decision}: expected 201, got ${response.status}`);
  assert.ok(response.body.ok, `submit ${source}/${decision}: response not ok`);
  const data = (response.body as {
    ok: true;
    data: { pickId: string; lifecycleState: string; governanceBrake?: boolean; outboxEnqueued: boolean };
  }).data;
  assert.equal(data.lifecycleState, 'awaiting_approval');
  assert.equal(data.governanceBrake, true);
  assert.equal(data.outboxEnqueued, false);

  const pickId = data.pickId;
  createdPickIds.push(pickId);
  return pickId;
}

async function assertReviewLaneFor(source: PickSource, decision: Decision) {
  const pickId = await submitBrakePick(source, decision);

  // Read live pick row; capture approval_status as it stands after submission.
  const preRows = await restQuery<PickRow>(
    `picks?id=eq.${pickId}&select=id,status,approval_status,source`,
  );
  assert.equal(preRows.length, 1, `pre-review pick row for ${pickId}`);
  assert.equal(preRows[0]!.status, 'awaiting_approval');
  const preApprovalStatus = preRows[0]!.approval_status;
  // Informational — the guard relaxation should work regardless of the value,
  // so we do not hard-assert it equals 'approved'. We capture it to surface any
  // upstream drift in the promotion default.
  console.log(
    `  [${source}/${decision}] pre-review approval_status=${preApprovalStatus} pickId=${pickId}`,
  );

  // Snapshot lifecycle row count for the hold assertion.
  const preLifecycle = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason,created_at&order=created_at.asc`,
  );
  const preLifecycleCount = preLifecycle.length;

  // Call the review controller in-process.
  const reviewResult = await reviewPickController(
    pickId,
    {
      decision,
      reason: `UTV2-521 governance review (${decision})`,
      decidedBy: 'utv2-521-proof-runner',
    },
    repositories,
  );

  assert.equal(
    reviewResult.status,
    200,
    `review ${source}/${decision}: expected 200, got ${reviewResult.status} — body=${JSON.stringify(reviewResult.body)}`,
  );
  assert.ok(reviewResult.body.ok, `review ${source}/${decision}: response not ok`);
  if (!reviewResult.body.ok) return;
  assert.equal(reviewResult.body.data.decision, decision);
  assert.ok(reviewResult.body.data.auditId);
  assert.ok(reviewResult.body.data.reviewId);

  // Read live pick row after review.
  const postRows = await restQuery<PickRow>(
    `picks?id=eq.${pickId}&select=id,status,approval_status,source`,
  );
  assert.equal(postRows.length, 1);
  const postStatus = postRows[0]!.status;

  if (decision === 'approve') {
    assert.equal(postStatus, 'queued', `approve should leave picks.status='queued' (got ${postStatus})`);
  } else if (decision === 'deny') {
    assert.equal(postStatus, 'voided', `deny should leave picks.status='voided' (got ${postStatus})`);
  } else {
    assert.equal(
      postStatus,
      'awaiting_approval',
      `hold must leave picks.status='awaiting_approval' (got ${postStatus})`,
    );
  }

  // pick_lifecycle assertions
  const postLifecycle = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason,created_at&order=created_at.asc`,
  );

  if (decision === 'approve') {
    const newEvents = postLifecycle.filter(
      (row) => row.from_state === 'awaiting_approval' && row.to_state === 'queued',
    );
    assert.equal(newEvents.length, 1, `approve: expected 1 awaiting_approval→queued row`);
    assert.equal(newEvents[0]!.writer_role, 'operator_override');
  } else if (decision === 'deny') {
    const newEvents = postLifecycle.filter(
      (row) => row.from_state === 'awaiting_approval' && row.to_state === 'voided',
    );
    assert.equal(newEvents.length, 1, `deny: expected 1 awaiting_approval→voided row`);
    assert.equal(newEvents[0]!.writer_role, 'operator_override');
  } else {
    // hold: no new lifecycle row
    assert.equal(
      postLifecycle.length,
      preLifecycleCount,
      `hold must not insert a pick_lifecycle row (pre=${preLifecycleCount}, post=${postLifecycle.length})`,
    );
  }

  // audit_log row — review-pick-controller writes entity_ref=pickId (text)
  const auditRows = await restQuery<AuditRow>(
    `audit_log?action=eq.review.${decision}&entity_ref=eq.${pickId}&select=id,action,payload,entity_type,entity_id,entity_ref&order=created_at.desc&limit=5`,
  );
  assert.ok(auditRows.length >= 1, `audit_log must have review.${decision} row with entity_ref=${pickId}`);
  assert.equal(auditRows[0]!.action, `review.${decision}`);
  const auditPayload = auditRows[0]!.payload as { previousLifecycleState?: string } | null;
  assert.equal(
    auditPayload?.previousLifecycleState,
    'awaiting_approval',
    `audit payload.previousLifecycleState must be 'awaiting_approval'`,
  );

  // pick_reviews row
  const reviewRows = await restQuery<PickReviewRow>(
    `pick_reviews?pick_id=eq.${pickId}&decision=eq.${decision}&select=id,pick_id,decision,reason,decided_by`,
  );
  assert.ok(reviewRows.length >= 1, `pick_reviews must have ${decision} row for ${pickId}`);
  assert.equal(reviewRows[0]!.decided_by, 'utv2-521-proof-runner');

  console.log(`  [${source}/${decision}] review lane OK — pickId=${pickId}`);
}

// ─── STEP 1: governance-review lane accepts each decision across brake sources ───

test('UTV2-521 review lane: approve on system-pick-scanner brake pick', { skip: skipReason }, async () => {
  await assertReviewLaneFor('system-pick-scanner', 'approve');
});

test('UTV2-521 review lane: deny on alert-agent brake pick', { skip: skipReason }, async () => {
  await assertReviewLaneFor('alert-agent', 'deny');
});

test('UTV2-521 review lane: hold on model-driven brake pick', { skip: skipReason }, async () => {
  await assertReviewLaneFor('model-driven', 'hold');
});

// ─── STEP 2: guard-relaxation regression ──────────────────────────────────────
//
// A pick in a non-awaiting_approval lifecycle state whose approval_status is
// NOT 'pending' must still return HTTP 400 NOT_PENDING. This protects against
// the guard being loosened beyond the governance-review lane.

test('UTV2-521 regression: non-governance, non-pending pick still rejects with NOT_PENDING', { skip: skipReason }, async () => {
  // Submit a human-source pick so it bypasses the brake and lands in validated.
  // Then use the ordinary promotion-approval workflow to set approval_status
  // to 'approved' via approve (NOT through the review controller — we need a
  // regression fixture where the review controller has never been called).
  //
  // Simpler and fully in-scope: submit a brake pick, approve it (which moves
  // it to queued + approval_status=approved), then attempt a SECOND review on
  // the same pick. The pick is now in lifecycle='queued', approval='approved'
  // — neither governance-review lane nor promotion-approval lane applies, so
  // the guard should fire.
  const pickId = await submitBrakePick('system-pick-scanner', 'approve');
  const firstReview = await reviewPickController(
    pickId,
    { decision: 'approve', reason: 'UTV2-521 regression setup', decidedBy: 'utv2-521-proof-runner' },
    repositories,
  );
  assert.equal(firstReview.status, 200);

  // Confirm live state: queued + approved.
  const state = await restQuery<PickRow>(
    `picks?id=eq.${pickId}&select=id,status,approval_status,source`,
  );
  assert.equal(state[0]!.status, 'queued');

  const secondReview = await reviewPickController(
    pickId,
    { decision: 'approve', reason: 'should be blocked', decidedBy: 'utv2-521-proof-runner' },
    repositories,
  );
  assert.equal(secondReview.status, 400, `regression: expected 400, got ${secondReview.status}`);
  assert.ok(!secondReview.body.ok);
  if (secondReview.body.ok) return;
  assert.equal(secondReview.body.error.code, 'NOT_PENDING');
});

// ─── STEP 3: diagnostics ─────────────────────────────────────────────────────

test('UTV2-521 created pick ids (diagnostics)', { skip: skipReason }, () => {
  console.log(`  UTV2-521 review test run created pick ids: ${JSON.stringify(createdPickIds)}`);
});
