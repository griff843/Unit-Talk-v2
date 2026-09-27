// Results / settlement ops data module.
// Reads settlement_records, picks_current_state (posted-stuck detection),
// and game_results (freshness). Columns verified against
// packages/db/src/database.types.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveEffectiveSettlement,
  type SettlementInput,
} from '@unit-talk/domain';
import type { Database } from '../../../../../packages/db/src/database.types.js';
import { getDataClient } from './client';
import { applyOperatorPickPopulation } from '../governed-population';
import { assertQuerySucceeded, readAuthoritativeCount } from '../query-result';


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
  pagination: {
    settlements: SettlementPage;
    manualReview: SettlementPage;
    corrections: SettlementPage;
  };
  stuckPosted: StuckPostedPick[];
  gameResults: {
    latestSourcedAt: string | null;
    count24h: number | null;
    unavailable?: boolean;
  };
}

export interface SettlementPage {
  page: number;
  pageSize: number;
  total: number;
  lastPage: number;
}

export interface ResultsOpsFilter {
  settlementsPage?: number;
  manualReviewPage?: number;
  correctionsPage?: number;
}

export interface EffectiveSettlementTruth {
  settlements: SettlementOpsRow[];
  manualReview: SettlementOpsRow[];
  corrections: SettlementOpsRow[];
}

const HISTORY_PAGE_SIZE = 1_000;
export const SETTLEMENT_DISPLAY_PAGE_SIZE = 25;

