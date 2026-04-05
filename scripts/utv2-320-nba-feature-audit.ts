/**
 * UTV2-320: NBA Feature Inventory, Dataset Proof, and Baseline Readiness Audit
 *
 * Queries live Supabase to:
 * 1. Audit provider_offers coverage for NBA game markets and player props
 * 2. Count settled NBA picks and current scoring/intelligence benchmark evidence
 * 3. Attempt canonical training-row extraction for game markets
 * 4. Recommend the first realistic baseline-model slice
 *
 * Run: pnpm exec tsx scripts/utv2-320-nba-feature-audit.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

interface NbaTrainingRow {
  providerEventId: string;
  marketKey: string;
  providerParticipantId: string | null;
  openingLine: number | null;
  closingLine: number | null;
  clvPts: number | null;
  pinnacleOpening: number | null;
  pinnacleClosing: number | null;
  bookCount: number;
  timeToGameMinutes: number | null;
  outcome: 'win' | 'loss' | 'push' | null;
}

type ProviderOfferAuditRow = {
  provider_key: string;
  provider_market_key: string;
  provider_event_id: string;
  provider_participant_id: string | null;
  sport_key: string;
  bookmaker_key: string | null;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  snapshot_at: string | null;
  is_opening: boolean | null;
  is_closing: boolean | null;
};

type PickAuditRow = {
  id: string;
  market: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

type SettlementAuditRow = {
  pick_id: string;
  result: 'win' | 'loss' | 'push' | null;
};

const GAME_MARKET_KEYS = new Set(['h2h', 'spreads', 'totals']);
const SHARP_BOOKS = new Set(['pinnacle', 'circa']);

function readNestedString(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNestedNumber(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function computeMinutesBeforeGame(snapshotAt: string | null, commenceTime: string | null) {
  if (!snapshotAt || !commenceTime) {
    return null;
  }

  const snapshot = Date.parse(snapshotAt);
  const commence = Date.parse(commenceTime);
  if (Number.isNaN(snapshot) || Number.isNaN(commence)) {
    return null;
  }

  return Math.round((commence - snapshot) / 60000);
}

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== UTV2-320: NBA Feature Inventory & Dataset Audit ===\n');

  const { data: offerRows, error: offerError } = await db
    .from('provider_offers')
    .select(
      'provider_key,provider_market_key,provider_event_id,provider_participant_id,sport_key,bookmaker_key,line,over_odds,under_odds,snapshot_at,is_opening,is_closing',
    )
    .eq('sport_key', 'NBA');

  if (offerError) {
    throw new Error(`provider_offers query failed: ${offerError.message}`);
  }

  const offers = (offerRows ?? []) as ProviderOfferAuditRow[];
  const totalOffers = offers.length;
  const openingOffers = offers.filter((offer) => offer.is_opening).length;
  const closingOffers = offers.filter((offer) => offer.is_closing).length;
  const gameMarketOffers = offers.filter((offer) => GAME_MARKET_KEYS.has(offer.provider_market_key)).length;
  const playerPropOffers = totalOffers - gameMarketOffers;
  const sharpOffers = offers.filter((offer) => SHARP_BOOKS.has((offer.bookmaker_key ?? '').toLowerCase())).length;

  const byBook = new Map<string, number>();
  const byMarket = new Map<string, number>();
  for (const offer of offers) {
    byBook.set(offer.bookmaker_key ?? offer.provider_key, (byBook.get(offer.bookmaker_key ?? offer.provider_key) ?? 0) + 1);
    byMarket.set(offer.provider_market_key, (byMarket.get(offer.provider_market_key) ?? 0) + 1);
  }

  console.log('--- Provider Offers (NBA) ---');
  console.log(`Total rows:              ${totalOffers}`);
  console.log(`Game-market rows:        ${gameMarketOffers}`);
  console.log(`Player-prop rows:        ${playerPropOffers}`);
  console.log(`is_opening=true:         ${openingOffers}`);
  console.log(`is_closing=true:         ${closingOffers}`);
  console.log(`Sharp-book rows:         ${sharpOffers}`);
  console.log('\nBy book:');
  for (const [book, count] of [...byBook.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8)) {
    console.log(`  ${book}: ${count}`);
  }
  console.log('\nTop markets:');
  for (const [market, count] of [...byMarket.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10)) {
    console.log(`  ${market}: ${count}`);
  }

  const { data: picksRows, error: picksError } = await db
    .from('picks')
    .select('id,market,status,metadata')
    .filter('metadata->>sport', 'eq', 'NBA');

  if (picksError) {
    throw new Error(`picks query failed: ${picksError.message}`);
  }

  const picks = (picksRows ?? []) as PickAuditRow[];
  const pickIds = picks.map((pick) => pick.id);

  let settlements: SettlementAuditRow[] = [];
  if (pickIds.length > 0) {
    const { data: settlementRows, error: settlementError } = await db
      .from('settlement_records')
      .select('pick_id,result')
      .in('pick_id', pickIds);

    if (settlementError) {
      throw new Error(`settlement_records query failed: ${settlementError.message}`);
    }

    settlements = (settlementRows ?? []) as SettlementAuditRow[];
  }

  const settledCount = settlements.length;
  const winCount = settlements.filter((row) => row.result === 'win').length;
  const lossCount = settlements.filter((row) => row.result === 'loss').length;
  const pushCount = settlements.filter((row) => row.result === 'push').length;

  const scoreBearingPicks = picks.filter((pick) => {
    const metadata = pick.metadata ?? {};
    return Boolean(
      (metadata.promotionScores && typeof metadata.promotionScores === 'object') ||
      (metadata.domainAnalysis && typeof metadata.domainAnalysis === 'object'),
    );
  }).length;

  const clvBearingPicks = picks.filter((pick) => {
    const metadata = pick.metadata ?? {};
    return Boolean(readNestedNumber(metadata, 'clvPercent') ?? readNestedNumber(metadata, 'clvRaw'));
  }).length;

  console.log('\n--- Settled NBA Picks ---');
  console.log(`Total NBA picks in DB:   ${pickIds.length}`);
  console.log(`Settled:                 ${settledCount} (wins: ${winCount}, losses: ${lossCount}, pushes: ${pushCount})`);
  console.log(`Score-bearing picks:     ${scoreBearingPicks}`);
  console.log(`CLV-bearing picks:       ${clvBearingPicks}`);

  const { data: eventsRows, error: eventsError } = await db
    .from('events')
    .select('external_id,metadata')
    .eq('sport_id', 'NBA');

  if (eventsError) {
    throw new Error(`events query failed: ${eventsError.message}`);
  }

  const commenceByProviderEventId = new Map<string, string | null>();
  for (const row of eventsRows ?? []) {
    const externalId = typeof row.external_id === 'string' ? row.external_id : null;
    if (!externalId) {
      continue;
    }
    const metadata = (row.metadata ?? null) as Record<string, unknown> | null;
    const commenceTime =
      readNestedString(metadata, 'starts_at') ??
      readNestedString(metadata, 'commence_time') ??
      readNestedString(metadata, 'start_time');
    commenceByProviderEventId.set(externalId, commenceTime);
  }

  const groupedGameMarkets = new Map<string, ProviderOfferAuditRow[]>();
  for (const offer of offers) {
    if (!GAME_MARKET_KEYS.has(offer.provider_market_key)) {
      continue;
    }
    const key = [
      offer.provider_event_id,
      offer.provider_market_key,
      offer.provider_participant_id ?? 'all',
    ].join('|');
    const existing = groupedGameMarkets.get(key) ?? [];
    existing.push(offer);
    groupedGameMarkets.set(key, existing);
  }

  const trainingRows: NbaTrainingRow[] = [];
  for (const [groupKey, rows] of groupedGameMarkets.entries()) {
    const [providerEventId, marketKey, providerParticipantId] = groupKey.split('|');
    const distinctBooks = new Set(rows.map((row) => row.bookmaker_key ?? row.provider_key));
    const openingRow = rows.find((row) => row.is_opening) ?? null;
    const closingRow = rows.find((row) => row.is_closing) ?? null;
    const sharpRows = rows.filter((row) => SHARP_BOOKS.has((row.bookmaker_key ?? '').toLowerCase()));
    const sharpOpening = sharpRows.find((row) => row.is_opening) ?? null;
    const sharpClosing = sharpRows.find((row) => row.is_closing) ?? null;

    trainingRows.push({
      providerEventId,
      marketKey,
      providerParticipantId: providerParticipantId === 'all' ? null : providerParticipantId,
      openingLine: openingRow?.line ?? null,
      closingLine: closingRow?.line ?? null,
      clvPts:
        openingRow?.line != null && closingRow?.line != null
          ? closingRow.line - openingRow.line
          : null,
      pinnacleOpening: sharpOpening?.line ?? null,
      pinnacleClosing: sharpClosing?.line ?? null,
      bookCount: distinctBooks.size,
      timeToGameMinutes: computeMinutesBeforeGame(
        openingRow?.snapshot_at ?? closingRow?.snapshot_at ?? null,
        commenceByProviderEventId.get(providerEventId) ?? null,
      ),
      outcome: null,
    });
  }

  const rowsWithOpeningAndClosing = trainingRows.filter(
    (row) => row.openingLine != null && row.closingLine != null,
  ).length;
  const rowsWithSharpReference = trainingRows.filter(
    (row) => row.pinnacleOpening != null || row.pinnacleClosing != null,
  ).length;
  const rowsWithThreeBooks = trainingRows.filter((row) => row.bookCount >= 3).length;

  console.log('\n--- Training Row Extraction ---');
  console.log(`Game-market groups:      ${trainingRows.length}`);
  console.log(`Rows with open+close:    ${rowsWithOpeningAndClosing}`);
  console.log(`Rows with sharp line:    ${rowsWithSharpReference}`);
  console.log(`Rows with 3+ books:      ${rowsWithThreeBooks}`);

  const baselineRecommendation = (() => {
    if (rowsWithOpeningAndClosing >= 100 && settledCount >= 30) {
      return 'Baseline model v1 is realistic now. Start with NBA moneyline/spread logistic baseline, benchmark against current scoring.';
    }
    if (gameMarketOffers > 0 && settledCount < 30) {
      return 'Dataset plumbing is viable, but statistical validation is still sample-limited. Build extraction + benchmark harness first, not a promoted model.';
    }
    return 'Do not force a trained NBA baseline yet. Finish dataset plumbing and accumulate settled evidence before claiming readiness.';
  })();

  const firstSliceRecommendation = gameMarketOffers > 0
    ? 'NBA moneyline/spread baseline'
    : 'NBA player-prop feature inventory only';

  console.log('\n--- Baseline Recommendation ---');
  console.log(`First realistic slice:   ${firstSliceRecommendation}`);
  console.log(`Recommendation:          ${baselineRecommendation}`);

  console.log('\n--- Blocking Gaps ---');
  const gaps = [
    {
      gap: openingOffers === 0 || closingOffers === 0
        ? 'Opening / closing tags are still absent in live NBA offer rows'
        : 'Opening / closing tags present',
      resolution: openingOffers === 0 || closingOffers === 0
        ? 'Wait for fresh post-UTV2-382 ingest cycles to accumulate tagged NBA rows.'
        : 'No blocker on tag presence.',
    },
    {
      gap: settledCount < 30
        ? `Only ${settledCount} settled NBA picks available for benchmark/proof`
        : 'Settled NBA sample is large enough for first benchmark pass',
      resolution: settledCount < 30
        ? 'Continue runtime burn-in and alert/system submissions to accumulate NBA truth.'
        : 'Proceed with benchmark baseline against scoring/intelligence.',
    },
    {
      gap: rowsWithSharpReference === 0
        ? 'No Pinnacle/Circa sharp reference rows in extractable game-market sample'
        : 'Sharp-book reference rows present',
      resolution: rowsWithSharpReference === 0
        ? 'Use multi-book consensus as interim benchmark, but note sharp-reference weakness explicitly.'
        : 'Sharp-book line available for evaluation.',
    },
  ];

  for (const { gap, resolution } of gaps) {
    console.log(`\nGAP: ${gap}`);
    console.log(`  Resolution: ${resolution}`);
  }

  console.log('\n=== Audit complete. Use this output to decide whether UTV2-320 should proceed as extraction/benchmark first or full baseline model build. ===');
}

main().catch((error) => {
  console.error('Audit failed:', error);
  process.exit(1);
});
