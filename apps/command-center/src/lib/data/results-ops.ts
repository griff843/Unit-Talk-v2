// Results / settlement ops data module.
// Reads settlement_records, picks_current_state (posted-stuck detection),
// and game_results (freshness). Columns verified against
// packages/db/src/database.types.ts.

import { getDataClient } from './client';
import { readAuthoritativeCount } from '../query-result';

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
  /**
   * CLV fields unpacked from settlement_records.payload. All are null today —
   * closing-line capture depends on a provider that is deliberately off — and the
   * surface renders that absence explicitly rather than as a dash.
   */
  clvPercent: number | null;
  beatsClosingLine: boolean | null;
  isOpeningLineFallback: boolean | null;
  clvStatus: string | null;
  clvUnavailableReason: string | null;
}

export interface StuckPostedPick {
  id: string;
  market: string | null;
  selection: string | null;
  sportDisplayName: string | null;
  postedAt: string | null;
  createdAt: string | null;
  ageHours: number | null;
}

/**
 * UTV2-1939: a delivered human-capper pick whose result is not in yet.
 *
 * This is deliberately NOT the "stuck posted" list. That one keys off a 24h age
 * proxy, so a pick delivered today whose game finishes tonight appears in it
 * only tomorrow -- and by then the recap window has passed. Until this list
 * existed the only route to such a pick was hand-constructing
 * `/settlement?pickId=<uuid>` from a database read, which is exactly the
 * per-submission engineering intervention Milestone 2 condition 1 forbids.
 *
 * The predicate is positive identification, never absence: a pick is here
 * because it carries an `authorized` server delivery authorization, not because
 * it merely lacks something.
 */
export interface DeliveredAwaitingSettlementRow {
  id: string;
  capperId: string | null;
  market: string | null;
  selection: string | null;
  odds: number | null;
  stakeUnits: number | null;
  sportDisplayName: string | null;
  postedAt: string | null;
}

export interface ResultsOpsSnapshot {
  counts: {
    settled24h: number;
    manualReviewOpen: number;
    corrections: number;
    stuckPosted: number;
    deliveredAwaitingSettlement: number;
  };
  deliveredAwaitingSettlement: DeliveredAwaitingSettlementRow[];
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
    ...readClvFields(row['payload']),
  };
}

function readClvFields(payload: unknown): Pick<
  SettlementOpsRow,
  'clvPercent' | 'beatsClosingLine' | 'isOpeningLineFallback' | 'clvStatus' | 'clvUnavailableReason'
> {
  const p =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const boolOrNull = (v: unknown) => (typeof v === 'boolean' ? v : null);
  const strOrNull = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

  return {
    clvPercent: numOrNull(p['clvPercent']),
    beatsClosingLine: boolOrNull(p['beatsClosingLine']),
    isOpeningLineFallback: boolOrNull(p['isOpeningLineFallback']),
    clvStatus: strOrNull(p['clvStatus']),
    clvUnavailableReason: strOrNull(p['clvUnavailableReason']),
  };
}

export async function getResultsOpsSnapshot(): Promise<ResultsOpsSnapshot> {
  const client: Client = await getDataClient();
  const nowMs = Date.now();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  const settlementColumns =
    'id, pick_id, status, result, source, confidence, review_reason, settled_by, corrects_id, settled_at, created_at, payload';

  const [
    recentResult,
    manualResult,
    manualCountResult,
    correctionsResult,
    correctionsCountResult,
    settled24hResult,
    stuckResult,
    stuckCountResult,
    deliveredAwaitingResult,
    gameLatestResult,
    game24hResult,
  ] =
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
        .select('id', { count: 'exact', head: true })
        .eq('status', 'manual_review'),
      client
        .from('settlement_records')
        .select(settlementColumns)
        .not('corrects_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50),
      client
        .from('settlement_records')
        .select('id', { count: 'exact', head: true })
        .not('corrects_id', 'is', null),
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
      client
        .from('picks_current_state')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'posted')
        .lte('created_at', dayAgo),
      // UTV2-1939: delivered human-capper picks awaiting their result.
      // Predicate validated against production 2026-09-18 -- returns exactly the
      // one live delivered pick and nothing else. No age filter: the 24h delay
      // on `stuckPosted` above is the defect this list exists to avoid.
      client
        .from('picks_current_state')
        .select('id, capper_id, market, selection, odds, stake_units, sport_display_name, posted_at')
        .eq('status', 'posted')
        .is('settlement_recorded_at', null)
        .eq('metadata->deliveryAuthorization->>decision', 'authorized')
        .order('posted_at', { ascending: true })
        .limit(50),
      client.from('game_results').select('sourced_at').order('sourced_at', { ascending: false }).limit(1),
      client.from('game_results').select('id', { count: 'exact', head: true }).gte('sourced_at', dayAgo),
    ]);

  for (const result of [
    recentResult,
    manualResult,
    correctionsResult,
    stuckResult,
    deliveredAwaitingResult,
    gameLatestResult,
  ]) {
    if (result.error) throw result.error;
  }

  const settled24h = readAuthoritativeCount(settled24hResult, 'settled in 24h');
  const manualReviewOpen = readAuthoritativeCount(manualCountResult, 'manual review settlements');
  const correctionCount = readAuthoritativeCount(correctionsCountResult, 'settlement corrections');
  const stuckPostedCount = readAuthoritativeCount(stuckCountResult, 'stuck posted picks');
  const gameResults24h = readAuthoritativeCount(game24hResult, 'game results in 24h');

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
      ageHours: createdAt && Number.isFinite(Date.parse(createdAt))
        ? Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 3_600_000))
        : null,
    };
  });

  const deliveredAwaitingSettlement: DeliveredAwaitingSettlementRow[] = (
    (deliveredAwaitingResult.data ?? []) as Array<Record<string, unknown>>
  ).map((row) => {
    // Number(null) is 0 and 0 is finite, so a null column would render as a real
    // zero price or a real zero stake. Both are lies an operator could act on.
    const toNumber = (value: unknown): number | null => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const odds = toNumber(row['odds']);
    const stake = toNumber(row['stake_units']);
    return {
      id: String(row['id'] ?? ''),
      capperId: typeof row['capper_id'] === 'string' ? row['capper_id'] : null,
      market: typeof row['market'] === 'string' ? row['market'] : null,
      selection: typeof row['selection'] === 'string' ? row['selection'] : null,
      odds,
      stakeUnits: stake,
      sportDisplayName:
        typeof row['sport_display_name'] === 'string' ? row['sport_display_name'] : null,
      postedAt: typeof row['posted_at'] === 'string' ? row['posted_at'] : null,
    };
  });

  const latestGameRow = ((gameLatestResult.data ?? []) as Array<Record<string, unknown>>)[0];

  return {
    counts: {
      settled24h,
      manualReviewOpen,
      corrections: correctionCount,
      stuckPosted: stuckPostedCount,
      deliveredAwaitingSettlement: deliveredAwaitingSettlement.length,
    },
    deliveredAwaitingSettlement,
    recentSettlements: ((recentResult.data ?? []) as Array<Record<string, unknown>>).map(mapSettlementRow),
    manualReview,
    corrections,
    stuckPosted,
    gameResults: {
      latestSourcedAt: typeof latestGameRow?.['sourced_at'] === 'string' ? latestGameRow['sourced_at'] : null,
      count24h: gameResults24h,
    },
  };
}
