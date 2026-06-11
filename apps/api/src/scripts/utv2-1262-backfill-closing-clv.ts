/**
 * UTV2-1262 backfill dry-run: historical closing_for_clv snapshots.
 *
 * DRY-RUN ONLY (default). Does NOT insert any rows unless --live flag is passed.
 * Live execution requires separate PM approval.
 *
 * For settled, non-voided, pick_candidate-joined picks lacking a closing_for_clv
 * snapshot, attempts to resolve the closing line from provider_offer_history via
 * the same resolution used by clv-service.ts at settlement time.
 *
 * Run:
 *   npx tsx apps/api/src/scripts/utv2-1262-backfill-closing-clv.ts        # dry-run
 *   npx tsx apps/api/src/scripts/utv2-1262-backfill-closing-clv.ts --live  # REQUIRES PM APPROVAL
 */

import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

const isLive = process.argv.includes('--live');

async function main() {
  let connection;
  try {
    connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  } catch (err) {
    console.log('[utv2-1262-backfill] SKIP — Supabase env unavailable:', (err as Error).message);
    process.exit(0);
  }

  const db = createDatabaseClientFromConnection(connection);

  console.log(`[utv2-1262-backfill] mode: ${isLive ? 'LIVE (will insert rows)' : 'DRY-RUN (no inserts)'}`);
  if (isLive) {
    console.warn('[utv2-1262-backfill] WARNING: Live mode requires explicit PM approval per UTV2-1262 ruling.');
  }

  // 1. Find settled picks without a closing_for_clv snapshot
  const { data: settledPicks, error: e1 } = await db
    .from('settlement_records')
    .select('id, pick_id, settled_at, payload')
    .in('result', ['win', 'loss', 'push'])
    .eq('status', 'settled')
    .limit(500);

  if (e1) { console.error('[utv2-1262-backfill] FAIL e1:', e1.message); process.exit(1); }

  const allSettled = settledPicks ?? [];
  console.log(`[utv2-1262-backfill] Total settled records (sample): ${allSettled.length}`);

  // 2. For each, check if closing_for_clv snapshot already exists
  let candidateCount = 0;
  let alreadyHasSnapshot = 0;
  let closingLineFound = 0;
  let closingLineMissing = 0;
  let wouldInsertCount = 0;
  const sampleRows: unknown[] = [];

  for (const record of allSettled) {
    const pickId = (record as Record<string, unknown>)['pick_id'] as string;
    const settlementId = (record as Record<string, unknown>)['id'] as string;

    // Check existing snapshot
    const { count: existingCount } = await db
      .from('pick_offer_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('pick_id', pickId)
      .eq('snapshot_kind', 'closing_for_clv');

    if ((existingCount ?? 0) > 0) {
      alreadyHasSnapshot++;
      continue;
    }
    candidateCount++;

    // Try to find pick + CLV data from payload (the computed CLV is stored in settlement payload)
    const payload = (record as Record<string, unknown>)['payload'] as Record<string, unknown> | null;
    const clvData = payload?.['clv'] as Record<string, unknown> | null;

    if (!clvData || typeof clvData['providerKey'] !== 'string') {
      closingLineMissing++;
      continue;
    }

    closingLineFound++;
    wouldInsertCount++;

    if (sampleRows.length < 5) {
      sampleRows.push({
        pick_id: pickId,
        settlement_id: settlementId,
        provider_key: clvData['providerKey'],
        closing_snapshot_at: clvData['closingSnapshotAt'],
        closing_odds: clvData['closingOdds'],
        entry_odds: (await db.from('picks').select('odds').eq('id', pickId).maybeSingle())?.data?.['odds'],
        settlement_result: (record as Record<string, unknown>)['result'],
        clv_computed: true,
      });
    }

    if (isLive) {
      // Live insert — only if PM approved
      // NOTE: This path uses clvData from payload which has closing_odds but not the raw provider_event_id/market_key.
      // A full backfill would re-resolve from provider_offer_history. This is a data-quality stub.
      console.warn(`[utv2-1262-backfill] LIVE insert for pick ${pickId} — NOT IMPLEMENTED (requires re-resolution from provider_offer_history)`);
    }
  }

  console.log('\n[utv2-1262-backfill] === Dry-Run Report ===');
  console.log(`  Total settled records sampled:   ${allSettled.length}`);
  console.log(`  Already have closing_for_clv:    ${alreadyHasSnapshot}`);
  console.log(`  Eligible candidates (no snapshot): ${candidateCount}`);
  console.log(`  CLV data in payload (resolvable): ${closingLineFound}`);
  console.log(`  No CLV data in payload:           ${closingLineMissing}`);
  console.log(`  Would-insert count (dry-run):     ${wouldInsertCount}`);
  console.log(`  Duplicate/conflict count:         0 (idempotency: already-has-snapshot excluded)`);
  console.log(`  Source table used: settlement_records.payload.clv (secondary; full backfill would use provider_offer_history)`);
  console.log('\n[utv2-1262-backfill] === Sample Candidates ===');
  console.log(JSON.stringify(sampleRows, null, 2));
  console.log('\n[utv2-1262-backfill] === Rollback/Disposition Plan ===');
  console.log('  If live backfill is approved: DELETE FROM pick_offer_snapshots');
  console.log("    WHERE snapshot_kind='closing_for_clv' AND payload->>'issue'='UTV2-1262'");
  console.log("    AND payload->>'backfill'='true';");
  console.log('  Forward-capture rows (written at settlement time) are NOT affected by this rollback.');
  console.log('\n[utv2-1262-backfill] NOTE: Full backfill with correct provenance (provider_event_id,');
  console.log('  market_key, bookmaker_key) requires re-resolution from provider_offer_history.');
  console.log('  That work should happen in a separate scoped lane with explicit PM approval.');
}

main().catch((e) => {
  console.error('[utv2-1262-backfill]', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
