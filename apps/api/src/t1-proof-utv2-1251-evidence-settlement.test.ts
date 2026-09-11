/**
 * T1 Live-DB Proof: evidence settlement decoupling (UTV2-1251, extended by UTV2-1861)
 *
 * Verifies that the UTV2-1251 invariant holds against live Supabase:
 *   1. picks.status stays awaiting_approval after a settlement record is written
 *      for the pick (the core claim of the evidence-plane path)
 *   2. distribution_outbox has zero rows — no Discord delivery triggered
 *   3. recordEvidenceSettlement correctly rejects a non-awaiting_approval pick
 *
 * UTV2-1861 widened the evidence plane to a second population — `validated`
 * **and** Track Only — and the last two tests in this file prove the same three
 * invariants for it, plus the discriminating control that a `validated` pick
 * without the Track Only marker is still refused. See the block comment above
 * them; A and B must be read together or A proves nothing.
 *
 * Uses the repository layer directly to isolate from CLV market-data
 * availability (the CLV path is covered by unit tests; here we prove the
 * DB-layer invariants hold against real Postgres).
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test-created rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1251-evidence-settlement.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from './controllers/submit-pick-controller.js';
import { recordEvidenceSettlement } from './settlement-service.js';

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

const RUN_ID = randomUUID().slice(0, 8);
let repositories: RepositoryBundle;
let supabaseUrl: string;
let serviceRoleKey: string;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  supabaseUrl = env.SUPABASE_URL!;
  serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
  repositories = createDatabaseRepositoryBundle(
    createServiceRoleDatabaseConnectionConfig(env),
  );
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

async function createAwaitingApprovalPick(): Promise<string> {
  const runId = randomUUID();
  const payload: SubmissionPayload = {
    source: 'system-pick-scanner',
    market: 'nba-spread',
    selection: `UTV2-1251 EVIDENCE PROOF ${runId}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1251' },
  };
  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `submission expected 201, got ${response.status}`);
  const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string } }).data;
  assert.equal(data.lifecycleState, 'awaiting_approval', 'pick must land in awaiting_approval');
  return data.pickId;
}

interface PickRow { id: string; status: string }
interface SettlementRow { id: string; pick_id: string; result: string; source: string }
interface OutboxRow { id: string; pick_id: string }

test(
  'UTV2-1251: settlement record written for awaiting_approval pick — picks.status unchanged',
  { skip: skipReason },
  async () => {
    const pickId = await createAwaitingApprovalPick();

    // Write settlement record directly via repository (same call path recordEvidenceSettlement uses)
    const now = new Date().toISOString();
    const settlement = await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'win',
      source: 'grading',
      confidence: 'confirmed',
      evidenceRef: `utv2-1251-proof-${RUN_ID}`,
      settledBy: 'utv2-1251-proof',
      settledAt: now,
      payload: { evidencePlane: true, proofRun: RUN_ID },
    });

    assert.ok(settlement.id, 'settlement INSERT must return a row id');
    assert.equal(settlement.pick_id, pickId);
    assert.equal(settlement.result, 'win');

    // Core invariant: picks.status must NOT have changed
    const pickRows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,status`);
    assert.equal(pickRows.length, 1, 'pick row must exist');
    assert.equal(
      pickRows[0]!.status,
      'awaiting_approval',
      'picks.status must remain awaiting_approval after evidence settlement write',
    );

    // Delivery invariant: no Discord delivery enqueued
    const outboxRows = await restQuery<OutboxRow>(`distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id`);
    assert.equal(
      outboxRows.length,
      0,
      'distribution_outbox must have zero rows — no Discord delivery for awaiting_approval picks',
    );

    // Settlement record is visible (confirms evidence counting scripts can see it)
    const settlementRows = await restQuery<SettlementRow>(
      `settlement_records?pick_id=eq.${pickId}&select=id,pick_id,result,source`,
    );
    assert.equal(settlementRows.length, 1, 'exactly one settlement record must be visible');
    assert.equal(settlementRows[0]!.result, 'win');
  },
);

test(
  'UTV2-1251: recordEvidenceSettlement rejects non-awaiting_approval pick',
  { skip: skipReason },
  async () => {
    // Submit a pick via smart-form (not a governance brake source) — lands in normal path
    const runId = randomUUID();
    const payload: SubmissionPayload = {
      source: 'smart-form',
      market: 'nba-spread',
      selection: `UTV2-1251 REJECT PROOF ${runId}`,
      line: -4.5,
      odds: -115,
      stakeUnits: 1,
      confidence: 55,
      metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1251-reject' },
    };
    const response = await submitPickController(payload, repositories);
    assert.equal(response.status, 201, `submission expected 201, got ${response.status}`);
    const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string } }).data;

    // Confirm this pick did NOT land in awaiting_approval
    assert.notEqual(data.lifecycleState, 'awaiting_approval', 'smart-form pick must not be in awaiting_approval');
    const pickId = data.pickId;

    // recordEvidenceSettlement must reject this pick
    await assert.rejects(
      () => recordEvidenceSettlement(
        pickId,
        'win',
        {
          actualValue: 27,
          marketKey: 'nba-spread',
          eventId: randomUUID(),
          gameResultId: randomUUID(),
        },
        repositories,
      ),
      /awaiting_approval/,
      'recordEvidenceSettlement must reject picks not in awaiting_approval state',
    );
  },
);

/**
 * UTV2-1861 — the behavioural half of the widened evidence-plane guard.
 *
 * The two tests above prove the three invariants for `awaiting_approval` only.
 * UTV2-1861 admits a second population — `validated` **and** Track Only — and
 * those two cases are what prove it, against live Postgres rather than against
 * an in-memory repository:
 *
 *   A. a validated Track Only pick settles into the evidence plane, its
 *      lifecycle stays `validated`, and nothing is enqueued for delivery;
 *   B. a validated pick WITHOUT the Track Only marker is still refused.
 *
 * B is the discriminating control. Without it, A is satisfied by a guard that
 * admitted every `validated` pick — which would sweep the entire pre-delivery
 * backlog into grading. The two must be read together.
 */

