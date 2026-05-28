/**
 * T1 Live-DB Proof: UTV2-1107 DB-Layer FSM Enforcement (INIT-2.3.4)
 *
 * Verifies that the picks_fsm_guard BEFORE UPDATE trigger correctly enforces
 * the canonical pick lifecycle FSM at the DB layer, including service-role
 * direct UPDATE paths that bypass the TypeScript lifecycle guards.
 *
 * Tests:
 *   1. Valid transitions succeed (draft→validated→queued→posted→settled)
 *   2. Invalid skip-transitions are rejected (draft→settled, draft→posted, validated→settled)
 *   3. Terminal states reject all further transitions (settled→*, voided→*)
 *   4. awaiting_approval path enforced (validated→awaiting_approval→queued)
 *   5. voided accepted from all non-terminal states
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test-created picks are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1107-picks-fsm-trigger.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { CanonicalPick } from '@unit-talk/contracts';
import {
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

async function createDraftPick(label: string): Promise<string> {
  const submissionId = randomUUID();
  const now = new Date().toISOString();
  await repositories.submissions.saveSubmission({
    id: submissionId,
    payload: { source: 'test', submittedBy: `utv2-1107-${RUN_ID}` } as any,
    receivedAt: now,
  });

  const pick: CanonicalPick = {
    id: randomUUID(),
    submissionId,
    market: 'nba-spread',
    selection: `UTV2-1107 FSM TRIGGER ${label}`,
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

  const record = await repositories.picks.savePick(pick, `utv2-1107-${label}`);
  return record.id;
}

async function directStatusUpdate(pickId: string, newStatus: string): Promise<{ error: { code?: string; message: string } | null }> {
  const config = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  const { createDatabaseClientFromConnection } = await import('@unit-talk/db');
  const rawClient = createDatabaseClientFromConnection(config);
  const { error } = await rawClient.from('picks').update({ status: newStatus }).eq('id', pickId);
  return { error };
}

// ---------------------------------------------------------------------------
// Valid transition tests
// ---------------------------------------------------------------------------

test('UTV2-1107: draft → validated is allowed by FSM trigger', { skip: skipReason }, async () => {
  const id = await createDraftPick(`valid-1-${RUN_ID}`);
  const { error } = await directStatusUpdate(id, 'validated');
  assert.equal(error, null, `Expected success, got: ${error?.message}`);
});

test('UTV2-1107: validated → queued is allowed by FSM trigger', { skip: skipReason }, async () => {
  const id = await createDraftPick(`valid-2-${RUN_ID}`);
  await directStatusUpdate(id, 'validated');
  const { error } = await directStatusUpdate(id, 'queued');
  assert.equal(error, null, `Expected success, got: ${error?.message}`);
});

test('UTV2-1107: validated → awaiting_approval is allowed by FSM trigger', { skip: skipReason }, async () => {
  const id = await createDraftPick(`valid-3-${RUN_ID}`);
  await directStatusUpdate(id, 'validated');
  const { error } = await directStatusUpdate(id, 'awaiting_approval');
  assert.equal(error, null, `Expected success, got: ${error?.message}`);
});

test('UTV2-1107: awaiting_approval → queued is allowed by FSM trigger', { skip: skipReason }, async () => {
  const id = await createDraftPick(`valid-4-${RUN_ID}`);
  await directStatusUpdate(id, 'validated');
  await directStatusUpdate(id, 'awaiting_approval');
  const { error } = await directStatusUpdate(id, 'queued');
  assert.equal(error, null, `Expected success, got: ${error?.message}`);
});

test('UTV2-1107: queued → posted is allowed by FSM trigger', { skip: skipReason }, async () => {
  const id = await createDraftPick(`valid-5-${RUN_ID}`);
  await directStatusUpdate(id, 'validated');
  await directStatusUpdate(id, 'queued');
  const { error } = await directStatusUpdate(id, 'posted');
  assert.equal(error, null, `Expected success, got: ${error?.message}`);
});

test('UTV2-1107: posted → settled is allowed by FSM trigger', { skip: skipReason }, async () => {
  const id = await createDraftPick(`valid-6-${RUN_ID}`);
  await directStatusUpdate(id, 'validated');
  await directStatusUpdate(id, 'queued');
  await directStatusUpdate(id, 'posted');
  const { error } = await directStatusUpdate(id, 'settled');
  assert.equal(error, null, `Expected success, got: ${error?.message}`);
});

// ---------------------------------------------------------------------------
// Invalid transition tests — FSM trigger must reject these
// ---------------------------------------------------------------------------

test('UTV2-1107: draft → settled REJECTED (skip-transition via direct service-role UPDATE)', { skip: skipReason }, async () => {
  const id = await createDraftPick(`invalid-1-${RUN_ID}`);
  const { error } = await directStatusUpdate(id, 'settled');
  assert.ok(error !== null, 'Expected FSM trigger to reject draft→settled, but got success');
  assert.ok(
    error.message.includes('FSM_PICK_TRANSITION_REJECTED') || error.code === 'P0001',
    `Expected FSM_PICK_TRANSITION_REJECTED, got: ${error.message}`
  );
});

test('UTV2-1107: draft → posted REJECTED (skip-transition via direct service-role UPDATE)', { skip: skipReason }, async () => {
  const id = await createDraftPick(`invalid-2-${RUN_ID}`);
  const { error } = await directStatusUpdate(id, 'posted');
  assert.ok(error !== null, 'Expected FSM trigger to reject draft→posted, but got success');
  assert.ok(
    error.message.includes('FSM_PICK_TRANSITION_REJECTED') || error.code === 'P0001',
    `Expected FSM_PICK_TRANSITION_REJECTED, got: ${error.message}`
  );
});

test('UTV2-1107: validated → settled REJECTED (skip-transition via direct service-role UPDATE)', { skip: skipReason }, async () => {
  const id = await createDraftPick(`invalid-3-${RUN_ID}`);
  await directStatusUpdate(id, 'validated');
  const { error } = await directStatusUpdate(id, 'settled');
  assert.ok(error !== null, 'Expected FSM trigger to reject validated→settled, but got success');
  assert.ok(
    error.message.includes('FSM_PICK_TRANSITION_REJECTED') || error.code === 'P0001',
    `Expected FSM_PICK_TRANSITION_REJECTED, got: ${error.message}`
  );
});

// ---------------------------------------------------------------------------
// Terminal state tests
// ---------------------------------------------------------------------------

test('UTV2-1107: settled is terminal — all further transitions REJECTED', { skip: skipReason }, async () => {
  const id = await createDraftPick(`terminal-settled-${RUN_ID}`);
  await directStatusUpdate(id, 'validated');
  await directStatusUpdate(id, 'queued');
  await directStatusUpdate(id, 'posted');
  await directStatusUpdate(id, 'settled');

  for (const next of ['draft', 'validated', 'queued', 'posted', 'voided']) {
    const { error } = await directStatusUpdate(id, next);
    assert.ok(error !== null, `Expected FSM trigger to reject settled→${next}, but got success`);
    assert.ok(
      error.message.includes('FSM_PICK_TRANSITION_REJECTED') || error.code === 'P0001',
      `Expected FSM_PICK_TRANSITION_REJECTED for settled→${next}, got: ${error.message}`
    );
  }
});

test('UTV2-1107: voided is terminal — all further transitions REJECTED', { skip: skipReason }, async () => {
  const id = await createDraftPick(`terminal-voided-${RUN_ID}`);
  await directStatusUpdate(id, 'voided');

  for (const next of ['draft', 'validated', 'queued', 'posted', 'settled']) {
    const { error } = await directStatusUpdate(id, next);
    assert.ok(error !== null, `Expected FSM trigger to reject voided→${next}, but got success`);
    assert.ok(
      error.message.includes('FSM_PICK_TRANSITION_REJECTED') || error.code === 'P0001',
      `Expected FSM_PICK_TRANSITION_REJECTED for voided→${next}, got: ${error.message}`
    );
  }
});

// ---------------------------------------------------------------------------
// Void path tests
// ---------------------------------------------------------------------------

test('UTV2-1107: draft → voided is allowed by FSM trigger', { skip: skipReason }, async () => {
  const id = await createDraftPick(`void-draft-${RUN_ID}`);
  const { error } = await directStatusUpdate(id, 'voided');
  assert.equal(error, null, `Expected success, got: ${error?.message}`);
});

test('UTV2-1107: queued → voided is allowed by FSM trigger', { skip: skipReason }, async () => {
  const id = await createDraftPick(`void-queued-${RUN_ID}`);
  await directStatusUpdate(id, 'validated');
  await directStatusUpdate(id, 'queued');
  const { error } = await directStatusUpdate(id, 'voided');
  assert.equal(error, null, `Expected success, got: ${error?.message}`);
});
