/**
 * Learning Ledger — ops script
 *
 * Queries settled picks with prediction context, CLV result, and settlement
 * outcome, then applies a basic error taxonomy to produce a queryable ledger
 * suitable for weekly/monthly model review.
 *
 * Error taxonomy categories:
 *   bad_price      — bet at odds that had no positive expected value (CLV < -2%)
 *   wrong_read     — model picked wrong side (loss + CLV >= 0, good price, wrong direction)
 *   stale_line     — pick posted but closing line moved >3% against before settlement
 *   thin_data      — pick was on a market family with historically low sample depth
 *   injury_gap     — pick metadata indicates injury/lineup flag was present
 *   no_error       — win with positive CLV (justified)
 *   unclassified   — doesn't fit the above
 *
 * Usage:
 *   npx tsx scripts/ops/learning-ledger.ts
 *   npx tsx scripts/ops/learning-ledger.ts --json
 *   npx tsx scripts/ops/learning-ledger.ts --csv
 *   npx tsx scripts/ops/learning-ledger.ts --limit 500
 *
 * Issue: UTV2-629
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
} from '@unit-talk/db';

// ── Types ────────────────────────────────────────────────────────────────────

type ErrorCategory =
  | 'bad_price'
  | 'wrong_read'
  | 'stale_line'
  | 'injury_gap'
  | 'thin_data'
  | 'no_error'
  | 'unclassified';

interface LedgerRow {
  pick_id: string;
  created_at: string;
  market_key: string | null;
  sport: string | null;
  source: string | null;
  outcome: string | null;
  clv_percent: number | null;
  beats_closing_line: boolean | null;
  posted_odds: number | null;
  closing_odds: number | null;
  confidence: number | null;
  has_injury_flag: boolean;
  error_category: ErrorCategory;
  error_notes: string;
}

interface TaxonomySummary {
  category: ErrorCategory;
  count: number;
  win_count: number;
  loss_count: number;
  push_count: number;
  win_rate: number | null;
  avg_clv: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readNum(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key];
  return typeof v === 'number' ? v : null;
}

function readBool(meta: Record<string, unknown>, key: string): boolean | null {
  const v = meta[key];
  return typeof v === 'boolean' ? v : null;
}

function classifyError(row: {
  outcome: string | null;
  clv_percent: number | null;
  beats_closing_line: boolean | null;
  posted_odds: number | null;
  closing_odds: number | null;
  has_injury_flag: boolean;
  market_key: string | null;
}): { category: ErrorCategory; notes: string } {
  const { outcome, clv_percent, beats_closing_line, posted_odds, closing_odds, has_injury_flag } = row;

  // No error — win with positive CLV
  if (outcome === 'WIN' && clv_percent !== null && clv_percent > 0) {
    return { category: 'no_error', notes: `CLV+${clv_percent.toFixed(2)}%` };
  }

  // Injury gap — metadata flagged an injury/lineup concern
  if (has_injury_flag) {
    return {
      category: 'injury_gap',
      notes: `Injury/lineup flag present; outcome=${outcome ?? 'unknown'}`,
    };
  }

  // Bad price — CLV significantly negative (paid too much for the bet)
  if (clv_percent !== null && clv_percent < -2) {
    return {
      category: 'bad_price',
      notes: `CLV=${clv_percent.toFixed(2)}% (threshold: <-2%)`,
    };
  }

  // Stale line — closing odds moved >3% against the posted side
  if (posted_odds !== null && closing_odds !== null) {
    const movePct = ((closing_odds - posted_odds) / Math.abs(posted_odds)) * 100;
    if (movePct > 3) {
      return {
        category: 'stale_line',
        notes: `Line moved +${movePct.toFixed(1)}% against after posting`,
      };
    }
  }

  // Wrong read — loss despite having a fair or positive price (correct price, wrong direction)
  if (outcome === 'LOSS' && (clv_percent === null || clv_percent >= -2) && beats_closing_line === false) {
    return {
      category: 'wrong_read',
      notes: `Loss with CLV=${clv_percent?.toFixed(2) ?? 'n/a'}%; didn't beat closing line`,
    };
  }

  // Thin data — player prop or niche market with no CLV data at all
  if (clv_percent === null && outcome === 'LOSS') {
    const key = row.market_key ?? '';
    if (key.includes('player') || key.includes('prop') || key.includes('alternate')) {
      return { category: 'thin_data', notes: `No CLV available; player/prop market` };
    }
  }

  return { category: 'unclassified', notes: `outcome=${outcome ?? 'unknown'} clv=${clv_percent?.toFixed(2) ?? 'n/a'}%` };
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function toCSVRow(row: LedgerRow): string {
  const fields = [
    row.pick_id,
    row.created_at,
    row.market_key ?? '',
    row.sport ?? '',
    row.source ?? '',
    row.outcome ?? '',
    row.clv_percent?.toFixed(4) ?? '',
    row.beats_closing_line?.toString() ?? '',
    row.posted_odds?.toFixed(2) ?? '',
    row.closing_odds?.toFixed(2) ?? '',
    row.confidence?.toFixed(4) ?? '',
    row.has_injury_flag.toString(),
    row.error_category,
    `"${row.error_notes.replace(/"/g, '""')}"`,
  ];
  return fields.join(',');
}

const CSV_HEADER = [
  'pick_id',
  'created_at',
  'market_key',
  'sport',
  'source',
  'outcome',
  'clv_percent',
  'beats_closing_line',
  'posted_odds',
  'closing_odds',
  'confidence',
  'has_injury_flag',
  'error_category',
  'error_notes',
].join(',');

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const csvMode = args.includes('--csv');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '1000', 10) : 1000;

  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const client = createDatabaseClientFromConnection(connection);

  if (!jsonMode && !csvMode) {
    console.log('=== UTV2-629: Learning Ledger ===\n');
    console.log(`Querying up to ${limit} settled picks...`);
  }

  const { data: picks, error } = await client
    .from('picks')
    .select(`
      id,
      created_at,
      market,
      sport_id,
      source,
      confidence,
      odds,
      metadata,
      settlement_records (
        result,
        payload,
        created_at
      )
    `)
    .eq('status', 'settled')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  if (!picks || picks.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ total: 0, rows: [], summary: [] }, null, 2));
    } else {
      console.log('No settled picks found.');
    }
    return;
  }

  // ── Build ledger rows ─────────────────────────────────────────────────────

  const rows: LedgerRow[] = [];

  for (const pick of picks) {
    const meta = isRecord(pick.metadata) ? pick.metadata : {};

    // Latest settlement record
    const settlements = (pick as unknown as {
      settlement_records: Array<{
        result: string | null;
        payload: unknown;
        created_at: string;
      }>;
    }).settlement_records;

    const latest = Array.isArray(settlements) && settlements.length > 0
      ? settlements.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      : null;

    // result field uses lowercase: 'win', 'loss', 'push' — normalise to uppercase
    const rawResult = latest?.result ?? null;
    const outcome = rawResult ? rawResult.toUpperCase() : null;

    // CLV data lives in the settlement payload
    const payload = isRecord(latest?.payload) ? latest!.payload : {};
    const clv_percent = readNum(payload, 'clvPercent');
    const beats_closing_line = readBool(payload, 'beatsClosingLine');
    const posted_odds = typeof pick.odds === 'number' ? pick.odds : readNum(payload, 'postedOdds');
    const closing_odds = readNum(payload, 'closingOdds') ?? readNum(meta, 'closingOdds');

    // Injury/lineup flag
    const availabilityMeta = isRecord(meta['availability']) ? meta['availability'] : {};
    const has_injury_flag =
      readBool(availabilityMeta, 'hasInjuryRisk') === true ||
      readBool(meta, 'injuryFlag') === true ||
      readBool(meta, 'hasInjuryRisk') === true;

    const { category, notes } = classifyError({
      outcome,
      clv_percent,
      beats_closing_line,
      posted_odds,
      closing_odds,
      has_injury_flag,
      market_key: pick.market ?? null,
    });

    rows.push({
      pick_id: pick.id,
      created_at: typeof pick.created_at === 'string' ? pick.created_at : '',
      market_key: pick.market ?? null,
      sport: pick.sport_id ?? null,
      source: pick.source ?? null,
      outcome,
      clv_percent,
      beats_closing_line,
      posted_odds,
      closing_odds,
      confidence: typeof pick.confidence === 'number' ? pick.confidence : null,
      has_injury_flag,
      error_category: category,
      error_notes: notes,
    });
  }

  // ── Summary by error category ─────────────────────────────────────────────

  const categoryOrder: ErrorCategory[] = [
    'no_error',
    'bad_price',
    'wrong_read',
    'stale_line',
    'injury_gap',
    'thin_data',
    'unclassified',
  ];

  const summaryMap = new Map<ErrorCategory, { wins: number; losses: number; pushes: number; clvs: number[] }>();
  for (const cat of categoryOrder) {
    summaryMap.set(cat, { wins: 0, losses: 0, pushes: 0, clvs: [] });
  }

  for (const row of rows) {
    const bucket = summaryMap.get(row.error_category)!;
    if (row.outcome === 'WIN') bucket.wins++;
    else if (row.outcome === 'LOSS') bucket.losses++;
    else if (row.outcome === 'PUSH') bucket.pushes++;
    if (row.clv_percent !== null) bucket.clvs.push(row.clv_percent);
  }

  const summary: TaxonomySummary[] = categoryOrder.map((cat) => {
    const b = summaryMap.get(cat)!;
    const count = b.wins + b.losses + b.pushes;
    const win_rate = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : null;
    return {
      category: cat,
      count,
      win_count: b.wins,
      loss_count: b.losses,
      push_count: b.pushes,
      win_rate,
      avg_clv: avg(b.clvs),
    };
  }).filter((s) => s.count > 0);

  // ── Output ────────────────────────────────────────────────────────────────

  if (jsonMode) {
    console.log(JSON.stringify({ total: rows.length, summary, rows }, null, 2));
    return;
  }

  if (csvMode) {
    const outDir = path.resolve('scripts/ops/output');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `learning-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
    const csvLines = [CSV_HEADER, ...rows.map(toCSVRow)];
    fs.writeFileSync(outPath, csvLines.join('\n'), 'utf8');
    console.log(`Wrote ${rows.length} rows to ${outPath}`);
    return;
  }

  // Table output
  console.log(`\nTotal settled picks: ${rows.length}\n`);
  console.log('── Error Taxonomy Summary ─────────────────────────────────────────────');
  console.log(
    'Category'.padEnd(16) +
    'Count'.padStart(7) +
    'Win%'.padStart(8) +
    'Avg CLV'.padStart(10)
  );
  console.log('─'.repeat(41));

  for (const s of summary) {
    const winPct = s.win_rate !== null ? `${(s.win_rate * 100).toFixed(1)}%` : 'n/a';
    const clvStr = s.avg_clv !== null ? `${s.avg_clv >= 0 ? '+' : ''}${s.avg_clv.toFixed(2)}%` : 'n/a';
    console.log(
      s.category.padEnd(16) +
      String(s.count).padStart(7) +
      winPct.padStart(8) +
      clvStr.padStart(10)
    );
  }

  console.log('\nRun with --json for full ledger data or --csv to write a dated CSV file.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