interface LifecycleRow { id: string; to_state: string }

/**
 * Submits a Smart Form pick carrying `distributionMode: "track-only"`, the same
 * shape the deployed form pins for an authenticated capper (UTV2-1672). The
 * controller's Track Only branch returns before any distribution enqueue, so
 * the fixture is created by the production path rather than by patching a row.
 */
async function createValidatedTrackOnlyPick(): Promise<string> {
  const runId = randomUUID();
  const payload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection: `UTV2-1861 TRACK ONLY PROOF ${runId}`,
    line: -2.5,
    odds: -108,
    stakeUnits: 1,
    confidence: 58,
    metadata: {
      distributionMode: 'track-only',
      proof_run: RUN_ID,
      proof_issue: 'UTV2-1861',
    },
  };
  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `submission expected 201, got ${response.status}`);
  const data = (
    response.body as {
      ok: true;
      data: { pickId: string; lifecycleState: string; outboxEnqueued: boolean };
    }
  ).data;
  assert.equal(
    data.lifecycleState,
    'validated',
    'a Track Only Smart Form pick must persist at validated — it is never queued or posted',
  );
  assert.equal(data.outboxEnqueued, false, 'Track Only submission must not enqueue delivery');
  return data.pickId;
}

test(
  'UTV2-1861: evidence settlement for a validated Track Only pick — status stays validated, zero delivery',
  { skip: skipReason },
  async () => {
    const pickId = await createValidatedTrackOnlyPick();

    const settlement = await recordEvidenceSettlement(
      pickId,
      'win',
      {
        actualValue: 27,
        marketKey: 'nba-spread',
        eventId: randomUUID(),
        gameResultId: randomUUID(),
      },
      repositories,
    );

    assert.ok(settlement.settlementRecord.id, 'settlement INSERT must return a row id');
    assert.equal(
      settlement.finalLifecycleState,
      'validated',
      'the evidence plane must not transition the pick out of validated',
    );
    assert.equal(
      settlement.lifecycleEvent,
      null,
      'an evidence settlement writes no lifecycle event',
    );

    // Lifecycle invariant, read back from the database rather than from the return value.
    const pickRows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,status`);
    assert.equal(pickRows.length, 1, 'pick row must exist');
    assert.equal(
      pickRows[0]!.status,
      'validated',
      'picks.status must remain validated after a Track Only evidence settlement',
    );

    const lifecycleRows = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&select=id,to_state`,
    );
    assert.equal(
      lifecycleRows.filter((row) => row.to_state === 'settled').length,
      0,
      'no pick_lifecycle row may transition a Track Only pick to settled',
    );

    // Delivery invariant: Track Only is proven unable to create member delivery.
    const outboxRows = await restQuery<OutboxRow>(
      `distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id`,
    );
    assert.equal(
      outboxRows.length,
      0,
      'distribution_outbox must have zero rows — Track Only never reaches a member',
    );

    // Persistence invariant: the settlement is visible to the evidence-counting queries.
    const settlementRows = await restQuery<SettlementRow>(
      `settlement_records?pick_id=eq.${pickId}&select=id,pick_id,result,source`,
    );
    assert.equal(settlementRows.length, 1, 'exactly one settlement record must be visible');
    assert.equal(settlementRows[0]!.result, 'win');
    assert.equal(settlementRows[0]!.source, 'grading');
  },
);

test(
  'UTV2-1861: recordEvidenceSettlement still rejects a validated pick WITHOUT the Track Only marker',
  { skip: skipReason },
  async () => {
    const runId = randomUUID();
    const payload: SubmissionPayload = {
      source: 'smart-form',
      market: 'nba-spread',
      selection: `UTV2-1861 NOT TRACK ONLY CONTROL ${runId}`,
      line: -6.5,
      odds: -112,
      stakeUnits: 1,
      confidence: 57,
      // Deliberately no distributionMode. This is the whole point of the control.
      metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1861-control' },
    };
    const response = await submitPickController(payload, repositories);
    assert.equal(response.status, 201, `submission expected 201, got ${response.status}`);
    const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string } })
      .data;
    assert.equal(
      data.lifecycleState,
      'validated',
      'the control must be validated — otherwise it discriminates on state, not on Track Only',
    );

    const pickRows = await restQuery<{ id: string; metadata: Record<string, unknown> | null }>(
      `picks?id=eq.${data.pickId}&select=id,metadata`,
    );
    assert.equal(pickRows.length, 1, 'control pick row must exist');
    assert.equal(
      (pickRows[0]!.metadata ?? {})['distributionMode'],
      undefined,
      'the control pick must carry no distributionMode — it is what makes the rejection meaningful',
    );

    await assert.rejects(
      () =>
        recordEvidenceSettlement(
          data.pickId,
          'win',
          {
            actualValue: 27,
            marketKey: 'nba-spread',
            eventId: randomUUID(),
            gameResultId: randomUUID(),
          },
          repositories,
        ),
      /validated with Track Only distribution/,
      'a validated pick without the Track Only marker must still be refused',
    );

    const settlementRows = await restQuery<SettlementRow>(
      `settlement_records?pick_id=eq.${data.pickId}&select=id,pick_id,result,source`,
    );
    assert.equal(
      settlementRows.length,
      0,
      'a refused evidence settlement must write no settlement record',
    );
  },
);
