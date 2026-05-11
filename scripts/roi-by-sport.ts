#!/usr/bin/env tsx
/**
 * UTV2-893: ROI / Win-Rate per Sport
 *
 * Queries settlement_records and computes win-rate and flat-bet ROI by sport.
 * Flat-bet ROI assumes -110 juice on all picks (if submission odds not available).
 * Data gate: run live on/after 2026-05-17 for post-UTV2-877 results.
 *
 * Usage: npx tsx scripts/roi-by-sport.ts [--after YYYY-MM-DD]
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const content = readFileSync(resolve(__dirname, '..', 'local.env'), 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

interface PickRow {
  result: string | null;
  sport: string | null;
  market_type: string | null;
  submission_odds: number | null;
  clv_percent: string | null;
  clv_status: string | null;
  settled_at: string;
}

function pct(n: number, total: number): string {
  if (total === 0) return 'n/a';
  return `${((n / total) * 100).toFixed(1)}%`;
}

function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

function computeFlatBetROI(wins: number, losses: number, avgDecimalOdds: number): number {
  const totalStaked = wins + losses;
  if (totalStaked === 0) return 0;
  const returns = wins * avgDecimalOdds;
  return ((returns - totalStaked) / totalStaked) * 100;
}

async function main() {
  loadEnv();

  const afterArg = process.argv.find(a => a.startsWith('--after='))?.split('=')[1];
  const afterDate = afterArg ?? '2026-05-10';

  const sb = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  );

  console.log(`\n=== ROI / Win-Rate by Sport ===`);
  console.log(`Query window: settled_at >= ${afterDate}`);
  console.log(`Generated: ${new Date().toISOString()}\n`);

  const { data: rows, error } = await sb
    .from('settlement_records')
    .select(`
      result,
      payload,
      settled_at,
      picks!inner(metadata, submissions(odds))
    `)
    .gte('settled_at', afterDate)
    .is('corrects_id', null) as { data: Array<{
      result: string | null;
      payload: Record<string, unknown>;
      settled_at: string;
      picks: {
        metadata: Record<string, unknown>;
        submissions: Array<{ odds: number | null }> | null;
      } | null;
    }> | null; error: unknown };

  if (error || !rows) {
    // Fallback without submissions join
    const { data: fallback, error: e2 } = await sb
      .from('settlement_records')
      .select(`result, payload, settled_at, picks!inner(metadata)`)
      .gte('settled_at', afterDate)
      .is('corrects_id', null) as { data: Array<{
        result: string | null;
        payload: Record<string, unknown>;
        settled_at: string;
        picks: { metadata: Record<string, unknown> } | null;
      }> | null; error: unknown };

    if (e2 || !fallback) {
      console.error('Failed to fetch:', e2 ?? error);
      process.exit(1);
    }

    const mapped: PickRow[] = fallback.map(r => ({
      result: r.result,
      sport: (r.picks?.metadata?.['sport'] as string) ?? null,
      market_type: (r.picks?.metadata?.['marketTypeId'] as string) ?? null,
      submission_odds: null,
      clv_percent: (r.payload?.['clvPercent'] as string) ?? null,
      clv_status: (r.payload?.['clvStatus'] as string) ?? null,
      settled_at: r.settled_at,
    }));
    printReport(mapped, afterDate);
    return;
  }

  const mapped: PickRow[] = rows.map(r => ({
    result: r.result,
    sport: (r.picks?.metadata?.['sport'] as string) ?? null,
    market_type: (r.picks?.metadata?.['marketTypeId'] as string) ?? null,
    submission_odds: r.picks?.submissions?.[0]?.odds ?? null,
    clv_percent: (r.payload?.['clvPercent'] as string) ?? null,
    clv_status: (r.payload?.['clvStatus'] as string) ?? null,
    settled_at: r.settled_at,
  }));
  printReport(mapped, afterDate);
}

function printReport(rows: PickRow[], afterDate: string) {
  const total = rows.length;
  const wins = rows.filter(r => r.result === 'win').length;
  const losses = rows.filter(r => r.result === 'loss').length;
  const pushes = rows.filter(r => r.result === 'push').length;

  // Assume -110 as default odds if submission odds not available
  const DEFAULT_AMERICAN_ODDS = -110;
  const defaultDecimal = americanToDecimal(DEFAULT_AMERICAN_ODDS);

  console.log(`## Overall (all sports)`);
  console.log(`| Metric | Value |`);
  console.log(`|--------|-------|`);
  console.log(`| Total settled | ${total} |`);
  console.log(`| Wins | ${wins} (${pct(wins, total)}) |`);
  console.log(`| Losses | ${losses} (${pct(losses, total)}) |`);
  console.log(`| Pushes | ${pushes} |`);
  const hasOdds = rows.some(r => r.submission_odds != null);
  if (hasOdds) {
    const oddsRows = rows.filter(r => r.submission_odds != null && r.result !== 'push');
    const winsWithOdds = oddsRows.filter(r => r.result === 'win');
    const totalPayout = winsWithOdds.reduce((sum, r) => sum + americanToDecimal(r.submission_odds!), 0);
    const trueROI = ((totalPayout - oddsRows.length) / oddsRows.length) * 100;
    console.log(`| ROI (actual odds) | ${trueROI >= 0 ? '+' : ''}${trueROI.toFixed(2)}% |`);
  } else {
    const flatBetROI = computeFlatBetROI(wins, losses, defaultDecimal);
    console.log(`| ROI (flat -110 assumption) | ${flatBetROI >= 0 ? '+' : ''}${flatBetROI.toFixed(2)}% |`);
    console.log(`| Note | Submission odds not available — ROI uses -110 assumption |`);
  }

  // By sport
  const sports = [...new Set(rows.map(r => r.sport ?? 'unknown'))].sort();
  console.log(`\n## By Sport`);
  console.log(`| Sport | Settled | Wins | Win% | Losses | ROI (${hasOdds ? 'actual' : '-110 assumption'}) | CLV coverage |`);
  console.log(`|-------|---------|------|------|--------|-----|-------------|`);

  for (const sport of sports) {
    const sportRows = rows.filter(r => (r.sport ?? 'unknown') === sport);
    const sWins = sportRows.filter(r => r.result === 'win');
    const sLosses = sportRows.filter(r => r.result === 'loss');
    const sComputed = sportRows.filter(r => r.clv_status === 'computed');

    let roiStr: string;
    if (hasOdds && sWins.some(r => r.submission_odds != null)) {
      const oddsRows = sportRows.filter(r => r.submission_odds != null && r.result !== 'push');
      const winsWithOdds = oddsRows.filter(r => r.result === 'win');
      const totalPayout = winsWithOdds.reduce((sum, r) => sum + americanToDecimal(r.submission_odds!), 0);
      const roi = ((totalPayout - oddsRows.length) / oddsRows.length) * 100;
      roiStr = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
    } else {
      const roi = computeFlatBetROI(sWins.length, sLosses.length, defaultDecimal);
      roiStr = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
    }

    console.log(`| ${sport.padEnd(5)} | ${String(sportRows.length).padEnd(7)} | ${String(sWins.length).padEnd(4)} | ${pct(sWins.length, sportRows.length).padEnd(4)} | ${String(sLosses.length).padEnd(6)} | ${roiStr.padEnd(4)} | ${pct(sComputed.length, sportRows.length)} |`);
  }

  // By market type if available
  const markets = [...new Set(rows.map(r => r.market_type).filter(Boolean))];
  if (markets.length > 0) {
    console.log(`\n## By Market Type`);
    console.log(`| Market | Settled | Win% |`);
    console.log(`|--------|---------|------|`);
    for (const market of markets.sort()) {
      const mRows = rows.filter(r => r.market_type === market);
      const mWins = mRows.filter(r => r.result === 'win').length;
      console.log(`| ${market} | ${mRows.length} | ${pct(mWins, mRows.length)} |`);
    }
  }

  console.log(`\n## Notes`);
  console.log(`- Data window: ${afterDate} onwards (post-UTV2-877 scorer fix merged 2026-05-10)`);
  console.log(`- Band data not available — band-sliced ROI requires band persistence fix`);
  console.log(`- Market type data sparse — marketTypeId not consistently in picks.metadata`);
  if (!hasOdds) {
    console.log(`- True ROI requires submission odds from submissions table — using -110 flat assumption`);
  }
  console.log(`- Run with --after=2026-05-17 on that date for 7-day post-fix window`);
}

main().catch(e => { console.error(e); process.exit(1); });
