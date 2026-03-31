/**
 * Shadow Validation — Grading Parity Comparison Script
 *
 * Compares V1 grading outcomes (prop_settlements) against V2 grading outcomes
 * (settlement_records) for overlapping picks. Outputs a CSV with discrepancy
 * classification per SHADOW_VALIDATION_PLAN.md.
 *
 * Usage:
 *   npx tsx scripts/shadow-grading-parity.ts [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--output path]
 *
 * Required env vars:
 *   V1_SUPABASE_URL, V1_SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (V2)
 *
 * Issue: UTV2-173
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// --- Types ---

interface V1Settlement {
  id: string;
  player_name: string;
  stat_type: string;
  line: number;
  bet_side: string;
  actual_value: number;
  settlement_result: string;
  settled_at: string;
  sport: string;
  user_id: string;
}

interface V2Settlement {
  id: string;
  pick_id: string;
  result: string;
  source: string;
  created_at: string;
  // Joined from picks
  participant: string;
  market: string;
  line: number;
  selection: string;
  submitted_by: string;
  sport: string;
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
  surface: 'grading';
  v1_result: string;
  v2_result: string;
  v1_actual_value: number | null;
  v2_actual_value: string | null;
  discrepancy_class: DiscrepancyClass;
  notes: string;
  v1_settled_at: string;
  v2_settled_at: string;
  sport: string;
  participant: string;
}

// --- Config ---

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
    output = `out/shadow-validation/grading_parity_${since}_${until}.csv`;
  }

  return { since, until, output };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// --- Data Fetching ---

async function fetchV1Settlements(
  client: SupabaseClient,
  since: string,
  until: string,
): Promise<V1Settlement[]> {
  // Query prop_settlements joined with game_results and unified_picks
  const { data, error } = await client
    .from('prop_settlements')
    .select(
      `
      id,
      player_name,
      stat_type,
      line,
      bet_side,
      actual_value,
      settlement_result,
      settled_at,
      game_results!inner(sport),
      unified_picks!inner(user_id)
    `,
    )
    .in('settlement_result', ['win', 'loss', 'push'])
    .gte('settled_at', since)
    .lte('settled_at', until)
    .order('settled_at', { ascending: true });

  if (error) throw new Error(`V1 query failed: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    player_name: String(row.player_name ?? ''),
    stat_type: String(row.stat_type ?? ''),
    line: Number(row.line ?? 0),
    bet_side: String(row.bet_side ?? ''),
    actual_value: Number(row.actual_value ?? 0),
    settlement_result: String(row.settlement_result ?? ''),
    settled_at: String(row.settled_at ?? ''),
    sport: String(
      (row.game_results as Record<string, unknown>)?.sport ?? '',
    ),
    user_id: String(
      (row.unified_picks as Record<string, unknown>)?.user_id ?? '',
    ),
  }));
}

async function fetchV2Settlements(
  client: SupabaseClient,
  since: string,
  until: string,
): Promise<V2Settlement[]> {
  const { data, error } = await client
    .from('settlement_records')
    .select(
      `
      id,
      pick_id,
      result,
      source,
      created_at,
      picks!inner(
        selection,
        line,
        market,
        submitted_by,
        metadata
      )
    `,
    )
    .in('result', ['win', 'loss', 'push'])
    .eq('source', 'grading')
    .gte('created_at', since)
    .lte('created_at', until)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`V2 query failed: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const pick = row.picks as Record<string, unknown>;
    const metadata = (pick?.metadata ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      pick_id: String(row.pick_id),
      result: String(row.result),
      source: String(row.source),
      created_at: String(row.created_at),
      participant: String(metadata.participant ?? ''),
      market: String(pick?.market ?? ''),
      line: Number(pick?.line ?? 0),
      selection: String(pick?.selection ?? ''),
      submitted_by: String(pick?.submitted_by ?? ''),
      sport: String(metadata.sport ?? ''),
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
  selection: string,
): string {
  return [
    capper.toLowerCase().trim(),
    sport.toLowerCase().trim(),
    participant.toLowerCase().trim(),
    market.toLowerCase().trim(),
    String(line),
    selection.toLowerCase().trim(),
  ].join('|');
}

function v1MatchKey(s: V1Settlement): string {
  return buildMatchKey(
    s.user_id,
    s.sport,
    s.player_name,
    s.stat_type,
    s.line,
    s.bet_side,
  );
}

function v2MatchKey(s: V2Settlement): string {
  return buildMatchKey(
    s.submitted_by,
    s.sport,
    s.participant,
    s.market,
    s.line,
    s.selection,
  );
}

// --- Comparison ---

function classifyOutcome(v1Result: string, v2Result: string): DiscrepancyClass {
  const v1 = v1Result.toLowerCase().trim();
  const v2 = v2Result.toLowerCase().trim();
  if (v1 === v2) return 'MATCH';
  return 'BLOCK_MISMATCH';
}

function compare(
  v1Settlements: V1Settlement[],
  v2Settlements: V2Settlement[],
): ComparisonRow[] {
  const v2ByKey = new Map<string, V2Settlement>();
  for (const s of v2Settlements) {
    const key = v2MatchKey(s);
    if (!v2ByKey.has(key)) v2ByKey.set(key, s);
  }

  const v1ByKey = new Map<string, V1Settlement>();
  for (const s of v1Settlements) {
    const key = v1MatchKey(s);
    if (!v1ByKey.has(key)) v1ByKey.set(key, s);
  }

  const rows: ComparisonRow[] = [];
  const matchedV2Keys = new Set<string>();

  // Compare V1 settlements against V2
  for (const v1 of v1Settlements) {
    const key = v1MatchKey(v1);
    if (v1ByKey.get(key) !== v1) continue; // skip duplicates
    const v2 = v2ByKey.get(key);

    if (!v2) {
      rows.push({
        match_key: key,
        surface: 'grading',
        v1_result: v1.settlement_result,
        v2_result: '',
        v1_actual_value: v1.actual_value,
        v2_actual_value: null,
        discrepancy_class: 'DATA_AVAIL',
        notes: 'Pick exists in V1 but not V2',
        v1_settled_at: v1.settled_at,
        v2_settled_at: '',
        sport: v1.sport,
        participant: v1.player_name,
      });
      continue;
    }

    matchedV2Keys.add(key);
    const discrepancy = classifyOutcome(v1.settlement_result, v2.result);

    rows.push({
      match_key: key,
      surface: 'grading',
      v1_result: v1.settlement_result,
      v2_result: v2.result,
      v1_actual_value: v1.actual_value,
      v2_actual_value: null,
      discrepancy_class: discrepancy,
      notes:
        discrepancy === 'MATCH'
          ? ''
          : `V1=${v1.settlement_result} V2=${v2.result}`,
      v1_settled_at: v1.settled_at,
      v2_settled_at: v2.created_at,
      sport: v1.sport,
      participant: v1.player_name,
    });
  }

  // V2-only picks (no V1 match)
  for (const v2 of v2Settlements) {
    const key = v2MatchKey(v2);
    if (matchedV2Keys.has(key)) continue;
    if (v2ByKey.get(key) !== v2) continue; // skip duplicates

    rows.push({
      match_key: key,
      surface: 'grading',
      v1_result: '',
      v2_result: v2.result,
      v1_actual_value: null,
      v2_actual_value: null,
      discrepancy_class: 'DATA_AVAIL',
      notes: 'Pick exists in V2 but not V1',
      v1_settled_at: '',
      v2_settled_at: v2.created_at,
      sport: v2.sport,
      participant: v2.participant,
    });
  }

  return rows;
}

// --- Output ---

function toCsv(rows: ComparisonRow[]): string {
  const headers = [
    'match_key',
    'surface',
    'v1_result',
    'v2_result',
    'v1_actual_value',
    'v2_actual_value',
    'discrepancy_class',
    'notes',
    'v1_settled_at',
    'v2_settled_at',
    'sport',
    'participant',
  ];

  const escape = (v: string | number | null) => {
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
  const matched = rows.filter((r) => r.v1_result && r.v2_result).length;
  const blocking = counts['BLOCK_MISMATCH'] ?? 0;

  console.log('\n=== Grading Parity Summary ===');
  console.log(`Total rows:          ${total}`);
  console.log(`Matched picks:       ${matched}`);
  console.log(`V1-only (DATA_AVAIL): ${counts['DATA_AVAIL'] ?? 0}`);
  console.log(`MATCH:               ${counts['MATCH'] ?? 0}`);
  console.log(`BLOCK_MISMATCH:      ${blocking}`);
  console.log(`WARN_DRIFT:          ${counts['WARN_DRIFT'] ?? 0}`);
  console.log(`ACCEPT_VAR:          ${counts['ACCEPT_VAR'] ?? 0}`);

  if (matched > 0) {
    const matchPct = (((counts['MATCH'] ?? 0) / matched) * 100).toFixed(1);
    console.log(`\nGrading parity rate: ${matchPct}%`);
  }

  if (blocking > 0) {
    console.log(`\n** ${blocking} BLOCKING MISMATCH(ES) — shadow validation FAILS for grading surface **`);
  } else {
    console.log('\nNo blocking mismatches. Grading surface PASSES.');
  }
}

// --- Main ---

async function main() {
  const { since, until, output } = parseArgs();

  console.log(`Shadow grading parity comparison: ${since} to ${until}`);

  const v1Client = createClient(
    requireEnv('V1_SUPABASE_URL'),
    requireEnv('V1_SUPABASE_SERVICE_ROLE_KEY'),
  );
  const v2Client = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );

  console.log('Fetching V1 settlements...');
  const v1 = await fetchV1Settlements(v1Client, since, until);
  console.log(`  ${v1.length} V1 settlements`);

  console.log('Fetching V2 settlements...');
  const v2 = await fetchV2Settlements(v2Client, since, until);
  console.log(`  ${v2.length} V2 settlements`);

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
