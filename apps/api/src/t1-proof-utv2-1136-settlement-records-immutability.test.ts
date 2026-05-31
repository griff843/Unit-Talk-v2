/**
 * T1 Live-DB Proof: UTV2-1136 settlement_records Immutability Trigger (INIT-4.2.2)
 *
 * Verifies that the settlement_records_immutable BEFORE UPDATE OR DELETE trigger
 * correctly enforces append-only semantics at the DB layer.
 *
 * Tests:
 *   1. Settlement INSERT succeeds (original record creation)
 *   2. UPDATE on existing settlement_records row is rejected (SETTLEMENT_RECORD_IMMUTABLE)
 *   3. DELETE on existing settlement_records row is rejected (SETTLEMENT_RECORD_IMMUTABLE)
 *   4. Correction INSERT (new row with corrects_id set) succeeds
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test-created rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1136-settlement-records-immutability.test.ts
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestPick(label: string): Promise<string> {
  const submissionId = randomUUID();
  const now = new Date().toISOString();
  const submissionPayload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection: `UTV2-1136 IMMUTABILITY ${label}`,
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
    selection: `UTV2-1136 IMMUTABILITY ${label}`,
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

  const record = await repositories.picks.savePick(pick, `utv2-1136-${label}`);
  return record.id;
}

function rawClient() {
  const config = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  return createDatabaseClientFromConnection(config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test(
  'UTV2-1136: settlement INSERT succeeds (baseline)',
  { skip: skipReason },
  async () => {
    const pickId = await createTestPick(`insert-${RUN_ID}`);
    const now = new Date().toISOString();

    const settlement = await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'win',
      source: 'grading',
      confidence: 'confirmed',
      evidenceRef: `utv2-1136-test-${RUN_ID}`,
      settledBy: 'utv2-1136-proof',
      settledAt: now,
      payload: { testRun: RUN_ID },
    });

    assert.ok(settlement.id, 'settlement INSERT must return a row id');
    assert.equal(settlement.pick_id, pickId);
    assert.equal(settlement.result, 'win');
    assert.equal(settlement.corrects_id, null, 'original row has no corrects_id');
  },
);

test(
  'UTV2-1136: UPDATE on settlement_records is rejected by immutability trigger',
  { skip: skipReason },
  async () => {
    const pickId = await createTestPick(`update-${RUN_ID}`);
    const now = new Date().toISOString();

    const settlement = await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'loss',
      source: 'grading',
      confidence: 'confirmed',
      evidenceRef: `utv2-1136-update-test-${RUN_ID}`,
      settledBy: 'utv2-1136-proof',
      settledAt: now,
      payload: { testRun: RUN_ID },
    });

    const { error } = await rawClient()
      .from('settlement_records')
      .update({ result: 'win' })
      .eq('id', settlement.id);

    assert.ok(error !== null, 'Expected UPDATE to be rejected but got success');
    assert.ok(
      error.message.includes('SETTLEMENT_RECORD_IMMUTABLE') || error.code === 'P0001',
      `Expected SETTLEMENT_RECORD_IMMUTABLE error, got: ${error.message}`,
    );
  },
);

test(
  'UTV2-1136: DELETE on settlement_records is rejected by immutability trigger',
  { skip: skipReason },
  async () => {
    const pickId = await createTestPick(`delete-${RUN_ID}`);
    const now = new Date().toISOString();

    const settlement = await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'push',
      source: 'grading',
      confidence: 'confirmed',
      evidenceRef: `utv2-1136-delete-test-${RUN_ID}`,
      settledBy: 'utv2-1136-proof',
      settledAt: now,
      payload: { testRun: RUN_ID },
    });

    const { error } = await rawClient()
      .from('settlement_records')
      .delete()
      .eq('id', settlement.id);

    assert.ok(error !== null, 'Expected DELETE to be rejected but got success');
    assert.ok(
      error.message.includes('SETTLEMENT_RECORD_IMMUTABLE') || error.code === 'P0001',
      `Expected SETTLEMENT_RECORD_IMMUTABLE error, got: ${error.message}`,
    );
  },
);

test(
  'UTV2-1136: correction INSERT (with corrects_id) succeeds — append-only path intact',
  { skip: skipReason },
  async () => {
    const pickId = await createTestPick(`correction-${RUN_ID}`);
    const now = new Date().toISOString();

    const original = await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'loss',
      source: 'grading',
      confidence: 'estimated',
      evidenceRef: `utv2-1136-orig-${RUN_ID}`,
      settledBy: 'utv2-1136-proof',
      settledAt: now,
      payload: { testRun: RUN_ID },
    });

    const correction = await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'win',
      source: 'grading',
      confidence: 'confirmed',
      evidenceRef: `utv2-1136-corr-${RUN_ID}`,
      settledBy: 'utv2-1136-proof',
      settledAt: new Date().toISOString(),
      correctsId: original.id,
      payload: { testRun: RUN_ID, corrects: original.id },
    });

    assert.ok(correction.id, 'correction INSERT must return a row id');
    assert.notEqual(correction.id, original.id, 'correction must be a new row');
    assert.equal(correction.corrects_id, original.id, 'corrects_id links to original');
    assert.equal(correction.result, 'win', 'correction row has updated result');

    const all = await repositories.settlements.listByPick(pickId);
    assert.equal(all.length, 2, 'both original and correction must be present');
  },
);
