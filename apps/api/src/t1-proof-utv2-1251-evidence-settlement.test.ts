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
 * these two cases prove it against live Postgres:
 *
 *   A. a validated Track Only pick settles into the evidence plane, its
 *      lifecycle stays `validated`, and nothing is enqueued for delivery;
 *   B. the SAME pick with `distributionMode` removed — validated, no Track Only
 *      marker — is still refused, and writes no settlement record.
 *
 * B is the discriminating control the lane packet requires. Without it, A is
 * equally satisfied by a guard that admitted every `validated` pick, which
 * would sweep the entire pre-delivery backlog into grading. The two fixtures
 * differ in exactly one field, which is what makes B discriminate on Track Only
 * rather than on state, on source, or on anything else.
 *
 * ---
 *
 * Why the fixture source is `api` and not `smart-form`, stated because the
 * obvious choice is wrong and the first version of this file made that mistake:
 *
 * `validateSmartFormRelationships` (submit-pick-controller.ts:46) applies the
 * full Smart Form relationship contract to any `smart-form` payload that
 * carries a `distributionMode` **or** a `participantResolution`
 * (`carriesSmartFormFields`). So a `smart-form` submission with
 * `distributionMode: "track-only"` and nothing else is refused with
 * SMART_FORM_RELATIONSHIP_INVALID — measured, not predicted: it is how the
 * first version of test A failed against staging. Satisfying that contract
 * means supplying a typed `participantResolution`, whose canonical branch needs
 * a real event and whose manual branch verifies the coverage gap it claims
 * against the reference-data catalog.
 *
 * Both branches would make this proof depend on staging reference-data coverage
 * that containment deliberately leaves unpopulated — i.e. it would be testing
 * the catalog, not the guard. `isEvidencePlanePick` reads exactly two things,
 * `status` and `metadata`, and reads neither `source` nor any Smart Form field.
 * `api` is a non-governance-brake source, so it lands at `validated` and the
 * controller's Track Only branch returns before any enqueue — which is the
 * precise state the guard is defined over.
 *
 * What this therefore does NOT prove: that the deployed Smart Form produces
 * such a pick. That is Milestone 1's evidence (pick dfcd9486), not this file's.
 */

interface LifecycleRow { id: string; to_state: string }

async function restPatch(path: string, body: unknown): Promise<void> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`PATCH ${path} failed: ${JSON.stringify(await resp.json())}`);
  }
}

/** Creates a pick in exactly the state isEvidencePlanePick admits: validated + Track Only. */
async function createValidatedTrackOnlyPick(label: string): Promise<string> {
  const runId = randomUUID();
  const payload: SubmissionPayload = {
    source: 'api',
    market: 'nba-spread',
    selection: `UTV2-1861 ${label} ${runId}`,
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
    'a Track Only pick must persist at validated — it is never queued or posted',
  );
  assert.equal(data.outboxEnqueued, false, 'a Track Only submission must not enqueue delivery');
  return data.pickId;
}

test(
  'UTV2-1861: evidence settlement for a validated Track Only pick — status stays validated, zero delivery',
  { skip: skipReason },
  async () => {
    const pickId = await createValidatedTrackOnlyPick('TRACK ONLY PROOF');

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
    assert.equal(settlement.lifecycleEvent, null, 'an evidence settlement writes no lifecycle event');

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
    // Built from the SAME fixture as test A, then stripped of exactly one field.
    // A submission that simply omits distributionMode is not a usable control:
    // measured against staging, it is enqueued and lands at `queued`, not
    // `validated`, so it would discriminate on lifecycle state rather than on
    // the Track Only marker and test A would survive a guard that admitted the
    // whole pre-delivery backlog.
    const pickId = await createValidatedTrackOnlyPick('NOT TRACK ONLY CONTROL');

    await restPatch(`picks?id=eq.${pickId}`, {
      metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1861-control' },
    });

    const pickRows = await restQuery<{ id: string; status: string; metadata: Record<string, unknown> | null }>(
      `picks?id=eq.${pickId}&select=id,status,metadata`,
    );
    assert.equal(pickRows.length, 1, 'control pick row must exist');
    assert.equal(
      pickRows[0]!.status,
      'validated',
      'the control must still be validated — it differs from test A only in the marker',
    );
    assert.equal(
      (pickRows[0]!.metadata ?? {})['distributionMode'],
      undefined,
      'the control pick must carry no distributionMode — it is what makes the rejection meaningful',
    );

    await assert.rejects(
      () =>
        recordEvidenceSettlement(
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
      /validated with Track Only distribution/,
      'a validated pick without the Track Only marker must still be refused',
    );

    const settlementRows = await restQuery<SettlementRow>(
      `settlement_records?pick_id=eq.${pickId}&select=id,pick_id,result,source`,
    );
    assert.equal(
      settlementRows.length,
      0,
      'a refused evidence settlement must write no settlement record',
    );
  },
);
