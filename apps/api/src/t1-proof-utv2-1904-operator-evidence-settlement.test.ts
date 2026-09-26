/**
 * T1 Live-DB Proof: operator settlement of an evidence-plane pick (UTV2-1904)
 *
 * What this proves against real Postgres, and nothing more:
 *
 *   1. An operator can settle a `validated` + Track Only pick through the
 *      ordinary `recordPickSettlement` entry point — exactly one
 *      `settlement_records` row lands, carrying `source = 'operator'` and the
 *      operator's attested grading context in its payload.
 *   2. Nothing else moves: `picks.status` stays `validated`, no
 *      `pick_lifecycle` row transitions it to `settled`, and
 *      `distribution_outbox` stays at zero rows for that pick. The third is the
 *      containment claim — a manual settlement must be unable to reach a member.
 *   3. It fails closed. Without `operatorGradingContext` the request is refused
 *      and **no** settlement row is written. This is the discriminating control:
 *      without it, test 1 would pass equally well against an implementation that
 *      never required the context at all.
 *
 * Fixture source is `api`, not `smart-form`, for the reason recorded at length
 * in `t1-proof-utv2-1251-evidence-settlement.test.ts`: a `smart-form` payload
 * carrying `distributionMode` triggers the full Smart Form relationship
 * contract, which needs staging reference-data coverage that containment
 * deliberately leaves unpopulated. `isEvidencePlanePick` reads `status` and
 * `metadata` and nothing else, so `api` reaches the identical state under test.
 *
 * What it therefore does NOT prove: that the deployed Smart Form produces such a
 * pick, or that any operator UI calls this endpoint. Neither exists yet.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test-created rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1904-operator-evidence-settlement.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { SettlementRequest, SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from './controllers/submit-pick-controller.js';
import { recordPickSettlement } from './settlement-service.js';

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

async function restQuery<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  }
  return body as T[];
}

interface PickRow { id: string; status: string }
interface LifecycleRow { id: string; to_state: string }
interface OutboxRow { id: string; pick_id: string }
interface SettlementRow {
  id: string;
  pick_id: string;
  result: string;
  source: string;
  settled_by: string;
  corrects_id: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
}

const OPERATOR_GRADING_CONTEXT = {
  outcomeBasis: 'Final box score, home team covered -2.5',
  resultSourceUrl: 'https://example.invalid/box-score/utv2-1904',
  observedAt: '2026-09-14T22:40:00.000Z',
};

function operatorRequest(overrides?: Partial<SettlementRequest>): SettlementRequest {
  return {
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `manual:utv2-1904:${RUN_ID}`,
    settledBy: 't1-proof-operator',
    operatorGradingContext: OPERATOR_GRADING_CONTEXT,
    ...overrides,
  };
}

/** Creates a pick in exactly the state isEvidencePlanePick admits: validated + Track Only. */
async function createValidatedTrackOnlyPick(label: string): Promise<string> {
  const runId = randomUUID();
  const payload: SubmissionPayload = {
    source: 'api',
    market: 'nba-spread',
    selection: `UTV2-1904 ${label} ${runId}`,
    line: -2.5,
    odds: -108,
    stakeUnits: 1,
    confidence: 58,
    metadata: {
      distributionMode: 'track-only',
      proof_run: RUN_ID,
      proof_issue: 'UTV2-1904',
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
  'UTV2-1904: an operator settles a Track Only pick — one settlement row, no transition, zero delivery',
  { skip: skipReason },
  async () => {
    const pickId = await createValidatedTrackOnlyPick('OPERATOR SETTLEMENT');

    const result = await recordPickSettlement(pickId, operatorRequest(), repositories);

    assert.ok(result.settlementRecord.id, 'settlement INSERT must return a row id');
    assert.equal(result.lifecycleEvent, null, 'an operator evidence settlement writes no lifecycle event');
    assert.equal(result.finalLifecycleState, 'validated');

    // Every assertion below reads the database back rather than the return value.
    const pickRows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,status`);
    assert.equal(pickRows.length, 1, 'pick row must exist');
    assert.equal(
      pickRows[0]!.status,
      'validated',
      'picks.status must remain validated after an operator evidence settlement',
    );

    const lifecycleRows = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&select=id,to_state`,
    );
    assert.equal(
      lifecycleRows.filter((row) => row.to_state === 'settled').length,
      0,
      'no pick_lifecycle row may transition a Track Only pick to settled',
    );

    // The containment claim.
    const outboxRows = await restQuery<OutboxRow>(
      `distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id`,
    );
    assert.equal(
      outboxRows.length,
      0,
      'distribution_outbox must have zero rows — a manual settlement must not reach a member',
    );

    const settlementRows = await restQuery<SettlementRow>(
      `settlement_records?pick_id=eq.${pickId}&select=id,pick_id,result,source,settled_by,corrects_id,created_at,payload`,
    );
    assert.equal(settlementRows.length, 1, 'exactly one settlement record must be visible');
    assert.equal(settlementRows[0]!.result, 'win');
    assert.equal(
      settlementRows[0]!.source,
      'operator',
      "the persisted row must attribute the settlement to an operator, not to 'grading'",
    );
    assert.equal(settlementRows[0]!.settled_by, 't1-proof-operator');

    const payload = settlementRows[0]!.payload ?? {};
    assert.deepEqual(
      payload['operatorGradingContext'],
      OPERATOR_GRADING_CONTEXT,
      'the operator attestation must be persisted, not merely validated in memory',
    );
    assert.equal(payload['evidencePlane'], true);
    assert.equal(payload['operatorSettled'], true);
    assert.equal(payload['clv'], null, 'there is no event scope, so there is no closing line');
    assert.equal(
      payload['clvUnavailableReason'],
      'operator_evidence_settlement_has_no_event_scope',
      'the row must say why CLV is absent rather than leaving a silent null',
    );
  },
);

test(
  'UTV2-1904: without an operator grading context the settlement is refused and nothing is written',
  { skip: skipReason },
  async () => {
    // The control on test 1. Identical fixture, identical request, one field
    // removed — so a passing test 1 alongside a passing test 2 can only be
    // explained by the guard actually being consulted.
    const pickId = await createValidatedTrackOnlyPick('FAIL CLOSED CONTROL');

    await assert.rejects(
      () =>
        recordPickSettlement(
          pickId,
          operatorRequest({ operatorGradingContext: undefined }),
          repositories,
        ),
      /OPERATOR_GRADING_CONTEXT_REQUIRED|requires operatorGradingContext/,
      'an evidence-plane settlement with no attested basis must be refused',
    );

    const settlementRows = await restQuery<SettlementRow>(
      `settlement_records?pick_id=eq.${pickId}&select=id,pick_id,result,source,settled_by,corrects_id,created_at,payload`,
    );
    assert.equal(
      settlementRows.length,
      0,
      'a refused settlement must write no settlement record — fail closed means no row, not a rolled-back one',
    );

    const pickRows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,status`);
    assert.equal(pickRows[0]!.status, 'validated');

    const outboxRows = await restQuery<OutboxRow>(
      `distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id`,
    );
    assert.equal(outboxRows.length, 0);
  },
);

test(
  'UTV2-1919: a second operator grade corrects the first against real Postgres, and the unique index permits exactly that',
  { skip: skipReason },
  async () => {
    // The in-memory repository does not implement
    // `settlement_records_pick_source_idx (pick_id, source) WHERE corrects_id
    // IS NULL`, so the unit tests can prove the chain but cannot prove the
    // index tolerates it. This one runs against the real constraint: the first
    // grade lands as the canonical row, and the second is accepted only
    // because it carries `corrects_id` and is therefore exempt.
    const pickId = await createValidatedTrackOnlyPick('EVIDENCE CORRECTION');

    const first = await recordPickSettlement(
      pickId,
      operatorRequest({ result: 'win', evidenceRef: `manual:utv2-1919:${RUN_ID}:v1` }),
      repositories,
    );
    const second = await recordPickSettlement(
      pickId,
      operatorRequest({ result: 'loss', evidenceRef: `manual:utv2-1919:${RUN_ID}:v2` }),
      repositories,
    );
    const third = await recordPickSettlement(
      pickId,
      operatorRequest({ result: 'win', evidenceRef: `manual:utv2-1919:${RUN_ID}:v3` }),
      repositories,
    );

    // Read the chain back from Postgres rather than from the return values.
    const rows = await restQuery<SettlementRow>(
      `settlement_records?pick_id=eq.${pickId}&select=id,pick_id,result,source,settled_by,corrects_id,created_at,payload&order=created_at.asc`,
    );
    assert.equal(rows.length, 3, 'three operator grades must persist as three rows');

    const roots = rows.filter((row) => row.corrects_id === null);
    assert.equal(
      roots.length,
      1,
      'exactly one canonical row may exist for a (pick, source) — more would violate the partial unique index',
    );
    assert.equal(roots[0]!.id, first.settlementRecord.id);
    assert.equal(roots[0]!.result, 'win', 'the original settlement is immutable');

    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(
      byId.get(second.settlementRecord.id)?.corrects_id,
      first.settlementRecord.id,
      'the second grade must reference the settlement it supersedes',
    );
    assert.equal(byId.get(second.settlementRecord.id)?.result, 'loss');
    assert.equal(
      byId.get(third.settlementRecord.id)?.corrects_id,
      second.settlementRecord.id,
      'the third grade must reference the second, not the original',
    );
    assert.equal(byId.get(third.settlementRecord.id)?.result, 'win');

    // One statistical contribution, and it is the tip of the chain.
    assert.equal(third.downstream.unresolvedReason, null);
    assert.equal(
      third.downstream.effectiveSettlement?.effective_record_id,
      third.settlementRecord.id,
    );
    assert.equal(third.downstream.effectiveSettlement?.result, 'win');
    assert.equal(third.downstream.effectiveSettlement?.correction_depth, 2);
    assert.equal(third.downstream.settlementSummary.total_picks, 1);

    const correctionPayload = byId.get(third.settlementRecord.id)?.payload ?? {};
    assert.equal(correctionPayload['correction'], true);
    assert.equal(correctionPayload['priorSettlementRecordId'], second.settlementRecord.id);
    assert.equal(correctionPayload['priorResult'], 'loss');
    assert.equal(correctionPayload['evidencePlane'], true);
    assert.deepEqual(
      correctionPayload['operatorGradingContext'],
      OPERATOR_GRADING_CONTEXT,
      'a correction carries its own attested basis, exactly as the original does',
    );

    // Nothing else moved. Correcting a grade is not a route to a member.
    const pickRows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,status`);
    assert.equal(
      pickRows[0]!.status,
      'validated',
      'a correction writes no lifecycle transition either',
    );

    const lifecycleRows = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&select=id,to_state`,
    );
    assert.equal(
      lifecycleRows.filter((row) => row.to_state === 'settled').length,
      0,
    );

    const outboxRows = await restQuery<OutboxRow>(
      `distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id`,
    );
    assert.equal(
      outboxRows.length,
      0,
      'distribution_outbox must stay at zero across all three grades',
    );
  },
);