export function mapSettlementRow(row: Record<string, unknown>): SettlementOpsRow {
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

function compareRowsDesc(
  left: SettlementOpsRow,
  right: SettlementOpsRow,
  timestamp: 'settledAt' | 'createdAt',
) {
  return right[timestamp].localeCompare(left[timestamp]) || right.id.localeCompare(left.id);
}

function settlementInput(row: SettlementOpsRow): SettlementInput {
  if (row.status !== 'settled' && row.status !== 'manual_review') {
    throw new Error(`Unsupported settlement status ${row.status} on ${row.id}`);
  }
  return {
    id: row.id,
    pick_id: row.pickId,
    status: row.status,
    result: row.result,
    confidence: row.confidence,
    corrects_id: row.correctsId,
    settled_at: row.settledAt,
  };
}

/**
 * Read the complete governed settlement plane before resolving current truth.
 * A PostgREST response is capped at 1,000 rows, so every page is ordered by the
 * immutable `(created_at, id)` tuple and the authoritative count is reconciled
 * against the union. This reader never hands a windowed correction chain to the
 * domain resolver.
 */
export async function readEffectiveSettlementTruth(
  client: SupabaseClient<Database>,
  options: { includeFixtures?: boolean } = {},
): Promise<EffectiveSettlementTruth> {
  const settlementColumns =
    'id, pick_id, status, result, source, confidence, review_reason, settled_by, corrects_id, settled_at, created_at, payload';
  const rows: SettlementOpsRow[] = [];
  const seen = new Set<string>();
  let exactTotal: number | null = null;

  for (let from = 0; exactTotal === null || from < exactTotal; from += HISTORY_PAGE_SIZE) {
    const base = client
      .from('settlement_records')
      .select(`${settlementColumns}, pick:picks!inner(id)`, { count: 'exact' });
    const scoped = options.includeFixtures ? base : applyOperatorPickPopulation(base, 'pick');
    const result = await scoped
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + HISTORY_PAGE_SIZE - 1)
      .abortSignal(AbortSignal.timeout(8_000));
    assertQuerySucceeded(result, 'complete settlement history');
    const reportedTotal = readAuthoritativeCount(result, 'complete settlement history');
    if (exactTotal !== null && reportedTotal !== exactTotal) {
      throw new Error(`Settlement history changed during pagination (${exactTotal} -> ${reportedTotal})`);
    }
    exactTotal = reportedTotal;
    for (const raw of (result.data ?? []) as Array<Record<string, unknown>>) {
      const row = mapSettlementRow(raw);
      if (seen.has(row.id)) throw new Error(`Duplicate settlement row ${row.id} across history pages`);
      seen.add(row.id);
      rows.push(row);
    }
    if ((result.data ?? []).length === 0) break;
  }

  if (rows.length !== exactTotal) {
    throw new Error(`Settlement history incomplete: read ${rows.length} of ${exactTotal ?? 'unknown'} rows`);
  }

  const byPick = new Map<string, SettlementOpsRow[]>();
  for (const row of rows) {
    const group = byPick.get(row.pickId);
    if (group) group.push(row);
    else byPick.set(row.pickId, [row]);
  }

  const settlements: SettlementOpsRow[] = [];
  for (const [pickId, history] of byPick) {
    const ids = new Set(history.map((row) => row.id));
    if (history.some((row) => row.correctsId !== null && !ids.has(row.correctsId))) {
      throw new Error(`Settlement chain for ${pickId} is missing a corrected record`);
    }
    const children = new Map<string, SettlementOpsRow[]>();
    for (const row of history) {
      if (row.correctsId === null) continue;
      const existing = children.get(row.correctsId);
      if (existing) existing.push(row);
      else children.set(row.correctsId, [row]);
    }
    if ([...children.values()].some((rowsForParent) => rowsForParent.length !== 1)) {
      throw new Error(`Settlement chain for ${pickId} branches and has no single effective result`);
    }
    const visited = new Set<string>();
    const additiveTips: SettlementOpsRow[] = [];
    for (const root of history.filter((row) => row.correctsId === null)) {
      const chain: SettlementOpsRow[] = [];
      let current: SettlementOpsRow | undefined = root;
      while (current) {
        if (visited.has(current.id)) throw new Error(`Settlement chain for ${pickId} is circular`);
        visited.add(current.id);
        chain.push(current);
        current = children.get(current.id)?.[0];
      }
      const resolved = resolveEffectiveSettlement(chain.map(settlementInput));
      if (!resolved.ok || resolved.settlement.correction_depth + 1 !== chain.length) {
        throw new Error(`Settlement chain for ${pickId} is incomplete or ambiguous`);
      }
      const effective = chain.find((row) => row.id === resolved.settlement.effective_record_id);
      if (!effective) throw new Error(`Effective settlement ${resolved.settlement.effective_record_id} is unavailable`);
      additiveTips.push(effective);
    }
    if (visited.size !== history.length || additiveTips.length === 0) {
      throw new Error(`Settlement chain for ${pickId} is incomplete or has no root`);
    }
    // A manual-review row may be followed by a separately recorded settlement
    // (both roots, both immutable). Each correction chain is resolved first;
    // the newest chain tip is then the pick's current additive truth.
    additiveTips.sort((left, right) => compareRowsDesc(left, right, 'createdAt'));
    settlements.push(additiveTips[0]!);
  }

  settlements.sort((left, right) => compareRowsDesc(left, right, 'settledAt'));
  const manualReview = settlements
    .filter((row) => row.status === 'manual_review')
    .sort((left, right) => compareRowsDesc(left, right, 'createdAt'));
  const corrections = rows
    .filter((row) => row.correctsId !== null)
    .sort((left, right) => compareRowsDesc(left, right, 'createdAt'));
  return { settlements, manualReview, corrections };
}

