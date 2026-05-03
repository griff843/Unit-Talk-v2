#!/usr/bin/env tsx
/**
 * UTV2-433: MLB CLV gate re-evaluation
 *
 * Gate threshold: clvBackedOutcomeCount >= 10
 * Fix date: UTV2-754 merged 2026-04-26 (route MLB picks through market-universe provenance)
 *
 * Checks:
 *   1. Total settled MLB picks post-fix
 *   2. CLV-backed count (settlement_records with clvRaw/clvPercent/beatsClosingLine)
 *   3. Provenance coverage (picks with marketUniverseId or scoredCandidateId)
 *   4. Gate pass/fail
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function loadEnv() {
  for (const p of ['local.env', '.env', '.env.example']) {
    try {
      const content = readFileSync(resolve(REPO_ROOT, p), 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
      break;
    } catch { /* try next */ }
  }
}

loadEnv();

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? '';
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? process.env['SUPABASE_SERVICE_KEY'] ?? '';
const FIX_DATE = '2026-04-26T00:00:00Z'; // UTV2-754 merged
const GATE_THRESHOLD = 10;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface SettlementRow {
  id: string;
  pick_id: string;
  settled_at: string;
  payload: Record<string, unknown> | null;
}

interface PickRow {
  id: string;
  sport_key: string | null;
  source: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

function isClvBacked(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false;
  return (
    payload['clvRaw'] != null ||
    payload['clvPercent'] != null ||
    payload['beatsClosingLine'] != null
  );
}

function hasProvenance(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  return metadata['marketUniverseId'] != null || metadata['scoredCandidateId'] != null;
}

async function main() {
  console.log('=== UTV2-433: MLB CLV Gate Re-evaluation ===');
  console.log(`Fix date (UTV2-754): ${FIX_DATE}`);
  console.log(`Gate threshold: clvBackedOutcomeCount >= ${GATE_THRESHOLD}`);
  console.log(`Run date: ${new Date().toISOString()}`);
  console.log('');

  // 1. Find settled MLB picks created after fix date
  const { data: mlbPicks, error: picksErr } = await db
    .from('picks')
    .select('id, sport_key, source, created_at, metadata')
    .gte('created_at', FIX_DATE)
    .or('sport_key.eq.baseball_mlb,sport_key.ilike.%mlb%');

  if (picksErr) {
    console.error('Failed to query picks:', picksErr.message);
    process.exit(1);
  }

  const picks = (mlbPicks ?? []) as PickRow[];
  console.log(`MLB picks created after fix date: ${picks.length}`);

  if (picks.length === 0) {
    console.log('');
    console.log('GATE RESULT: INSUFFICIENT DATA');
    console.log('No MLB picks found after UTV2-754 fix date. Pipeline may not have processed MLB picks yet.');
    console.log('Re-run after the next MLB slate settlement window.');
    process.exit(0);
  }

  const pickIds = picks.map(p => p.id);

  // 2. Find settlement records for these picks
  const { data: settlements, error: settleErr } = await db
    .from('settlement_records')
    .select('id, pick_id, settled_at, payload')
    .in('pick_id', pickIds);

  if (settleErr) {
    console.error('Failed to query settlement_records:', settleErr.message);
    process.exit(1);
  }

  const settledRows = (settlements ?? []) as SettlementRow[];
  const settledPickIds = new Set(settledRows.map(s => s.pick_id));

  const totalSettled = settledRows.length;
  const clvBackedRows = settledRows.filter(s => isClvBacked(s.payload));
  const clvBackedCount = clvBackedRows.length;

  // 3. Provenance coverage on post-fix picks
  const withProvenance = picks.filter(p => hasProvenance(p.metadata));
  const bySource = picks.reduce<Record<string, number>>((acc, p) => {
    const src = p.source ?? 'unknown';
    acc[src] = (acc[src] ?? 0) + 1;
    return acc;
  }, {});

  console.log('');
  console.log('--- Post-fix MLB pick breakdown ---');
  console.log(`Total post-fix MLB picks:           ${picks.length}`);
  console.log(`  With provenance (muId/scId):      ${withProvenance.length} (${pct(withProvenance.length, picks.length)})`);
  Object.entries(bySource).forEach(([src, n]) => {
    console.log(`  Source "${src}":                   ${n}`);
  });

  console.log('');
  console.log('--- Settlement breakdown ---');
  console.log(`Post-fix MLB picks settled:         ${settledPickIds.size}`);
  console.log(`Settlement records total:           ${totalSettled}`);
  console.log(`CLV-backed settlement records:      ${clvBackedCount}`);

  if (clvBackedCount > 0) {
    console.log('');
    console.log('CLV-backed sample (first 5):');
    for (const s of clvBackedRows.slice(0, 5)) {
      const p = s.payload ?? {};
      console.log(`  pick=${s.pick_id.slice(0, 8)} clvPercent=${p['clvPercent'] ?? 'n/a'} beatsClose=${p['beatsClosingLine'] ?? 'n/a'}`);
    }
  }

  console.log('');
  console.log('=== GATE RESULT ===');

  const pass = clvBackedCount >= GATE_THRESHOLD;

  if (pass) {
    console.log(`PASS  clvBackedOutcomeCount = ${clvBackedCount} >= ${GATE_THRESHOLD}`);
    console.log('UTV2-433 MLB CLV gate: PASS — sufficient CLV-backed post-fix outcomes.');
  } else {
    console.log(`FAIL  clvBackedOutcomeCount = ${clvBackedCount} < ${GATE_THRESHOLD}`);
    console.log(`Need ${GATE_THRESHOLD - clvBackedCount} more CLV-backed outcomes from post-fix MLB picks.`);

    if (settledPickIds.size === 0) {
      console.log('Root cause: Post-fix MLB picks have not settled yet. Wait for next MLB slate.');
    } else if (withProvenance.length === 0) {
      console.log('Root cause: Post-fix MLB picks are not carrying provenance (marketUniverseId/scoredCandidateId).');
      console.log('Check whether UTV2-754 fix is deployed to the running API instance.');
    } else {
      console.log('Root cause: Picks have provenance but settlements are not computing CLV.');
      console.log('Check clv-service and settlement worker logs.');
    }
  }

  process.exit(pass ? 0 : 1);
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

main().catch((err: unknown) => {
  console.error('Script error:', err);
  process.exit(1);
});
