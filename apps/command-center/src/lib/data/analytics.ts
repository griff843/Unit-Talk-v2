/* eslint-disable @typescript-eslint/no-explicit-any */
import { americanToDecimal, isValidAmericanOdds } from '@unit-talk/contracts';
import {
  resolveEffectiveSettlement,
  type SettlementInput,
} from '../../../../../packages/domain/dist/outcomes/settlement-downstream.js';

import { getDataClient, isTestFixturePick } from './client';
import { applyPickPopulation, resolveGovernedPick } from '../governed-population';
import { getPerformanceCohort } from './performance-cohort';

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
  /**
   * Net units returned per unit staked, as a percentage, computed from the real
   * American price and the real stake on each decided pick.
   *
   * `null` means nothing in this cohort could be priced. That is NOT 0 -- a
   * break-even record and an unmeasurable one are different facts, and reporting
   * the unmeasurable one as 0.0% is the reassuring direction.
   */
  roiPct: number | null;
  /** Total units risked across the priced picks. `null` when nothing was priced. */
  unitsStaked: number | null;
  /** Net units won or lost across the priced picks. `null` when nothing was priced. */
  unitsNet: number | null;
  /** Decided picks that carried no usable odds or stake, so contributed no units. */
  unpriced: number;
  avgScore: number | null;
  avgClvPct: number | null;
  avgStakeUnits: number | null;
}

interface NamedInsight {
  name: string;
  roiPct: number | null;
  sampleSize: number;
}

export interface PerformanceData {
  windows: { today: Stats; last7d: Stats; last30d: Stats; mtd: Stats };
  bySource: { capper: Stats; system: Stats };
  bySport: Record<string, Stats>;
  byIndividualSource: Record<string, Stats>;
  /** Published statistics per canonical `picks.capper_id`. Track Only excluded. */
  byCapper: Record<string, Stats>;
  /**
   * The Unit Talk aggregate over exactly the rows `byCapper` and `bySource`
   * partition. Every per-capper figure reconciles against this by construction:
   * same cohort, same function.
   */
  unitTalkAggregate: Stats;
  /**
   * Internal Track Only evidence, reported separately and never folded into any
   * published figure above.
   */
  trackOnly: { stats: Stats; byCapper: Record<string, Stats> };
  decisions: { approved: Stats; denied: Stats; held: Stats; heldCount: number };
  insights: {
    capperRoiPct: number | null;
    systemRoiPct: number | null;
    approvedRoiPct: number | null;
    deniedRoiPct: number | null;
    approvedVsDeniedDelta: number | null;
    topCapper: NamedInsight;
    worstSegment: NamedInsight;
    strongestSport: NamedInsight;
    weakestSport: NamedInsight;
  };
}

