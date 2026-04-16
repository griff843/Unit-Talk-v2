/**
 * Learning Ledger Review — UTV2-629
 *
 * Queries settled picks and their settlement records, assembles LedgerEntry[],
 * calls summarizeLedger(), and prints the error taxonomy breakdown.
 *
 * Usage:
 *   npx tsx scripts/ops/learning-ledger-review.ts [--json] [--limit N]
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';
import {
  classifyMiss,
  summarizeLedger,
  ALL_MISS_CATEGORIES,
  type LedgerEntry,
} from '../../packages/domain/src/outcomes/learning-ledger.js';

const env = loadEnvironment();
const url = env.SUPABASE_URL ?? '';
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!url || !key) {
  console.error('FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const limitIdx = args.indexOf('--limit');
const rowLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '500', 10) : 500;

async function main(): Promise<void> {
  // ── 1. Pull settlement records ────────────────────────────────────────────
  const { data: settlements, error: settleErr } = await db
    .from('settlement_records')
    .select(
      'pick_id, outcome, clv_percent, clv_status, is_opening_line_fallback, pnl_units, settled_at',
    )
    .order('settled_at', { ascending: false })
    .limit(rowLimit);

  if (settleErr) {
    console.error('ERROR fetching settlement_records:', settleErr.message);
    process.exit(1);
  }

  if (!settlements || settlements.length === 0) {
    console.log('No settlement records found.');
    return;
  }

  const pickIds = settlements.map(s => s.pick_id as string).filter(Boolean);

  // ── 2. Pull picks for prediction context ─────────────────────────────────
  const { data: picks, error: pickErr } = await db
    .from('picks')
    .select('id, sport, market_family, market, p_final, p_market_devig, stat_alpha')
    .in('id', pickIds);

  if (pickErr) {
    console.error('ERROR fetching picks:', pickErr.message);
    process.exit(1);
  }

  const pickById = new Map(
    (picks ?? []).map(p => [p.id as string, p]),
  );

  // ── 3. Build LedgerEntry[] ───────────────────────────────────────────────
  const entries: LedgerEntry[] = [];

  for (const s of settlements) {
    const pickId = s.pick_id as string;
    const pick = pickById.get(pickId);

    const base: Omit<LedgerEntry, 'missCategory' | 'missReason'> = {
      pickId,
      sport: (pick?.sport as string) ?? 'unknown',
      marketFamily: (pick?.market_family as string) ?? (pick?.market as string) ?? 'unknown',
      modelProbability: (pick?.p_final as number) ?? 0.5,
      marketProbability: (pick?.p_market_devig as number | null) ?? null,
      statAlpha: (pick?.stat_alpha as number | null) ?? null,
      clvPercent: s.clv_percent as number | null,
      clvStatus: s.clv_status as string | null,
      isOpeningLineFallback: Boolean(s.is_opening_line_fallback),
      outcome: (s.outcome as 'WIN' | 'LOSS' | 'PUSH' | null) ?? null,
      pnlUnits: s.pnl_units as number | null,
    };

    const { category, reason } = classifyMiss(base);

    entries.push({
      ...base,
      missCategory: category === 'unknown' && base.outcome !== 'LOSS' ? null : category,
      missReason: category === 'unknown' && base.outcome !== 'LOSS' ? null : reason,
    });
  }

  // ── 4. Summarise ─────────────────────────────────────────────────────────
  const summary = summarizeLedger(entries);

  if (jsonMode) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), summary, sampleSize: entries.length }, null, 2));
    return;
  }

  // ── 5. Print report ───────────────────────────────────────────────────────
  console.log(`\nLearning Ledger Review — ${new Date().toISOString()}`);
  console.log(`Picks: ${summary.totalPicks} total, ${summary.settledPicks} settled`);

  const wr = summary.winRate != null ? `${(summary.winRate * 100).toFixed(1)}%` : 'n/a';
  const avgClv = summary.avgCLVPercent != null
    ? `${summary.avgCLVPercent >= 0 ? '+' : ''}${summary.avgCLVPercent.toFixed(2)}%`
    : 'n/a';
  const clvCov = `${(summary.clvCoverageRate * 100).toFixed(1)}%`;

  console.log(`Win rate:       ${wr}`);
  console.log(`Avg CLV:        ${avgClv}`);
  console.log(`CLV coverage:   ${clvCov}`);
  console.log('');

  console.log('Miss category breakdown:');
  for (const cat of ALL_MISS_CATEGORIES) {
    const count = summary.missCategoryBreakdown[cat];
    const isTop = cat === summary.topMissCategory;
    const marker = isTop ? ' ← top actionable' : '';
    console.log(`  ${cat.padEnd(22)} ${count}${marker}`);
  }

  if (summary.topMissCategory) {
    console.log(`\nTop actionable miss: ${summary.topMissCategory} (${summary.topMissCount} occurrences)`);
  } else {
    console.log('\nNo actionable miss pattern identified.');
  }
}

main().catch(e => {
  console.error(String(e));
  process.exit(1);
});
