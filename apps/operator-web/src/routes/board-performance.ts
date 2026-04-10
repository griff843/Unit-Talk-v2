/**
 * Board Performance route — GET /api/board/performance
 *
 * Returns governed pick performance data from the v_governed_pick_performance
 * view, which joins picks, pick_candidates, syndicate_board, market_universe,
 * and settlement_records into a single attribution row per governed pick.
 *
 * Optional query param: ?boardRunId=<uuid> to filter to a specific board run.
 *
 * Read-only. Used by the Command Center attribution surface.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

// ---------------------------------------------------------------------------
// Response types (mirrored in command-center/src/lib/types.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleBoardPerformanceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };

  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: [] });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  // Parse optional boardRunId query param
  const rawUrl = request.url ?? '';
  const urlObj = new URL(rawUrl, 'http://localhost');
  const boardRunId = urlObj.searchParams.get('boardRunId') ?? null;

  let query = client
    .from('v_governed_pick_performance')
    .select('*')
    .order('board_rank', { ascending: true });

  if (boardRunId) {
    query = query.eq('board_run_id', boardRunId);
  }

  const { data, error } = await query;

  if (error) {
    writeJson(response, 500, {
      ok: false,
      error: String(error.message ?? error),
    });
    return;
  }

  writeJson(response, 200, {
    ok: true,
    data: (data ?? []) as GovernedPickPerformanceRow[],
  });
}
