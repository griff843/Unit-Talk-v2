/**
 * Provider Quality Review — UTV2-628
 *
 * Queries settlement_records + provider_offers to build ProviderExecutionRecord[]
 * and prints a trust-score table sorted by ascending trust score.
 *
 * Usage:
 *   npx tsx scripts/ops/provider-quality-review.ts [--json]
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';
import {
  computeProviderQualitySummary,
  providerTrustMultiplier,
  type ProviderExecutionRecord,
} from '../../packages/domain/src/execution-quality/provider-quality.js';

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

async function main(): Promise<void> {
  // ── 1. Pull settled picks with CLV data ──────────────────────────────────
  const { data: settlements, error: settleErr } = await db
    .from('settlement_records')
    .select(
      'pick_id, outcome, clv_percent, clv_status, is_opening_line_fallback, settled_at',
    )
    .order('settled_at', { ascending: false })
    .limit(2000);

  if (settleErr) {
    console.error('ERROR fetching settlement_records:', settleErr.message);
    process.exit(1);
  }

  if (!settlements || settlements.length === 0) {
    console.log('No settlement records found.');
    return;
  }

  const pickIds = settlements.map(s => s.pick_id as string).filter(Boolean);

  // ── 2. Pull picks for provider + sport + market_family ───────────────────
  const { data: picks, error: pickErr } = await db
    .from('picks')
    .select('id, sport, market, market_family, odds, created_at')
    .in('id', pickIds);

  if (pickErr) {
    console.error('ERROR fetching picks:', pickErr.message);
    process.exit(1);
  }

  // ── 3. Pull provider_offers to get provider + line age ───────────────────
  // Match by pick_id (provider_offers may store it or join via canonical_market_key)
  // We join via pick_id using the canonical association stored in provider_offers.
  const { data: offers, error: offerErr } = await db
    .from('provider_offers')
    .select(
      'pick_id, provider_key, is_closing, captured_at, offered_at',
    )
    .in('pick_id', pickIds);

  if (offerErr) {
    console.error('ERROR fetching provider_offers:', offerErr.message);
    process.exit(1);
  }

  // ── 4. Build lookup maps ─────────────────────────────────────────────────
  const pickById = new Map(
    (picks ?? []).map(p => [p.id as string, p]),
  );

  // One offer per pick (take the first match)
  const offerByPickId = new Map(
    (offers ?? []).map(o => [o.pick_id as string, o]),
  );

  // ── 5. Assemble ProviderExecutionRecord[] ────────────────────────────────
  const records: ProviderExecutionRecord[] = [];

  for (const settlement of settlements) {
    const pickId = settlement.pick_id as string;
    const pick = pickById.get(pickId);
    const offer = offerByPickId.get(pickId);

    if (!pick || !offer) continue;

    const capturedAt = (offer.captured_at ?? pick.created_at) as string;
    const offeredAt = (offer.offered_at ?? capturedAt) as string;
    const lineAgeAtCapture = Math.max(
      0,
      (new Date(capturedAt).getTime() - new Date(offeredAt).getTime()) / 1000,
    );

    records.push({
      provider: (offer.provider_key as string) ?? 'unknown',
      marketFamily: (pick.market_family as string) ?? (pick.market as string) ?? 'unknown',
      sport: (pick.sport as string) ?? 'unknown',
      lineAgeAtCapture,
      wasClosingLine: Boolean(offer.is_closing),
      clvPercent: settlement.clv_percent as number | null,
      edgeAtCapture: null, // not available at query time
      capturedAt,
    });
  }

  if (records.length === 0) {
    console.log('No records could be assembled — check provider_offers pick_id linkage.');
    return;
  }

  // ── 6. Compute summaries ─────────────────────────────────────────────────
  const summaries = computeProviderQualitySummary(records);

  // Sort ascending by trust score (lowest trust first — most actionable)
  summaries.sort((a, b) => a.trustScore - b.trustScore);

  if (jsonMode) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2));
    return;
  }

  // ── 7. Print table ───────────────────────────────────────────────────────
  console.log(`\nProvider Execution Quality — ${new Date().toISOString()}`);
  console.log(`Records assembled: ${records.length} | Summaries: ${summaries.length}\n`);

  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const pct = (v: number | null) => (v == null ? '  n/a  ' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  const f2 = (v: number) => v.toFixed(2);

  const header = [
    pad('provider', 14),
    pad('sport', 6),
    pad('family', 14),
    pad('n', 5),
    pad('age(s)', 7),
    pad('cov%', 6),
    pad('avgCLV', 8),
    pad('posClv%', 8),
    pad('trust', 6),
    pad('alert', 9),
    pad('mult', 5),
  ].join(' ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const s of summaries) {
    const mult = providerTrustMultiplier(s);
    const row = [
      pad(s.provider, 14),
      pad(s.sport, 6),
      pad(s.marketFamily, 14),
      pad(String(s.sampleSize), 5),
      pad(s.avgLineAgeSeconds.toFixed(0), 7),
      pad(`${(s.closingLineCoverageRate * 100).toFixed(0)}%`, 6),
      pad(pct(s.avgClvPercent), 8),
      pad(s.positiveCLVRate != null ? `${(s.positiveCLVRate * 100).toFixed(0)}%` : 'n/a', 8),
      pad(f2(s.trustScore), 6),
      pad(s.alertLevel, 9),
      pad(String(mult), 5),
    ].join(' ');
    console.log(row);
  }

  const degraded = summaries.filter(s => s.alertLevel === 'degraded').length;
  const warning = summaries.filter(s => s.alertLevel === 'warning').length;
  console.log(`\nAlert summary: ${degraded} degraded, ${warning} warning, ${summaries.length - degraded - warning} green`);
}

main().catch(e => {
  console.error(String(e));
  process.exit(1);
});
