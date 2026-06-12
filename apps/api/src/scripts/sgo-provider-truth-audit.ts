/**
 * UTV2-1267 — Sample-seeded DB-signal classification of the 172 UTV2-1262
 * backfilled closing_for_clv rows, with per-row validation_source.
 *
 * IMPORTANT SEMANTICS (PM directive, Option A):
 *   This is NOT full provider-truth verification of all 172 rows.
 *   - validation_source='mcp_direct'    → row has a durably recorded SGO MCP
 *     verdict from the 31-row sampled review. Only the 13 non-PASS verdicts
 *     (6 FAIL, 7 WARN) were recorded per pick_id; sampled rows that passed
 *     were not durably recorded and are conservatively classified
 *     db_signal_only. provider_truth_verified=true.
 *   - validation_source='poh_verified'  → reserved for canonical local
 *     provider row match (provider_offer_history against expected
 *     event/market/participant/line/side). Currently 0 rows: backfilled
 *     snapshot payloads carry no provider identifiers, and because the
 *     UTV2-1262 backfill derived its closing values from the same local
 *     provider data, a POH re-match would be circular, not independent.
 *   - validation_source='db_signal_only' → PASS/WARN derived from local DB
 *     CLV fields alone. provider_truth_verified=false. A db_signal PASS is
 *     NOT provider-truth verified and must never be reported as such.
 *
 * Run:
 *   tsx apps/api/src/scripts/sgo-provider-truth-audit.ts
 *   tsx apps/api/src/scripts/sgo-provider-truth-audit.ts --dry-run
 *
 * Output:
 *   docs/06_status/proof/UTV2-1267/audit-results.json
 *
 * Data source:
 *   pick_offer_snapshots (snapshot_kind=closing_for_clv, backfill_lane=UTV2-1262)
 *   settlement_records.payload.clv (closingLine, closingOdds, pickOdds, providerKey)
 *
 * Guardrails:
 *   - Read-only. Does NOT mutate pick_offer_snapshots or any other table.
 *   - Does NOT certify P3 or mark UTV2-1042 Done.
 *   - Does NOT count FAIL rows in certification-facing evidence metrics.
 *   - FAIL rows reported separately in fail_excluded bucket.
 *   - db_signal_only rows must never be reported as provider-truth verified.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '@unit-talk/db';

// ── Types ─────────────────────────────────────────────────────────────────────

type Verdict = 'PASS' | 'WARN' | 'FAIL';

/**
 * How a row's verdict was established.
 *   mcp_direct     — durably recorded SGO MCP verdict (provider truth)
 *   poh_verified   — canonical local provider_offer_history match (provider truth)
 *   db_signal_only — local DB CLV fields only (NOT provider-truth verified)
 */
type ValidationSource = 'mcp_direct' | 'poh_verified' | 'db_signal_only';

type FailReason =
  | 'LINE_MOVE_STALE'
  | 'ALT_LINE'
  | '1H_NO_CLOSE'
  | 'NULL_BOTH_SIDES'
  | 'OVERROUND_INVALID';

type WarnReason =
  | 'ODDS_TIMING_DRIFT'
  | 'NO_CLOSE_ONE_SIDE'
  | 'LINE_MOVED_CORRECT_CLOSE_DRIFT'
  | 'INTERMEDIATE_SNAPSHOT'
  | 'SETTLEMENT_SOURCE_MISMATCH'
  | 'LINE_MOVED_DB_SIGNAL';

type PassReason = 'DB_SIGNAL_PASS';

interface SnapshotRow {
  pick_id: string;
  closing_line: number | null;
  closing_odds: number | null;
  pick_odds: number | null;
  provider_key: string | null;
  closing_snapshot_at: string | null;
  backfill_source: string | null;
  created_at: string;
}

interface ClassifiedRow extends SnapshotRow {
  verdict: Verdict;
  reason_code: FailReason | WarnReason | PassReason;
  validation_source: ValidationSource;
  provider_truth_verified: boolean;
  backfill_lane: string;
  fail_reason?: FailReason;
  warn_reason?: WarnReason;
  note: string;
}

