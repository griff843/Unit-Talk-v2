import { getDataClient } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const DEFAULT_CAPS = { perSlate: 15, perSport: 10, perGame: 2 } as const;
const DEFAULT_THRESHOLD = 70;
const DEFAULT_WEIGHTS = { edge: 0.4, trust: 0.2, readiness: 0.2, uniqueness: 0.1, boardFit: 0.1 } as const;

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function toStatus(utilization: number): 'open' | 'near-cap' | 'at-cap' {
  if (utilization >= 1.0) return 'at-cap';
  if (utilization >= 0.75) return 'near-cap';
  return 'open';
}

function roundPct(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.round((n / d) * 1000) / 1000;
}

export async function getBoardState(target = 'best-bets'): Promise<{ ok: true; data: unknown }> {
  const client: Client = getDataClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await client
    .from('pick_promotion_history')
    .select('id, pick_id, target, status, score, reason, payload, decided_at')
    .eq('target', target)
    .gte('decided_at', cutoff)
    .order('decided_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`getBoardState: ${String(error.message ?? error)}`);
  }

  const historyRows = (rows ?? []) as Array<Record<string, unknown>>;
  const firstPayload = asRecord(historyRows[0]?.['payload']);
  const payloadCaps = asRecord(firstPayload['boardCaps']);
  const caps = {
    perSlate: asNumber(payloadCaps['perSlate'], DEFAULT_CAPS.perSlate),
    perSport: asNumber(payloadCaps['perSport'], DEFAULT_CAPS.perSport),
    perGame: asNumber(payloadCaps['perGame'], DEFAULT_CAPS.perGame),
  };

  const qualified = historyRows.filter((r) => asString(r['status']) === 'qualified');
  const blocked = historyRows.filter((r) => asString(r['status']) !== 'qualified');
  const slateCount = qualified.length;

  const sportCounts = new Map<string, number>();
  for (const row of qualified) {
    const payload = asRecord(row['payload']);
    const scoreInputs = asRecord(payload['scoreInputs']);
    const sport = asString(scoreInputs['sport'] ?? payload['sport'] ?? row['sport']);
    if (sport) sportCounts.set(sport, (sportCounts.get(sport) ?? 0) + 1);
  }

  const gameCounts = new Map<string, number>();
  for (const row of qualified) {
    const payload = asRecord(row['payload']);
    const gameId = asString(payload['eventName'] ?? payload['gameId'] ?? payload['providerEventId']);
    if (gameId) gameCounts.set(gameId, (gameCounts.get(gameId) ?? 0) + 1);
  }

  const scoreBreakdowns = historyRows.map((row) => {
    const payload = asRecord(row['payload']);
    const scoreInputs = asRecord(payload['scoreInputs']);
    const policyWeights = asRecord(asRecord(payload['policy'])['weights']);
    const weights = {
      edge: asNumber(policyWeights['edge'], DEFAULT_WEIGHTS.edge),
      trust: asNumber(policyWeights['trust'], DEFAULT_WEIGHTS.trust),
      readiness: asNumber(policyWeights['readiness'], DEFAULT_WEIGHTS.readiness),
      uniqueness: asNumber(policyWeights['uniqueness'], DEFAULT_WEIGHTS.uniqueness),
      boardFit: asNumber(policyWeights['boardFit'], DEFAULT_WEIGHTS.boardFit),
    };
    const components = {
      edge: asNumber(scoreInputs['edge'], 0),
      trust: asNumber(scoreInputs['trust'], 0),
      readiness: asNumber(scoreInputs['readiness'], 0),
      uniqueness: asNumber(scoreInputs['uniqueness'], 50),
      boardFit: asNumber(scoreInputs['boardFit'], 0),
    };
    const threshold = asNumber(payload['minimumScore'] ?? asRecord(payload['policy'])['minimumScore'], DEFAULT_THRESHOLD);
    const totalScore = asNumber(row['score'], 0);
    return {
      pickId: asString(row['pick_id']),
      target: asString(row['target']),
      status: asString(row['status']),
      totalScore,
      threshold,
      qualifiedOnScore: totalScore >= threshold,
      components,
      weights,
      componentsWeighted: {
        edge: Math.round(components.edge * weights.edge * 10) / 10,
        trust: Math.round(components.trust * weights.trust * 10) / 10,
        readiness: Math.round(components.readiness * weights.readiness * 10) / 10,
        uniqueness: Math.round(components.uniqueness * weights.uniqueness * 10) / 10,
        boardFit: Math.round(components.boardFit * weights.boardFit * 10) / 10,
      },
      thresholdDelta: Math.round((totalScore - threshold) * 10) / 10,
      decidedAt: asString(row['decided_at']),
    };
  });

  const conflictCards = blocked
    .filter((row) => asNumber(row['score'], 0) >= DEFAULT_THRESHOLD)
    .map((row) => {
      const payload = asRecord(row['payload']);
      const reason = asString(row['reason']);
      let conflictReason: 'slate-cap' | 'sport-cap' | 'game-cap' | 'duplicate' | 'other' = 'other';
      const reasonLower = reason.toLowerCase();
      if (reasonLower.includes('slate') || reasonLower.includes('board count') || reasonLower.includes('perslate')) conflictReason = 'slate-cap';
      else if (reasonLower.includes('sport') || reasonLower.includes('persport')) conflictReason = 'sport-cap';
      else if (reasonLower.includes('game') || reasonLower.includes('pergame')) conflictReason = 'game-cap';
      else if (reasonLower.includes('duplicate') || reasonLower.includes('unique')) conflictReason = 'duplicate';
      const scoreInputs = asRecord(asRecord(payload['scoreInputs']));
      return {
        pickId: asString(row['pick_id']),
        status: asString(row['status']),
        totalScore: asNumber(row['score'], 0),
        threshold: DEFAULT_THRESHOLD,
        thresholdDelta: Math.round((asNumber(row['score'], 0) - DEFAULT_THRESHOLD) * 10) / 10,
        conflictReason,
        rawReason: reason,
        sport: asString(scoreInputs['sport'] ?? payload['sport'] ?? ''),
        decidedAt: asString(row['decided_at']),
      };
    });

  const bySport = Array.from(sportCounts.entries()).map(([sportKey, current]) => ({
    sportKey, current, cap: caps.perSport, utilization: roundPct(current, caps.perSport), status: toStatus(roundPct(current, caps.perSport)),
  }));
  const byGame = Array.from(gameCounts.entries()).map(([gameId, current]) => ({
    gameId, current, cap: caps.perGame, utilization: roundPct(current, caps.perGame), status: toStatus(roundPct(current, caps.perGame)),
  }));

  return {
    ok: true,
    data: {
      window: '24h',
      computedAt: new Date().toISOString(),
      target,
      caps,
      slate: { current: slateCount, cap: caps.perSlate, utilization: roundPct(slateCount, caps.perSlate), status: toStatus(roundPct(slateCount, caps.perSlate)) },
      bySport,
      byGame,
      scoreBreakdowns,
      conflictCards,
    },
  };
}

