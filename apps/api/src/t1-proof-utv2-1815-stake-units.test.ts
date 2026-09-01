/**
 * T1 Live-DB Proof: UTV2-1815 null-stake computation truth
 *
 * Proves against live Supabase that the settlement write path refuses to
 * compute a profit/loss from a stake it cannot see, and that the refusal is
 * legible in the persisted row rather than silently indistinguishable from a
 * real 1-unit stake.
 *
 * Three fixtures through the same in-process `recordEvidenceSettlement` call
 * with live repositories:
 *   1. stake_units = NULL  -> payload.stakeUnitsStatus = 'historical_unknown',
 *                             payload.stakeUnitsHistoricalUnknown = true,
 *                             payload has NO profitLossUnits key
 *   2. stake_units = NaN   -> identical refusal. This is the case the shipped
 *                             `stakeUnits ?? 1` idiom could not catch, because
 *                             `??` fires only on null/undefined.
 *   3. stake_units = 2     -> negative control: a real stake still produces a
 *                             real profitLossUnits, so the refusals above are
 *                             proven to be about the stake and not about the
 *                             path being broken.
 *
 * Unit tests cover the same three cases under InMemory repositories. This
 * proof exists because that is exactly the gap this class of change has
 * shipped broken through before: InMemory accepts a JS NaN, Postgres stores a
 * NULL numeric, and the two disagree about what the service actually reads.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Fixtures are tagged with a deterministic
 * prefix (`utv2-1815-stake-*`) so they can be found after the run, and are NOT
 * deleted -- this proof does not mutate any row it did not create.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1815-stake-units.test.ts
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
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: authHeaders() });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  }
  return body as T[];
}

/**
 * Sets stake_units on a fixture pick this proof created. `null` and a
 * non-numeric literal are both written through PostgREST so the value the
 * service reads back is the value Postgres actually stores, not a JS value the
 * test invented. See the fabricated-fixture failure mode: a hand-built row can
 * assert a column shape the database would never produce.
 */
async function setFixtureStakeUnits(pickId: string, value: number | null): Promise<unknown> {
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/picks?id=eq.${pickId}&select=id,stake_units`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({ stake_units: value === null || Number.isNaN(value) ? null : value }),
    },
  );
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`PATCH picks failed: ${JSON.stringify(body)}`);
  }
  return (body as { stake_units: unknown }[])[0]?.stake_units;
}

async function createAwaitingApprovalPick(label: string): Promise<string> {
  const payload: SubmissionPayload = {
    source: 'system-pick-scanner',
    market: 'nba-spread',
    selection: `utv2-1815-stake-${label}-${RUN_ID}`,
    line: -3.5,
    odds: 100,
    stakeUnits: 1,
    confidence: 60,
    metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1815', fixture: label },
  };
  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `submission expected 201, got ${response.status}`);
  const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string } }).data;
  assert.equal(data.lifecycleState, 'awaiting_approval', 'fixture must land in awaiting_approval');
  return data.pickId;
}

const gradingContext = {
  actualValue: 1,
  marketKey: 'nba-spread',
  eventId: `utv2-1815-event-${RUN_ID}`,
  gameResultId: `utv2-1815-result-${RUN_ID}`,
};

interface SettlementRow {
  id: string;
  pick_id: string;
  payload: Record<string, unknown>;
}

async function settleAndReadBack(pickId: string): Promise<Record<string, unknown>> {
  await recordEvidenceSettlement(pickId, 'win', gradingContext, repositories);
  const rows = await restQuery<SettlementRow>(
    `settlement_records?pick_id=eq.${pickId}&select=id,pick_id,payload`,
  );
  assert.equal(rows.length, 1, `expected exactly one persisted settlement row, got ${rows.length}`);
  return rows[0]!.payload;
}

test(
  'UTV2-1815 live DB: a NULL stake persists as historical_unknown with no profit/loss',
  { skip: skipReason },
  async () => {
    const pickId = await createAwaitingApprovalPick('null');
    const stored = await setFixtureStakeUnits(pickId, null);
    assert.equal(stored, null, 'fixture must actually hold a NULL stake in Postgres');

    const payload = await settleAndReadBack(pickId);

    assert.equal(payload['stakeUnitsStatus'], 'historical_unknown');
    assert.equal(payload['stakeUnitsHistoricalUnknown'], true);
    assert.equal(
      'profitLossUnits' in payload,
      false,
      `a NULL stake must not persist a profit/loss; payload was ${JSON.stringify(payload)}`,
    );
  },
);

test(
  'UTV2-1815 live DB: a NaN stake is refused identically to a NULL one',
  { skip: skipReason },
  async () => {
    const pickId = await createAwaitingApprovalPick('nan');
    // Postgres numeric has no NaN for this column, so a corrupted stake reaches
    // the service as NULL. The service-side NaN branch is covered by the unit
    // tests; what this proves is that the DB's own representation of an
    // unusable stake lands on the same refusal, which is the half of the
    // contract InMemory cannot demonstrate.
    await setFixtureStakeUnits(pickId, Number.NaN);

    const payload = await settleAndReadBack(pickId);

    assert.equal(payload['stakeUnitsStatus'], 'historical_unknown');
    assert.equal('profitLossUnits' in payload, false);
  },
);

test(
  'UTV2-1815 live DB: a real stake still persists a real profit/loss (negative control)',
  { skip: skipReason },
  async () => {
    const pickId = await createAwaitingApprovalPick('canonical');
    const stored = await setFixtureStakeUnits(pickId, 2);
    assert.equal(Number(stored), 2, 'fixture must hold a real stake');

    const payload = await settleAndReadBack(pickId);

    assert.equal(payload['stakeUnitsStatus'], 'canonical');
    assert.equal(payload['stakeUnitsHistoricalUnknown'], undefined);
    assert.equal(
      payload['profitLossUnits'],
      2,
      'a win at +100 on a 2-unit stake must persist profitLossUnits = 2',
    );
  },
);
