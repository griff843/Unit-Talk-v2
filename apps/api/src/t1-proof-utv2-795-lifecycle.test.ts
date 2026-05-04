/**
 * T1 proof: UTV2-795 lifecycle pipeline — posted → settlement → CLV → recap.
 *
 * Targets two designated live picks with confirmed market_universe closing data:
 *   d9b96f8d — NHL player_hockey_points_ou
 *   a3072fdc — MLB player_batting_doubles_ou
 *
 * Each pick is settled via the approved service path (source='operator').
 * Idempotent: if already settled, reads the original settlement record.
 *
 * Skipped when SUPABASE_SERVICE_ROLE_KEY is not configured.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

import { runPickProof } from './scripts/utv2-795-lifecycle-proof.js';

const PROOF_PICKS = [
  { id: 'd9b96f8d-7d57-4f70-adbd-260722cc70a5', label: 'NHL player_hockey_points_ou' },
  { id: 'a3072fdc-c0f9-45e1-b10b-206f1f4c1f4b', label: 'MLB player_batting_doubles_ou' },
] as const;

for (const { id: pickId, label } of PROOF_PICKS) {
  test(`UTV2-795 lifecycle proof — ${label} (${pickId})`, async (t) => {
    let connection;
    try {
      connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
    } catch (err) {
      t.skip(`Supabase service-role environment unavailable: ${(err as Error).message}`);
      return;
    }

    const repositories = createDatabaseRepositoryBundle(connection);
    const db = createDatabaseClientFromConnection(connection);

    const result = await runPickProof(pickId, repositories, db);

    if (result.skipReason !== null) {
      t.skip(result.skipReason);
      return;
    }

    assert.equal(result.proof, 'utv2-795');
    assert.equal(result.pickId, pickId);

    // Stage: pick was in 'posted' state (or transitioned through it)
    assert.equal(result.stages.posted, true, 'stage posted must be true');

    // Stage: settlement record created
    assert.equal(result.stages.settlement_created, true, 'stage settlement_created must be true');

    // Stage: original row — not a correction
    assert.equal(
      result.stages.corrects_id_null,
      true,
      'settlement_record.corrects_id must be null (original row, not correction)',
    );

    // Stage: CLV computed via marketUniverseId fast path
    assert.equal(
      result.stages.clv_computed,
      true,
      `CLV must be computed; got clv_status='${result.stages.clv_status}'`,
    );
    assert.equal(
      result.stages.clv_status,
      'computed',
      `clv_status must be 'computed', got '${result.stages.clv_status}'`,
    );

    // Stage: recap can consume this settlement
    assert.equal(
      result.stages.recap_consumes,
      true,
      'computeRecapSummary must return a non-null summary covering this settlement',
    );

    // Stage: audit_log has entity_id entry for this pick
    assert.equal(
      result.stages.audit_entity_id_present,
      true,
      'audit_log must have at least one row with entity_ref = pickId and entity_id non-null',
    );

    // Top-level: CLV-backed proof
    assert.equal(result.clvBacked, true, 'clvBacked must be true');
    assert.equal(result.skipReason, null, 'skipReason must be null');
  });
}
