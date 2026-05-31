/**
 * T1 Live-DB Proof: UTV2-1137 — Dual-Authorized Corrections (INIT-4.2.3)
 *
 * Verifies dual-authorization enforcement at the DB layer.
 *
 * Tests:
 *   1. Attempted mutation of settlement_records rejected (immutability — UTV2-1136)
 *   2. Single-approver correction rejected by DB CHECK constraint
 *   3. Dual-authorized correction succeeds and settlement_corrections record is created
 *   4. PnL reproduced through correction chain via resolveEffectiveSettlement
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts
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
import {
  resolveEffectiveSettlement,
  validateDualAuthorization,
  validateSettlementCorrectionInput,
} from '@unit-talk/domain';

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const config = createServiceRoleDatabaseConnectionConfig(env);
  supabase = createDatabaseClientFromConnection(config);
  repositories = createDatabaseRepositoryBundle(config);
});

async function createTestPick(label: string): Promise<string> {
  const submissionId = randomUUID();
  const now = new Date().toISOString();
  const submissionPayload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection: `UTV2-1137 DUAL-AUTH ${label} ${RUN_ID}`,
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

  const pick: CanonicalPick = {
    id: randomUUID(),
    submissionId,
    market: 'nba-spread',
    selection: `UTV2-1137 DUAL-AUTH ${label} ${RUN_ID}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    source: 'smart-form',
    submittedBy: `test-${RUN_ID}`,
    approvalStatus: 'pending',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata: { testRun: RUN_ID },
    createdAt: now,
  };
  await repositories.picks.savePick(pick);
  return pick.id;
}

// ── Test 1: Immutability enforced (UTV2-1136 inherited) ───────────────────────

test('T1 Proof 1 — attempted UPDATE on settlement_records rejected', { skip: skipReason }, async () => {
  const pickId = await createTestPick('immutability-check');
  const now = new Date().toISOString();

  const original = await repositories.settlements.record({
    pickId,
    status: 'settled',
    result: 'loss',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `ref-${RUN_ID}-immutability`,
    settledBy: `test-${RUN_ID}`,
    settledAt: now,
    payload: { testRun: RUN_ID },
  });

  const { error } = await supabase
    .from('settlement_records')
    .update({ result: 'win' })
    .eq('id', original.id);

  assert.ok(error, 'Expected immutability error, but UPDATE succeeded');
  assert.ok(
    (error.message as string).includes('SETTLEMENT_RECORD_IMMUTABLE'),
    `Unexpected error: ${error.message}`,
  );
});

// ── Test 2: Single-approver correction rejected ───────────────────────────────

test('T1 Proof 2 — single-approver correction rejected by DB constraint', { skip: skipReason }, async () => {
  const pickId = await createTestPick('single-approver');
  const now = new Date().toISOString();

  const original = await repositories.settlements.record({
    pickId,
    status: 'settled',
    result: 'loss',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `ref-${RUN_ID}-single-approver-orig`,
    settledBy: `test-${RUN_ID}`,
    settledAt: now,
    payload: { testRun: RUN_ID },
  });

  const correction = await repositories.settlements.record({
    pickId,
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `ref-${RUN_ID}-single-approver-corr`,
    settledBy: `test-${RUN_ID}`,
    settledAt: now,
    correctsId: original.id,
    payload: { testRun: RUN_ID, correction: true },
  });

  // Single-approver: same identity for both authorizers — must be rejected
  const { error } = await supabase
    .from('settlement_corrections')
    .insert({
      settlement_record_id: correction.id,
      prior_record_id: original.id,
      authorizer_1: 'same-user',
      authorizer_2: 'same-user',
      justification: 'Attempting single-approver correction',
    });

  assert.ok(error, 'Expected CHECK constraint violation, but INSERT succeeded');
  assert.ok(
    (error.message as string).toLowerCase().includes('check') ||
    (error.message as string).includes('distinct_authorizers') ||
    (error.code as string) === '23514',
    `Unexpected error: ${error.message} (code: ${error.code})`,
  );
});

// ── Test 3: Dual-authorized correction succeeds ───────────────────────────────

test('T1 Proof 3 — dual-authorized correction creates settlement_corrections record', { skip: skipReason }, async () => {
  const pickId = await createTestPick('dual-auth-success');
  const now = new Date().toISOString();

  const authValidation = validateDualAuthorization({
    authorizer_1: 'authorizer-alpha',
    authorizer_2: 'authorizer-beta',
    justification: 'T1 proof: correcting settlement result from loss to win',
  });
  assert.ok(authValidation.ok, 'Domain validation must pass');

  const original = await repositories.settlements.record({
    pickId,
    status: 'settled',
    result: 'loss',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `ref-${RUN_ID}-dual-original`,
    settledBy: `test-${RUN_ID}`,
    settledAt: now,
    payload: { testRun: RUN_ID },
  });

  const correction = await repositories.settlements.record({
    pickId,
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `ref-${RUN_ID}-dual-correction`,
    settledBy: `authorizer-alpha`,
    settledAt: now,
    correctsId: original.id,
    payload: { testRun: RUN_ID, correction: true },
  });

  const { data: authRecord, error } = await supabase
    .from('settlement_corrections')
    .insert({
      settlement_record_id: correction.id,
      prior_record_id: original.id,
      authorizer_1: 'authorizer-alpha',
      authorizer_2: 'authorizer-beta',
      justification: 'T1 proof: correcting settlement result from loss to win',
    })
    .select()
    .single();

  assert.ok(!error, `settlement_corrections INSERT failed: ${JSON.stringify(error)}`);
  assert.ok(authRecord, 'Expected settlement_corrections record');
  assert.equal(authRecord.settlement_record_id, correction.id);
  assert.equal(authRecord.prior_record_id, original.id);
  assert.equal(authRecord.authorizer_1, 'authorizer-alpha');
  assert.equal(authRecord.authorizer_2, 'authorizer-beta');
});

// ── Test 4: PnL reproduces through correction chain ──────────────────────────

test('T1 Proof 4 — PnL reproduces through correction chain', { skip: skipReason }, async () => {
  const pickId = await createTestPick('pnl-reproduction');
  const now = new Date().toISOString();

  const original = await repositories.settlements.record({
    pickId,
    status: 'settled',
    result: 'loss',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `ref-${RUN_ID}-pnl-original`,
    settledBy: `test-${RUN_ID}`,
    settledAt: now,
    payload: { testRun: RUN_ID },
  });

  const correction = await repositories.settlements.record({
    pickId,
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `ref-${RUN_ID}-pnl-correction`,
    settledBy: `authorizer-gamma`,
    settledAt: now,
    correctsId: original.id,
    payload: { testRun: RUN_ID, correction: true },
  });

  await supabase.from('settlement_corrections').insert({
    settlement_record_id: correction.id,
    prior_record_id: original.id,
    authorizer_1: 'authorizer-gamma',
    authorizer_2: 'authorizer-delta',
    justification: 'T1 proof: PnL reproduction test',
  });

  const allRecords = await repositories.settlements.listByPick(pickId);
  assert.ok(allRecords.length >= 2, 'Expected original + correction');

  const effectiveResult = resolveEffectiveSettlement(
    allRecords.map((r) => ({
      id: r.id,
      pick_id: r.pick_id,
      status: r.status as 'settled' | 'manual_review',
      result: r.result,
      confidence: r.confidence,
      corrects_id: r.corrects_id,
      settled_at: r.settled_at,
    })),
  );

  assert.ok(effectiveResult.ok, `Effective settlement resolution failed: ${JSON.stringify(effectiveResult)}`);
  assert.equal(effectiveResult.settlement.result, 'win', 'Effective result should be win after correction');
  assert.equal(effectiveResult.settlement.correction_depth, 1, 'Correction depth should be 1');

  const inputValidation = validateSettlementCorrectionInput({
    prior_record_id: original.id,
    pick_id: pickId,
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidence_ref: `ref-${RUN_ID}-pnl-correction`,
    settled_by: 'authorizer-gamma',
    settled_at: now,
    authorization: {
      authorizer_1: 'authorizer-gamma',
      authorizer_2: 'authorizer-delta',
      justification: 'T1 proof: PnL reproduction test',
    },
  });
  assert.ok(inputValidation.ok, 'Domain validation must pass');
});
