#!/usr/bin/env tsx
/**
 * UTV2-892: Band Accuracy Analysis
 *
 * Queries settlement_records and computes win-rate and flat-bet ROI per promotion band
 * (A+/A/B/C/SUPPRESS). Band is read from picks.metadata.band.
 *
 * Data gate: band persistence requires DEBT-018 fix (UTV2-906).
 * Until then this script will report 100% null-band and serve as the ready-to-run
 * instrument once band data flows.
 *
 * Usage: npx tsx scripts/band-accuracy.ts [--after YYYY-MM-DD]
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

type Band = 'A+' | 'A' | 'B' | 'C' | 'SUPPRESS' | null;

interface BandRow {
  result: string | null;
  band: Band;
  sport: string | null;
  settled_at: string;
}

function pct(n: number, total: number): string {
  if (total === 0) return 'n/a';
  return `${((n / total) * 100).toFixed(1)}%`;
}

function flatBetROI(wins: number, losses: number): string {
  const total = wins + losses;
  if (total === 0) return 'n/a';
  const DEFAULT_DECIMAL = 100 / 110 + 1; // -110 assumption
  const returns = wins * DEFAULT_DECIMAL;
  const roi = ((returns - total) / total) * 100;
  return `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
}

async function main() {
  loadEnv();

  const afterArg = process.argv.find(a => a.startsWith('--after='))?.split('=')[1];
  const afterDate = afterArg ?? '2026-05-10';

  const sb = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  );

  console.log(`\n=== Band Accuracy Report (UTV2-892) ===`);
  console.log(`Query window: settled_at >= ${afterDate}`);
  console.log(`Generated: ${new Date().toISOString()}\n`);

  const { data: rows, error } = await sb
    .from('settlement_records')
    .select(`
      result,
      settled_at,
      picks!inner(metadata)
    `)
    .gte('settled_at', afterDate)
    .is('corrects_id', null) as {
      data: Array<{
        result: string | null;
        settled_at: string;
        picks: { metadata: Record<string, unknown> } | null;
      }> | null;
      error: unknown;
    };

  if (error || !rows) {
    console.error('Failed to fetch:', error);
    process.exit(1);
  }

  const mapped: BandRow[] = rows.map(r => ({
    result: r.result,
    band: (r.picks?.metadata?.['band'] as Band) ?? null,
    sport: (r.picks?.metadata?.['sport'] as string) ?? null,
    settled_at: r.settled_at,
  }));

  printReport(mapped, afterDate);
}

function printReport(rows: BandRow[], afterDate: string) {
  const total = rows.length;
  const withBand = rows.filter(r => r.band !== null);
  const nullBand = rows.filter(r => r.band === null);

  console.log(`## Summary`);
  console.log(`| Metric | Value |`);
  console.log(`|--------|-------|`);
  console.log(`| Total settled (since ${afterDate}) | ${total} |`);
  console.log(`| Picks with band data | ${withBand.length} (${pct(withBand.length, total)}) |`);
  console.log(`| Picks with null band | ${nullBand.length} (${pct(nullBand.length, total)}) |`);

  if (withBand.length === 0) {
    console.log(`\n## Band Coverage: ZERO`);
    console.log(`\nBand is null for all ${total} settled picks.`);
    console.log(`Root cause: DEBT-018 / UTV2-906 — band assignment is computed at promotion`);
    console.log(`evaluation time but never persisted to picks.metadata.band or`);
    console.log(`pick_promotion_history.payload.band.`);
    console.log(`\nAction required: fix UTV2-906 (band persistence) before this report`);
    console.log(`can produce meaningful output. Re-run after the fix is deployed.`);
    console.log(`\nThis script is ready — it will produce band-sliced ROI automatically`);
    console.log(`once picks.metadata.band is populated.`);
    printNotes(afterDate);
    return;
  }

  // Band breakdown — only shown when band data is available
  const BAND_ORDER: Band[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'];
  const presentBands = BAND_ORDER.filter(b => withBand.some(r => r.band === b));

  console.log(`\n## By Band`);
  console.log(`| Band | Settled | Wins | Win% | Losses | ROI (-110 assumption) |`);
  console.log(`|------|---------|------|------|--------|-----------------------|`);

  for (const band of presentBands) {
    const bandRows = withBand.filter(r => r.band === band);
    const wins = bandRows.filter(r => r.result === 'win').length;
    const losses = bandRows.filter(r => r.result === 'loss').length;
    console.log(`| ${String(band).padEnd(4)} | ${String(bandRows.length).padEnd(7)} | ${String(wins).padEnd(4)} | ${pct(wins, bandRows.length).padEnd(4)} | ${String(losses).padEnd(6)} | ${flatBetROI(wins, losses)} |`);
  }

  // Unclassified null-band rows if mixed
  if (nullBand.length > 0) {
    const wins = nullBand.filter(r => r.result === 'win').length;
    const losses = nullBand.filter(r => r.result === 'loss').length;
    console.log(`| null | ${String(nullBand.length).padEnd(7)} | ${String(wins).padEnd(4)} | ${pct(wins, nullBand.length).padEnd(4)} | ${String(losses).padEnd(6)} | ${flatBetROI(wins, losses)} |`);
  }

  // By sport × band (if data exists)
  if (withBand.length > 0) {
    const sports = [...new Set(withBand.map(r => r.sport ?? 'unknown'))].sort();
    console.log(`\n## Band × Sport Cross-Tab (picks with band data only)`);
    console.log(`| Sport | Band | Settled | Win% |`);
    console.log(`|-------|------|---------|------|`);
    for (const sport of sports) {
      for (const band of presentBands) {
        const cell = withBand.filter(r => (r.sport ?? 'unknown') === sport && r.band === band);
        if (cell.length === 0) continue;
        const wins = cell.filter(r => r.result === 'win').length;
        console.log(`| ${sport.padEnd(5)} | ${String(band).padEnd(4)} | ${String(cell.length).padEnd(7)} | ${pct(wins, cell.length)} |`);
      }
    }
  }

  printNotes(afterDate);
}

function printNotes(afterDate: string) {
  console.log(`\n## Notes`);
  console.log(`- Data window: ${afterDate} onwards (post-UTV2-877 scorer fix merged 2026-05-10)`);
  console.log(`- Band persistence: DEBT-018 / UTV2-906 — band must be written to picks.metadata.band at promotion time`);
  console.log(`- ROI uses -110 flat assumption (submission odds not joined in this script)`);
  console.log(`- Run with --after=2026-05-17 for 7-day post-fix window`);
  console.log(`- After UTV2-906 is deployed: re-run for first band-sliced accuracy report`);
}

main().catch(e => { console.error(e); process.exit(1); });
