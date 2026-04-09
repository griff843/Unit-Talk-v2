/**
 * ISyndicateBoardRepository — interface and implementations for syndicate_board table.
 *
 * Phase 4 — UTV2-474: Board Construction Service
 *
 * syndicate_board stores the output of the board construction service:
 * a bounded, scarcity-filtered top-N list of pick_candidates for the current cycle.
 *
 * Hard Phase 4 invariants (never violate):
 *   - Never writes to picks table
 *   - Never sets pick_id on any candidate
 *   - Never sets shadow_mode=false
 *   - No governance/approval logic
 */

import crypto from 'node:crypto';
import type { UnitTalkSupabaseClient } from './client.js';
import { createDatabaseClientFromConnection, type DatabaseConnectionConfig } from './client.js';

export interface SyndicateBoardInsertInput {
  candidate_id: string;
  board_rank: number;
  board_tier: string;
  sport_key: string;
  market_type_id: string | null;
  model_score: number;
  board_run_id: string;
}

export interface SyndicateBoardRow {
  id: string;
  candidate_id: string;
  board_rank: number;
  board_tier: string;
  sport_key: string;
  market_type_id: string | null;
  model_score: number;
  board_run_id: string;
  created_at: string;
  updated_at: string;
}

export interface ISyndicateBoardRepository {
  /**
   * Insert a full board run. All rows share the same board_run_id.
   * Returns the board_run_id (same value passed in the rows).
   *
   * Implementation note: rows are inserted as a batch. If the batch is empty,
   * the implementation MUST still return the board_run_id without error.
   */
  insertBoardRun(rows: SyndicateBoardInsertInput[]): Promise<string>;

  /**
   * Return all rows from the most recent board run, ordered by board_rank ASC.
   *
   * "Most recent" = the board run with the latest created_at among all distinct
   * board_run_ids. If no rows exist, returns [].
   */
  listLatestBoardRun(): Promise<SyndicateBoardRow[]>;
}

// =============================================================================
// InMemorySyndicateBoardRepository — in-process store for unit tests.
// =============================================================================

export class InMemorySyndicateBoardRepository implements ISyndicateBoardRepository {
  private readonly rows: SyndicateBoardRow[] = [];

  async insertBoardRun(inputs: SyndicateBoardInsertInput[]): Promise<string> {
    if (inputs.length === 0) {
      // Return the board_run_id from the inputs if present, else generate one.
      // Callers always pass a pre-generated board_run_id; but handle empty gracefully.
      return inputs[0]?.board_run_id ?? crypto.randomUUID();
    }

    const boardRunId = inputs[0]!.board_run_id;
    const now = new Date().toISOString();

    for (const input of inputs) {
      this.rows.push({
        id: crypto.randomUUID(),
        candidate_id: input.candidate_id,
        board_rank: input.board_rank,
        board_tier: input.board_tier,
        sport_key: input.sport_key,
        market_type_id: input.market_type_id,
        model_score: input.model_score,
        board_run_id: input.board_run_id,
        created_at: now,
        updated_at: now,
      });
    }

    return boardRunId;
  }

  async listLatestBoardRun(): Promise<SyndicateBoardRow[]> {
    if (this.rows.length === 0) return [];

    // Find the board_run_id with the latest created_at
    const runTimes = new Map<string, string>();
    for (const row of this.rows) {
      const existing = runTimes.get(row.board_run_id);
      if (!existing || row.created_at > existing) {
        runTimes.set(row.board_run_id, row.created_at);
      }
    }

    // Find the board_run_id with the max time
    let latestRunId = '';
    let latestTime = '';
    for (const [runId, time] of runTimes.entries()) {
      if (time > latestTime) {
        latestTime = time;
        latestRunId = runId;
      }
    }

    return this.rows
      .filter((r) => r.board_run_id === latestRunId)
      .sort((a, b) => a.board_rank - b.board_rank);
  }

  /** Test helper: return all rows. */
  listAll(): SyndicateBoardRow[] {
    return [...this.rows];
  }
}

// =============================================================================
// DatabaseSyndicateBoardRepository — Supabase implementation.
//
// Uses `fromUntyped` pattern since syndicate_board is not in generated types.
// =============================================================================

type UntypedQueryBuilder = {
  insert(data: unknown): UntypedQueryBuilder;
  select(columns?: string): UntypedQueryBuilder;
  order(column: string, opts?: { ascending?: boolean }): UntypedQueryBuilder;
  eq(column: string, value: unknown): UntypedQueryBuilder;
  then: Promise<{ data: unknown; error: { message: string } | null }>['then'];
};

type UntypedSupabaseClient = {
  from(table: string): UntypedQueryBuilder;
};

function fromUntyped(client: UnitTalkSupabaseClient, table: string): UntypedQueryBuilder {
  return (client as unknown as UntypedSupabaseClient).from(table);
}

export class DatabaseSyndicateBoardRepository implements ISyndicateBoardRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async insertBoardRun(inputs: SyndicateBoardInsertInput[]): Promise<string> {
    if (inputs.length === 0) {
      return inputs[0]?.board_run_id ?? crypto.randomUUID();
    }

    const boardRunId = inputs[0]!.board_run_id;
    const now = new Date().toISOString();

    const rows = inputs.map((input) => ({
      candidate_id: input.candidate_id,
      board_rank: input.board_rank,
      board_tier: input.board_tier,
      sport_key: input.sport_key,
      market_type_id: input.market_type_id,
      model_score: input.model_score,
      board_run_id: input.board_run_id,
      created_at: now,
      updated_at: now,
    }));

    const { error } = await (fromUntyped(this.client, 'syndicate_board').insert(rows) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);

    if (error) {
      throw new Error(`syndicate_board insertBoardRun failed: ${error.message}`);
    }

    return boardRunId;
  }

  async listLatestBoardRun(): Promise<SyndicateBoardRow[]> {
    // Fetch all rows ordered by created_at DESC to find the latest run's rows
    // We use a two-step approach: first find the latest board_run_id, then fetch its rows.
    // Since syndicate_board is not in generated types we use fromUntyped.

    // Step 1: get the most recent board_run_id
    const { data: runData, error: runError } = await (fromUntyped(this.client, 'syndicate_board')
      .select('board_run_id, created_at')
      .order('created_at', { ascending: false }) as unknown as Promise<{ data: Array<{ board_run_id: string; created_at: string }> | null; error: { message: string } | null }>);

    if (runError) {
      throw new Error(`syndicate_board listLatestBoardRun (step 1) failed: ${runError.message}`);
    }

    if (!runData || runData.length === 0) return [];

    const latestRunId = runData[0]!.board_run_id;

    // Step 2: fetch all rows for that run, ordered by board_rank
    const { data, error } = await (fromUntyped(this.client, 'syndicate_board')
      .select('*')
      .eq('board_run_id', latestRunId)
      .order('board_rank', { ascending: true }) as unknown as Promise<{ data: SyndicateBoardRow[] | null; error: { message: string } | null }>);

    if (error) {
      throw new Error(`syndicate_board listLatestBoardRun (step 2) failed: ${error.message}`);
    }

    return data ?? [];
  }
}