export interface BoardQueueRow {
  boardRank: number;
  boardTier: string;
  candidateId: string;
  boardRunId: string;
  sportKey: string;
  modelScore: number;
  pickId: string | null;
  shadowMode: boolean;
  canonicalMarketKey: string;
  currentLine: number | null;
  currentOverOdds: number | null;
  currentUnderOdds: number | null;
  universeId: string;
}

export interface BoardQueueData {
  boardRunId: string;
  observedAt: string;
  totalRows: number;
  pendingCount: number;
  writtenCount: number;
  rows: BoardQueueRow[];
}

export async function getBoardQueue(): Promise<{ ok: true; data: BoardQueueData }> {
  const client: Client = getDataClient();

  const { data: latestRunRows, error: runError } = await client
    .from('syndicate_board')
    .select('board_run_id, created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  if (runError) throw new Error(`getBoardQueue: ${String(runError.message ?? runError)}`);

  if (!latestRunRows || latestRunRows.length === 0) {
    return { ok: true, data: { boardRunId: '', observedAt: new Date().toISOString(), totalRows: 0, pendingCount: 0, writtenCount: 0, rows: [] } };
  }

  const latestRunId = String(latestRunRows[0].board_run_id);

  const { data: boardRows, error: boardError } = await client
    .from('syndicate_board')
    .select('candidate_id, board_rank, board_tier, board_run_id, sport_key, model_score')
    .eq('board_run_id', latestRunId)
    .order('board_rank', { ascending: true });

  if (boardError) throw new Error(`getBoardQueue: ${String(boardError.message ?? boardError)}`);

  const rows = (boardRows ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return { ok: true, data: { boardRunId: latestRunId, observedAt: new Date().toISOString(), totalRows: 0, pendingCount: 0, writtenCount: 0, rows: [] } };
  }

  const candidateIds = rows.map((r) => String(r['candidate_id']));

  const { data: candidateRows, error: candidateError } = await client
    .from('pick_candidates')
    .select('id, universe_id, pick_id, shadow_mode, status')
    .in('id', candidateIds);

  if (candidateError) throw new Error(`getBoardQueue: ${String(candidateError.message ?? candidateError)}`);

  const candidates = (candidateRows ?? []) as Array<Record<string, unknown>>;
  const candidateMap = new Map(candidates.map((c) => [String(c['id']), c]));
  const universeIds = [...new Set(candidates.map((c) => String(c['universe_id'])))];

  const { data: universeRows, error: universeError } = await client
    .from('market_universe')
    .select('id, canonical_market_key, current_line, current_over_odds, current_under_odds, sport_key, league_key')
    .in('id', universeIds);

  if (universeError) throw new Error(`getBoardQueue: ${String(universeError.message ?? universeError)}`);

  const universes = (universeRows ?? []) as Array<Record<string, unknown>>;
  const universeMap = new Map(universes.map((u) => [String(u['id']), u]));

  const queueRows: BoardQueueRow[] = [];
  for (const boardRow of rows) {
    const candidateId = String(boardRow['candidate_id']);
    const candidate = candidateMap.get(candidateId);
    if (!candidate) continue;
    const universeId = String(candidate['universe_id']);
    const universe = universeMap.get(universeId);
    queueRows.push({
      boardRank: Number(boardRow['board_rank']),
      boardTier: String(boardRow['board_tier'] ?? 'STANDARD'),
      candidateId,
      boardRunId: latestRunId,
      sportKey: String(boardRow['sport_key'] ?? universe?.['sport_key'] ?? ''),
      modelScore: Number(boardRow['model_score'] ?? 0),
      pickId: candidate['pick_id'] != null ? String(candidate['pick_id']) : null,
      shadowMode: Boolean(candidate['shadow_mode'] ?? true),
      canonicalMarketKey: String(universe?.['canonical_market_key'] ?? ''),
      currentLine: universe?.['current_line'] != null ? Number(universe['current_line']) : null,
      currentOverOdds: universe?.['current_over_odds'] != null ? Number(universe['current_over_odds']) : null,
      currentUnderOdds: universe?.['current_under_odds'] != null ? Number(universe['current_under_odds']) : null,
      universeId,
    });
  }

  const pendingCount = queueRows.filter((r) => r.pickId === null).length;
  const writtenCount = queueRows.filter((r) => r.pickId !== null).length;

  return {
    ok: true,
    data: { boardRunId: latestRunId, observedAt: new Date().toISOString(), totalRows: queueRows.length, pendingCount, writtenCount, rows: queueRows },
  };
}

export interface GovernedPickPerformanceRow {
  pick_id: string;
  market: string | null;
  selection: string | null;
  odds: number | null;
  pick_status: string | null;
  settled_at: string | null;
  pick_created_at: string | null;
  metadata: Record<string, unknown> | null;
  board_run_id: string | null;
  board_rank: number | null;
  board_tier: string | null;
  sport_key: string | null;
  market_type_id: string | null;
  board_model_score: number | null;
  candidate_id: string | null;
  universe_id: string | null;
  candidate_model_score: number | null;
  model_confidence: number | null;
  model_tier: string | null;
  selection_rank: number | null;
  provider_key: string | null;
  provider_market_key: string | null;
  settlement_id: string | null;
  settlement_result: string | null;
  settlement_status: string | null;
  settlement_settled_at: string | null;
  settled_by: string | null;
  settlement_confidence: number | null;
}

export async function getBoardPerformance(boardRunId?: string | null): Promise<{ ok: true; data: GovernedPickPerformanceRow[] }> {
  const client: Client = getDataClient();

  let query = client
    .from('v_governed_pick_performance')
    .select('*')
    .order('board_rank', { ascending: true });

  if (boardRunId) query = query.eq('board_run_id', boardRunId);

  const { data, error } = await query;
  if (error) throw new Error(`getBoardPerformance: ${String(error.message ?? error)}`);

  return { ok: true, data: (data ?? []) as GovernedPickPerformanceRow[] };
}
