/**
 * UTV2-906 live DB proof: promotion band persistence
 *
 * Submits a high-scoring smart-form pick through the live database bundle and
 * asserts that both `picks.metadata.band` and the newest
 * `pick_promotion_history.payload.band` are populated for the same pick.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx apps/api/src/scripts/utv2-906-band-persistence-proof.ts
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import type { SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { submitPickController } from '../controllers/submit-pick-controller.js';

type PickRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

type PromotionHistoryRow = {
  id: string;
  payload: Record<string, unknown> | null;
};

function authHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

async function restQuery<T>(supabaseUrl: string, serviceRoleKey: string, path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: authHeaders(serviceRoleKey),
  });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  }
  return body as T[];
}

async function main() {
  const env = loadEnvironment();
  assert.ok(env.SUPABASE_URL, 'SUPABASE_URL is required');
  assert.ok(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required');

  const repositories: RepositoryBundle = createDatabaseRepositoryBundle(
    createServiceRoleDatabaseConnectionConfig(env),
  );

  const fixtureId = `utv2-906-band-${randomUUID()}`;
  const payload: SubmissionPayload = {
    source: 'smart-form',
    market: 'nba-spread',
    selection: 'UTV2-906 Proof Team -4.5',
    line: -4.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.9,
    eventName: `UTV2-906 Proof ${fixtureId}`,
    metadata: {
      sport: 'NBA',
      capper: 'utv2-906-proof',
      proof_fixture_id: fixtureId,
      proof_issue: 'UTV2-906',
      promotionScores: {
        edge: 88,
        trust: 88,
        readiness: 88,
        uniqueness: 88,
        boardFit: 88,
      },
    },
  };

  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `expected 201, got ${response.status}`);
  assert.ok(response.body.ok, 'submitPickController should return ok');
  const pickId = response.body.data.pickId;

  const pickRows = await restQuery<PickRow>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    `picks?id=eq.${pickId}&select=id,metadata`,
  );
  assert.equal(pickRows.length, 1, 'expected persisted pick row');
  const persistedBand = pickRows[0]!.metadata?.['band'];
  assert.ok(typeof persistedBand === 'string' && persistedBand.length > 0, 'metadata.band must be persisted');

  const historyRows = await restQuery<PromotionHistoryRow>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    `pick_promotion_history?pick_id=eq.${pickId}&select=id,payload&order=created_at.desc&limit=1`,
  );
  assert.equal(historyRows.length, 1, 'expected promotion history row');
  const historyBand = historyRows[0]!.payload?.['band'];
  assert.equal(historyBand, persistedBand, 'payload.band must match metadata.band');

  console.log(
    JSON.stringify({
      ok: true,
      issue: 'UTV2-906',
      pickId,
      band: persistedBand,
      promotionHistoryId: historyRows[0]!.id,
      proofFixtureId: fixtureId,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
