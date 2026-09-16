/**
 * T1 Live-DB Proof: capper attribution resolves through `picks.capper_id` (UTV2-1907)
 *
 * PM required five behaviours to be demonstrated end to end against live
 * repositories rather than against the existing generic DB suite. Each maps to
 * one test below:
 *
 *   1. A persisted pick with a recognized capper resolves through
 *      `picks.capper_id`.
 *   2. An unresolved / null `capper_id` remains explicitly unattributed.
 *   3. `metadata.capper` or `pick.source` cannot resurrect attribution.
 *   4. Promotion / CLV reads are keyed to the persisted canonical capper.
 *   5. A second capper / control cannot contaminate the cohort.
 *
 * The fixture design is what makes 2 and 3 provable rather than asserted, and it
 * comes from the write path rather than from a mock. `runtime-repositories.ts`
 * existence-checks the derived capper candidate against the `cappers` table
 * before persisting it (`:403-425`) and stores `data?.id ?? null`. So:
 *
 *   A  metadata.capper = a capper this test SEEDS   -> capper_id = that id
 *   B  metadata.capper = a capper that DOES NOT EXIST -> capper_id = NULL
 *   C  metadata.capper = a second seeded capper      -> capper_id = that id
 *
 * B is the discriminating control. Its row carries a `metadata.capper` naming a
 * capper and a non-null `source`, and both are read back from the database to
 * prove they are really there — yet every attribution read returns the
 * unattributed sentinel. Against an implementation that still fell back to
 * `metadata.capper || source`, test 3 fails and tests 4 and 5 report a
 * contaminated cohort.
 *
 * Two bounded honesty notes, stated here rather than left for a reader to
 * discover:
 *
 *   - The CLV fixtures are written to `settlement_records` directly, with
 *     `source = 'grading'` and a `clvPercent` payload. What is under test is the
 *     attribution *read*, not the settlement *write*; the settlement write path
 *     is proven separately by the UTV2-1904 proof. Routing these through
 *     `recordPickSettlement` would prove nothing additional about attribution
 *     and would drag the evidence-plane settlement contract into a lane that
 *     does not change it.
 *   - `checkExposureGate` (`promotion-service.ts:1906,1912,1924`) still reads
 *     `metadata.capper || source` and is an EXPLICIT, BOUNDED EXCLUSION from
 *     this proof. It takes a `CanonicalPick`, and `CanonicalPick` carries no
 *     `capperId` field at all, so repairing it means changing
 *     `packages/contracts` plus every materialization site — outside this lane's
 *     file scope and outside the two-path override. Its failure direction is
 *     safe: collapsing unattributed picks under a channel-named pseudo-capper
 *     makes the gate group MORE picks together, so `maxPicksPerGame` /
 *     `maxPicksPerDay` trigger sooner. The gate only ever suppresses; it
 *     computes no statistics and writes no record, so it cannot inflate a
 *     capper's performance — which is the harm UTV2-1907 exists to prevent.
 *
 * Fixture source is `api`, not `smart-form`, for the reason recorded in the
 * UTV2-1904 proof: a `smart-form` payload carrying `distributionMode` triggers
 * the full Smart Form relationship contract, which needs staging reference-data
 * coverage that containment deliberately leaves unpopulated. Nothing under test
 * here reads `source` except the fallback this lane removed, and test 3 asserts
 * that removal directly.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test-created rows are NOT deleted.
 *
 * Run it ONLY through `pnpm test:t1-proof:live`, whose `&&` chain begins with
 * `pnpm ci:assert-staging`. That guard is what pins the target to the staging
 * project; this file writes fixture rows and carries no guard of its own, so a
 * standalone `tsx --test` run would write to whatever `SUPABASE_URL` names.
 * The 22 sibling proofs in that chain share the same contract.
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
import { computeClvTrustAdjustment } from './clv-feedback.js';
import { UNATTRIBUTED_CAPPER, isUnattributedCapper, resolveCapperIdentity } from './capper-identity.js';

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

/** Seeded in `cappers`. */
const CAPPER_A = `t1-proof-1907-a-${RUN_ID}`;
/** Seeded in `cappers`. The cohort-contamination control. */
const CAPPER_C = `t1-proof-1907-c-${RUN_ID}`;
/** DELIBERATELY NOT seeded. The attribution-resurrection control. */
const GHOST_CAPPER = `t1-proof-1907-ghost-${RUN_ID}`;

