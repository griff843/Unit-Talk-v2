/**
 * T1 Live-DB Proof: UTV2-1258 listByLifecycleState offset parameter
 *
 * Verifies that the `offset` parameter added to `PickRepository.listByLifecycleState`
 * is honored by the real Supabase PostgREST `.range()` call.
 *
 * Root cause guard: InMemory implementations pass unit tests while the real
 * DB may ignore the param (UTV2-519, UTV2-521 pattern). This proof runs
 * against live Supabase to confirm `.range(offset, offset+limit-1)` advances
 * the window correctly.
 *
 * Test steps:
 *   1. Submit 2 awaiting_approval picks (ensures >= 2 rows exist)
 *   2. Fetch offset=0,limit=1 and offset=1,limit=1 — assert different row IDs
 *   3. Confirm fetchAllByLifecycleState assembles pages (returns both our picks)
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1258-pagination.test.ts
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
import { fetchAllByLifecycleState } from './grading-service.js';

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
  repositories = createDatabaseRepositoryBundle(
    createServiceRoleDatabaseConnectionConfig(env),
  );
});

async function createAwaitingApprovalPick(): Promise<string> {
  const runId = randomUUID();
  const payload: SubmissionPayload = {
    source: 'system-pick-scanner',
    market: 'nba-spread',
    selection: `UTV2-1258 PAGINATION PROOF ${RUN_ID}-${runId}`,
    line: -3.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 60,
    metadata: { proof_run: RUN_ID, proof_issue: 'UTV2-1258' },
  };
  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `submission expected 201, got ${response.status}`);
  const data = (response.body as { ok: true; data: { pickId: string; lifecycleState: string } }).data;
  assert.equal(data.lifecycleState, 'awaiting_approval', 'pick must land in awaiting_approval');
  return data.pickId;
}

test(
  'UTV2-1258: listByLifecycleState offset param is honored by real Supabase .range()',
  { skip: skipReason },
  async () => {
    // Ensure at least 2 awaiting_approval rows exist
    const [p1, p2] = await Promise.all([
      createAwaitingApprovalPick(),
      createAwaitingApprovalPick(),
    ]);

    // offset=0 and offset=1 must return different rows
    const row0 = await repositories.picks.listByLifecycleState('awaiting_approval', 1, 0);
    const row1 = await repositories.picks.listByLifecycleState('awaiting_approval', 1, 1);

    assert.equal(row0.length, 1, 'offset=0 limit=1 must return exactly 1 row');
    assert.equal(row1.length, 1, 'offset=1 limit=1 must return exactly 1 row');
    assert.notEqual(
      row0[0]!.id,
      row1[0]!.id,
      'offset=0 and offset=1 must return different row IDs — proves .range() is honored',
    );

    // fetchAllByLifecycleState must return both of our submitted picks
    const all = await fetchAllByLifecycleState(repositories.picks, 'awaiting_approval');
    const ids = new Set(all.map((p) => p.id));
    assert.ok(ids.has(p1), `fetchAllByLifecycleState must include submitted pick p1 (${p1})`);
    assert.ok(ids.has(p2), `fetchAllByLifecycleState must include submitted pick p2 (${p2})`);
  },
);
