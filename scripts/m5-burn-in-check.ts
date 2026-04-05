/**
 * M5 burn-in evidence collector — checks LP-M5, SG-M5, OC-M5 criteria against live DB.
 * Run: npx tsx scripts/m5-burn-in-check.ts
 */
import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== M5 Burn-In Evidence Check ===\n');

  // --- LP-M5: Delivery ---
  console.log('--- LP-M5: Delivery Burn-In ---');

  const { data: outbox } = await db
    .from('distribution_outbox')
    .select('id, status')
    .limit(200);
  const outboxByStatus: Record<string, number> = {};
  for (const r of outbox ?? []) {
    outboxByStatus[r.status] = (outboxByStatus[r.status] ?? 0) + 1;
  }
  console.log('Outbox by status:', JSON.stringify(outboxByStatus));

  const { data: receipts } = await db
    .from('distribution_receipts')
    .select('id, outcome, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  const receiptByOutcome: Record<string, number> = {};
  for (const r of receipts ?? []) {
    receiptByOutcome[r.outcome] = (receiptByOutcome[r.outcome] ?? 0) + 1;
  }
  console.log('Receipts by outcome:', JSON.stringify(receiptByOutcome));
  console.log('Total receipts:', receipts?.length ?? 0);

  const deadLetter = outboxByStatus['dead_letter'] ?? 0;
  const failedReceipts = receiptByOutcome['terminal-failure'] ?? 0;
  console.log('Dead-letter rows:', deadLetter, deadLetter === 0 ? '✓' : '⛔');
  console.log('Terminal-failure receipts:', failedReceipts, failedReceipts === 0 ? '✓' : '⛔');

  // --- SG-M5: Settlement ---
  console.log('\n--- SG-M5: Settlement Stability ---');

  const { data: settlements, error: srErr } = await db
    .from('settlement_records')
    .select('id, pick_id, result, corrects_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (srErr) console.log('settlement_records query error:', srErr.message);

  const byPick: Record<string, number> = {};
  for (const r of settlements ?? []) byPick[r.pick_id] = (byPick[r.pick_id] ?? 0) + 1;
  const duplicateSettlements = Object.entries(byPick).filter(([, c]) => c > 1);
  const corrections = (settlements ?? []).filter(r => r.corrects_id !== null).length;
  const resultCounts: Record<string, number> = {};
  for (const r of settlements ?? []) {
    resultCounts[r.result] = (resultCounts[r.result] ?? 0) + 1;
  }

  console.log('Total settlement rows:', settlements?.length ?? 0);
  console.log('Results:', JSON.stringify(resultCounts));
  console.log('Correction rows (corrects_id set):', corrections);
  console.log('Duplicate settlements on same pick:', duplicateSettlements.length,
    duplicateSettlements.length === 0 ? '✓' : '⛔ ' + JSON.stringify(duplicateSettlements));

  // --- Worker runs ---
  console.log('\n--- Worker Runs ---');
  const { data: workerRuns } = await db
    .from('system_runs')
    .select('id, run_type, status, created_at')
    .eq('run_type', 'distribution.process')
    .order('created_at', { ascending: false })
    .limit(20);

  const runByStatus: Record<string, number> = {};
  for (const r of workerRuns ?? []) runByStatus[r.status] = (runByStatus[r.status] ?? 0) + 1;
  console.log('Worker runs (last 20) by status:', JSON.stringify(runByStatus));
  if (workerRuns && workerRuns.length > 0) {
    console.log('Latest run:', workerRuns[0]?.status, '@', workerRuns[0]?.created_at);
  }

  // --- Summary ---
  console.log('\n--- Summary ---');
  const lpPassed = deadLetter === 0 && failedReceipts === 0;
  const sgPassed = duplicateSettlements.length === 0 && (settlements?.length ?? 0) > 0;
  console.log('LP-M5 delivery criteria:', lpPassed ? '✓ PASS' : '⛔ NEEDS ATTENTION');
  console.log('SG-M5 settlement criteria:', sgPassed ? '✓ PASS' : '⛔ NEEDS ATTENTION');
  console.log('OC-M5 operator surface: requires browser verification (cannot automate)');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
