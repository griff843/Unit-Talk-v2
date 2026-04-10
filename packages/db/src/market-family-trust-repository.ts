/**
 * IMarketFamilyTrustRepository — interface and implementations for market_family_trust table.
 *
 * Phase 6 — UTV2-480: Market-family trust and threshold tuning
 *
 * market_family_trust stores the output of the tuning service:
 * one row per market_type_id per tuning run. Rows are read-only after insert.
 *
 * Hard invariants (never violate):
 *   - Does NOT change model weights
 *   - Does NOT modify pick_candidates, syndicate_board, or picks
 *   - Rows are insert-only — never updated after creation
 */

import crypto from 'node:crypto';
import type { UnitTalkSupabaseClient } from './client.js';
import { createDatabaseClientFromConnection, type DatabaseConnectionConfig } from './client.js';

export interface MarketFamilyTrustInsert {
  tuning_run_id: string;
  market_type_id: string;
  sport_key: string | null;
  sample_size: number;
  win_count: number;
  loss_count: number;
  push_count: number;
  win_rate: number | null;
  roi: number | null;
  avg_model_score: number | null;
  confidence_band: string | null;
  metadata: Record<string, unknown>;
}

export interface MarketFamilyTrustRow {
  id: string;
  tuning_run_id: string;
  market_type_id: string;
  sport_key: string | null;
  sample_size: number;
  win_count: number;
  loss_count: number;
  push_count: number;
  win_rate: number | null;
  roi: number | null;
  avg_model_score: number | null;
  confidence_band: string | null;
  computed_at: string;
  metadata: Record<string, unknown>;
}

export interface IMarketFamilyTrustRepository {
  /**
   * Insert a full tuning run. All rows share the same tuning_run_id.
   * Returns the tuning_run_id (same value passed in the rows).
   *
   * If the array is empty, still returns the tuning_run_id without error.
   */
  insertTuningRun(rows: MarketFamilyTrustInsert[]): Promise<string>;

  /**
   * Return all rows from the most recent tuning run, ordered by market_type_id ASC.
   *
   * "Most recent" = the tuning run with the latest computed_at among all distinct
   * tuning_run_ids. If no rows exist, returns [].
   */
  listLatestRun(): Promise<MarketFamilyTrustRow[]>;
}

// =============================================================================
// InMemoryMarketFamilyTrustRepository — in-process store for unit tests.
// =============================================================================

export class InMemoryMarketFamilyTrustRepository implements IMarketFamilyTrustRepository {
  private readonly rows: MarketFamilyTrustRow[] = [];

  async insertTuningRun(inputs: MarketFamilyTrustInsert[]): Promise<string> {
    if (inputs.length === 0) {
      return inputs[0]?.tuning_run_id ?? crypto.randomUUID();
    }

    const tuningRunId = inputs[0]!.tuning_run_id;
    const now = new Date().toISOString();

    for (const input of inputs) {
      this.rows.push({
        id: crypto.randomUUID(),
        tuning_run_id: input.tuning_run_id,
        market_type_id: input.market_type_id,
        sport_key: input.sport_key,
        sample_size: input.sample_size,
        win_count: input.win_count,
        loss_count: input.loss_count,
        push_count: input.push_count,
        win_rate: input.win_rate,
        roi: input.roi,
        avg_model_score: input.avg_model_score,
        confidence_band: input.confidence_band,
        computed_at: now,
        metadata: input.metadata,
      });
    }

    return tuningRunId;
  }

  async listLatestRun(): Promise<MarketFamilyTrustRow[]> {
    if (this.rows.length === 0) return [];

    // Find the tuning_run_id with the latest computed_at
    const runTimes = new Map<string, string>();
    for (const row of this.rows) {
      const existing = runTimes.get(row.tuning_run_id);
      if (!existing || row.computed_at > existing) {
        runTimes.set(row.tuning_run_id, row.computed_at);
      }
    }

    let latestRunId = '';
    let latestTime = '';
    for (const [runId, time] of runTimes.entries()) {
      if (time > latestTime) {
        latestTime = time;
        latestRunId = runId;
      }
    }

    return this.rows
      .filter((r) => r.tuning_run_id === latestRunId)
      .sort((a, b) => a.market_type_id.localeCompare(b.market_type_id));
  }

  /** Test helper: return all rows. */
  listAll(): MarketFamilyTrustRow[] {
    return [...this.rows];
  }
}

// =============================================================================
// DatabaseMarketFamilyTrustRepository — Supabase implementation.
//
// Uses `fromUntyped` pattern since market_family_trust is not in generated types.
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

export class DatabaseMarketFamilyTrustRepository implements IMarketFamilyTrustRepository {
  private readonly client: UnitTalkSupabaseClient;

  constructor(connection: DatabaseConnectionConfig) {
    this.client = createDatabaseClientFromConnection(connection);
  }

  async insertTuningRun(inputs: MarketFamilyTrustInsert[]): Promise<string> {
    if (inputs.length === 0) {
      return inputs[0]?.tuning_run_id ?? crypto.randomUUID();
    }

    const tuningRunId = inputs[0]!.tuning_run_id;
    const now = new Date().toISOString();

    const rows = inputs.map((input) => ({
      tuning_run_id: input.tuning_run_id,
      market_type_id: input.market_type_id,
      sport_key: input.sport_key,
      sample_size: input.sample_size,
      win_count: input.win_count,
      loss_count: input.loss_count,
      push_count: input.push_count,
      win_rate: input.win_rate,
      roi: input.roi,
      avg_model_score: input.avg_model_score,
      confidence_band: input.confidence_band,
      computed_at: now,
      metadata: input.metadata,
    }));

    const { error } = await (fromUntyped(this.client, 'market_family_trust').insert(rows) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);

    if (error) {
      throw new Error(`market_family_trust insertTuningRun failed: ${error.message}`);
    }

    return tuningRunId;
  }

  async listLatestRun(): Promise<MarketFamilyTrustRow[]> {
    // Step 1: get the most recent tuning_run_id
    const { data: runData, error: runError } = await (fromUntyped(this.client, 'market_family_trust')
      .select('tuning_run_id, computed_at')
      .order('computed_at', { ascending: false }) as unknown as Promise<{ data: Array<{ tuning_run_id: string; computed_at: string }> | null; error: { message: string } | null }>);

    if (runError) {
      throw new Error(`market_family_trust listLatestRun (step 1) failed: ${runError.message}`);
    }

    if (!runData || runData.length === 0) return [];

    const latestRunId = runData[0]!.tuning_run_id;

    // Step 2: fetch all rows for that run, ordered by market_type_id
    const { data, error } = await (fromUntyped(this.client, 'market_family_trust')
      .select('*')
      .eq('tuning_run_id', latestRunId)
      .order('market_type_id', { ascending: true }) as unknown as Promise<{ data: MarketFamilyTrustRow[] | null; error: { message: string } | null }>);

    if (error) {
      throw new Error(`market_family_trust listLatestRun (step 2) failed: ${error.message}`);
    }

    return data ?? [];
  }
}
