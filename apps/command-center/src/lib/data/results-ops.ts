// Results / settlement ops data module.
// Reads settlement_records, picks_current_state (posted-stuck detection),
// and game_results (freshness). Columns verified against
// packages/db/src/database.types.ts.

import { getDataClient } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface SettlementOpsRow {
  id: string;
  pickId: string;
  status: string;
  result: string | null;
  source: string;
  confidence: string;
  reviewReason: string | null;
  settledBy: string | null;
  correctsId: string | null;
  settledAt: string;
  createdAt: string;
}

export interface StuckPostedPick {
  id: string;
  market: string | null;
  selection: string | null;
  sportDisplayName: string | null;
  postedAt: string | null;
  createdAt: string | null;
  ageHours: number;
}

export interface ResultsOpsSnapshot {
  counts: {
    settled24h: number;
    manualReviewOpen: number;
    corrections: number;
    stuckPosted: number;
  };
  recentSettlements: SettlementOpsRow[];
  manualReview: SettlementOpsRow[];
  corrections: SettlementOpsRow[];
  stuckPosted: StuckPostedPick[];
  gameResults: {
    latestSourcedAt: string | null;
    count24h: number;
  };
}

function mapSettlementRow(row: Record<string, unknown>): SettlementOpsRow {
  return {
    id: String(row['id'] ?? ''),
    pickId: String(row['pick_id'] ?? ''),
    status: String(row['status'] ?? ''),
    result: typeof row['result'] === 'string' ? row['result'] : null,
    source: String(row['source'] ?? ''),
    confidence: String(row['confidence'] ?? ''),
    reviewReason: typeof row['review_reason'] === 'string' ? row['review_reason'] : null,
    settledBy: typeof row['settled_by'] === 'string' ? row['settled_by'] : null,
    correctsId: typeof row['corrects_id'] === 'string' ? row['corrects_id'] : null,
    settledAt: String(row['settled_at'] ?? ''),
    createdAt: String(row['created_at'] ?? ''),
  };
}

export async function getResultsOpsSnapshot(): Promise<ResultsOpsSnapshot> {
  const client: Client = getDataClient();
  const nowMs = Date.now();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  const settlementColumns =
    'id, pick_id, status, result, source, confidence, review_reason, settled_by, corrects_id, settled_at, created_at';

  const [recentResult, manualResult, correctionsResult, settled24hResult, stuckResult, gameLatestResult, game24hResult] =
    await Promise.all([
      client.from('settlement_records').select(settlementColumns).order('settled_at', { ascending: false }).limit(50),
      client
        .from('settlement_records')
        .select(settlementColumns)
        .eq('status', 'manual_review')
        .order('created_at', { ascending: false })
        .limit(50),
      client
        .from('settlement_records')
        .select(settlementColumns)
        .not('corrects_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50),
      client
        .from('settlement_records')
        .select('id', { count: 'exact', head: true })
        .gte('settled_at', dayAgo),
      // Picks still lifecycle "posted" more than 24h after posting — age-based
      // proxy for "event started but never settled".
      // TODO(data-contract): join events (via pick metadata eventId) so stuck
      // detection keys off actual event start time rather than posted age.
      client
        .from('picks_current_state')
        .select('id, market, selection, sport_display_name, posted_at, created_at')
        .eq('status', 'posted')
        .lte('created_at', dayAgo)
        .order('created_at', { ascending: true })
        .limit(50),
      client.from('game_results').select('sourced_at').order('sourced_at', { ascending: false }).limit(1),
      client.from('game_results').select('id', { count: 'exact', head: true }).gte('sourced_at', dayAgo),
    ]);

  for (const result of [recentResult, manualResult, correctionsResult, stuckResult, gameLatestResult]) {
    if (result.error) throw result.error;
  }

  const manualReview = ((manualResult.data ?? []) as Array<Record<string, unknown>>).map(mapSettlementRow);
  const corrections = ((correctionsResult.data ?? []) as Array<Record<string, unknown>>).map(mapSettlementRow);

  const stuckPosted: StuckPostedPick[] = ((stuckResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const createdAt = typeof row['created_at'] === 'string' ? row['created_at'] : null;
    return {
      id: String(row['id'] ?? ''),
      market: typeof row['market'] === 'string' ? row['market'] : null,
      selection: typeof row['selection'] === 'string' ? row['selection'] : null,
      sportDisplayName: typeof row['sport_display_name'] === 'string' ? row['sport_display_name'] : null,
      postedAt: typeof row['posted_at'] === 'string' ? row['posted_at'] : null,
      createdAt,
      ageHours: createdAt ? Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 3_600_000)) : 0,
    };
  });

  const latestGameRow = ((gameLatestResult.data ?? []) as Array<Record<string, unknown>>)[0];

  return {
    counts: {
      settled24h: settled24hResult.count ?? 0,
      manualReviewOpen: manualReview.length,
      corrections: corrections.length,
      stuckPosted: stuckPosted.length,
    },
    recentSettlements: ((recentResult.data ?? []) as Array<Record<string, unknown>>).map(mapSettlementRow),
    manualReview,
    corrections,
    stuckPosted,
    gameResults: {
      latestSourcedAt: typeof latestGameRow?.['sourced_at'] === 'string' ? latestGameRow['sourced_at'] : null,
      count24h: game24hResult.count ?? 0,
    },
  };
}