interface AuditResults {
  run_at: string;
  total_rows: number;
  pass_count: number;
  warn_count: number;
  fail_count: number;
  pass_rate_excluding_fail: string;
  validation_source_counts: {
    mcp_direct: number;
    poh_verified: number;
    db_signal_only: number;
  };
  split_metrics: {
    mcp_direct_pass: number;
    poh_verified_pass: number;
    db_signal_pass_unverified: number;
    warn: number;
    fail_excluded: number;
  };
  fail_reasons: Record<string, number>;
  warn_reasons: Record<string, number>;
  methodology_note: string;
  buckets: {
    provider_truth_pass: ClassifiedRow[];
    db_signal_pass_unverified: ClassifiedRow[];
    pass_and_warn: ClassifiedRow[];
    fail_excluded: ClassifiedRow[];
    all_rows: ClassifiedRow[];
  };
  posture: string;
  guardrails: string[];
}

const BACKFILL_LANE = 'UTV2-1262';

// ── DB Query ──────────────────────────────────────────────────────────────────

async function fetchBackfilledRows(): Promise<SnapshotRow[]> {
  const db = createDatabaseClient({ useServiceRole: true });

  // Step 1: fetch pick_ids from pick_offer_snapshots
  const { data: snapData, error: snapError } = await db
    .from('pick_offer_snapshots')
    .select('pick_id, payload, created_at')
    .eq('snapshot_kind', 'closing_for_clv')
    .not('payload->>backfill_source', 'is', null)
    .eq('payload->>backfill_lane', 'UTV2-1262')
    .order('created_at', { ascending: true })
    .limit(250);

  if (snapError) throw new Error(`pick_offer_snapshots query failed: ${snapError.message}`);
  assert.ok(snapData, 'No snapshot data returned');

  const pickIds = (snapData as unknown[]).map((r) => (r as Record<string, unknown>).pick_id as string);
  const snapByPickId = new Map<string, Record<string, unknown>>();
  for (const row of snapData as unknown[]) {
    const r = row as Record<string, unknown>;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    snapByPickId.set(r.pick_id as string, {
      created_at: r.created_at as string,
      backfill_source: (payload.backfill_source as string) ?? null,
    });
  }

  // Step 2: fetch settlement_records.payload.clv for all pick_ids
  const { data: settlData, error: settlError } = await db
    .from('settlement_records')
    .select('pick_id, payload->clv')
    .in('pick_id', pickIds);

  if (settlError) throw new Error(`settlement_records query failed: ${settlError.message}`);
  assert.ok(settlData, 'No settlement data returned');

  const settlByPickId = new Map<string, Record<string, unknown>>();
  for (const row of settlData as unknown[]) {
    const r = row as Record<string, unknown>;
    const clv = (r.clv ?? {}) as Record<string, unknown>;
    settlByPickId.set(r.pick_id as string, clv);
  }

  // Merge
  return pickIds.map((pickId) => {
    const snap = snapByPickId.get(pickId) ?? {};
    const clv = settlByPickId.get(pickId) ?? {};
    return {
      pick_id: pickId,
      closing_line: clv.closingLine !== null && clv.closingLine !== undefined ? Number(clv.closingLine) : null,
      closing_odds: clv.closingOdds !== null && clv.closingOdds !== undefined ? Number(clv.closingOdds) : null,
      pick_odds: clv.pickOdds !== null && clv.pickOdds !== undefined ? Number(clv.pickOdds) : null,
      provider_key: clv.providerKey ? String(clv.providerKey) : null,
      closing_snapshot_at: clv.closingSnapshotAt ? String(clv.closingSnapshotAt) : null,
      backfill_source: snap.backfill_source ? String(snap.backfill_source) : null,
      created_at: String(snap.created_at ?? ''),
    };
  });
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Phase 1 DB-signal classification (validation_source='db_signal_only').
 * Uses settlement_records.payload.clv for closing odds presence check.
 * A db_signal PASS is NOT provider-truth verified — LINE_MOVE_STALE,
 * ALT_LINE, and source-mismatch detection require provider truth (Phase 2
 * mcp_direct overrides, applied via KNOWN_FAILS/KNOWN_WARNS).
 */
function classifyRow(row: SnapshotRow): ClassifiedRow {
  // FAIL: no closing data at all
  if (row.closing_line === null && row.closing_odds === null) {
    return {
      ...row,
      verdict: 'FAIL',
      reason_code: 'NULL_BOTH_SIDES',
      validation_source: 'db_signal_only',
      provider_truth_verified: false,
      backfill_lane: BACKFILL_LANE,
      fail_reason: 'NULL_BOTH_SIDES',
      note: 'No closingLine or closingOdds in settlement CLV — no provider evidence captured',
    };
  }

  // WARN: partial data
  if (row.closing_odds === null) {
    return {
      ...row,
      verdict: 'WARN',
      reason_code: 'NO_CLOSE_ONE_SIDE',
      validation_source: 'db_signal_only',
      provider_truth_verified: false,
      backfill_lane: BACKFILL_LANE,
      warn_reason: 'NO_CLOSE_ONE_SIDE',
      note: `closingLine=${row.closing_line} but closingOdds is null — partial provider data`,
    };
  }

  // PASS from DB signals only — NOT provider-truth verified.
  return {
    ...row,
    verdict: 'PASS',
    reason_code: 'DB_SIGNAL_PASS',
    validation_source: 'db_signal_only',
    provider_truth_verified: false,
    backfill_lane: BACKFILL_LANE,
    note: `DB-signal only (NOT provider-truth verified): closingLine=${row.closing_line} closingOdds=${row.closing_odds} pickOdds=${row.pick_odds} via ${row.provider_key ?? 'unknown'}.`,
  };
}

// ── Known FAILs from SGO MCP validation (31-pick sample, UTV2-1267 Part A) ───

const KNOWN_FAILS: Record<string, { verdict: 'FAIL'; fail_reason: FailReason; note: string }> = {
  'd511cdd3': {
    verdict: 'FAIL',
    fail_reason: 'LINE_MOVE_STALE',
    note: 'Joey Ortiz batting_totalBases: DB over=+195 from old 1.5 line; SGO true close=-159 on 0.5 line; CLV +34.7% invalid',
  },
  'b9641fd1': {
    verdict: 'FAIL',
    fail_reason: 'LINE_MOVE_STALE',
    note: 'Luke Kornet rebounds: DB line=3.5 vs SGO close=2.5; stale old-line snapshot',
  },
  'b366ea76': {
    verdict: 'FAIL',
    fail_reason: 'LINE_MOVE_STALE',
    note: 'Jalen Brunson 2PA: DB line=15.5 vs SGO close=16.5; stale old-line snapshot',
  },
  'bd9d71a6': {
    verdict: 'FAIL',
    fail_reason: 'ALT_LINE',
    note: 'Julian Champagnie 3PM game: DB snap_line=2.5 but SGO main line always=1.5; includeAltLines contamination',
  },
  '5fd426f7': {
    verdict: 'FAIL',
    fail_reason: '1H_NO_CLOSE',
    note: 'Julian Champagnie 3PM 1H: null both sides confirmed via SGO MCP',
  },
  '9c99a461': {
    verdict: 'FAIL',
    fail_reason: '1H_NO_CLOSE',
    note: 'Jalen Brunson 3PM 1H: null both sides confirmed via SGO MCP',
  },
};

const KNOWN_WARNS: Record<string, { verdict: 'WARN'; warn_reason: WarnReason; note: string }> = {
  '75988fd7': {
    verdict: 'WARN',
    warn_reason: 'NO_CLOSE_ONE_SIDE',
    note: 'C. Montgomery batting_triples: no closeBookOdds for under at Pinnacle; matches closeFairOdds',
  },
  'bc0e3c53': {
    verdict: 'WARN',
    warn_reason: 'LINE_MOVED_CORRECT_CLOSE_DRIFT',
    note: 'S. Sharpe assists: line moved 2.5→0.5; DB has correct close line; Δ30 over / Δ12 under',
  },
  'a3072fdc': {
    verdict: 'WARN',
    warn_reason: 'ODDS_TIMING_DRIFT',
    note: 'J. Aranda batting_doubles: Δ21 over / Δ58 under; timing mismatch',
  },
  '1baa15f3': {
    verdict: 'WARN',
    warn_reason: 'SETTLEMENT_SOURCE_MISMATCH',
    note: 'K. Johnson 3PM: settlement close=-145 vs SGO close=-115 (Δ30 source mismatch)',
  },
  '11bb2312': {
    verdict: 'WARN',
    warn_reason: 'INTERMEDIATE_SNAPSHOT',
    note: 'OG Anunoby FTA: line moved 3.5→5; DB captured intermediate 4.5 line',
  },
  '6a1599e0': {
    verdict: 'WARN',
    warn_reason: 'ODDS_TIMING_DRIFT',
    note: 'J. Randle turnovers: over odds +102→-118 direction shift; timing issue',
  },
  'e4f8bd16': {
    verdict: 'WARN',
    warn_reason: 'LINE_MOVED_CORRECT_CLOSE_DRIFT',
    note: 'P. Pages batting_totalBases: line moved 0.5→1.5; DB correct close line; snap_under Δ62',
  },
};

// ── Override with known SGO MCP verdicts (validation_source='mcp_direct') ─────
// Only these rows carry provider_truth_verified=true. The 31-row sampled
// review also produced PASS verdicts, but those were not durably recorded
// per pick_id, so sampled-PASS rows remain db_signal_only (conservative).

function applyKnownVerdicts(rows: ClassifiedRow[]): ClassifiedRow[] {
  return rows.map((row) => {
    const pickIdShort = row.pick_id.slice(0, 8);
    const knownFail = KNOWN_FAILS[pickIdShort];
    const knownWarn = KNOWN_WARNS[pickIdShort];
    if (knownFail) {
      return {
        ...row,
        ...knownFail,
        reason_code: knownFail.fail_reason,
        validation_source: 'mcp_direct' as const,
        provider_truth_verified: true,
      };
    }
    if (knownWarn) {
      return {
        ...row,
        ...knownWarn,
        reason_code: knownWarn.warn_reason,
        validation_source: 'mcp_direct' as const,
        provider_truth_verified: true,
      };
    }
    return row;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[UTV2-1267] Starting provider-truth audit${isDryRun ? ' (dry-run)' : ''}...`);

  let rows: SnapshotRow[];
  try {
    rows = await fetchBackfilledRows();
  } catch (err) {
    console.error('[UTV2-1267] DB fetch failed:', err);
    process.exit(1);
  }

  console.log(`[UTV2-1267] Fetched ${rows.length} backfilled closing_for_clv rows`);

  // Phase 1: DB-observable classification
  let classified = rows.map(classifyRow);

  // Phase 2: Apply known verdicts from 31-pick SGO MCP sample
  classified = applyKnownVerdicts(classified);

  const passRows = classified.filter((r) => r.verdict === 'PASS');
  const warnRows = classified.filter((r) => r.verdict === 'WARN');
  const failRows = classified.filter((r) => r.verdict === 'FAIL');

  const failReasons: Record<string, number> = {};
  for (const r of failRows) {
    if (r.fail_reason) {
      failReasons[r.fail_reason] = (failReasons[r.fail_reason] ?? 0) + 1;
    }
  }

  const warnReasons: Record<string, number> = {};
  for (const r of warnRows) {
    if (r.warn_reason) {
      warnReasons[r.warn_reason] = (warnReasons[r.warn_reason] ?? 0) + 1;
    }
  }

  const totalNonFail = passRows.length + warnRows.length;
  const passRateExcludingFail = totalNonFail > 0
    ? `${((passRows.length / totalNonFail) * 100).toFixed(1)}%`
    : 'n/a';

  const mcpDirectRows = classified.filter((r) => r.validation_source === 'mcp_direct');
  const pohVerifiedRows = classified.filter((r) => r.validation_source === 'poh_verified');
  const dbSignalRows = classified.filter((r) => r.validation_source === 'db_signal_only');

  const providerTruthPassRows = passRows.filter((r) => r.provider_truth_verified);
  const dbSignalPassRows = passRows.filter((r) => !r.provider_truth_verified);

  const results: AuditResults = {
    run_at: new Date().toISOString(),
    total_rows: classified.length,
    pass_count: passRows.length,
    warn_count: warnRows.length,
    fail_count: failRows.length,
    pass_rate_excluding_fail: passRateExcludingFail,
    validation_source_counts: {
      mcp_direct: mcpDirectRows.length,
      poh_verified: pohVerifiedRows.length,
      db_signal_only: dbSignalRows.length,
    },
    split_metrics: {
      mcp_direct_pass: providerTruthPassRows.filter((r) => r.validation_source === 'mcp_direct').length,
      poh_verified_pass: providerTruthPassRows.filter((r) => r.validation_source === 'poh_verified').length,
      db_signal_pass_unverified: dbSignalPassRows.length,
      warn: warnRows.length,
      fail_excluded: failRows.length,
    },
    fail_reasons: failReasons,
    warn_reasons: warnReasons,
    methodology_note: [
      '172 rows classified by DB-signal + 13-row MCP direct validation overrides.',
      'NOT full provider-truth verification: only the 13 non-PASS verdicts from the 31-row',
      'sampled SGO MCP review were durably recorded per pick_id (6 FAIL, 7 WARN);',
      'sampled rows that passed were not durably recorded, so they are conservatively',
      'classified db_signal_only. A db_signal PASS means closingLine + closingOdds are',
      'non-null in settlement_records.payload.clv — it is NOT provider-truth verified',
      'and may include undetected LINE_MOVE_STALE / ALT_LINE rows.',
      'poh_verified=0 by design: backfilled snapshot payloads carry no provider',
      'identifiers, and because the UTV2-1262 backfill derived closing values from the',
      'same local provider data, a provider_offer_history re-match would be circular,',
      'not independent verification.',
      'Payload source: pick_offer_snapshots.payload stores CLV result metadata only',
      '(clv_raw, clv_percent); closing odds live in settlement_records.payload.clv.',
    ].join(' '),
    buckets: {
      provider_truth_pass: providerTruthPassRows,
      db_signal_pass_unverified: dbSignalPassRows,
      pass_and_warn: [...passRows, ...warnRows],
      fail_excluded: failRows,
      all_rows: classified,
    },
    posture: 'DATA_SUFFICIENT_READY_FOR_FILTERED_PM_REVIEW',
    guardrails: [
      'FAIL rows excluded from certification-facing evidence metrics',
      'db_signal_only rows must never be reported as provider-truth verified',
      'backfill provenance visible (backfill_source=UTV2-1262-historical, backfill_lane=UTV2-1262)',
      'no production data mutated',
      'UTV2-1042 not marked Done',
      'P3 not certified',
      'CLV/ROI/edge claims not made',
      'public Discord remains gated',
    ],
  };

  // Print summary
  console.log(`\n[UTV2-1267] Classification complete:`);
  console.log(`  Total rows : ${results.total_rows}`);
  console.log(`  PASS       : ${results.pass_count} (${((results.pass_count / results.total_rows) * 100).toFixed(1)}%)`);
  console.log(`  WARN       : ${results.warn_count} (${((results.warn_count / results.total_rows) * 100).toFixed(1)}%)`);
  console.log(`  FAIL       : ${results.fail_count} (${((results.fail_count / results.total_rows) * 100).toFixed(1)}%)`);
  console.log(`  PASS rate (excl. FAIL): ${results.pass_rate_excluding_fail}`);
  console.log(`\n  validation_source: ${JSON.stringify(results.validation_source_counts)}`);
  console.log(`  split_metrics    : ${JSON.stringify(results.split_metrics)}`);
  console.log(`\n  FAIL reasons: ${JSON.stringify(failReasons)}`);
  console.log(`  WARN reasons: ${JSON.stringify(warnReasons)}`);
  console.log(`\n  Methodology: ${results.methodology_note.slice(0, 120)}...`);
  console.log(`\n  Posture: ${results.posture}`);

  if (!isDryRun) {
    const outPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../docs/06_status/proof/UTV2-1267/audit-results.json',
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\n[UTV2-1267] Results written to ${outPath}`);
  }

  // Exit non-zero if no rows
  if (classified.length === 0) {
    console.error('[UTV2-1267] ERROR: 0 rows returned — check DB connection and backfill_lane filter');
    process.exit(1);
  }

  console.log('\n[UTV2-1267] Audit complete.');
}

main().catch((err) => {
  console.error('[UTV2-1267] Unhandled error:', err);
  process.exit(1);
});