export interface LeaderboardRow {
  /** Canonical `picks.capper_id`. Never derived from `picks.source` or metadata. */
  capper: string;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number | null;
  unitsStaked: number | null;
  unitsNet: number | null;
  unpriced: number;
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
  roiPct: number | null;
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
  roiPct: number | null;
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
    approvedVsDeniedRoiDelta: number | null;
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
 * Profit in units for one decided pick, priced from the real American odds and
 * the real stake.
 *
 * This is the same arithmetic the settled Track Only reporter uses
 * (`scripts/ops/track-only/stats.ts` -> `profitUnits`), expressed through the
 * canonical contracts primitive instead of a second odds conversion:
 * `stake * (decimal - 1)` equals `stake * odds/100` for a positive price and
 * `stake * 100/|odds|` for a negative one.
 *
 * Returns `null` when the pick cannot be priced. A null is never coerced to 0:
 * "we could not price this" and "this broke even" are different facts, and only
 * one of them is reassuring.
 */
export function pickProfitUnits(
  result: 'win' | 'loss' | 'push',
  odds: unknown,
  stakeUnits: unknown,
): number | null {
  if (typeof stakeUnits !== 'number' || !Number.isFinite(stakeUnits) || stakeUnits <= 0) {
    return null;
  }
  if (!isValidAmericanOdds(odds)) return null;
  if (result === 'push') return 0;
  if (result === 'loss') return -stakeUnits;
  return stakeUnits * (americanToDecimal(odds) - 1);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Cohort statistics over settlement rows that have been enriched with their
 * pick's real `odds` and `stake_units`.
 *
 * Hit rate excludes pushes. ROI is units-weighted over the picks that could
 * actually be priced, and is `null` -- not 0 -- when none could.
 */
export function computeStats(rows: Row[]): Stats {
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
  let unitsStaked = 0;
  let unitsNet = 0;
  let priced = 0;
  let unpriced = 0;

  for (const row of rows) {
    const result = safeString(row['result']).toLowerCase();
    const decided = result === 'win' || result === 'loss' || result === 'push';
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

    if (!decided) continue;
    const profit = pickProfitUnits(result as 'win' | 'loss' | 'push', row['odds'], stake);
    if (profit === null || stake === null) {
      unpriced++;
      continue;
    }
    unitsStaked += stake;
    unitsNet += profit;
    priced++;
  }

  const settled = wins + losses + pushes;
  const hitDenominator = wins + losses;
  const hitRatePct = hitDenominator > 0 ? (wins / hitDenominator) * 100 : 0;
  const hasUnits = priced > 0 && unitsStaked > 0;
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
    roiPct: hasUnits ? Math.round((unitsNet / unitsStaked) * 1000) / 10 : null,
    unitsStaked: hasUnits ? round4(unitsStaked) : null,
    unitsNet: hasUnits ? round4(unitsNet) : null,
    unpriced,
    avgScore,
    avgClvPct,
    avgStakeUnits,
  };
}

/**
 * Canonical capper attribution: `picks.capper_id`, and nothing else.
 *
 * UTV2-1907 established that a pick belongs to a capper when and only when it
 * carries a `capper_id`. `picks.source` names the intake path (`smart-form`,
 * `board-construction`, ...), not a person, so a substring match on it invents
 * an attribution. Returns `null` for a pick with no capper -- which is a fact,
 * not an "unknown" capper to be given a leaderboard row of its own.
 */
export function resolveCapperId(pick: Row): string | null {
  return asString(pick['capper_id']);
}

/**
 * A pick is attributed to a capper iff it carries a canonical `capper_id`.
 * Everything else is system/board output.
 */
export function classifyAttribution(pick: Row): 'capper' | 'system' {
  return resolveCapperId(pick) === null ? 'system' : 'capper';
}

/**
 * Track Only picks are internal evidence. They persist, they grade, and they
 * settle -- but they were never shown to a member, so they must not appear in
 * any published or member-facing figure. Excluding them is a truthfulness
 * requirement, not a display preference.
 */
export function isTrackOnlyPick(pick: Row): boolean {
  return safeString(asRecord(pick['metadata'])['distributionMode']) === 'track-only';
}

/**
 * Extract sport from picks.metadata.sport or metadata.league.
 */
function extractSport(metadata: Row): string {
  return safeString(metadata['sport'] ?? metadata['league'], 'unknown');
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

/**
 * Best or worst named segment by ROI.
 *
 * A segment whose ROI is `null` -- nothing in it could be priced -- is not a
 * candidate at all. Previously an unpriceable segment presented as 0.0% and
 * could win "worst" against genuinely profitable ones, or "best" against
 * genuinely losing ones, purely because nothing was measured.
 */
function namedInsightFromMap(
  map: Map<string, Row[]>,
  pick: 'best' | 'worst',
): NamedInsight {
  let best: NamedInsight | null = null;
  for (const [name, rows] of map.entries()) {
    const stats = computeStats(rows);
    if (stats.roiPct === null) continue;
    if (
      best === null ||
      (pick === 'best' && stats.roiPct > best.roiPct!) ||
      (pick === 'worst' && stats.roiPct < best.roiPct!)
    ) {
      best = { name, roiPct: stats.roiPct, sampleSize: stats.settled };
    }
  }
  return best ?? { name: '—', roiPct: null, sampleSize: 0 };
}

// ─────────────────────────────────────────────────────────────
// getPerformanceData
// ─────────────────────────────────────────────────────────────

export async function getPerformanceData(): Promise<PerformanceData | null> {
  try {
    const cohort = await getPerformanceCohort();
    const cutoff30d = daysAgoIso(30);
    const todayStart = todayUtcStart();
    const cutoff7d = daysAgoIso(7);
    const mtdStart = monthStartUtc();
    const widestStart = cutoff30d < mtdStart ? cutoff30d : mtdStart;
    const settlementRows: Row[] = cohort.settlements.filter((row) => row.status === 'settled' && row.settled_at >= widestStart);
    const heldCount = cohort.picks.filter((pick) => pick.review_decision === 'hold' && pick.status !== 'settled' && pick.status !== 'voided').length;
    const picksMap = new Map<string, Row>();
    const pcsMap = new Map<string, Row>();
    for (const pick of cohort.picks) {
      if (pick.id) { picksMap.set(pick.id, pick); pcsMap.set(pick.id, pick); }
    }

    // Enrich settlement rows with pick data
    interface EnrichedRow extends Row {
      _source: string;
      _capperId: string | null;
      _attribution: 'capper' | 'system';
      _trackOnly: boolean;
      _sport: string;
      _score: number | null;
      _stakeUnits: number | null;
      _reviewDecision: string | null;
      _settledAt: string | null;
    }

    const enriched: EnrichedRow[] = settlementRows.flatMap((sr) => {
      const pickId = asString(sr['pick_id']) ?? '';
      // Governed membership is the driving predicate, not a join enrichment.
      // picksMap holds only governed rows, so a settlement whose pick is absent
      // belongs to the fixture corpus and is dropped -- never carried forward as
      // an `unknown` source with null units, which would silently distort ROI.
      const pick = resolveGovernedPick(picksMap, pickId);
      if (pick === null) return [];
      if (isTestFixturePick(pick)) return [];
      const pcs = pcsMap.get(pickId) ?? {};
      const metadata = asRecord(pick['metadata']);
      const payload = asRecord(sr['payload']);
      return [{
        ...sr,
        promotion_score: asNumber(pick['promotion_score']),
        stake_units: asNumber(pick['stake_units']),
        // The pick's real price, carried onto the settlement row so computeStats
        // can weight ROI by units instead of assuming a flat -110 book.
        odds: asNumber(pick['odds']),
        _source: safeString(pick['source'], 'unknown'),
        _capperId: resolveCapperId(pick),
        _attribution: classifyAttribution(pick),
        _trackOnly: isTrackOnlyPick(pick),
        _sport: extractSport(metadata),
        _score: asNumber(pick['promotion_score']),
        _stakeUnits: asNumber(pick['stake_units']),
        _reviewDecision: asString(pcs['review_decision']),
        _settledAt: asString(sr['settled_at'] ?? sr['created_at']),
        payload,
      }];
    });

    // Track Only picks are internal evidence and never reached a member, so
    // every published figure below is computed over `published` -- the cohort
    // with the Track Only rows removed. The Track Only cohort is reported
    // separately and by name rather than being silently dropped.
    const trackOnlyRows = enriched.filter((r) => r._trackOnly);
    const published = enriched.filter((r) => !r._trackOnly);

    // Time-window partitioning
    function inWindow(row: EnrichedRow, from: string): boolean {
      const ts = row._settledAt ?? '';
      return ts >= from;
    }

    const rowsToday = published.filter((r) => inWindow(r, todayStart));
    const rows7d = published.filter((r) => inWindow(r, cutoff7d));
    const rows30d = published.filter((r) => inWindow(r, cutoff30d));
    const rowsMtd = published.filter((r) => inWindow(r, mtdStart));

    // bySource grouping
    const capperRows = published.filter((r) => r._attribution === 'capper');
    const systemRows = published.filter((r) => r._attribution === 'system');

    // bySport grouping
    const sportMap = new Map<string, EnrichedRow[]>();
    for (const row of published) {
      const sport = row._sport;
      if (!sportMap.has(sport)) sportMap.set(sport, []);
      sportMap.get(sport)!.push(row);
    }

    // byIndividualSource grouping
    const sourceMap = new Map<string, EnrichedRow[]>();
    for (const row of published) {
      const src = row._source;
      if (!sourceMap.has(src)) sourceMap.set(src, []);
      sourceMap.get(src)!.push(row);
    }

    // decisions grouping
    const approvedRows = published.filter((r) => r._reviewDecision === 'approve');
    const deniedRows = published.filter((r) => r._reviewDecision === 'deny');
    const heldRows = published.filter((r) => r._reviewDecision === 'hold');

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

    // A delta between two ROIs only exists when both were measured. Treating an
    // unmeasured cohort as 0 would manufacture a delta out of missing data.
    const approvedVsDeniedDelta =
      approvedStats.roiPct !== null && deniedStats.roiPct !== null
        ? Math.round((approvedStats.roiPct - deniedStats.roiPct) * 10) / 10
        : null;

    // Per-capper published statistics, partitioned on the canonical capper_id,
    // plus the Unit Talk aggregate over the same rows. Both come from the same
    // computeStats over the same cohort, so a per-capper total that disagrees
    // with the aggregate is a defect in one of them, not two opinions.
    const capperIdMap = new Map<string, EnrichedRow[]>();
    for (const row of capperRows) {
      const id = row._capperId;
      if (id === null) continue;
      if (!capperIdMap.has(id)) capperIdMap.set(id, []);
      capperIdMap.get(id)!.push(row);
    }
    const byCapper: Record<string, Stats> = {};
    for (const [id, rows] of capperIdMap.entries()) byCapper[id] = computeStats(rows);

    const trackOnly = {
      stats: computeStats(trackOnlyRows),
      byCapper: (() => {
        const map = new Map<string, EnrichedRow[]>();
        for (const row of trackOnlyRows) {
          const id = row._capperId;
          if (id === null) continue;
          if (!map.has(id)) map.set(id, []);
          map.get(id)!.push(row);
        }
        const out: Record<string, Stats> = {};
        for (const [id, rows] of map.entries()) out[id] = computeStats(rows);
        return out;
      })(),
    };

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
      byCapper,
      unitTalkAggregate: computeStats(published),
      trackOnly,
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

export interface LeaderboardResult {
  rows: LeaderboardRow[];
  /** Non-null when a query failed — the page must surface this, not render an empty board. */
  error: string | null;
}

export async function getLeaderboard(days: number): Promise<LeaderboardResult> {
  try {
    const cohort = await getPerformanceCohort();
    const cutoff = daysAgoIso(days);
    const settlementRows: Row[] = cohort.settlements.filter((row) => row.status === 'settled' && row.settled_at >= cutoff);
    const picksMap = new Map<string, Row>();
    for (const pick of cohort.picks) if (pick.id) picksMap.set(pick.id, pick);

    // Group by the canonical capper_id. A pick with no capper_id has no capper,
    // so it produces no leaderboard row at all -- it is not filed under a made-up
    // name derived from its intake `source`. Track Only picks are internal
    // evidence and are excluded from this published board.
    const capperMap = new Map<string, { rows: Row[]; clvSum: number; clvCount: number }>();

    for (const sr of settlementRows) {
      const pickId = asString(sr['pick_id']) ?? '';
      // Same driving predicate as getPerformanceData: picksMap is governed-only,
      // so an absent pick is a fixture settlement and produces no board row.
      const pick = resolveGovernedPick(picksMap, pickId);
      if (pick === null) continue;
      if (isTestFixturePick(pick)) continue;
      if (isTrackOnlyPick(pick)) continue;
      const capperId = resolveCapperId(pick);
      if (capperId === null) continue;
      const payload = asRecord(sr['payload']);
      const clv = asNumber(payload['clvPercent']);

      if (!capperMap.has(capperId)) {
        capperMap.set(capperId, { rows: [], clvSum: 0, clvCount: 0 });
      }
      const entry = capperMap.get(capperId)!;
      // Carry the pick's real price and stake onto the settlement row so the
      // board's ROI is units-weighted rather than a flat -110 assumption.
      entry.rows.push({ ...sr, odds: asNumber(pick['odds']), stake_units: asNumber(pick['stake_units']) });
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
        unitsStaked: stats.unitsStaked,
        unitsNet: stats.unitsNet,
        unpriced: stats.unpriced,
        avgClvPct,
      });
    }

    // Sort by ROI descending. An unpriceable capper sorts last rather than
    // ranking as if they had broken even.
    result.sort((a, b) => (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity));
    return { rows: result, error: null };
  } catch (err) {
    console.error('[analytics] getLeaderboard error:', err);
    return { rows: [], error: 'Performance records could not be reconciled. Refresh to retry.' };
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
    const client: Client = await getDataClient();

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

  const hitDenominator = wins + losses;
  const hitRatePct = hitDenominator > 0 ? Math.round((wins / hitDenominator) * 1000) / 10 : 0;
  // Units-weighted, from the same real odds and stake the cohort statistics use.
  const roiPct = computeStats(rows).roiPct;

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

/**
 * Reduce settlement rows to one effective row per pick.
 *
 * A pick's result is the tip of its correction chain (`corrects_id` → prior
 * record), never the root: reading `corrects_id IS NULL` reports the superseded
 * result of every corrected pick. A chain that does not resolve -- a correction
 * whose target is not in the rows, two roots, a cycle -- is excluded and
 * counted rather than guessed. Only a `settled` tip is returned; a tip in
 * `manual_review` is not a settlement yet.
 *
 * Rows are ordered by the chain ROOT's `settled_at`, newest first, so a late
 * correction does not move an old game to the front of the recent-form window.
 */
export function selectEffectiveSettlementRows(rows: Row[]): { rows: Row[]; unresolvedPickCount: number } {
  const byPick = new Map<string, Row[]>();
  for (const row of rows) {
    const pickId = asString(row['pick_id']);
    if (pickId === null) continue;
    const group = byPick.get(pickId);
    if (group) group.push(row); else byPick.set(pickId, [row]);
  }
  const effective: Array<{ row: Row; rootSettledAt: string }> = [];
  let unresolvedPickCount = 0;
  for (const [pickId, group] of byPick) {
    const ids = new Set(group.map((row) => asString(row['id'])));
    const inputs: SettlementInput[] = [];
    let wellFormed = true;
    for (const row of group) {
      const id = asString(row['id']);
      const status = asString(row['status']);
      const settledAt = asString(row['settled_at']);
      const correctsId = asString(row['corrects_id']);
      if (id === null || settledAt === null || (status !== 'settled' && status !== 'manual_review')
        || (correctsId !== null && !ids.has(correctsId))) {
        wellFormed = false;
        break;
      }
      inputs.push({
        id, pick_id: pickId, status, result: asString(row['result']),
        confidence: safeString(row['confidence']), corrects_id: correctsId, settled_at: settledAt,
      });
    }
    const resolved = wellFormed ? resolveEffectiveSettlement(inputs) : null;
    if (!resolved || !resolved.ok || resolved.settlement.correction_depth + 1 !== group.length) {
      unresolvedPickCount++;
      continue;
    }
    if (resolved.settlement.status !== 'settled') continue;
    const tip = group.find((row) => asString(row['id']) === resolved.settlement.effective_record_id)!;
    const root = inputs.find((input) => input.corrects_id === null)!;
    effective.push({ row: tip, rootSettledAt: root.settled_at });
  }
  effective.sort((a, b) => (a.rootSettledAt < b.rootSettledAt ? 1 : a.rootSettledAt > b.rootSettledAt ? -1 : 0));
  return { rows: effective.map((e) => e.row), unresolvedPickCount };
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
    const client: Client = await getDataClient();

    // The picks behind the last 200 settlement records, most recent first. Only
    // pick ids are read here: a pick's result is the tip of its correction chain,
    // so its full history is read below and reduced to one effective row.
    const [recentResult, holdsResult] = await Promise.all([
      client
        .from('settlement_records')
        .select('pick_id')
        .order('settled_at', { ascending: false })
        .limit(200),
      client
        .from('picks_current_state')
        .select('id, status', { count: 'exact' })
        .eq('review_decision', 'hold'),
    ]);

    if (recentResult.error) {
      console.error('[analytics] getIntelligenceData settlement error:', recentResult.error);
      return null;
    }

    const recentPickIds = [
      ...new Set(((recentResult.data ?? []) as Row[]).map((r) => asString(r['pick_id'])).filter(Boolean)),
    ] as string[];
    const history: Row[] = [];
    for (let start = 0; start < recentPickIds.length; start += 100) {
      const historyResult = await client
        .from('settlement_records')
        .select('id, pick_id, result, status, confidence, corrects_id, payload, created_at, settled_at')
        .in('pick_id', recentPickIds.slice(start, start + 100));
      if (historyResult.error) {
        console.error('[analytics] getIntelligenceData settlement history error:', historyResult.error);
        return null;
      }
      history.push(...((historyResult.data ?? []) as Row[]));
    }
    const effectiveSettlements = selectEffectiveSettlementRows(history);
    const settlementRows = effectiveSettlements.rows;
    const holdsTotal = holdsResult.count ?? 0;
    const holdsResolvedCount = (holdsResult.data ?? []).filter(
      (r: Row) => safeString(r['status']) === 'settled',
    ).length;

    // Collect pick IDs
    const pickIds = [...new Set(settlementRows.map((r) => asString(r['pick_id'])).filter(Boolean))] as string[];

    const picksMap = new Map<string, Row>();
    const pcsMap = new Map<string, Row>();

    if (pickIds.length > 0) {
      const [picksResult, pcsResult] = await Promise.all([
        applyPickPopulation(client
          .from('picks')
          .select('id, source, capper_id, odds, stake_units, metadata, promotion_score')
          .in('id', pickIds), 'governed'),
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
      _attribution: 'capper' | 'system';
      _trackOnly: boolean;
      _sport: string;
      _score: number | null;
      _reviewDecision: string | null;
    }

    const enriched: IntelRow[] = settlementRows.flatMap((sr) => {
      const pickId = asString(sr['pick_id']) ?? '';
      // Governed membership is the driving predicate, not a join enrichment.
      // picksMap holds only governed rows, so a settlement whose pick is absent
      // belongs to the fixture corpus and is dropped -- never carried forward as
      // an `unknown` source with null units, which would silently distort ROI.
      const pick = resolveGovernedPick(picksMap, pickId);
      if (pick === null) return [];
      if (isTestFixturePick(pick)) return [];
      const pcs = pcsMap.get(pickId) ?? {};
      const metadata = asRecord(pick['metadata']);
      return [{
        ...sr,
        odds: asNumber(pick['odds']),
        stake_units: asNumber(pick['stake_units']),
        _source: safeString(pick['source'], 'unknown'),
        _attribution: classifyAttribution(pick),
        _trackOnly: isTrackOnlyPick(pick),
        _sport: extractSport(metadata),
        _score: asNumber(pick['promotion_score']),
        _reviewDecision: asString(pcs['review_decision']),
      }];
    });

    // Track Only evidence never reached a member, so it is out of every figure
    // this surface publishes -- including recent form and the score bands.
    const publishedIntel = enriched.filter((r) => !r._trackOnly);

    // Recent form — overall
    const overallForm = computeFormWindow(publishedIntel);

    // Attribution is the canonical capper_id, never a substring of `source`.
    const capperEnriched = publishedIntel.filter((r) => r._attribution === 'capper');
    const systemEnriched = publishedIntel.filter((r) => r._attribution === 'system');
    const approvedEnriched = publishedIntel.filter((r) => r._reviewDecision === 'approve');
    const deniedEnriched = publishedIntel.filter((r) => r._reviewDecision === 'deny');

    // By sport
    const sportGroups = new Map<string, IntelRow[]>();
    for (const row of publishedIntel) {
      const sport = row._sport;
      if (!sport || sport === 'unknown') continue;
      if (!sportGroups.has(sport)) sportGroups.set(sport, []);
      sportGroups.get(sport)!.push(row);
    }

    // By individual source
    const srcGroups = new Map<string, IntelRow[]>();
    for (const row of publishedIntel) {
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
      const bandRows = publishedIntel.filter((r) => {
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
    const scoredRows = publishedIntel.filter((r) => r._score !== null);
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
    // Only a delta between two measured ROIs is a delta. Null in, null out.
    const approvedVsDeniedRoiDelta =
      approvedStats.roiPct !== null && deniedStats.roiPct !== null
        ? Math.round((approvedStats.roiPct - deniedStats.roiPct) * 10) / 10
        : null;

    // Feedback loop — last 50 settled picks
    const feedbackLoop: FeedbackEntry[] = publishedIntel.slice(0, 50).map((row) => {
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
    // A band whose ROI could not be measured is not the best band.
    let bestScoreBand: { range: string; roiPct: number } | null = null;
    for (const band of scoreBands) {
      if (band.roiPct === null) continue;
      if (band.total >= 5 && (bestScoreBand === null || band.roiPct > bestScoreBand.roiPct)) {
        bestScoreBand = { range: band.range, roiPct: band.roiPct };
      }
    }

    const warnings: Array<{ segment: string; message: string }> = [];
    if (effectiveSettlements.unresolvedPickCount > 0) {
      warnings.push({
        segment: 'Settlement History',
        message: `${effectiveSettlements.unresolvedPickCount} pick(s) excluded — their settlement correction chain does not resolve to one effective result.`,
      });
    }
    if (sampleSize < 20) {
      warnings.push({ segment: 'Score Quality', message: 'Sample size is below 20 — score correlation should not be treated as reliable.' });
    }
    if (correlation === 'negative') {
      warnings.push({ segment: 'Score Quality', message: 'Score-outcome correlation is negative — the promotion score may not be predictive of wins.' });
    }
    if (approvedStats.roiPct !== null && approvedStats.roiPct < 0 && approvedSettled.length >= 10) {
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
