/**
 * Live-DB proof: per-pick settlement-recap provenance (UTV2-1951)
 *
 * What this proves against real Postgres, and nothing more:
 *
 *   1. `observeSettlementRecap` writes its `recap.post` run row BEFORE the
 *      attempt runs. The attempt itself reads the row back and asserts
 *      `status = 'running'`, so a run recorded only after the fact fails here.
 *   2. The three outcomes stay distinguishable in the persisted record:
 *      `succeeded` (posted), `cancelled` (a known refusal, with its reason) and
 *      `failed` (the attempt threw — recorded as `recap_request_outcome_unknown`,
 *      which is deliberately NOT a claim that the post did not happen).
 *   3. Every row carries the pick and settlement identity needed to answer
 *      "did this pick's recap post?" from history alone.
 *
 * This case was originally appended to
 * `t1-proof-utv2-1904-operator-evidence-settlement.test.ts`. It lives in its own
 * file because that file is held by the open UTV2-1919 lane (PR #1589); it is
 * self-contained and shares no state with the UTV2-1904 cases.
 *
 * No Discord message is sent. Every outcome below is simulated in-process — the
 * `posted: true` case returns a synthetic receipt and never reaches a network.
 *
 * Gated on the approved staging project. Test-created rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1951-settlement-recap-provenance.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  isApprovedStagingTarget,
} from '@unit-talk/db';
import { observeSettlementRecap } from './settlement-recap-observation.js';

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

// Per-pick recap evidence belongs to the operator-settlement persistence boundary.
// Outcomes below are simulated: this case never sends a Discord message.
test(
  'UTV2-1951 staging persists per-pick recap provenance before an attempt and after each outcome',
  { skip: skipReason },
  async () => {
    const env = loadEnvironment();
    assert.equal(
      isApprovedStagingTarget(env.SUPABASE_URL),
      true,
      'Recap persistence proof requires the approved staging project',
    );
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    const repositories = createDatabaseRepositoryBundle(connection);
    const client = createDatabaseClientFromConnection(connection);
    const pickId = randomUUID();
    const settlementRecordId = randomUUID();
    const read = async () => {
      const result = await client
        .from('system_runs')
        .select('*')
        .eq('run_type', 'recap.post')
        .eq('details->>pickId', pickId)
        .order('started_at');
      assert.equal(result.error, null);
      return result.data ?? [];
    };

    let simulatedAttempts = 0;
    await observeSettlementRecap(pickId, settlementRecordId, repositories.runs, async () => {
      const [running] = await read();
      assert.equal(
        running?.status,
        'running',
        'provenance must exist in Postgres before the simulated network operation',
      );
      simulatedAttempts++;
      return {
        posted: true,
        channel: 'staging-simulation-no-discord-send',
        messageId: 'synthetic-receipt',
      };
    });
    await observeSettlementRecap(pickId, settlementRecordId, repositories.runs, async () => ({
      posted: false,
      reason: 'kill-switch-engaged',
    }));
    await observeSettlementRecap(pickId, settlementRecordId, repositories.runs, async () => {
      throw new Error('simulated lost response');
    });

    const records = await read();
    assert.equal(simulatedAttempts, 1);
    assert.equal(records.length, 3);
    assert.deepEqual(
      records.map((row) => row.status),
      ['succeeded', 'cancelled', 'failed'],
    );
    for (const record of records) {
      assert.ok(record.finished_at, 'the database completion timestamp must persist');
      assert.ok(
        record.details && typeof record.details === 'object' && !Array.isArray(record.details),
      );
      assert.equal(record.details['pickId'], pickId);
      assert.equal(record.details['settlementRecordId'], settlementRecordId);
      assert.equal(record.details['recapKind'], 'settlement-pick');
    }
    assert.deepEqual(records[0]?.details, {
      recapKind: 'settlement-pick',
      pickId,
      settlementRecordId,
      pickCount: 1,
      posted: true,
      channel: 'staging-simulation-no-discord-send',
      messageId: 'synthetic-receipt',
    });
    assert.deepEqual(records[1]?.details, {
      recapKind: 'settlement-pick',
      pickId,
      settlementRecordId,
      pickCount: 1,
      posted: false,
      reason: 'kill-switch-engaged',
    });
    assert.deepEqual(records[2]?.details, {
      recapKind: 'settlement-pick',
      pickId,
      settlementRecordId,
      pickCount: 1,
      posted: false,
      reason: 'recap_request_outcome_unknown',
      failed: true,
    });
  },
);
