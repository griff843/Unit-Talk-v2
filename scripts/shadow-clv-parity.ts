/**
 * Shadow Validation — CLV Parity Comparison Script
 *
 * Compares V1 CLV values (clv_tracking) against V2 CLV values
 * (settlement_records.clvRaw/clvPercent) for overlapping graded picks.
 * Outputs a CSV with discrepancy classification per SHADOW_VALIDATION_PLAN.md.
 *
 * Usage:
 *   npx tsx scripts/shadow-clv-parity.ts [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--output path]
 *
 * Required env vars:
 *   V1_SUPABASE_URL, V1_SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (V2)
 *
 * Issue: UTV2-174
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// --- Types ---

interface V1CLV {
  prop_id: string;
  clv: number;
  clv_percentage: number;
  beats_closing: boolean;
  devigged_opening_prob: number | null;
  devigged_closing_prob: number | null;
  bet_odds: number;
  closing_odds: number | null;
  player_name: string;
  stat_type: string;
  line: number;
  bet_side: string;
  sport: string;
  user_id: string;
  bet_time: string;
}

interface V2CLV {
  pick_id: string;
  clv_raw: number | null;
  clv_percent: number | null;
  beats_closing_line: boolean | null;
  participant: string;
  market: string;
  line: number;
  selection: string;
  submitted_by: string;
  sport: string;
  settled_at: string;
}

type DiscrepancyClass =
  | 'MATCH'
  | 'ACCEPT_VAR'
  | 'WARN_DRIFT'
  | 'BLOCK_MISMATCH'
  | 'DATA_AVAIL'
  | 'TIMING_DIFF'
  | 'KNOWN_DIV'
  | 'CONTAMINATION';

interface ComparisonRow {
  match_key: string;
  surface: 'clv';
  v1_clv_raw: number | null;
  v2_clv_raw: number | null;
  v1_beats_closing: boolean | null;
  v2_beats_closing: boolean | null;
  clv_delta: number | null;
  discrepancy_class: DiscrepancyClass;
  notes: string;
  sport: string;
  participant: string;
}

// --- Config ---

const CLV_TOLERANCE = 0.005; // ACCEPT_VAR threshold
const CLV_WARN_TOLERANCE = 0.01; // WARN_DRIFT threshold

function parseArgs(): { since: string; until: string; output: string } {
  const args = process.argv.slice(2);
  let since = '';
  let until = '';
  let output = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && args[i + 1]) since = args[++i]!;
    if (args[i] === '--until' && args[i + 1]) until = args[++i]!;
    if (args[i] === '--output' && args[i + 1]) output = args[++i]!;
  }

  if (!since) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    since = d.toISOString().slice(0, 10);
  }
  if (!until) {
    until = new Date().toISOString().slice(0, 10);
  }
  if (!output) {
    output = `out/shadow-validation/clv_parity_${since}_${until}.csv`;
  }

  return { since, until, output };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// --- Data Fetching ---

async function fetchV1CLV(
  client: SupabaseClient,
  since: string,
  until: string,
): Promise<V1CLV[]> {
  const { data, error } = await client
    .from('clv_tracking')
    .select(
      `
      prop_id, clv, clv_percentage, beats_closing,
      devigged_opening_prob, devigged_closing_prob,
      bet_odds, closing_odds, bet_time,
      raw_props!inner(player_name, stat_type, line),
      unified_picks!inner(user_id, sport)
    `,
    )
    .not('clv', 'is', null)
    .gte('bet_time', since)
    .lte('bet_time', until)
    .order('bet_time', { ascending: true });

  if (error) throw new Error(`V1 CLV query failed: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const rawProp = (row.raw_props ?? {}) as Record<string, unknown>;
    const pick = (row.unified_picks ?? {}) as Record<string, unknown>;
    return {
      prop_id: String(row.prop_id),
      clv: Number(row.clv ?? 0),
      clv_percentage: Number(row.clv_percentage ?? 0),
      beats_closing: Boolean(row.beats_closing),
      devigged_opening_prob: row.devigged_opening_prob != null ? Number(row.devigged_opening_prob) : null,
      devigged_closing_prob: row.devigged_closing_prob != null ? Number(row.devigged_closing_prob) : null,
      bet_odds: Number(row.bet_odds ?? 0),
      closing_odds: row.closing_odds != null ? Number(row.closing_odds) : null,
      player_name: String(rawProp.player_name ?? ''),
      stat_type: String(rawProp.stat_type ?? ''),
      line: Number(rawProp.line ?? 0),
      bet_side: '',
      sport: String(pick.sport ?? ''),
      user_id: String(pick.user_id ?? ''),
      bet_time: String(row.bet_time ?? ''),
    };
  });
}

async function fetchV2CLV(
  client: SupabaseClient,
  since: string,
  until: string,
): Promise<V2CLV[]> {
  const { data, error } = await client
    .from('settlement_records')
    .select(
      `
      pick_id, result, source, created_at,
      details,
      picks!inner(selection, line, market, submitted_by, metadata)
    `,
    )
    .eq('source', 'grading')
    .in('result', ['win', 'loss', 'push'])
    .gte('created_at', since)
    .lte('created_at', until)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`V2 CLV query failed: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const pick = (row.picks ?? {}) as Record<string, unknown>;
    const metadata = (pick.metadata ?? {}) as Record<string, unknown>;
    const details = (row.details ?? {}) as Record<string, unknown>;
    return {
      pick_id: String(row.pick_id),
      clv_raw: details.clvRaw != null ? Number(details.clvRaw) : null,
      clv_percent: details.clvPercent != null ? Number(details.clvPercent) : null,
      beats_closing_line: details.beatsClosingLine != null ? Boolean(details.beatsClosingLine) : null,
      participant: String(metadata.participant ?? ''),
      market: String(pick.market ?? ''),
      line: Number(pick.line ?? 0),
      selection: String(pick.selection ?? ''),
      submitted_by: String(pick.submitted_by ?? ''),
      sport: String(metadata.sport ?? ''),
      settled_at: String(row.created_at ?? ''),
    };
  });
}

// --- Matching ---

function buildMatchKey(
  capper: string,
  sport: string,
  participant: string,
  market: string,
  line: number,
): string {
  return [
    capper.toLowerCase().trim(),
    sport.toLowerCase().trim(),
    participant.toLowerCase().trim(),
    market.toLowerCase().trim(),
    String(line),
  ].join('|');
}

function v1Key(s: V1CLV): string {
  return buildMatchKey(s.user_id, s.sport, s.player_name, s.stat_type, s.line);
}

function v2Key(s: V2CLV): string {
  return buildMatchKey(s.submitted_by, s.sport, s.participant, s.market, s.line);
}

// --- Comparison ---

function classifyCLV(v1Raw: number, v2Raw: number | null): { cls: DiscrepancyClass; notes: string } {
  if (v2Raw == null) {
    return { cls: 'DATA_AVAIL', notes: 'V2 CLV not computed (no closing line data)' };
  }

  const delta = Math.abs(v1Raw - v2Raw);

  if (delta <= CLV_TOLERANCE) {
    return { cls: delta === 0 ? 'MATCH' : 'ACCEPT_VAR', notes: '' };
  }
  if (delta <= CLV_WARN_TOLERANCE) {
    return { cls: 'WARN_DRIFT', notes: `delta=${delta.toFixed(5)}` };
  }
  return { cls: 'BLOCK_MISMATCH', notes: `delta=${delta.toFixed(5)} exceeds tolerance` };
}

function classifyBeatsClosing(v1: boolean, v2: boolean | null): { cls: DiscrepancyClass; notes: string } {
  if (v2 == null) return { cls: 'DATA_AVAIL', notes: 'V2 beatsClosingLine not computed' };
  if (v1 === v2) return { cls: 'MATCH', notes: '' };
  return { cls: 'BLOCK_MISMATCH', notes: `V1=${v1} V2=${v2}` };
}

function compare(v1Data: V1CLV[], v2Data: V2CLV[]): ComparisonRow[] {
  const v2ByKey = new Map<string, V2CLV>();
  for (const s of v2Data) {
    const key = v2Key(s);
    if (!v2ByKey.has(key)) v2ByKey.set(key, s);
  }

  const v1ByKey = new Map<string, V1CLV>();
  for (const s of v1Data) {
    const key = v1Key(s);
    if (!v1ByKey.has(key)) v1ByKey.set(key, s);
  }

  const rows: ComparisonRow[] = [];
  const matchedV2Keys = new Set<string>();

  for (const v1 of v1Data) {
    const key = v1Key(v1);
    if (v1ByKey.get(key) !== v1) continue;
    const v2 = v2ByKey.get(key);

    if (!v2) {
      rows.push({
        match_key: key,
        surface: 'clv',
        v1_clv_raw: v1.clv,
        v2_clv_raw: null,
        v1_beats_closing: v1.beats_closing,
        v2_beats_closing: null,
        clv_delta: null,
        discrepancy_class: 'DATA_AVAIL',
        notes: 'Pick exists in V1 CLV but not V2',
        sport: v1.sport,
        participant: v1.player_name,
      });
      continue;
    }

    matchedV2Keys.add(key);
    const clvResult = classifyCLV(v1.clv, v2.clv_raw);
    const beatsResult = classifyBeatsClosing(v1.beats_closing, v2.beats_closing_line);

    // Use the worse classification
    const cls =
      clvResult.cls === 'BLOCK_MISMATCH' || beatsResult.cls === 'BLOCK_MISMATCH'
        ? 'BLOCK_MISMATCH'
        : clvResult.cls === 'WARN_DRIFT' || beatsResult.cls === 'WARN_DRIFT'
          ? 'WARN_DRIFT'
          : clvResult.cls === 'DATA_AVAIL' || beatsResult.cls === 'DATA_AVAIL'
            ? 'DATA_AVAIL'
            : clvResult.cls === 'ACCEPT_VAR' || beatsResult.cls === 'ACCEPT_VAR'
              ? 'ACCEPT_VAR'
              : 'MATCH';

    const notes = [clvResult.notes, beatsResult.notes].filter(Boolean).join('; ');

    rows.push({
      match_key: key,
      surface: 'clv',
      v1_clv_raw: v1.clv,
      v2_clv_raw: v2.clv_raw,
      v1_beats_closing: v1.beats_closing,
      v2_beats_closing: v2.beats_closing_line,
      clv_delta: v2.clv_raw != null ? Math.abs(v1.clv - v2.clv_raw) : null,
      discrepancy_class: cls,
      notes,
      sport: v1.sport,
      participant: v1.player_name,
    });
  }

  // V2-only CLV records
  for (const v2 of v2Data) {
    const key = v2Key(v2);
    if (matchedV2Keys.has(key)) continue;
    if (v2ByKey.get(key) !== v2) continue;
    if (v2.clv_raw == null) continue; // skip V2 picks without CLV

    rows.push({
      match_key: key,
      surface: 'clv',
      v1_clv_raw: null,
      v2_clv_raw: v2.clv_raw,
      v1_beats_closing: null,
      v2_beats_closing: v2.beats_closing_line,
      clv_delta: null,
      discrepancy_class: 'DATA_AVAIL',
      notes: 'Pick exists in V2 CLV but not V1',
      sport: v2.sport,
      participant: v2.participant,
    });
  }

  return rows;
}

// --- Output ---

function toCsv(rows: ComparisonRow[]): string {
  const headers = [
    'match_key', 'surface', 'v1_clv_raw', 'v2_clv_raw',
    'v1_beats_closing', 'v2_beats_closing', 'clv_delta',
    'discrepancy_class', 'notes', 'sport', 'participant',
  ];

  const escape = (v: string | number | boolean | null) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h as keyof ComparisonRow])).join(','));
  }
  return lines.join('\n') + '\n';
}

function printSummary(rows: ComparisonRow[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.discrepancy_class] = (counts[row.discrepancy_class] ?? 0) + 1;
  }

  const total = rows.length;
  const matched = rows.filter((r) => r.v1_clv_raw != null && r.v2_clv_raw != null).length;
  const withinTolerance = (counts['MATCH'] ?? 0) + (counts['ACCEPT_VAR'] ?? 0);

  console.log('\n=== CLV Parity Summary ===');
  console.log(`Total rows:          ${total}`);
  console.log(`Matched picks:       ${matched}`);
  console.log(`DATA_AVAIL:          ${counts['DATA_AVAIL'] ?? 0}`);
  console.log(`MATCH:               ${counts['MATCH'] ?? 0}`);
  console.log(`ACCEPT_VAR:          ${counts['ACCEPT_VAR'] ?? 0}`);
  console.log(`WARN_DRIFT:          ${counts['WARN_DRIFT'] ?? 0}`);
  console.log(`BLOCK_MISMATCH:      ${counts['BLOCK_MISMATCH'] ?? 0}`);

  if (matched > 0) {
    const parityPct = ((withinTolerance / matched) * 100).toFixed(1);
    console.log(`\nCLV parity rate (MATCH + ACCEPT_VAR): ${parityPct}%`);
    console.log(`Threshold for pass: >= 95%`);
    console.log(Number(parityPct) >= 95 ? 'CLV surface PASSES.' : '** CLV surface FAILS — below 95% parity **');
  }
}

// --- Main ---

async function main() {
  const { since, until, output } = parseArgs();

  console.log(`Shadow CLV parity comparison: ${since} to ${until}`);

  const v1Client = createClient(
    requireEnv('V1_SUPABASE_URL'),
    requireEnv('V1_SUPABASE_SERVICE_ROLE_KEY'),
  );
  const v2Client = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );

  console.log('Fetching V1 CLV data...');
  const v1 = await fetchV1CLV(v1Client, since, until);
  console.log(`  ${v1.length} V1 CLV records`);

  console.log('Fetching V2 CLV data...');
  const v2 = await fetchV2CLV(v2Client, since, until);
  console.log(`  ${v2.length} V2 settlements with potential CLV`);

  console.log('Comparing...');
  const rows = compare(v1, v2);

  const outputPath = resolve(output);
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, toCsv(rows));
  console.log(`CSV written to: ${outputPath}`);

  printSummary(rows);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
