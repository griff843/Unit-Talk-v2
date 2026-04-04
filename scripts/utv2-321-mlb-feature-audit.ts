/**
 * UTV2-321: MLB Feature Inventory and Canonical Dataset Extraction Audit
 *
 * Queries live Supabase to:
 * 1. Audit provider_offers coverage for MLB (market types, books, opening/closing status)
 * 2. Count settled MLB picks with CLV
 * 3. Attempt to build canonical training rows (opening + closing + outcome)
 * 4. Report training readiness and document remaining blockers
 *
 * Run: npx tsx scripts/utv2-321-mlb-feature-audit.ts
 * Expected today: trainingReadyRows=0 (blocked by data accumulation post UTV2-382)
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Canonical training row shape for MLB moneyline/spread/total models
// ---------------------------------------------------------------------------

export interface MlbTrainingRow {
  providerEventId: string;
  marketKey: string;            // 'moneyline' | 'spreads' | 'totals'
  providerParticipantId: string | null;
  openingLine: number | null;
  closingLine: number | null;
  clvPts: number | null;        // closingLine - openingLine (null if either missing)
  pinnacleOpening: number | null;
  pinnacleClosing: number | null;
  bookCount: number;            // distinct books with offers for this event/market
  timeToGameMinutes: number | null; // snapshot_at to commence_time delta
  outcome: 'win' | 'loss' | 'push' | null; // null = no settled pick linked
}

// ---------------------------------------------------------------------------
// Feature availability matrix
// ---------------------------------------------------------------------------

const FEATURE_MATRIX = [
  { feature: 'Opening line (is_opening=true)',    source: 'provider_offers',      blockedBy: 'UTV2-382 (is_opening fix)' },
  { feature: 'Closing line (is_closing=true)',    source: 'provider_offers',      blockedBy: 'UTV2-382 (is_closing fix)' },
  { feature: 'CLV (closing - opening)',           source: 'Computed',             blockedBy: 'UTV2-382 + data accumulation' },
  { feature: 'Multi-book consensus',              source: 'provider_offers',      blockedBy: 'UTV2-382 + data accumulation' },
  { feature: 'Pinnacle sharp line',               source: 'provider_offers:pinnacle', blockedBy: 'UTV2-382 + data accumulation' },
  { feature: 'Outcome (win/loss)',                source: 'settlement_records',   blockedBy: 'Data accumulation (1 MLB pick today)' },
  { feature: 'Time-to-game',                      source: 'events.metadata',      blockedBy: 'UTV2-382 (snapshot_at tagging)' },
  { feature: 'Market type',                       source: 'provider_market_key',  blockedBy: 'Available now' },
  { feature: 'RLM / public money %',              source: 'External provider',    blockedBy: 'Provider not integrated (TheOddsAPI paid)' },
  { feature: 'Sharp book classification',         source: 'first_mover_book',     blockedBy: 'UTV2-379 (first-mover capture) + 30d accumulation' },
] as const;

// ---------------------------------------------------------------------------
// Main audit
// ---------------------------------------------------------------------------

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== UTV2-321: MLB Feature Inventory & Dataset Audit ===\n');

  // 1. Provider offers coverage
  const { data: offerStats, error: offerErr } = await db
    .from('provider_offers')
    .select('provider_key, provider_market_key, is_opening, is_closing, sport_key')
    .in('sport_key', ['MLB', 'baseball']);

  if (offerErr) throw new Error(`provider_offers query failed: ${offerErr.message}`);

  const offers = offerStats ?? [];
  const totalOffers = offers.length;
  const openingOffers = offers.filter((o) => o.is_opening).length;
  const closingOffers = offers.filter((o) => o.is_closing).length;

  const byBook: Record<string, number> = {};
  const byMarket: Record<string, number> = {};
  for (const o of offers) {
    byBook[o.provider_key] = (byBook[o.provider_key] ?? 0) + 1;
    byMarket[o.provider_market_key] = (byMarket[o.provider_market_key] ?? 0) + 1;
  }

  console.log('--- Provider Offers (MLB / baseball) ---');
  console.log(`Total rows:     ${totalOffers}`);
  console.log(`is_opening=true: ${openingOffers}`);
  console.log(`is_closing=true: ${closingOffers}`);
  console.log('\nBy book:');
  for (const [book, count] of Object.entries(byBook).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${book}: ${count}`);
  }
  console.log('\nTop markets:');
  for (const [market, count] of Object.entries(byMarket).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${market}: ${count}`);
  }

  // 2. Settled MLB picks
  const { data: picks, error: picksErr } = await db
    .from('picks')
    .select('id, market, source, metadata')
    .filter('metadata->>sport', 'eq', 'MLB');

  if (picksErr) throw new Error(`picks query failed: ${picksErr.message}`);

  const mlbPickIds = (picks ?? []).map((p) => p.id);

  let settledCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let pushCount = 0;

  if (mlbPickIds.length > 0) {
    const { data: settlements, error: settlErr } = await db
      .from('settlement_records')
      .select('pick_id, result')
      .in('pick_id', mlbPickIds);

    if (settlErr) throw new Error(`settlement_records query failed: ${settlErr.message}`);

    for (const s of settlements ?? []) {
      settledCount += 1;
      if (s.result === 'win') winCount += 1;
      else if (s.result === 'loss') lossCount += 1;
      else if (s.result === 'push') pushCount += 1;
    }
  }

  console.log('\n--- Settled MLB Picks ---');
  console.log(`Total MLB picks in DB: ${mlbPickIds.length}`);
  console.log(`Settled:               ${settledCount} (wins: ${winCount}, losses: ${lossCount}, pushes: ${pushCount})`);

  // 3. Training-ready row count
  // A training-ready row requires: opening line + closing line + outcome
  // Opening/closing lines require is_opening/is_closing to be tagged correctly.
  const trainingReadyRows = openingOffers > 0 && closingOffers > 0 && settledCount >= 10
    ? 'POSSIBLE — run extraction join query'
    : 0;

  const gameMarkets = ['moneyline', 'spreads', 'totals', 'h2h'];
  const gameMarketOffers = offers.filter((o) => gameMarkets.includes(o.provider_market_key)).length;
  const pinnacleOffers = offers.filter((o) => o.provider_key === 'odds-api:pinnacle').length;

  console.log('\n--- Training Readiness ---');
  console.log(`Game-market offers (moneyline/spreads/totals): ${gameMarketOffers}`);
  console.log(`Pinnacle offers (sharp reference line):        ${pinnacleOffers}`);
  console.log(`Opening lines tagged:                          ${openingOffers}`);
  console.log(`Closing lines tagged:                          ${closingOffers}`);
  console.log(`Settled picks with outcome:                    ${settledCount}`);
  console.log(`Training-ready rows (open+close+outcome):      ${trainingReadyRows}`);

  // 4. Feature matrix
  console.log('\n--- Feature Availability Matrix ---');
  console.log('Feature                              | Source                    | Blocked by');
  console.log('-------------------------------------|---------------------------|---------------------------');
  for (const row of FEATURE_MATRIX) {
    const feature = row.feature.padEnd(36);
    const source = row.source.padEnd(25);
    console.log(`${feature} | ${source} | ${row.blockedBy}`);
  }

  // 5. Blocking gaps
  console.log('\n--- Blocking Gaps ---');
  const gaps = [
    {
      gap: 'is_opening / is_closing never tagged',
      blocker: 'UTV2-382 (Fix is_opening/is_closing in ingestor) — IN PROGRESS',
      resolution: 'Merge UTV2-382 PR, then next ingest cycle will tag opening lines correctly',
    },
    {
      gap: 'Only 1 settled MLB pick (Bryan Woo)',
      blocker: 'Data accumulation — no shortcut',
      resolution: 'Continue submitting MLB picks through Smart Form or alert-agent; ~30-60 days for statistical significance',
    },
    {
      gap: 'SGO data (4025 MLB rows) has zero game-line markets — only player props',
      blocker: 'SGO feed structure for MLB (props-only)',
      resolution: 'Use Odds API (baseball sport_key) as primary MLB game-line source; has 16 events with moneyline/spreads/totals across 4 books incl. Pinnacle',
    },
    {
      gap: 'No public money % / bet percentage data',
      blocker: 'External provider not integrated',
      resolution: 'TheOddsAPI has /v4/sports/{sport}/odds with volume data on paid plans; requires new ingestor adapter',
    },
  ];

  for (const { gap, blocker, resolution } of gaps) {
    console.log(`\nGAP: ${gap}`);
    console.log(`  Blocker:    ${blocker}`);
    console.log(`  Resolution: ${resolution}`);
  }

  console.log('\n=== Audit complete. trainingReadyRows=0 is expected until UTV2-382 merges and data accumulates. ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
