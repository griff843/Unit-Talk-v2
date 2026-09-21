/** Staging-only persistence proof. Discord outcomes are simulated; no member messages are sent. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import { createDatabaseClientFromConnection, createDatabaseRepositoryBundle, createServiceRoleDatabaseConnectionConfig, isApprovedStagingTarget } from '@unit-talk/db';
import { observeSettlementRecap } from './settlement-recap-observation.js';

test('UTV2-1950 staging persists per-pick recap provenance before an attempt and after each outcome', async () => {
  const env = loadEnvironment();
  assert.equal(isApprovedStagingTarget(env.SUPABASE_URL), true, 'Recap persistence proof requires the approved staging project');
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const repositories = createDatabaseRepositoryBundle(connection);
  const client = createDatabaseClientFromConnection(connection);
  const pickId = randomUUID();
  const settlementRecordId = randomUUID();
  const read = async () => {
    const result = await client.from('system_runs').select('*').eq('run_type', 'recap.post').eq('details->>pickId', pickId).order('started_at');
    assert.equal(result.error, null);
    return result.data ?? [];
  };
  let simulatedAttempts = 0;
  await observeSettlementRecap(pickId, settlementRecordId, repositories.runs, async () => {
    const [running] = await read();
    assert.equal(running?.status, 'running', 'provenance must exist in Postgres before the simulated network operation');
    simulatedAttempts++;
    return { posted: true, channel: 'staging-simulation-no-discord-send', messageId: 'synthetic-receipt' };
  });
  await observeSettlementRecap(pickId, settlementRecordId, repositories.runs, async () => ({ posted: false, reason: 'kill-switch-engaged' }));
  await observeSettlementRecap(pickId, settlementRecordId, repositories.runs, async () => { throw new Error('simulated lost response'); });
  const records = await read();
  assert.equal(simulatedAttempts, 1);
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((row) => row.status), ['succeeded', 'cancelled', 'failed']);
  for (const record of records) {
    assert.ok(record.finished_at, 'the database completion timestamp must persist');
    assert.ok(record.details && typeof record.details === 'object' && !Array.isArray(record.details));
    assert.equal(record.details['pickId'], pickId);
    assert.equal(record.details['settlementRecordId'], settlementRecordId);
    assert.equal(record.details['recapKind'], 'settlement-pick');
  }
  assert.deepEqual(records[0]?.details, { recapKind: 'settlement-pick', pickId, settlementRecordId, pickCount: 1, posted: true, channel: 'staging-simulation-no-discord-send', messageId: 'synthetic-receipt' });
  assert.deepEqual(records[1]?.details, { recapKind: 'settlement-pick', pickId, settlementRecordId, pickCount: 1, posted: false, reason: 'kill-switch-engaged' });
  assert.deepEqual(records[2]?.details, { recapKind: 'settlement-pick', pickId, settlementRecordId, pickCount: 1, posted: false, reason: 'recap_request_outcome_unknown', failed: true });
});
