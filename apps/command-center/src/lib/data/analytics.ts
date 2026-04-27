/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDataClient } from './client.js';

type Client = any;
type Row = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────

export interface Stats {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  avgScore: number | null;
  avgClvPct: number | null;
  avgStakeUnits: number | null;
}

interface NamedInsight {
  name: string;
  roiPct: number;
  sampleSize: number;
}

export interface PerformanceData {
  windows: { today: Stats; last7d: Stats; last30d: Stats; mtd: Stats };
  bySource: { capper: Stats; system: Stats };
  bySport: Record<string, Stats>;
  byIndividualSource: Record<string, Stats>;
  decisions: { approved: Stats; denied: Stats; held: Stats; heldCount: number };
  insights: {
    capperRoiPct: number;
    systemRoiPct: number;
    approvedRoiPct: number;
    deniedRoiPct: number;
    approvedVsDeniedDelta: number;
    topCapper: NamedInsight;
    worstSegment: NamedInsight;
    strongestSport: NamedInsight;
    weakestSport: NamedInsight;
  };
}

export interface LeaderboardRow {
  capper: string;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  avgClvPct: number | null;
}

export interface ReviewRow {
  id: string;
  pickId: string;
  decision: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  pick: {
    market: string;
    selection: string;
    source: string;
    score: number | null;
    status: string;
  } | null;
  outcome: string | null;
}

export interface MiniStats {
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  streak: string;
}

export interface FormWindow {
  last5: MiniStats;
  last10: MiniStats;
  last20: MiniStats;
}

export interface ScoreBand {
  range: string;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
}

export interface FeedbackEntry {
  pickId: string;
  source: string;
  sport: string;
  promotionScore: number | null;
  reviewDecision: string | null;
  result: string;
  scoreSignal: 'correct' | 'incorrect' | 'marginal' | null;
  reviewWasRight: boolean | null;
}

