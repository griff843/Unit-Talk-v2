import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

test('UTV2-753 live settlement records have profitLossUnits for all win/loss/push results', async (t) => {
  let connection;
  try {
    connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  } catch (error) {
    t.skip(`Supabase service-role environment unavailable: ${(error as Error).message}`);
    return;
  }

  const db = createDatabaseClientFromConnection(connection);

  const { count: totalSettled, error: totalError } = await db
    .from('settlement_records')
    .select('id', { count: 'exact', head: true })
    .in('result', ['win', 'loss', 'push'])
    .is('corrects_id', null);

  assert.ifError(totalError);
  assert.ok((totalSettled ?? 0) >= 20, `expected ≥20 settled records, got ${totalSettled}`);

  const { count: missingPnl, error: missingError } = await db
    .from('settlement_records')
    .select('id', { count: 'exact', head: true })
    .in('result', ['win', 'loss', 'push'])
    .is('corrects_id', null)
    .is('payload->>profitLossUnits', null);

  assert.ifError(missingError);
  assert.equal(missingPnl, 0, `expected 0 records missing profitLossUnits after backfill, got ${missingPnl}`);

  // Spot-check: loss records must have negative profitLossUnits
  const { data: lossSample, error: lossError } = await db
    .from('settlement_records')
    .select('payload')
    .eq('result', 'loss')
    .is('corrects_id', null)
    .limit(5);

  assert.ifError(lossError);
  assert.ok((lossSample ?? []).length > 0, 'expected at least one loss record');
  for (const row of lossSample ?? []) {
    const pnl = (row.payload as Record<string, unknown>)?.profitLossUnits as number;
    assert.ok(pnl < 0, `loss record profitLossUnits should be negative, got ${pnl}`);
  }

  // Spot-check: push records must have profitLossUnits === 0
  const { data: pushSample, error: pushError } = await db
    .from('settlement_records')
    .select('payload')
    .eq('result', 'push')
    .is('corrects_id', null)
    .limit(5);

  assert.ifError(pushError);
  for (const row of pushSample ?? []) {
    const pnl = (row.payload as Record<string, unknown>)?.profitLossUnits as number;
    assert.equal(pnl, 0, `push record profitLossUnits should be 0, got ${pnl}`);
  }
});
