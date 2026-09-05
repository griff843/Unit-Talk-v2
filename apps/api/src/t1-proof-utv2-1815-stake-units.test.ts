/**
 * T1 Live-DB Proof: UTV2-1815 null-stake computation truth
 *
 * WHAT THE LIVE-DB PORTION PROVES
 * -------------------------------
 * That the database itself refuses to create an unsafe stake, fail-closed, on a
 * real Postgres. `public.picks` carries
 *
 *   CONSTRAINT picks_stake_units_canonical_check
 *     CHECK (((stake_units IS NOT NULL) AND (stake_units > (0)::numeric))) NOT VALID
 *
 * and this file proves that constraint is live on the write path: an attempt to
 * PATCH a real fixture pick's `stake_units` to NULL, or to a non-positive value,
 * is REFUSED by Postgres with SQLSTATE 23514 naming that exact constraint, and
 * the row's stake is unchanged afterwards -- the refusal does not partially
 * apply. Test 3 is the negative control: a legal stake still writes, and still
 * settles into a real `profitLossUnits`, so the refusals above are about the
 * stake and not about the path being broken. Test 4 closes the one live question
 * the other three cannot see: they all coerce the value they read back with
 * `Number(...)`, so none of them observes the runtime *representation* PostgREST
 * returns for a `numeric` column. `resolveStakeUnits` rejects on
 * `typeof value !== 'number'`, so a stake arriving as the JSON string "2.5"
 * would make every canonical row read back as `historical_unknown` -- the
 * guard's false-refusal direction, which is the one direction a fail-closed
 * control cannot detect about itself. Test 4 puts the value the database
 * actually returned, untouched, through the shipped resolver.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE
 * -----------------------------------
 * It does NOT prove the settlement service's `historical_unknown` refusal
 * against a live row, because that state is *unconstructable* against any
 * database carrying this constraint: the only way to obtain a live NULL-stake
 * pick would be to alter, drop, or defer the constraint, which is a reserved
 * production action and is not attempted here. The domain-layer refusal for
 * those rows is therefore proven by the unit tests in
 * `packages/domain/src/attribution/attribution-engine.test.ts` and by mutation,
 * not by a live write.
 *
 * WHY THE DOMAIN GUARD IS STILL NECESSARY
 * ---------------------------------------
 * The constraint is `NOT VALID`. That is load-bearing: it is enforced on every
 * new INSERT and UPDATE, but it was never verified against pre-existing rows.
 * Measured read-only against production (project `zfzdnfwdarxucxtaojxm`) on
 * 2026-09-05: **2,902 of 107,858 rows in `public.picks` hold
 * `stake_units IS NULL`**, and 0 rows hold a non-positive non-null stake. Those
 * 2,902 legacy rows are real, are read, and are computed on. The write-side
 * constraint proven below does not remove them and does not make the
 * domain-layer `historical_unknown` refusal unnecessary -- it is precisely why
 * that refusal has to exist.
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
import { resolveStakeUnits } from '@unit-talk/domain';
import { submitPickController } from './controllers/submit-pick-controller.js';
import { recordEvidenceSettlement } from './settlement-service.js';

const STAKE_CONSTRAINT = 'picks_stake_units_canonical_check';
const CHECK_VIOLATION_SQLSTATE = '23514';

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

/** PostgREST's error envelope for a failed write. */
interface PostgrestError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

interface PatchOutcome {
  accepted: boolean;
  httpStatus: number;
  /** Present only when `accepted` is false. */
  error: PostgrestError | null;
  /** Present only when `accepted` is true: the value Postgres actually stored. */
  stored: unknown;
}

/**
 * Attempts to set `stake_units` on a fixture pick this proof created, and
 * returns the outcome as structured data rather than throwing. The refusal IS
 * the thing under test here, so the error code and constraint name must be
 * assertable as values -- asserting on a substring of a thrown Error's message
 * would be the weaker proof.
 */