export interface IntelligenceData {
  recentForm: {
    overall: FormWindow;
    capper: FormWindow;
    system: FormWindow;
    approved: FormWindow;
    denied: FormWindow;
    bySport: Record<string, FormWindow>;
    bySource: Record<string, FormWindow>;
  };
  scoreQuality: {
    bands: ScoreBand[];
    scoreVsOutcome: {
      avgScoreWins: number | null;
      avgScoreLosses: number | null;
      correlation: 'positive' | 'weak' | 'negative' | 'insufficient_data';
      sampleSize: number;
      confidence: 'high' | 'medium' | 'low' | 'none';
    };
  };
  decisionQuality: {
    approvedWinRate: number | null;
    deniedWouldHaveWonRate: number | null;
    approvedVsDeniedRoiDelta: number;
    holdsResolvedCount: number;
    holdsTotal: number;
  };
  feedbackLoop: FeedbackEntry[];
  insights: {
    bestScoreBand: { range: string; roiPct: number } | null;
    warnings: Array<{ segment: string; message: string }>;
  };
  observedAt: string;
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function asRecord(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Flat-bet -110 ROI: win = +0.909 units, loss = -1 unit.
 * ROI% = ((wins * 0.909 - losses) / settled_count) * 100
 * Hit rate = wins / (wins + losses) * 100 (exclude pushes)
 */
function computeStats(rows: Row[]): Stats {
  const total = rows.length;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let clvSum = 0;
  let clvCount = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let stakeSum = 0;
  let stakeCount = 0;

  for (const row of rows) {
    const result = safeString(row['result']).toLowerCase();
    if (result === 'win') wins++;
    else if (result === 'loss') losses++;
    else if (result === 'push') pushes++;

    const payload = asRecord(row['payload']);
    const clv = asNumber(payload['clvPercent']);
    if (clv !== null) { clvSum += clv; clvCount++; }

    const score = asNumber(row['promotion_score']);
    if (score !== null) { scoreSum += score; scoreCount++; }

    const stake = asNumber(row['stake_units']);
    if (stake !== null) { stakeSum += stake; stakeCount++; }
  }

  const settled = wins + losses + pushes;
  const hitDenominator = wins + losses;
  const hitRatePct = hitDenominator > 0 ? (wins / hitDenominator) * 100 : 0;
  const roiPct = settled > 0 ? ((wins * 0.909 - losses) / settled) * 100 : 0;
  const avgClvPct = clvCount > 0 ? clvSum / clvCount : null;
  const avgScore = scoreCount > 0 ? scoreSum / scoreCount : null;
  const avgStakeUnits = stakeCount > 0 ? stakeSum / stakeCount : null;

  return {
    total,
    settled,
    wins,
    losses,
    pushes,
    hitRatePct: Math.round(hitRatePct * 10) / 10,
    roiPct: Math.round(roiPct * 10) / 10,
    avgScore,
    avgClvPct,
    avgStakeUnits,
  };
}

function emptyStats(): Stats {
  return {
    total: 0, settled: 0, wins: 0, losses: 0, pushes: 0,
    hitRatePct: 0, roiPct: 0, avgScore: null, avgClvPct: null, avgStakeUnits: null,
  };
}

/**
 * Source classification: picks where source contains 'capper' or doesn't
 * contain 'system'/'scanner'/'board' are 'capper'; else 'system'.
 */
function classifySource(source: string): 'capper' | 'system' {
  const s = source.toLowerCase();
  if (s.includes('capper')) return 'capper';
  if (s.includes('system') || s.includes('scanner') || s.includes('board')) return 'system';
  return 'capper';
}

/**
 * Extract sport from picks.metadata.sport or metadata.league.
 */
function extractSport(metadata: Row): string {
  return safeString(metadata['sport'] ?? metadata['league'], 'unknown');
}

/**
 * Extract capper name from metadata or source field.
 */
function extractCapperName(row: Row): string {
  const metadata = asRecord(row['metadata']);
  return (
    asString(metadata['capper']) ??
    asString(metadata['capperName']) ??
    asString(row['source']) ??
    'unknown'
  );
}

/**
 * UTC start of current day.
 */
function todayUtcStart(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * UTC start of current month.
 */
function monthStartUtc(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function namedInsightFromMap(
  map: Map<string, Row[]>,
  pick: 'best' | 'worst',
): NamedInsight {
  let best: NamedInsight = { name: '—', roiPct: 0, sampleSize: 0 };
  for (const [name, rows] of map.entries()) {
    const stats = computeStats(rows);
    if (
      best.sampleSize === 0 ||
      (pick === 'best' && stats.roiPct > best.roiPct) ||
      (pick === 'worst' && stats.roiPct < best.roiPct)
    ) {
      best = { name, roiPct: stats.roiPct, sampleSize: stats.settled };
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────
// getPerformanceData
// ─────────────────────────────────────────────────────────────

export async function getPerformanceData(): Promise<PerformanceData | null> {
  try {
    const client: Client = getDataClient();

    // Fetch canonical settled records joined with picks (last 30 days is the widest window)
    // We always fetch the widest window and filter in-memory for sub-windows.
    const cutoff30d = daysAgoIso(30);
    const todayStart = todayUtcStart();
    const cutoff7d = daysAgoIso(7);
    const mtdStart = monthStartUtc();

    const [settlementResult, heldCountResult] = await Promise.all([
      client
        .from('settlement_records')
        .select('id, pick_id, result, status, payload, created_at, settled_at')
        .is('corrects_id', null)
        .eq('status', 'settled')
        .gte('created_at', cutoff30d),
      client
        .from('picks_current_state')
        .select('id', { count: 'exact', head: true })
        .eq('review_decision', 'hold')
        .neq('status', 'settled')
        .neq('status', 'voided'),
    ]);

    if (settlementResult.error) {
      console.error('[analytics] getPerformanceData settlement query error:', settlementResult.error);
      return null;
    }

    const settlementRows = (settlementResult.data ?? []) as Row[];
    const heldCount = heldCountResult.count ?? 0;

    // Collect pick IDs to fetch associated picks data
    const pickIds = [...new Set(settlementRows.map((r) => asString(r['pick_id'])).filter(Boolean))] as string[];

    let picksMap = new Map<string, Row>();
    if (pickIds.length > 0) {
      const picksResult = await client
        .from('picks')
        .select('id, source, market, selection, stake_units, promotion_score, metadata, status, created_at')
        .in('id', pickIds);
      if (!picksResult.error) {
        for (const row of (picksResult.data ?? []) as Row[]) {
          const id = asString(row['id']);
          if (id) picksMap.set(id, row);
        }
      }
    }

    // Fetch picks_current_state for review_decision grouping
    let pcsMap = new Map<string, Row>();
    if (pickIds.length > 0) {
      const pcsResult = await client
        .from('picks_current_state')
        .select('id, review_decision, settlement_result')
        .in('id', pickIds);
      if (!pcsResult.error) {
        for (const row of (pcsResult.data ?? []) as Row[]) {
          const id = asString(row['id']);
          if (id) pcsMap.set(id, row);
        }
      }
    }

    // Enrich settlement rows with pick data
    interface EnrichedRow extends Row {
      _source: string;
      _sport: string;
      _score: number | null;
      _stakeUnits: number | null;
      _reviewDecision: string | null;
      _settledAt: string | null;
    }

    const enriched: EnrichedRow[] = settlementRows.map((sr) => {
      const pickId = asString(sr['pick_id']) ?? '';
      const pick = picksMap.get(pickId) ?? {};
      const pcs = pcsMap.get(pickId) ?? {};
      const metadata = asRecord(pick['metadata']);
      const payload = asRecord(sr['payload']);
      return {
        ...sr,
        promotion_score: asNumber(pick['promotion_score']),
        stake_units: asNumber(pick['stake_units']),
        _source: safeString(pick['source'], 'unknown'),
        _sport: extractSport(metadata),
        _score: asNumber(pick['promotion_score']),
        _stakeUnits: asNumber(pick['stake_units']),
        _reviewDecision: asString(pcs['review_decision']),
        _settledAt: asString(sr['settled_at'] ?? sr['created_at']),
        payload,
      };
    });

    // Time-window partitioning
    function inWindow(row: EnrichedRow, from: string): boolean {
      const ts = safeString(row['created_at']);
      return ts >= from;
    }

    const rowsToday = enriched.filter((r) => inWindow(r, todayStart));
    const rows7d = enriched.filter((r) => inWindow(r, cutoff7d));
    const rows30d = enriched; // already filtered to 30d
    const rowsMtd = enriched.filter((r) => inWindow(r, mtdStart));

    // bySource grouping
    const capperRows = enriched.filter((r) => classifySource(r._source) === 'capper');
    const systemRows = enriched.filter((r) => classifySource(r._source) === 'system');

    // bySport grouping
    const sportMap = new Map<string, EnrichedRow[]>();
    for (const row of enriched) {
      const sport = row._sport;
      if (!sportMap.has(sport)) sportMap.set(sport, []);
      sportMap.get(sport)!.push(row);
    }

    // byIndividualSource grouping
    const sourceMap = new Map<string, EnrichedRow[]>();
    for (const row of enriched) {
      const src = row._source;
      if (!sourceMap.has(src)) sourceMap.set(src, []);
      sourceMap.get(src)!.push(row);
    }

    // decisions grouping
    const approvedRows = enriched.filter((r) => r._reviewDecision === 'approve');
    const deniedRows = enriched.filter((r) => r._reviewDecision === 'deny');
    const heldRows = enriched.filter((r) => r._reviewDecision === 'hold');

    const bySport: Record<string, Stats> = {};
    for (const [sport, rows] of sportMap.entries()) {
      if (sport && sport !== 'unknown') bySport[sport] = computeStats(rows);
    }

    const byIndividualSource: Record<string, Stats> = {};
    for (const [src, rows] of sourceMap.entries()) {
      if (src) byIndividualSource[src] = computeStats(rows);
    }

    const capperStats = computeStats(capperRows);
    const systemStats = computeStats(systemRows);
    const approvedStats = computeStats(approvedRows);
    const deniedStats = computeStats(deniedRows);

    // Named insights — by individual source for top/worst capper
    const topCapper = namedInsightFromMap(sourceMap as Map<string, Row[]>, 'best');
    const worstSegment = namedInsightFromMap(sourceMap as Map<string, Row[]>, 'worst');
    const strongestSport = namedInsightFromMap(sportMap as Map<string, Row[]>, 'best');
    const weakestSport = namedInsightFromMap(sportMap as Map<string, Row[]>, 'worst');

    const approvedVsDeniedDelta = Math.round((approvedStats.roiPct - deniedStats.roiPct) * 10) / 10;

    return {
      windows: {
        today: computeStats(rowsToday),
        last7d: computeStats(rows7d),
        last30d: computeStats(rows30d),
        mtd: computeStats(rowsMtd),
      },
      bySource: {
        capper: capperStats,
        system: systemStats,
      },
      bySport,
      byIndividualSource,
      decisions: {
        approved: approvedStats,
        denied: deniedStats,
        held: computeStats(heldRows),
        heldCount,
      },
      insights: {
        capperRoiPct: capperStats.roiPct,
        systemRoiPct: systemStats.roiPct,
        approvedRoiPct: approvedStats.roiPct,
        deniedRoiPct: deniedStats.roiPct,
        approvedVsDeniedDelta,
        topCapper,
        worstSegment,
        strongestSport,
        weakestSport,
      },
    };
  } catch (err) {
    console.error('[analytics] getPerformanceData error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// getLeaderboard
// ─────────────────────────────────────────────────────────────

export async function getLeaderboard(days: number): Promise<LeaderboardRow[]> {
  try {
    const client: Client = getDataClient();
    const cutoff = daysAgoIso(days);

    const settlementResult = await client
      .from('settlement_records')
      .select('id, pick_id, result, payload, created_at')
      .is('corrects_id', null)
      .eq('status', 'settled')
      .gte('created_at', cutoff);

    if (settlementResult.error) {
      console.error('[analytics] getLeaderboard settlement query error:', settlementResult.error);
      return [];
    }

    const settlementRows = (settlementResult.data ?? []) as Row[];
    const pickIds = [...new Set(settlementRows.map((r) => asString(r['pick_id'])).filter(Boolean))] as string[];

    if (pickIds.length === 0) return [];

    const picksResult = await client
      .from('picks')
      .select('id, source, metadata')
      .in('id', pickIds);

    if (picksResult.error) {
      console.error('[analytics] getLeaderboard picks query error:', picksResult.error);
      return [];
    }

    const picksMap = new Map<string, Row>();
    for (const row of (picksResult.data ?? []) as Row[]) {
      const id = asString(row['id']);
      if (id) picksMap.set(id, row);
    }

    // Group by capper name
    const capperMap = new Map<string, { rows: Row[]; clvSum: number; clvCount: number }>();

    for (const sr of settlementRows) {
      const pickId = asString(sr['pick_id']) ?? '';
      const pick = picksMap.get(pickId) ?? {};
      const capperName = extractCapperName(pick);
      const payload = asRecord(sr['payload']);
      const clv = asNumber(payload['clvPercent']);

      if (!capperMap.has(capperName)) {
        capperMap.set(capperName, { rows: [], clvSum: 0, clvCount: 0 });
      }
      const entry = capperMap.get(capperName)!;
      entry.rows.push(sr);
      if (clv !== null) { entry.clvSum += clv; entry.clvCount++; }
    }

    const result: LeaderboardRow[] = [];
    for (const [capper, entry] of capperMap.entries()) {
      const stats = computeStats(entry.rows);
      const avgClvPct = entry.clvCount > 0 ? entry.clvSum / entry.clvCount : null;
      result.push({
        capper,
        total: stats.total,
        wins: stats.wins,
        losses: stats.losses,
        pushes: stats.pushes,
        hitRatePct: stats.hitRatePct,
        roiPct: stats.roiPct,
        avgClvPct,
      });
    }

    // Sort by ROI descending
    result.sort((a, b) => b.roiPct - a.roiPct);
    return result;
  } catch (err) {
    console.error('[analytics] getLeaderboard error:', err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// getReviewHistory
// ─────────────────────────────────────────────────────────────

const DECISION_ACTION_MAP: Record<string, string> = {
  approve: 'review.approve',
  deny: 'review.deny',
  hold: 'review.hold',
  return: 'review.return',
};

const ACTION_DECISION_MAP: Record<string, string> = {
  'review.approve': 'approve',
  'review.deny': 'deny',
  'review.hold': 'hold',
  'review.return': 'return',
};

export async function getReviewHistory(
  decision?: string,
): Promise<{ reviews: ReviewRow[]; total: number }> {
  try {
    const client: Client = getDataClient();

    const validActions = ['review.approve', 'review.deny', 'review.hold', 'review.return'];
    const targetAction = decision ? DECISION_ACTION_MAP[decision] : undefined;

    let query = client
      .from('audit_log')
      .select('id, entity_type, entity_id, entity_ref, action, actor, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (targetAction) {
      query = query.eq('action', targetAction);
    } else {
      query = query.in('action', validActions);
    }

    const auditResult = await query;
    if (auditResult.error) {
      console.error('[analytics] getReviewHistory audit query error:', auditResult.error);
      return { reviews: [], total: 0 };
    }

    const auditRows = (auditResult.data ?? []) as Row[];

    // Collect pick IDs from entity_ref
    const pickIds = [...new Set(
      auditRows
        .map((r) => asString(r['entity_ref']))
        .filter(Boolean),
    )] as string[];

    // Fetch pick state for each
    const pcsMap = new Map<string, Row>();
    if (pickIds.length > 0) {
      const pcsResult = await client
        .from('picks_current_state')
        .select('id, market, selection, source, promotion_score, status, settlement_result')
        .in('id', pickIds);
      if (!pcsResult.error) {
        for (const row of (pcsResult.data ?? []) as Row[]) {
          const id = asString(row['id']);
          if (id) pcsMap.set(id, row);
        }
      }
    }

    const reviews: ReviewRow[] = auditRows.map((auditRow) => {
      const action = safeString(auditRow['action']);
      const decisionLabel = ACTION_DECISION_MAP[action] ?? action.replace('review.', '');
      const pickId = asString(auditRow['entity_ref']) ?? asString(auditRow['entity_id']) ?? '';
      const payload = asRecord(auditRow['payload']);
      const reason = asString(payload['reason']) ?? asString(payload['notes']) ?? '';
      const actor = asString(auditRow['actor']) ?? 'unknown';
      const createdAt = safeString(auditRow['created_at']);

      const pcs = pcsMap.get(pickId) ?? null;
      const pickDetails = pcs
        ? {
            market: safeString(pcs['market']),
            selection: safeString(pcs['selection']),
            source: safeString(pcs['source']),
            score: asNumber(pcs['promotion_score']),
            status: safeString(pcs['status']),
          }
        : null;

      const outcome = pcs ? asString(pcs['settlement_result']) : null;

      return {
        id: safeString(auditRow['id']),
        pickId,
        decision: decisionLabel,
        reason,
        decidedBy: actor,
        decidedAt: createdAt,
        pick: pickDetails,
        outcome,
      };
    });

    return { reviews, total: reviews.length };
  } catch (err) {
    console.error('[analytics] getReviewHistory error:', err);
    return { reviews: [], total: 0 };
  }
}

// ─────────────────────────────────────────────────────────────
// Intelligence helpers
// ─────────────────────────────────────────────────────────────

function computeMiniStats(rows: Row[]): MiniStats {
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const row of rows) {
    const result = safeString(row['result']).toLowerCase();
    if (result === 'win') wins++;
    else if (result === 'loss') losses++;
    else if (result === 'push') pushes++;
  }

  const settled = wins + losses + pushes;
  const hitDenominator = wins + losses;
  const hitRatePct = hitDenominator > 0 ? Math.round((wins / hitDenominator) * 1000) / 10 : 0;
  const roiPct = settled > 0 ? Math.round(((wins * 0.909 - losses) / settled) * 1000) / 10 : 0;

  // Compute streak from rows (assumed ordered by settled_at desc)
  let streakCount = 0;
  let streakType: 'W' | 'L' | null = null;
  for (const row of rows) {
    const result = safeString(row['result']).toLowerCase();
    if (result === 'push') continue;
    const t = result === 'win' ? 'W' : 'L';
    if (streakType === null) { streakType = t; streakCount = 1; }
    else if (t === streakType) { streakCount++; }
    else break;
  }
  const streak = streakType ? `${streakType}${streakCount}` : '—';

  return { wins, losses, pushes, hitRatePct, roiPct, streak };
}

function computeFormWindow(rows: Row[]): FormWindow {
  // rows should be ordered most-recent first
  const last5 = rows.slice(0, 5);
  const last10 = rows.slice(0, 10);
  const last20 = rows.slice(0, 20);
  return {
    last5: computeMiniStats(last5),
    last10: computeMiniStats(last10),
    last20: computeMiniStats(last20),
  };
}

function emptyFormWindow(): FormWindow {
  const empty: MiniStats = { wins: 0, losses: 0, pushes: 0, hitRatePct: 0, roiPct: 0, streak: '—' };
  return { last5: empty, last10: empty, last20: empty };
}

const SCORE_BANDS = [
  { range: '0–40', min: 0, max: 40 },
  { range: '40–60', min: 40, max: 60 },
  { range: '60–70', min: 60, max: 70 },
  { range: '70–80', min: 70, max: 80 },
  { range: '80–100', min: 80, max: 100 },
] as const;

// ─────────────────────────────────────────────────────────────
// getIntelligenceData
// ─────────────────────────────────────────────────────────────

export async function getIntelligenceData(): Promise<IntelligenceData | null> {
  try {
    const client: Client = getDataClient();

    // Fetch last 200 settled records (canonical) ordered by settled_at desc for form windows
    const [settlementResult, holdsResult] = await Promise.all([
      client
        .from('settlement_records')
        .select('id, pick_id, result, status, payload, created_at, settled_at')
        .is('corrects_id', null)
        .eq('status', 'settled')
        .order('settled_at', { ascending: false })
        .limit(200),
      client
        .from('picks_current_state')
        .select('id, status', { count: 'exact' })
        .eq('review_decision', 'hold'),
    ]);

    if (settlementResult.error) {
      console.error('[analytics] getIntelligenceData settlement error:', settlementResult.error);
      return null;
    }

    const settlementRows = (settlementResult.data ?? []) as Row[];
    const holdsTotal = holdsResult.count ?? 0;
    const holdsResolvedCount = (holdsResult.data ?? []).filter(
      (r: Row) => safeString(r['status']) === 'settled',
    ).length;

    // Collect pick IDs
    const pickIds = [...new Set(settlementRows.map((r) => asString(r['pick_id'])).filter(Boolean))] as string[];

    let picksMap = new Map<string, Row>();
    let pcsMap = new Map<string, Row>();

    if (pickIds.length > 0) {
      const [picksResult, pcsResult] = await Promise.all([
        client
          .from('picks')
          .select('id, source, metadata, promotion_score')
          .in('id', pickIds),
        client
          .from('picks_current_state')
          .select('id, review_decision, settlement_result')
          .in('id', pickIds),
      ]);

      if (!picksResult.error) {
        for (const row of (picksResult.data ?? []) as Row[]) {
          const id = asString(row['id']);
          if (id) picksMap.set(id, row);
        }
      }
      if (!pcsResult.error) {
        for (const row of (pcsResult.data ?? []) as Row[]) {
          const id = asString(row['id']);
          if (id) pcsMap.set(id, row);
        }
      }
    }

    // Enrich settlement rows
    interface IntelRow extends Row {
      _source: string;
      _sport: string;
      _score: number | null;
      _reviewDecision: string | null;
    }

    const enriched: IntelRow[] = settlementRows.map((sr) => {
      const pickId = asString(sr['pick_id']) ?? '';
      const pick = picksMap.get(pickId) ?? {};
      const pcs = pcsMap.get(pickId) ?? {};
      const metadata = asRecord(pick['metadata']);
      return {
        ...sr,
        _source: safeString(pick['source'], 'unknown'),
        _sport: extractSport(metadata),
        _score: asNumber(pick['promotion_score']),
        _reviewDecision: asString(pcs['review_decision']),
      };
    });

    // Recent form — overall
    const overallForm = computeFormWindow(enriched);

    // By source classification
    const capperEnriched = enriched.filter((r) => classifySource(r._source) === 'capper');
    const systemEnriched = enriched.filter((r) => classifySource(r._source) === 'system');
    const approvedEnriched = enriched.filter((r) => r._reviewDecision === 'approve');
    const deniedEnriched = enriched.filter((r) => r._reviewDecision === 'deny');

    // By sport
    const sportGroups = new Map<string, IntelRow[]>();
    for (const row of enriched) {
      const sport = row._sport;
      if (!sport || sport === 'unknown') continue;
      if (!sportGroups.has(sport)) sportGroups.set(sport, []);
      sportGroups.get(sport)!.push(row);
    }

    // By individual source
    const srcGroups = new Map<string, IntelRow[]>();
    for (const row of enriched) {
      const src = row._source;
      if (!src || src === 'unknown') continue;
      if (!srcGroups.has(src)) srcGroups.set(src, []);
      srcGroups.get(src)!.push(row);
    }

    const bySportForm: Record<string, FormWindow> = {};
    for (const [sport, rows] of sportGroups.entries()) {
      bySportForm[sport] = computeFormWindow(rows);
    }

    const bySourceForm: Record<string, FormWindow> = {};
    for (const [src, rows] of srcGroups.entries()) {
      bySourceForm[src] = computeFormWindow(rows);
    }

    // Score quality bands — use all settled with a score
    const scoreBands: ScoreBand[] = SCORE_BANDS.map(({ range, min, max }) => {
      const bandRows = enriched.filter((r) => {
        const score = r._score;
        return score !== null && score >= min && score < max;
      });
      const stats = computeStats(bandRows);
      return {
        range,
        total: stats.settled,
        wins: stats.wins,
        losses: stats.losses,
        pushes: stats.pushes,
        hitRatePct: stats.hitRatePct,
        roiPct: stats.roiPct,
      };
    });

    // Score vs outcome correlation
    const scoredRows = enriched.filter((r) => r._score !== null);
    const scoredWins = scoredRows.filter((r) => safeString(r['result']).toLowerCase() === 'win');
    const scoredLosses = scoredRows.filter((r) => safeString(r['result']).toLowerCase() === 'loss');
    const avgScoreWins = scoredWins.length > 0
      ? scoredWins.reduce((sum, r) => sum + (r._score ?? 0), 0) / scoredWins.length
      : null;
    const avgScoreLosses = scoredLosses.length > 0
      ? scoredLosses.reduce((sum, r) => sum + (r._score ?? 0), 0) / scoredLosses.length
      : null;

    const sampleSize = scoredRows.length;
    let correlation: 'positive' | 'weak' | 'negative' | 'insufficient_data' = 'insufficient_data';
    let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';

    if (avgScoreWins !== null && avgScoreLosses !== null && sampleSize >= 10) {
      const delta = avgScoreWins - avgScoreLosses;
      if (delta > 5) correlation = 'positive';
      else if (delta < -5) correlation = 'negative';
      else correlation = 'weak';

      if (sampleSize >= 50) confidence = 'high';
      else if (sampleSize >= 25) confidence = 'medium';
      else confidence = 'low';
    }

    // Decision quality
    const approvedSettled = approvedEnriched.filter((r) => {
      const result = safeString(r['result']).toLowerCase();
      return result === 'win' || result === 'loss';
    });
    const deniedSettled = deniedEnriched.filter((r) => {
      const result = safeString(r['result']).toLowerCase();
      return result === 'win' || result === 'loss';
    });

    const approvedWins = approvedSettled.filter((r) => safeString(r['result']).toLowerCase() === 'win').length;
    const deniedWouldHaveWon = deniedSettled.filter((r) => safeString(r['result']).toLowerCase() === 'win').length;

    const approvedWinRate = approvedSettled.length > 0
      ? Math.round((approvedWins / approvedSettled.length) * 1000) / 10
      : null;
    const deniedWouldHaveWonRate = deniedSettled.length > 0
      ? Math.round((deniedWouldHaveWon / deniedSettled.length) * 1000) / 10
      : null;

    const approvedStats = computeStats(approvedEnriched);
    const deniedStats = computeStats(deniedEnriched);
    const approvedVsDeniedRoiDelta = Math.round((approvedStats.roiPct - deniedStats.roiPct) * 10) / 10;

    // Feedback loop — last 50 settled picks
    const feedbackLoop: FeedbackEntry[] = enriched.slice(0, 50).map((row) => {
      const result = safeString(row['result']).toLowerCase();
      const score = row._score;
      const reviewDecision = row._reviewDecision;

      // scoreSignal: was the score above 70 (high confidence) on a win, or did it fail?
      let scoreSignal: 'correct' | 'incorrect' | 'marginal' | null = null;
      if (score !== null) {
        if (score >= 70 && result === 'win') scoreSignal = 'correct';
        else if (score >= 70 && result === 'loss') scoreSignal = 'incorrect';
        else if (score >= 60 && score < 70) scoreSignal = 'marginal';
        else if (score < 60 && result === 'loss') scoreSignal = 'correct';
        else if (score < 60 && result === 'win') scoreSignal = 'incorrect';
      }

      // reviewWasRight: approve+win or deny+loss
      let reviewWasRight: boolean | null = null;
      if (reviewDecision === 'approve' && result === 'win') reviewWasRight = true;
      else if (reviewDecision === 'approve' && result === 'loss') reviewWasRight = false;
      else if (reviewDecision === 'deny' && result === 'loss') reviewWasRight = true;
      else if (reviewDecision === 'deny' && result === 'win') reviewWasRight = false;

      return {
        pickId: safeString(row['pick_id']),
        source: row._source,
        sport: row._sport,
        promotionScore: score,
        reviewDecision,
        result,
        scoreSignal,
        reviewWasRight,
      };
    });

    // Insights
    let bestScoreBand: { range: string; roiPct: number } | null = null;
    for (const band of scoreBands) {
      if (band.total >= 5 && (bestScoreBand === null || band.roiPct > bestScoreBand.roiPct)) {
        bestScoreBand = { range: band.range, roiPct: band.roiPct };
      }
    }

    const warnings: Array<{ segment: string; message: string }> = [];
    if (sampleSize < 20) {
      warnings.push({ segment: 'Score Quality', message: 'Sample size is below 20 — score correlation should not be treated as reliable.' });
    }
    if (correlation === 'negative') {
      warnings.push({ segment: 'Score Quality', message: 'Score-outcome correlation is negative — the promotion score may not be predictive of wins.' });
    }
    if (approvedStats.roiPct < 0 && approvedSettled.length >= 10) {
      warnings.push({ segment: 'Approved Picks', message: `Approved picks have negative ROI (${approvedStats.roiPct.toFixed(1)}%) over the observed window.` });
    }
    if (deniedWouldHaveWonRate !== null && deniedWouldHaveWonRate > 55) {
      warnings.push({ segment: 'Denied Picks', message: `Denied picks would have won ${deniedWouldHaveWonRate.toFixed(1)}% of the time — review denial criteria.` });
    }

    return {
      recentForm: {
        overall: overallForm,
        capper: computeFormWindow(capperEnriched),
        system: computeFormWindow(systemEnriched),
        approved: computeFormWindow(approvedEnriched),
        denied: computeFormWindow(deniedEnriched),
        bySport: bySportForm,
        bySource: bySourceForm,
      },
      scoreQuality: {
        bands: scoreBands,
        scoreVsOutcome: {
          avgScoreWins,
          avgScoreLosses,
          correlation,
          sampleSize,
          confidence,
        },
      },
      decisionQuality: {
        approvedWinRate,
        deniedWouldHaveWonRate,
        approvedVsDeniedRoiDelta,
        holdsResolvedCount,
        holdsTotal,
      },
      feedbackLoop,
      insights: {
        bestScoreBand,
        warnings,
      },
      observedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[analytics] getIntelligenceData error:', err);
    return null;
  }
}