function normalizePage(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageRows<T>(rows: T[], requestedPage: unknown) {
  const lastPage = Math.max(1, Math.ceil(rows.length / SETTLEMENT_DISPLAY_PAGE_SIZE));
  const page = Math.min(normalizePage(requestedPage), lastPage);
  const from = (page - 1) * SETTLEMENT_DISPLAY_PAGE_SIZE;
  return {
    rows: rows.slice(from, from + SETTLEMENT_DISPLAY_PAGE_SIZE),
    pagination: { page, pageSize: SETTLEMENT_DISPLAY_PAGE_SIZE, total: rows.length, lastPage },
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

export async function getResultsOpsSnapshot(filter: ResultsOpsFilter = {}): Promise<ResultsOpsSnapshot> {
  const client = await getDataClient() as SupabaseClient<Database>;
  const nowMs = Date.now();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  const [
    settlementTruth,
    stuckResult,
    stuckCountResult,
    deliveredAwaitingResult,
    deliveredAwaitingCountResult,
    gameLatestResult,
    game24hResult,
  ] =
    await Promise.all([
      readEffectiveSettlementTruth(client),
      // Picks still lifecycle "posted" more than 24h after posting — age-based
      // proxy for "event started but never settled".
      // TODO(data-contract): join events (via pick metadata eventId) so stuck
      // detection keys off actual event start time rather than posted age.
      applyOperatorPickPopulation(client
        .from('picks_current_state')
        .select('id, market, selection, sport_display_name, posted_at, created_at'))
        .eq('status', 'posted')
        .lte('posted_at', dayAgo)
        .order('posted_at', { ascending: true })
        .limit(50),
      applyOperatorPickPopulation(client
        .from('picks_current_state')
        .select('id', { count: 'exact', head: true }))
        .eq('status', 'posted')
        .lte('posted_at', dayAgo),
      // UTV2-1939: delivered human-capper picks awaiting their result.
      // Predicate validated against production 2026-09-18 -- returns exactly the
      // one live delivered pick and nothing else. No age filter: the 24h delay
      // on `stuckPosted` above is the defect this list exists to avoid.
      applyOperatorPickPopulation(client
        .from('picks_current_state')
        .select('id, capper_id, market, selection, odds, stake_units, sport_display_name, posted_at'))
        .eq('status', 'posted')
        .is('settlement_recorded_at', null)
        .eq('metadata->deliveryAuthorization->>decision', 'authorized')
        .order('posted_at', { ascending: true })
        .limit(50),
      applyOperatorPickPopulation(client.from('picks_current_state').select('id', { count: 'exact', head: true }))
        .eq('status', 'posted')
        .is('settlement_recorded_at', null)
        .eq('metadata->deliveryAuthorization->>decision', 'authorized'),
      client.from('game_results').select('sourced_at').order('sourced_at', { ascending: false }).limit(1),
      client.from('game_results').select('id', { count: 'exact', head: true }).gte('sourced_at', dayAgo),
    ]);

  for (const result of [
    stuckResult,
    deliveredAwaitingResult,
  ]) {
    if (result.error) throw result.error;
  }

  const settled24h = settlementTruth.settlements.filter((row) => row.settledAt >= dayAgo).length;
  const manualReviewOpen = settlementTruth.manualReview.length;
  const correctionCount = settlementTruth.corrections.length;
  const stuckPostedCount = readAuthoritativeCount(stuckCountResult, 'stuck posted picks');
  // Results-feed availability is independent of operator settlement. A provider
  // read failure must not remove the operator's own history and controls.
  const gameUnavailable = Boolean(gameLatestResult.error || game24hResult.error || game24hResult.count == null);
  const gameResults24h = gameUnavailable ? null : readAuthoritativeCount(game24hResult, 'game results in 24h');

  const settlementsPage = pageRows(settlementTruth.settlements, filter.settlementsPage);
  const manualReviewPage = pageRows(settlementTruth.manualReview, filter.manualReviewPage);
  const correctionsPage = pageRows(settlementTruth.corrections, filter.correctionsPage);

  const stuckPosted: StuckPostedPick[] = ((stuckResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const createdAt = typeof row['created_at'] === 'string' ? row['created_at'] : null;
    const postedAt = typeof row['posted_at'] === 'string' ? row['posted_at'] : null;
    return {
      id: String(row['id'] ?? ''),
      market: typeof row['market'] === 'string' ? row['market'] : null,
      selection: typeof row['selection'] === 'string' ? row['selection'] : null,
      sportDisplayName: typeof row['sport_display_name'] === 'string' ? row['sport_display_name'] : null,
      postedAt,
      createdAt,
      ageHours: postedAt && Number.isFinite(Date.parse(postedAt))
        ? Math.max(0, Math.floor((nowMs - Date.parse(postedAt)) / 3_600_000))
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
      deliveredAwaitingSettlement: readAuthoritativeCount(deliveredAwaitingCountResult, 'delivered awaiting settlement'),
    },
    deliveredAwaitingSettlement,
    recentSettlements: settlementsPage.rows,
    manualReview: manualReviewPage.rows,
    corrections: correctionsPage.rows,
    pagination: {
      settlements: settlementsPage.pagination,
      manualReview: manualReviewPage.pagination,
      corrections: correctionsPage.pagination,
    },
    stuckPosted,
    gameResults: {
      latestSourcedAt: !gameUnavailable && typeof latestGameRow?.['sourced_at'] === 'string' ? latestGameRow['sourced_at'] : null,
      count24h: gameResults24h,
      unavailable: gameUnavailable,
    },
  };
}