async function patchFixtureStakeUnits(
  pickId: string,
  value: number | null,
): Promise<PatchOutcome> {
  // JSON has no NaN literal, so a JS NaN cannot be transmitted as a numeric.
  // The faithful wire representation of an unusable stake is null, which is what
  // a corrupted stake actually reaches Postgres as. Documented rather than
  // papered over: test 2 below is therefore not a distinct *value* case, and it
  // says so.
  const wireValue = value === null || Number.isNaN(value) ? null : value;
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/picks?id=eq.${pickId}&select=id,stake_units`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({ stake_units: wireValue }),
    },
  );
  const body: unknown = await resp.json();
  if (!resp.ok) {
    return {
      accepted: false,
      httpStatus: resp.status,
      error: body as PostgrestError,
      stored: undefined,
    };
  }
  return {
    accepted: true,
    httpStatus: resp.status,
    error: null,
    stored: (body as { stake_units: unknown }[])[0]?.stake_units,
  };
}

/**
 * The constraint name is carried by PostgREST only inside the error envelope's
 * text fields, so it is located by scanning every string field of the STRUCTURED
 * error for the exact constraint identifier. That is a match on a machine
 * identifier, not on the prose wording of the message.
 */
function namesConstraint(error: PostgrestError | null, constraint: string): boolean {
  if (!error) return false;
  return Object.values(error).some(
    (field) => typeof field === 'string' && field.includes(constraint),
  );
}

async function readStakeUnits(pickId: string): Promise<unknown> {
  const rows = await restQuery<{ id: string; stake_units: unknown }>(
    `picks?id=eq.${pickId}&select=id,stake_units`,
  );
  assert.equal(rows.length, 1, `expected exactly one fixture row, got ${rows.length}`);
  return rows[0]!.stake_units;
}

/** Asserts the write was refused by the canonical stake constraint, structurally. */
function assertRefusedByStakeConstraint(outcome: PatchOutcome, what: string): void {
  assert.equal(
    outcome.accepted,
    false,
    `${what}: the database must refuse this write; it returned ${outcome.httpStatus}`,
  );
  assert.equal(
    outcome.error?.code,
    CHECK_VIOLATION_SQLSTATE,
    `${what}: expected SQLSTATE ${CHECK_VIOLATION_SQLSTATE}, got ${JSON.stringify(outcome.error)}`,
  );
  assert.equal(
    namesConstraint(outcome.error, STAKE_CONSTRAINT),
    true,
    `${what}: refusal must name ${STAKE_CONSTRAINT}; got ${JSON.stringify(outcome.error)}`,
  );
}

const FIXTURE_STAKE_UNITS = 1;

async function createAwaitingApprovalPick(label: string): Promise<string> {
  const payload: SubmissionPayload = {
    source: 'system-pick-scanner',
    market: 'nba-spread',
    selection: `utv2-1815-stake-${label}-${RUN_ID}`,
    line: -3.5,
    odds: 100,
    stakeUnits: FIXTURE_STAKE_UNITS,
    confidence: 60,
    metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1815', fixture: label },
  };
  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `submission expected 201, got ${response.status}`);
  const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string } }).data;
  assert.equal(data.lifecycleState, 'awaiting_approval', 'fixture must land in awaiting_approval');
  return data.pickId;
}

// events.id and game_results.id are uuid columns, so a readable slug is not a
// legal value -- PostgREST rejects it with `invalid input syntax for type uuid`
// before any assertion in this file runs. These UUIDs deliberately do not exist:
// EventRepository.findById returns null for an absent row (it only throws on a
// query error), buildCLVContextFromGradingEvent then returns null, and CLV is
// not what this proof is about. RUN_ID stays in `metadata.proof_run` for
// traceability.
const gradingContext = {
  actualValue: 1,
  marketKey: 'nba-spread',
  eventId: randomUUID(),
  gameResultId: randomUUID(),
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
  'UTV2-1815 live DB: Postgres refuses a NULL stake with 23514 on picks_stake_units_canonical_check',
  { skip: skipReason },
  async () => {
    const pickId = await createAwaitingApprovalPick('null');
    assert.equal(
      Number(await readStakeUnits(pickId)),
      FIXTURE_STAKE_UNITS,
      'fixture must start from a legal stake, or the refusal below proves nothing',
    );

    const outcome = await patchFixtureStakeUnits(pickId, null);
    assertRefusedByStakeConstraint(outcome, 'NULL stake');

    // The refusal must not have partially applied.
    assert.equal(
      Number(await readStakeUnits(pickId)),
      FIXTURE_STAKE_UNITS,
      'a refused write must leave stake_units exactly as it was',
    );
  },
);

test(
  'UTV2-1815 live DB: an unrepresentable (NaN) stake and a non-positive stake are refused identically',
  { skip: skipReason },
  async () => {
    const pickId = await createAwaitingApprovalPick('nan');

    // JSON carries no NaN literal, so a JS NaN reaches Postgres as NULL. This
    // half is therefore the same *wire value* as the test above, on a different
    // fixture row -- stated plainly rather than dressed up as a distinct case.
    const nanOutcome = await patchFixtureStakeUnits(pickId, Number.NaN);
    assertRefusedByStakeConstraint(nanOutcome, 'NaN stake (transmitted as NULL)');

    // The constraint's second conjunct, `stake_units > 0`, is a genuinely
    // distinct refusal path and is exercised here. It is also safe: the write is
    // refused, so no unsafe row is created.
    const zeroOutcome = await patchFixtureStakeUnits(pickId, 0);
    assertRefusedByStakeConstraint(zeroOutcome, 'zero stake');

    assert.equal(
      Number(await readStakeUnits(pickId)),
      FIXTURE_STAKE_UNITS,
      'neither refused write may leave a partially applied stake',
    );
  },
);

test(
  'UTV2-1815 live DB: a real stake still persists a real profit/loss (negative control)',
  { skip: skipReason },
  async () => {
    const pickId = await createAwaitingApprovalPick('canonical');
    const outcome = await patchFixtureStakeUnits(pickId, 2);
    assert.equal(outcome.accepted, true, `legal stake must be accepted: ${JSON.stringify(outcome.error)}`);
    assert.equal(Number(outcome.stored), 2, 'fixture must hold a real stake');

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

test(
  'UTV2-1815 live DB: the shipped resolver classifies the stake exactly as Postgres returns it',
  { skip: skipReason },
  async () => {
    // Every other assertion in this file coerces the stake it reads back with
    // `Number(...)`, so none of them can see the runtime *representation*
    // PostgREST hands back for a `numeric` column. That representation is
    // load-bearing here and nowhere else in this bundle:
    //
    //   resolveStakeUnits rejects on `typeof value !== 'number'`
    //
    // so if a real, perfectly good stake arrives from the database as the JSON
    // string "2.5" rather than the number 2.5, the shipped guard classifies it
    // `historical_unknown` and every downstream path refuses to compute on a row
    // that was never invalid. That is the guard's false-refusal direction, and it
    // is the one direction a fail-closed control cannot detect about itself.
    //
    // This test therefore takes the value the database actually returned,
    // untouched, and puts it through the shipped resolver.
    const pickId = await createAwaitingApprovalPick('representation');
    const accepted = await patchFixtureStakeUnits(pickId, 2.5);
    assert.equal(
      accepted.accepted,
      true,
      `a fractional legal stake must be accepted: ${JSON.stringify(accepted.error)}`,
    );

    const rawFromDatabase = await readStakeUnits(pickId);

    // Recorded as an assertion rather than a comment: if PostgREST's numeric
    // serialization ever changes, this fails here with the observed type named,
    // instead of surfacing as an unexplained refusal in attribution.
    assert.equal(
      typeof rawFromDatabase,
      'number',
      `PostgREST returned stake_units as ${typeof rawFromDatabase} (${JSON.stringify(rawFromDatabase)}); ` +
        'resolveStakeUnits refuses anything that is not a number, so a non-number here would make ' +
        'every canonical row read back as historical_unknown',
    );

    const resolution = resolveStakeUnits(rawFromDatabase as number);
    assert.equal(
      resolution.status,
      'canonical',
      'a real stake round-tripped through Postgres must resolve canonical, not historical_unknown',
    );
    assert.equal(resolution.stake_units, 2.5, 'the resolved stake must be the stored value, unrounded');

    // The negative control on the same round-tripped path: the resolver must
    // still refuse when the value genuinely is unusable. `null` is the exact
    // shape the 2,902 legacy production rows hold, and it is the shape this
    // database's constraint can no longer create -- which is why it is
    // constructed here from the read rather than from a write.
    assert.equal(resolveStakeUnits(null).status, 'historical_unknown');
    assert.equal(resolveStakeUnits(null).stake_units, null);

    // And the settlement path, reading the same row from the same database,
    // must agree with the resolver rather than with an assumption.
    const payload = await settleAndReadBack(pickId);
    assert.equal(payload['stakeUnitsStatus'], 'canonical');
    assert.equal(
      payload['profitLossUnits'],
      2.5,
      'a win at +100 on a 2.5-unit stake must persist profitLossUnits = 2.5, not a flat 1',
    );
  },
);