const A_CLV = [4.0, 6.0]; // mean 5.0  -> adjustment +10 (avg > 2)
const C_CLV = [-40.0, -40.0]; // would drag A's mean negative if the cohorts merged

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

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function restQuery<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: restHeaders() });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  return body as T[];
}

async function restInsert<T>(table: string, rows: unknown[]): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`POST ${table} failed: ${JSON.stringify(body)}`);
  return body as T[];
}

interface PickRow {
  id: string;
  capper_id: string | null;
  source: string;
  metadata: Record<string, unknown> | null;
}

async function seedCapper(id: string): Promise<void> {
  const existing = await restQuery<{ id: string }>(`cappers?id=eq.${id}&select=id`);
  if (existing.length > 0) return;
  await restInsert('cappers', [{ id, display_name: `T1 proof capper ${id}`, active: true }]);
}

/** Submits one validated Track Only pick through the real controller. */
async function submitPickAs(capperCandidate: string, label: string): Promise<string> {
  const payload: SubmissionPayload = {
    source: 'api',
    market: 'nba-spread',
    selection: `UTV2-1907 ${label} ${randomUUID()}`,
    line: -2.5,
    odds: -108,
    stakeUnits: 1,
    confidence: 58,
    metadata: {
      distributionMode: 'track-only',
      capper: capperCandidate,
      proof_run: RUN_ID,
      proof_issue: 'UTV2-1907',
    },
  };
  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `submission expected 201, got ${response.status}`);
  const data = (
    response.body as { ok: true; data: { pickId: string; lifecycleState: string; outboxEnqueued: boolean } }
  ).data;
  assert.equal(data.lifecycleState, 'validated');
  assert.equal(data.outboxEnqueued, false, 'a Track Only submission must not enqueue delivery');
  return data.pickId;
}

