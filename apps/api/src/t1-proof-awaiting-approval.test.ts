/**
 * T1 Pre-Merge Proof: UTV2-519 awaiting_approval governance brake
 *
 * Exercises the Phase 7A brake path against the live Supabase database via
 * the in-process submit-pick controller, covering the three brake sources
 * (system-pick-scanner, alert-agent, model-driven) plus an atomic-rollback
 * regression that confirms the new `transition_pick_lifecycle` RPC rolls
 * both writes back on a mismatched fromState.
 *
 * STEP 4 extends the same live path to UTV2-1611's automated write boundary
 * for `board-construction`, which is born directly in `awaiting_approval`
 * rather than braked out of `validated`.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Fixtures are tagged with a
 * deterministic prefix (`utv2-519-brake-*`, `utv2-1611-boundary-*`) so they
 * can be found after the run. The UTV2-519 fixtures are NOT deleted — we do
 * not mutate live rows in that proof. The UTV2-1611 board fixtures ARE voided
 * at the end of the run, through the lifecycle FSM (never a direct status
 * PATCH), so no board fixture is left in an actionable state.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-awaiting-approval.test.ts
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { PickSource, SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  InvalidTransitionError,
  transitionPickLifecycle,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from './controllers/submit-pick-controller.js';

function hasSupabaseSmokeEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseSmokeEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let repositories: RepositoryBundle;
let supabaseUrl: string;
let serviceRoleKey: string;
const createdPickIds: string[] = [];

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  supabaseUrl = env.SUPABASE_URL!;
  serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
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

interface PickRow {
  id: string;
  status: string;
  source: string;
}

interface LifecycleRow {
  id: string;
  pick_id: string;
  from_state: string | null;
  to_state: string;
  writer_role: string;
  reason: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  entity_type: string;
  entity_id: string;
}

interface OutboxRow {
  id: string;
  pick_id: string;
  status: string;
}

async function runBrakeCase(source: PickSource) {
  const runId = randomUUID();
  const fixtureId = `utv2-519-brake-${source}-${runId}`;
  const payload: SubmissionPayload = {
    source,
    market: 'nba-spread',
    selection: `UTV2-519 BRAKE ${source} ${runId}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: {
      proof_fixture_id: fixtureId,
      proof_issue: 'UTV2-519',
    },
  };

  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `brake ${source}: expected 201, got ${response.status}`);
  assert.ok(response.body.ok, `brake ${source}: response not ok`);
  const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string; governanceBrake?: boolean; outboxEnqueued: boolean } }).data;
  assert.equal(data.lifecycleState, 'awaiting_approval', `brake ${source}: lifecycleState`);
  assert.equal(data.governanceBrake, true, `brake ${source}: governanceBrake flag`);
  assert.equal(data.outboxEnqueued, false, `brake ${source}: outboxEnqueued`);

  const pickId = data.pickId;
  createdPickIds.push(pickId);

  // 1. picks row status
  const pickRows = await restQuery<PickRow>(
    `picks?id=eq.${pickId}&select=id,status,source`,
  );
  assert.equal(pickRows.length, 1, `brake ${source}: pick row not found`);
  assert.equal(pickRows[0]!.status, 'awaiting_approval', `brake ${source}: picks.status`);

  // 2. exactly one pick_lifecycle row with validated->awaiting_approval
  const lifecycleRows = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason&order=created_at.asc`,
  );
  const brakeEvents = lifecycleRows.filter(
    (row) => row.from_state === 'validated' && row.to_state === 'awaiting_approval',
  );
  assert.equal(
    brakeEvents.length,
    1,
    `brake ${source}: expected 1 validated->awaiting_approval event, got ${brakeEvents.length}`,
  );
  const brakeEvent = brakeEvents[0]!;
  assert.ok(brakeEvent.writer_role, `brake ${source}: writer_role must be non-empty`);
  assert.ok(brakeEvent.reason && brakeEvent.reason.length > 0, `brake ${source}: reason must be non-empty`);

  // 3. audit_log has pick.governance_brake.applied with payload.pickId
  const auditRows = await restQuery<AuditRow>(
    `audit_log?action=eq.pick.governance_brake.applied&select=id,action,payload,entity_type,entity_id&order=created_at.desc&limit=200`,
  );
  const matchingAudit = auditRows.find(
    (row) => (row.payload as { pickId?: string } | null)?.pickId === pickId,
  );
  assert.ok(
    matchingAudit,
    `brake ${source}: no pick.governance_brake.applied audit row with payload.pickId=${pickId}`,
  );

  // 4. distribution_outbox has zero rows for this pick
  const outboxRows = await restQuery<OutboxRow>(
    `distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id,status`,
  );
  assert.equal(
    outboxRows.length,
    0,
    `brake ${source}: expected 0 outbox rows, got ${outboxRows.length}`,
  );

  return pickId;
}

// ─── STEP 1: brake-path integrity for each non-human source ──────────

test('UTV2-519 brake path: system-pick-scanner', { skip: skipReason }, async () => {
  const id = await runBrakeCase('system-pick-scanner');
  console.log(`  system-pick-scanner brake OK — pickId=${id}`);
});

test('UTV2-519 brake path: alert-agent', { skip: skipReason }, async () => {
  const id = await runBrakeCase('alert-agent');
  console.log(`  alert-agent brake OK — pickId=${id}`);
});

test('UTV2-519 brake path: model-driven', { skip: skipReason }, async () => {
  const id = await runBrakeCase('model-driven');
  console.log(`  model-driven brake OK — pickId=${id}`);
});

// ─── STEP 2: atomic-rollback regression ──────────────────────────────
//
// Submit a fresh brake-path pick (which lands it in awaiting_approval), then
// deliberately call transitionPickLifecycle with a MISMATCHED fromState
// ('queued' instead of the real 'awaiting_approval'). The atomic RPC must
// raise INVALID_LIFECYCLE_TRANSITION (P0001), the TypeScript caller must
// surface this as InvalidTransitionError, picks.status must not change, and
// no new pick_lifecycle row must be written.

test('UTV2-519 atomic rollback: mismatched fromState leaves picks.status and pick_lifecycle untouched', { skip: skipReason }, async () => {
  // Create a fresh fixture pick via the brake path so we are guaranteed to
  // own the row without touching any pre-existing stranded data.
  const runId = randomUUID();
  const fixtureId = `utv2-519-rollback-${runId}`;
  const payload: SubmissionPayload = {
    source: 'system-pick-scanner',
    market: 'nba-total',
    selection: `UTV2-519 ROLLBACK ${runId}`,
    line: 220.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: { proof_fixture_id: fixtureId, proof_issue: 'UTV2-519' },
  };
  const resp = await submitPickController(payload, repositories);
  assert.equal(resp.status, 201);
  const pickId = (resp.body as { ok: true; data: { pickId: string } }).data.pickId;
  createdPickIds.push(pickId);

  // Snapshot pick_lifecycle count before the mismatched attempt.
  const beforeEvents = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason`,
  );
  const beforeCount = beforeEvents.length;

  // FSM guard check in lifecycle.ts evaluates allowedTransitions before it
  // calls the atomic RPC. So to force the atomic path to raise the
  // INVALID_LIFECYCLE_TRANSITION, we need a target that is allowed by the
  // TypeScript FSM from our claimed fromState. awaiting_approval -> queued
  // is allowed by the FSM. The pick is actually in awaiting_approval, so
  // the ClaimPickTransition pre-check in transitionPickLifecycle will pass
  // (from = awaiting_approval, to = queued are FSM-valid), then we pass the
  // REAL fromState to the atomic RPC which will match. That is NOT a
  // mismatch test.
  //
  // Better: call the repository's transitionPickLifecycleAtomic directly
  // with a fabricated fromState mismatch. This bypasses the FSM pre-check
  // and lets us observe the Postgres-level exception rollback.
  // The method is optional on the interface (see UTV2-520 for tightening).
  // DatabasePickRepository implements it; assert it exists before invoking.
  const atomicTransition = repositories.picks.transitionPickLifecycleAtomic;
  assert.ok(
    typeof atomicTransition === 'function',
    'DatabasePickRepository.transitionPickLifecycleAtomic must be implemented for this proof',
  );
  await assert.rejects(
    () =>
      atomicTransition.call(repositories.picks, {
        pickId,
        fromState: 'queued', // wrong — real state is awaiting_approval
        toState: 'posted',
        writerRole: 'proof-runner',
        reason: 'UTV2-519 atomic rollback regression',
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err instanceof InvalidTransitionError ||
          (err as Error).message.includes('INVALID_LIFECYCLE_TRANSITION'),
        `expected InvalidTransitionError or INVALID_LIFECYCLE_TRANSITION, got: ${(err as Error).message}`,
      );
      return true;
    },
  );

  // Assert picks.status did not change.
  const afterPick = await restQuery<PickRow>(
    `picks?id=eq.${pickId}&select=id,status,source`,
  );
  assert.equal(afterPick.length, 1);
  assert.equal(
    afterPick[0]!.status,
    'awaiting_approval',
    'picks.status must be unchanged after rollback',
  );

  // Assert no new pick_lifecycle row was inserted.
  const afterEvents = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason`,
  );
  assert.equal(
    afterEvents.length,
    beforeCount,
    `pick_lifecycle row count must not change after rollback (before=${beforeCount}, after=${afterEvents.length})`,
  );

  // Sanity: the real transition still works (proves the atomic path is
  // live and the rollback did not leave a persistent lock).
  const realTransition = await transitionPickLifecycle(
    repositories.picks,
    pickId,
    'voided',
    'UTV2-519 cleanup to voided (allowed)',
    'promoter',
  );
  assert.equal(realTransition.lifecycleState, 'voided');

  console.log(`  atomic rollback OK — pickId=${pickId} (cleaned up to voided)`);
});

// ─── STEP 3: diagnostics ─────────────────────────────────────────────

test('UTV2-519 created pick ids (diagnostics)', { skip: skipReason }, () => {
  console.log(`  UTV2-519 test run created pick ids: ${JSON.stringify(createdPickIds)}`);
});

// ─── STEP 4: UTV2-1611 automated write boundary (board-construction) ──
//
// Exercises the REAL board-construction submission path against the live
// Supabase database via the same in-process submit-pick controller, and proves
// the property that lane exists to establish: an automated board production is
// born in `awaiting_approval` and is never persisted as `validated`.
//
// This is distinct from the STEP 1 brake cases above, which cover the Phase 7A
// SOURCE brake (system-pick-scanner, alert-agent, model-driven) using minimal
// source-only fixtures that reach `validated` first and are then braked. Before
// UTV2-1611 `board-construction` was absent from `GOVERNANCE_BRAKE_SOURCES` and
// had no marker-independent brake, so its picks rested in `validated`
// ungoverned. The governing mechanism here is the shared automated write
// boundary, admitted by SOURCE (board-construction is `boundary-required`),
// with `GOVERNANCE_BRAKE_SOURCES` membership as the source-keyed fallback
// brake.
//
// Unlike the STEP 1 fixtures, these are voided at the end of the run so no
// board fixture is left in an actionable state. The cleanup goes through the
// lifecycle FSM, never a direct status PATCH.

const boundaryRunId = randomUUID();
const boundaryFixturePrefix = `utv2-1611-boundary-${boundaryRunId}`;
const boundaryPickIds: string[] = [];

function boardSubmission(): SubmissionPayload {
  return {
    source: 'board-construction',
    submittedBy: 'scheduler:board-pick-writer',
    market: 'nba-spread',
    selection: `UTV2-1611 BOUNDARY ${boundaryRunId}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: {
      systemGenerated: true,
      marketUniverseId: `${boundaryFixturePrefix}-universe`,
      providerKey: 'sgo',
      providerMarketKey: 'spread-all-game',
      snapshot_at: new Date().toISOString(),
      sportKey: 'nba',
      proof_fixture_id: boundaryFixturePrefix,
      proof_issue: 'UTV2-1611',
    },
  } as SubmissionPayload;
}

test('UTV2-1611: an automated board production is born in awaiting_approval', { skip: skipReason }, async () => {
  const response = await submitPickController(boardSubmission(), repositories);
  assert.equal(response.status, 201, `expected 201, got ${response.status}`);

  const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string; outboxEnqueued: boolean } }).data;
  boundaryPickIds.push(data.pickId);

  assert.equal(data.lifecycleState, 'awaiting_approval', 'board production must not be actionable');
  assert.equal(data.outboxEnqueued, false, 'an ungoverned board pick must never enqueue for delivery');

  // The persisted row is the authority, not the response envelope.
  const [row] = await restQuery<PickRow>(
    `picks?id=eq.${data.pickId}&select=id,status,source`,
  );
  assert.ok(row, 'pick row must exist');
  assert.equal(row.status, 'awaiting_approval', 'persisted status must be awaiting_approval');
  assert.equal(row.source, 'board-construction');
});

test('UTV2-1611: the birth lifecycle event agrees and records no validated state', { skip: skipReason }, async () => {
  const pickId = boundaryPickIds[0];
  assert.ok(pickId, 'previous test must have created a pick');

  const rows = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=id,pick_id,from_state,to_state,writer_role,reason&order=created_at.asc`,
  );
  assert.ok(rows.length >= 1, 'a birth lifecycle event must exist');

  const birth = rows[0]!;
  assert.equal(birth.to_state, 'awaiting_approval', 'birth event must agree with the persisted status');

  // The boundary materializes the governed state in the same atomic write, so
  // no lifecycle row may ever name `validated` -- not as a destination and not
  // as a state the pick was transitioned out of.
  for (const row of rows) {
    assert.notEqual(row.to_state, 'validated', 'no lifecycle event may move this pick into validated');
    assert.notEqual(row.from_state, 'validated', 'the pick must never have occupied validated');
  }
});

test('UTV2-1611: no unauthorized direct-to-validated board write exists for this run', { skip: skipReason }, async () => {
  // Scoped to this run's fixtures so the assertion cannot be satisfied or
  // broken by unrelated production rows.
  const offenders = await restQuery<PickRow>(
    `picks?source=eq.board-construction&status=eq.validated&metadata->>proof_fixture_id=eq.${boundaryFixturePrefix}&select=id,status,source`,
  );
  assert.equal(offenders.length, 0, `direct-to-validated board writes found: ${JSON.stringify(offenders)}`);
});

after(async () => {
  if (skipReason) return;
  // Leave no board fixture in an actionable state. `voided` is terminal and is
  // never distributed, so this cannot leak into delivery.
  //
  // UTV2-1611: cleanup goes through the lifecycle FSM, never a direct status
  // PATCH. A raw `PATCH picks SET status='voided'` writes the lifecycle column
  // without the matching `pick_lifecycle` row, so it (a) is not validated
  // against `pickLifecycleTransitions` and would happily perform a forbidden
  // transition, and (b) leaves an unauditable status change — the very class of
  // ungoverned direct write this proof exists to disprove. A proof that cleans
  // up by bypassing the control it is proving is not evidence.
  for (const pickId of boundaryPickIds) {
    try {
      await transitionPickLifecycle(
        repositories.picks,
        pickId,
        'voided',
        'UTV2-1611 live proof fixture cleanup',
        'operator_override',
      );
    } catch (cleanupError) {
      // Surface rather than swallow: a fixture left actionable is an operational
      // fact the run must report, not hide.
      console.error(
        JSON.stringify({
          proof: 'UTV2-1611',
          event: 'fixture_cleanup_failed',
          pickId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        }),
      );
      throw cleanupError;
    }
  }

  // The cleanup itself must be auditable: every voided fixture carries a
  // matching pick_lifecycle row. This is the assertion a direct PATCH cannot
  // satisfy.
  for (const pickId of boundaryPickIds) {
    const rows = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&to_state=eq.voided&select=id,pick_id,from_state,to_state,writer_role,reason`,
    );
    assert.equal(rows.length, 1, `voiding fixture ${pickId} must write exactly one lifecycle event`);
    assert.equal(rows[0]!.from_state, 'awaiting_approval');
  }
});

// ─── STEP 5: UTV2-1672 Track Only chokepoint against live Postgres ──────────
//
// The Track Only guards were previously proven only against an in-memory
// repository and a stub Supabase client. Both are faithful, but neither is
// Postgres, and this class of change has shipped broken twice precisely
// because unit tests pass under InMemory while production diverges.
//
// This step submits a Track Only pick through the real in-process submit-pick
// controller against real database repositories, then attacks the persisted
// row directly through DatabaseOutboxRepository — the repository production
// actually runs — and proves no `distribution_outbox` row can be created for
// it. Fixtures are tagged `utv2-1672-track-only-<runId>` and voided through
// the lifecycle FSM in the `after` hook, so nothing is left actionable.

const trackOnlyRunId = randomUUID();
const trackOnlyFixtureId = `utv2-1672-track-only-${trackOnlyRunId}`;
const trackOnlyPickIds: string[] = [];
let trackOnlyPickId = '';

test('UTV2-1672: a Track Only submission persists as track-only and creates no outbox row', { skip: skipReason }, async () => {
  // The Smart Form relationship contract runs for `smart-form` submissions, so
  // this fixture has to satisfy it rather than route around it — that keeps the
  // proof end-to-end instead of proving only the chokepoint in isolation.
  //
  // The sport is read from the live catalog rather than hardcoded: a hardcoded
  // id that staging happened not to carry would fail CANONICAL_SPORT_ID_GUARD
  // and produce a red that says nothing about Track Only.
  const catalog = await repositories.referenceData.getCatalog();
  const teamSports = new Set(['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB', 'NHL', 'SOCCER']);
  const sport = catalog.sports.find((candidate) => teamSports.has(candidate.id.toUpperCase()));
  assert.ok(sport, `no canonical team sport in the live catalog (found: ${catalog.sports.map((s) => s.id).join(', ')})`);
  const sportId = sport.id;

  // Deliberately non-canonical participant names, so the coverage gap the
  // manual resolution claims is genuine. MANUAL_COVERAGE_GAP_PROOF_GUARD
  // refuses a fabricated gap, so these must not collide with real reference
  // data — the run id makes that certain.
  const awayName = `UTV2-1672 Proof Away ${trackOnlyRunId}`;
  const homeName = `UTV2-1672 Proof Home ${trackOnlyRunId}`;
  const enteredEventName = `${awayName} at ${homeName}`;

  const payload: SubmissionPayload = {
    source: 'smart-form',
    market: 'spread',
    selection: `UTV2-1672 TRACK ONLY ${trackOnlyRunId}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    eventName: enteredEventName,
    metadata: {
      proof_fixture_id: trackOnlyFixtureId,
      proof_issue: 'UTV2-1672',
      distributionMode: 'track-only',
      participantResolution: {
        resolution: 'manual',
        sportId,
        eventId: null,
        manualOverride: true,
        reason: 'canonical-coverage-gap',
        enteredEventName,
        enteredParticipants: [
          { role: 'away', displayName: awayName, canonicalParticipantId: null },
          { role: 'home', displayName: homeName, canonicalParticipantId: null },
        ],
      },
    },
  };

  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `expected 201, got ${response.status}`);
  const data = (response.body as { ok: true; data: { pickId: string; outboxEnqueued: boolean } }).data;
  assert.equal(data.outboxEnqueued, false, 'a Track Only submission must not enqueue delivery work');

  trackOnlyPickId = data.pickId;
  trackOnlyPickIds.push(trackOnlyPickId);
  createdPickIds.push(trackOnlyPickId);

  // The metadata must be durable in Postgres, not merely present on the
  // in-process result object. Every downstream guard reads the persisted row.
  const pickRows = await restQuery<{ id: string; status: string; metadata: Record<string, unknown> | null }>(
    `picks?id=eq.${trackOnlyPickId}&select=id,status,metadata`,
  );
  assert.equal(pickRows.length, 1, 'pick row not found in Postgres');
  assert.equal(
    (pickRows[0]!.metadata as { distributionMode?: string } | null)?.distributionMode,
    'track-only',
    'persisted metadata must carry distributionMode=track-only',
  );

  const outboxRows = await restQuery<OutboxRow>(
    `distribution_outbox?pick_id=eq.${trackOnlyPickId}&select=id,pick_id,status`,
  );
  assert.equal(outboxRows.length, 0, `expected 0 outbox rows, got ${outboxRows.length}`);
});

test('UTV2-1672: DatabaseOutboxRepository refuses to enqueue the persisted Track Only pick', { skip: skipReason }, async () => {
  assert.ok(trackOnlyPickId, 'the Track Only fixture must exist before the chokepoint is attacked');
  const { TrackOnlyDeliveryForbiddenError } = await import('@unit-talk/db');

  // This is the direct attack the controller-level test cannot make: call the
  // production outbox repository against live Postgres and ask it to create
  // delivery work for a pick whose Track Only status exists only as a
  // persisted row.
  await assert.rejects(
    () =>
      repositories.outbox.enqueue({
        pickId: trackOnlyPickId,
        target: 'discord:best-bets',
        payload: {},
        idempotencyKey: `${trackOnlyFixtureId}-enqueue`,
      }),
    (error: unknown) => {
      // Asserting the specific error type is the control here, not decoration.
      // The chokepoint throws a DIFFERENT error ("Track Only status cannot be
      // established") when it cannot read the pick row. Getting
      // TrackOnlyDeliveryForbiddenError therefore proves it read the real row
      // out of Postgres and refused on the metadata it found — not that it
      // failed closed for an unrelated reason such as the row being invisible.
      assert.ok(
        error instanceof TrackOnlyDeliveryForbiddenError,
        `expected TrackOnlyDeliveryForbiddenError, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      );
      return true;
    },
  );

  // The refusal must also have written nothing. An exception raised after an
  // insert would still leave deliverable work in the queue.
  const outboxRows = await restQuery<OutboxRow>(
    `distribution_outbox?pick_id=eq.${trackOnlyPickId}&select=id,pick_id,status`,
  );
  assert.equal(outboxRows.length, 0, `refusal still created ${outboxRows.length} outbox row(s)`);
});

test('UTV2-1672: no outbox row exists for any Track Only fixture from this run', { skip: skipReason }, async () => {
  // Scoped to this run so the assertion cannot be satisfied or broken by
  // unrelated production rows.
  const fixturePicks = await restQuery<{ id: string }>(
    `picks?metadata->>proof_fixture_id=eq.${trackOnlyFixtureId}&select=id`,
  );
  assert.ok(fixturePicks.length > 0, 'this run must have created at least one fixture');
  for (const pick of fixturePicks) {
    const rows = await restQuery<OutboxRow>(
      `distribution_outbox?pick_id=eq.${pick.id}&select=id,pick_id,status`,
    );
    assert.equal(rows.length, 0, `fixture ${pick.id} has ${rows.length} outbox row(s)`);
  }
});

after(async () => {
  if (skipReason) return;
  // Same discipline as UTV2-1611: void through the lifecycle FSM, never a
  // direct status PATCH, so the cleanup is itself governed and auditable.
  for (const pickId of trackOnlyPickIds) {
    try {
      await transitionPickLifecycle(
        repositories.picks,
        pickId,
        'voided',
        'UTV2-1672 live proof fixture cleanup',
        'operator_override',
      );
    } catch (cleanupError) {
      console.error(
        JSON.stringify({
          proof: 'UTV2-1672',
          event: 'fixture_cleanup_failed',
          pickId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        }),
      );
      throw cleanupError;
    }
  }

  for (const pickId of trackOnlyPickIds) {
    const rows = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&to_state=eq.voided&select=id,pick_id,from_state,to_state,writer_role,reason`,
    );
    assert.equal(rows.length, 1, `voiding fixture ${pickId} must write exactly one lifecycle event`);
    const outboxRows = await restQuery<OutboxRow>(
      `distribution_outbox?pick_id=eq.${pickId}&select=id,pick_id,status`,
    );
    assert.equal(outboxRows.length, 0, `fixture ${pickId} left ${outboxRows.length} actionable outbox row(s)`);
  }
});
