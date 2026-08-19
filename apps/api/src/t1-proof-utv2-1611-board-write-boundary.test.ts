/**
 * T1 Pre-Merge Proof: UTV2-1611 automated write boundary (board-construction)
 *
 * Exercises the REAL board-construction submission path against the live
 * Supabase database via the in-process submit-pick controller, and proves the
 * property this lane exists to establish: an automated board production is
 * born in `awaiting_approval` and is never persisted as `validated`.
 *
 * This is distinct from `t1-proof-awaiting-approval.test.ts`, which covers the
 * Phase 7A SOURCE brake (system-pick-scanner, alert-agent, model-driven) using
 * minimal source-only fixtures. Before this lane `board-construction` was
 * absent from `GOVERNANCE_BRAKE_SOURCES` and had no marker-independent brake,
 * so its picks reached `validated` ungoverned. The governing mechanism here is
 * the shared automated write boundary, admitted by SOURCE (board-construction
 * is `boundary-required`), with `GOVERNANCE_BRAKE_SOURCES` membership as the
 * source-keyed fallback brake.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Fixtures are uniquely namespaced with a
 * per-run UUID under the `utv2-1611-boundary-*` prefix and are voided at the
 * end of the run so no fixture is left in an actionable state.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1611-board-write-boundary.test.ts
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
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

const runId = randomUUID();
const fixturePrefix = `utv2-1611-boundary-${runId}`;
const createdPickIds: string[] = [];

let repositories: RepositoryBundle;
let supabaseUrl: string;
let serviceRoleKey: string;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  supabaseUrl = env.SUPABASE_URL!;
  serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
  repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(env));
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
  if (!resp.ok) throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  return body as T[];
}

interface PickRow {
  id: string;
  status: string;
  source: string;
}

interface LifecycleRow {
  pick_id: string;
  from_state: string | null;
  to_state: string;
  writer_role: string;
}

function boardSubmission(): SubmissionPayload {
  return {
    source: 'board-construction',
    submittedBy: 'scheduler:board-pick-writer',
    market: 'nba-spread',
    selection: `UTV2-1611 BOUNDARY ${runId}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: {
      systemGenerated: true,
      marketUniverseId: `${fixturePrefix}-universe`,
      providerKey: 'sgo',
      providerMarketKey: 'spread-all-game',
      snapshot_at: new Date().toISOString(),
      sportKey: 'nba',
      proof_fixture_id: fixturePrefix,
      proof_issue: 'UTV2-1611',
    },
  } as SubmissionPayload;
}

test('UTV2-1611: an automated board production is born in awaiting_approval', { skip: skipReason }, async () => {
  const response = await submitPickController(boardSubmission(), repositories);
  assert.equal(response.status, 201, `expected 201, got ${response.status}`);

  const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string; outboxEnqueued: boolean } }).data;
  createdPickIds.push(data.pickId);

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
  const pickId = createdPickIds[0];
  assert.ok(pickId, 'previous test must have created a pick');

  const rows = await restQuery<LifecycleRow>(
    `pick_lifecycle?pick_id=eq.${pickId}&select=pick_id,from_state,to_state,writer_role&order=created_at.asc`,
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
    `picks?source=eq.board-construction&status=eq.validated&metadata->>proof_fixture_id=eq.${fixturePrefix}&select=id,status,source`,
  );
  assert.equal(offenders.length, 0, `direct-to-validated board writes found: ${JSON.stringify(offenders)}`);
});

after(async () => {
  if (skipReason) return;
  // Leave no fixture in an actionable state. `voided` is terminal and is never
  // distributed, so this cannot leak into delivery.
  //
  // UTV2-1611: cleanup goes through the lifecycle FSM, never a direct status
  // PATCH. A raw `PATCH picks SET status='voided'` writes the lifecycle column
  // without the matching `pick_lifecycle` row, so it (a) is not validated
  // against `pickLifecycleTransitions` and would happily perform a forbidden
  // transition, and (b) leaves an unauditable status change — the very class of
  // ungoverned direct write this proof exists to disprove. A proof that cleans
  // up by bypassing the control it is proving is not evidence.
  for (const pickId of createdPickIds) {
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
  for (const pickId of createdPickIds) {
    const rows = await restQuery<LifecycleRow>(
      `pick_lifecycle?pick_id=eq.${pickId}&to_state=eq.voided&select=pick_id,from_state,to_state,writer_role`,
    );
    assert.equal(rows.length, 1, `voiding fixture ${pickId} must write exactly one lifecycle event`);
    assert.equal(rows[0]!.from_state, 'awaiting_approval');
  }
});
