/**
 * Board Queue route — GET /api/operator/board-queue
 *
 * Returns the latest syndicate_board run annotated with pick-link status.
 * Used by the Command Center Decision workspace to render the governed
 * write queue and distinguish pending candidates from already-written picks.
 *
 * Data sources:
 *   syndicate_board   — ranked board rows for the latest run
 *   pick_candidates   — pick_id / shadow_mode / status per candidate
 *   market_universe   — market key, odds, line for display
 *
 * Read-only. Mutations go through POST /api/board/write-picks in apps/api.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

// ---------------------------------------------------------------------------
// Response types (mirrored in command-center/src/lib/types.ts)
// ---------------------------------------------------------------------------

export interface BoardQueueRow {
  boardRank: number;
  boardTier: string;
  candidateId: string;
  boardRunId: string;
  sportKey: string;
  modelScore: number;
  /** null = pending write; non-null = already written */
  pickId: string | null;
  /** true until pick_id linked */
  shadowMode: boolean;
  /** from market_universe */
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

// ---------------------------------------------------------------------------
// Empty response
// ---------------------------------------------------------------------------

function emptyBoardQueue(): BoardQueueData {
  return {
    boardRunId: '',
    observedAt: new Date().toISOString(),
    totalRows: 0,
    pendingCount: 0,
    writtenCount: 0,
    rows: [],
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleBoardQueueRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };

  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: emptyBoardQueue() });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  // Step 1: find the latest board_run_id
  const { data: latestRunRows, error: runError } = await client
    .from('syndicate_board')
    .select('board_run_id, created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  if (runError) {
    writeJson(response, 500, {
      ok: false,
      error: { code: 'DB_ERROR', message: String(runError.message ?? runError) },
    });
    return;
  }

  if (!latestRunRows || latestRunRows.length === 0) {
    writeJson(response, 200, { ok: true, data: emptyBoardQueue() });
    return;
  }

  const latestRunId = String(latestRunRows[0].board_run_id);

  // Step 2: fetch all board rows for that run
  const { data: boardRows, error: boardError } = await client
    .from('syndicate_board')
    .select('candidate_id, board_rank, board_tier, board_run_id, sport_key, model_score')
    .eq('board_run_id', latestRunId)
    .order('board_rank', { ascending: true });

  if (boardError) {
    writeJson(response, 500, {
      ok: false,
      error: { code: 'DB_ERROR', message: String(boardError.message ?? boardError) },
    });
    return;
  }

  const rows = (boardRows ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    writeJson(response, 200, { ok: true, data: emptyBoardQueue() });
    return;
  }

  const candidateIds = rows.map((r) => String(r['candidate_id']));

  // Step 3: fetch candidate rows (pick_id, shadow_mode, universe_id)
  const { data: candidateRows, error: candidateError } = await client
    .from('pick_candidates')
    .select('id, universe_id, pick_id, shadow_mode, status')
    .in('id', candidateIds);

  if (candidateError) {
    writeJson(response, 500, {
      ok: false,
      error: { code: 'DB_ERROR', message: String(candidateError.message ?? candidateError) },
    });
    return;
  }

  const candidates = (candidateRows ?? []) as Array<Record<string, unknown>>;
  const candidateMap = new Map(candidates.map((c) => [String(c['id']), c]));

  const universeIds = [...new Set(candidates.map((c) => String(c['universe_id'])))];

  // Step 4: fetch market_universe rows for display data
  const { data: universeRows, error: universeError } = await client
    .from('market_universe')
    .select('id, canonical_market_key, current_line, current_over_odds, current_under_odds, sport_key, league_key')
    .in('id', universeIds);

  if (universeError) {
    writeJson(response, 500, {
      ok: false,
      error: { code: 'DB_ERROR', message: String(universeError.message ?? universeError) },
    });
    return;
  }

  const universes = (universeRows ?? []) as Array<Record<string, unknown>>;
  const universeMap = new Map(universes.map((u) => [String(u['id']), u]));

  // Step 5: assemble response rows
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

  writeJson(response, 200, {
    ok: true,
    data: {
      boardRunId: latestRunId,
      observedAt: new Date().toISOString(),
      totalRows: queueRows.length,
      pendingCount,
      writtenCount,
      rows: queueRows,
    } satisfies BoardQueueData,
  });
}