async function readPickRow(pickId: string): Promise<PickRow> {
  const rows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,capper_id,source,metadata`);
  assert.equal(rows.length, 1, `pick ${pickId} must exist`);
  return rows[0]!;
}

async function seedGradingSettlement(pickId: string, clvPercent: number): Promise<void> {
  await restInsert('settlement_records', [
    {
      pick_id: pickId,
      source: 'grading',
      status: 'settled',
      result: 'win',
      confidence: 'confirmed',
      settled_by: 't1-proof-1907',
      settled_at: new Date().toISOString(),
      evidence_ref: `t1-proof:utv2-1907:${RUN_ID}`,
      payload: { clvPercent, proof_run: RUN_ID },
    },
  ]);
}

test(
  'UTV2-1907 behaviour 1: a persisted pick with a recognized capper resolves through picks.capper_id',
  { skip: skipReason },
  async () => {
    await seedCapper(CAPPER_A);
    const pickId = await submitPickAs(CAPPER_A, 'RECOGNIZED');

    const row = await readPickRow(pickId);
    assert.equal(row.capper_id, CAPPER_A, 'the canonical column must carry the recognized capper');

    const record = await repositories.picks.findPickById(pickId);
    assert.ok(record, 'the repository must find the persisted pick');
    assert.equal(
      resolveCapperIdentity(record),
      CAPPER_A,
      'identity must be read off the persisted column, not re-derived from metadata',
    );
    assert.equal(isUnattributedCapper(resolveCapperIdentity(record)), false);
  },
);

test(
  'UTV2-1907 behaviour 2: an unresolved capper_id remains explicitly unattributed',
  { skip: skipReason },
  async () => {
    const pickId = await submitPickAs(GHOST_CAPPER, 'GHOST');

    const row = await readPickRow(pickId);
    assert.equal(
      row.capper_id,
      null,
      'a candidate with no matching cappers row must persist as NULL, not as the raw string',
    );

    const record = await repositories.picks.findPickById(pickId);
    assert.ok(record);
    const identity = resolveCapperIdentity(record);
    assert.equal(identity, UNATTRIBUTED_CAPPER, 'a null capper_id must name itself, not be silently dropped');
    assert.equal(isUnattributedCapper(identity), true);
  },
);

test(
  'UTV2-1907 behaviour 3: metadata.capper and pick.source cannot resurrect attribution',
  { skip: skipReason },
  async () => {
    const pickId = await submitPickAs(GHOST_CAPPER, 'RESURRECTION CONTROL');

    // The control is only a control if the two fields it excludes are really present.
    const row = await readPickRow(pickId);
    assert.equal(
      (row.metadata ?? {})['capper'],
      GHOST_CAPPER,
      'the fixture must actually carry metadata.capper — otherwise this test proves nothing',
    );
    assert.equal(row.source, 'api', 'the fixture must actually carry a non-empty source');
    assert.equal(row.capper_id, null);

    const record = await repositories.picks.findPickById(pickId);
    assert.ok(record);
    const identity = resolveCapperIdentity(record);
    assert.equal(
      identity,
      UNATTRIBUTED_CAPPER,
      'with metadata.capper set and source set, identity must still be unattributed',
    );
    assert.notEqual(identity, GHOST_CAPPER, 'metadata.capper must not resurrect attribution');
    assert.notEqual(identity, row.source, 'pick.source must not resurrect attribution');

    // And the sentinel is refused as a caller, so the unattributed population
    // cannot acquire a CLV history of its own either.
    const adjustment = await computeClvTrustAdjustment(
      UNATTRIBUTED_CAPPER,
      repositories.settlements,
      repositories.picks,
      { minSampleSize: 1 },
    );
    assert.equal(adjustment, null, 'the unattributed sentinel must never be aggregated as a capper');
  },
);

test(
  'UTV2-1907 behaviours 4 and 5: CLV reads key on the persisted capper, and a second capper cannot contaminate the cohort',
  { skip: skipReason },
  async () => {
    await seedCapper(CAPPER_A);
    await seedCapper(CAPPER_C);

    const aPicks: string[] = [];
    for (const _clv of A_CLV) {
      aPicks.push(await submitPickAs(CAPPER_A, 'CLV A'));
    }
    const cPicks: string[] = [];
    for (const _clv of C_CLV) {
      cPicks.push(await submitPickAs(CAPPER_C, 'CLV C'));
    }
    const ghostPick = await submitPickAs(GHOST_CAPPER, 'CLV GHOST');

    for (const [i, pickId] of aPicks.entries()) {
      await seedGradingSettlement(pickId, A_CLV[i]!);
    }
    for (const [i, pickId] of cPicks.entries()) {
      await seedGradingSettlement(pickId, C_CLV[i]!);
    }
    // The ghost pick carries a CLV value too. If attribution fell back to
    // metadata.capper it would join a cohort; it must join none.
    await seedGradingSettlement(ghostPick, 99.0);

    const aAdjustment = await computeClvTrustAdjustment(
      CAPPER_A,
      repositories.settlements,
      repositories.picks,
      { minSampleSize: 1 },
    );
    assert.ok(aAdjustment, 'capper A has settled picks with CLV and must produce an adjustment');
    assert.equal(aAdjustment.sampleSize, A_CLV.length, "capper A's cohort must be exactly its own picks");
    assert.equal(
      aAdjustment.avgClvPercent,
      A_CLV.reduce((s, v) => s + v, 0) / A_CLV.length,
      "capper A's average must be computed over A's picks alone",
    );

    const cAdjustment = await computeClvTrustAdjustment(
      CAPPER_C,
      repositories.settlements,
      repositories.picks,
      { minSampleSize: 1 },
    );
    assert.ok(cAdjustment, 'capper C must produce its own, separate adjustment');
    assert.equal(cAdjustment.sampleSize, C_CLV.length);
    assert.notEqual(
      cAdjustment.avgClvPercent,
      aAdjustment.avgClvPercent,
      'two cappers with different CLV histories must not report the same figure',
    );

    // The ghost identity matches no persisted capper_id, so it aggregates nothing.
    const ghostAdjustment = await computeClvTrustAdjustment(
      GHOST_CAPPER,
      repositories.settlements,
      repositories.picks,
      { minSampleSize: 1 },
    );
    assert.equal(
      ghostAdjustment,
      null,
      'an identity that exists only in metadata must aggregate no settlements at all',
    );
  },
);
