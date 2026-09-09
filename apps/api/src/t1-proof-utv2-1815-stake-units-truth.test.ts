/**
 * T1 Live-DB Proof: UTV2-1815 stake_units computation truth
 *
 * UTV2-1815 routes every stake reading in settlement through one shared
 * definition (`resolveStakeUnits` in @unit-talk/domain) instead of three
 * independent `stakeUnits == null || !Number.isFinite(stakeUnits)` checks.
 * The behavioural delta over the previous code is narrow and specific:
 *
 *   - null / undefined stake  -> unchanged: `historical_unknown`, P/L null
 *   - non-positive stake (0, negative) -> CHANGED: previously `Number.isFinite(0)`
 *     was true, so a zero stake was treated as canonical and produced a
 *     computed profit/loss of 0. It is now refused as `historical_unknown`
 *     with a null P/L.
 *
 * What this proof establishes against a real database, and why it is shaped
 * this way:
 *
 * `public.picks` carries `picks_stake_units_canonical_check`
 * (`CHECK (stake_units IS NOT NULL AND stake_units > 0)`, NOT VALID) in both
 * production and staging. NOT VALID exempts pre-existing rows but is fully
 * enforced on INSERT and UPDATE. So the unusable-stake shapes this change
 * governs **cannot be created** through any write path — the branch is
 * defensive, retained for rows written before the constraint existed
 * (2,902 null-stake picks measured in production on 2026-09-09).
 *
 * A live-DB proof that manufactured a null-stake pick would therefore be
 * proving something the database refuses to represent. This proof instead
 * asserts both halves of the actual truth:
 *
 *   1. The canonical path — the one that IS reachable — settles correctly
 *      end to end through `recordPickSettlement` with live repositories,
 *      persisting `stakeUnitsStatus: 'canonical'` and a computed P/L.
 *   2. The DB itself refuses null and non-positive stake on INSERT and on
 *      UPDATE, which is what makes the changed branch unreachable for new
 *      rows rather than merely unlikely.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test-created rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1815-stake-units-truth.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { CanonicalPick, SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
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

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const config = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(config);
});

function rawClient() {
  return createDatabaseClientFromConnection(
    createServiceRoleDatabaseConnectionConfig(loadEnvironment()),
  );
}

/**
 * Persist a real pick. `stakeUnits` is a parameter so the constraint tests can
 * attempt the shapes the change governs through the ordinary write path rather
 * than through a hand-built SQL statement that would bypass repository logic.
 */
async function createPick(
  label: string,
  stakeUnits: number | null,
): Promise<{ id: string; error: string | null }> {
  const submissionId = randomUUID();
  const now = new Date().toISOString();
  const selection = `UTV2-1815 STAKE TRUTH ${label} ${RUN_ID}`;

  const submissionPayload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection,
    line: -3.5,
    odds: -110,
    stakeUnits: stakeUnits ?? 1,
    confidence: 60,
    metadata: { testRun: RUN_ID, label },
  };
  await repositories.submissions.saveSubmission({
    id: submissionId,
    payload: submissionPayload,
    receivedAt: now,
  });

  const id = randomUUID();
  const pick = {
    id,
    submissionId,
    market: 'nba-spread',
    selection,
    line: -3.5,
    odds: -110,
    stakeUnits,
    confidence: 60,
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'draft',
    metadata: { testRun: RUN_ID, label },
    createdAt: now,
  } as unknown as CanonicalPick;

  try {
    await repositories.picks.savePick(pick, `utv2-1815-${label}`);
    return { id, error: null };
  } catch (err) {
    return { id, error: err instanceof Error ? err.message : String(err) };
  }
}

async function advance(pickId: string, status: string): Promise<void> {
  const { error } = await rawClient().from('picks').update({ status }).eq('id', pickId);
  assert.equal(error, null, `Expected transition to ${status} to succeed, got: ${error?.message}`);
}

async function readSettlementPayload(pickId: string): Promise<Record<string, unknown>> {
  const { data, error } = await rawClient()
    .from('settlement_records')
    .select('payload')
    .eq('pick_id', pickId)
    .order('settled_at', { ascending: false })
    .limit(1);
  assert.equal(error, null, `settlement_records read failed: ${error?.message}`);
  assert.ok(data && data.length === 1, 'expected exactly one settlement row for the test pick');
  return (data[0] as { payload: Record<string, unknown> }).payload;
}

// ---------------------------------------------------------------------------
// 1. The reachable path — a canonical stake settles and is labelled canonical
// ---------------------------------------------------------------------------

test(
  'UTV2-1815: canonical stake settles with stakeUnitsStatus canonical and a computed P/L',
  { skip: skipReason },
  async () => {
    const { id, error } = await createPick('canonical', 2.5);
    assert.equal(error, null, `canonical-stake pick must persist, got: ${error}`);

    await advance(id, 'validated');
    await advance(id, 'queued');
    await advance(id, 'posted');

    const result = await recordPickSettlement(
      id,
      {
        status: 'settled',
        result: 'win',
        source: 'operator',
        confidence: 'confirmed',
        evidenceRef: `utv2-1815-canonical-${RUN_ID}`,
        settledBy: `utv2-1815-proof-${RUN_ID}`,
      },
      {
        picks: repositories.picks,
        settlements: repositories.settlements,
        audit: repositories.audit,
      },
    );
    assert.ok(result, 'recordPickSettlement must return a result');

    const payload = await readSettlementPayload(id);
    assert.equal(
      payload['stakeUnitsStatus'],
      'canonical',
      'a positive finite stake must persist as canonical',
    );
    assert.equal(
      payload['stakeUnitsHistoricalUnknown'],
      undefined,
      'a canonical stake must not carry the historical-unknown marker',
    );
    // 2.5 units at -110: 2.5 * (100/110) = 2.2727..., rounded to 2 decimals.
    assert.equal(
      payload['profitLossUnits'],
      2.27,
      'profit/loss must be computed from the real stake, not assumed',
    );
  },
);

// ---------------------------------------------------------------------------
// 2. Why the changed branch is unreachable for new rows — the DB refuses the
//    shapes it governs, on INSERT and on UPDATE.
// ---------------------------------------------------------------------------

test(
  'UTV2-1815: picks refuses a null stake on INSERT (picks_stake_units_canonical_check)',
  { skip: skipReason },
  async () => {
    const { error } = await createPick('null-stake', null);
    assert.ok(
      error !== null,
      'Expected the DB to refuse a null stake_units INSERT, but the write succeeded',
    );
    assert.ok(
      /stake_units/i.test(error ?? ''),
      `Expected a stake_units constraint violation, got: ${error}`,
    );
  },
);

test(
  'UTV2-1815: picks refuses a non-positive stake on UPDATE',
  { skip: skipReason },
  async () => {
    const { id, error } = await createPick('zero-stake-update', 1);
    assert.equal(error, null, `baseline pick must persist, got: ${error}`);

    const { error: updateError } = await rawClient()
      .from('picks')
      .update({ stake_units: 0 })
      .eq('id', id);

    assert.ok(
      updateError !== null,
      'Expected the DB to refuse an UPDATE to stake_units = 0, but it succeeded',
    );
    assert.ok(
      /stake_units/i.test(updateError?.message ?? ''),
      `Expected a stake_units constraint violation, got: ${updateError?.message}`,
    );
  },
);
