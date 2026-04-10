/**
 * Market Family Trust Tuning Service — Phase 6 UTV2-480
 *
 * Reads governed pick performance from v_governed_pick_performance,
 * groups by market family, computes win rate / ROI / sample metrics,
 * and writes tuning output to market_family_trust.
 *
 * Hard invariants (never violate):
 *   - Does NOT change model weights
 *   - Does NOT modify pick_candidates, syndicate_board, or picks
 *   - Tuning is recorded/queryable but NOT yet applied to runtime routing
 *   - Minimum sample size = 5 settled picks before any metric is emitted
 */

import crypto from 'node:crypto';
import type { IMarketFamilyTrustRepository, MarketFamilyTrustInsert } from '@unit-talk/db';
import type { AuditLogRepository } from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_SAMPLE = 5;

// ---------------------------------------------------------------------------
// Types for view rows (v_governed_pick_performance)
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
  settlement_result: 'win' | 'loss' | 'push' | null;
  settlement_status: string | null;
  settlement_settled_at: string | null;
  settled_by: string | null;
  settlement_confidence: string | null;
}

// ---------------------------------------------------------------------------
// Repository interface for querying the view
// ---------------------------------------------------------------------------

export interface IGovernedPickPerformanceRepository {
  listSettled(): Promise<GovernedPickPerformanceRow[]>;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface MarketFamilyTuningResult {
  tuningRunId: string;
  marketFamilyCount: number;
  totalSettled: number;
  familiesWithMetrics: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface MarketFamilyTuningDeps {
  governedPerformance: IGovernedPickPerformanceRepository;
  marketFamilyTrust: IMarketFamilyTrustRepository;
  audit: AuditLogRepository;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  actor?: string;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

interface FamilyGroup {
  market_type_id: string;
  sport_key: string | null;
  wins: number;
  losses: number;
  pushes: number;
  modelScores: number[];
}

function computeConfidenceBand(sampleSize: number): string {
  if (sampleSize < 10) return 'low';
  if (sampleSize < 30) return 'medium';
  return 'high';
}

export async function runMarketFamilyTuning(
  deps: MarketFamilyTuningDeps,
): Promise<MarketFamilyTuningResult> {
  const startedAt = Date.now();
  const logger = deps.logger ?? console;
  const actor = deps.actor ?? 'system:market-family-tuning';
  const tuningRunId = crypto.randomUUID();

  logger.info('market-family-tuning: starting run', { tuningRunId });

  // 1. Fetch all settled rows from the view
  const rows = await deps.governedPerformance.listSettled();
  const totalSettled = rows.length;

  logger.info('market-family-tuning: fetched settled rows', { totalSettled });

  // 2. Group by market_type_id (fall back to 'unknown' if null)
  const groups = new Map<string, FamilyGroup>();

  for (const row of rows) {
    if (row.settlement_result === null) continue; // guard: should already be filtered

    const key = row.market_type_id ?? 'unknown';
    // Use sport_key from the first row in the group (consistent per family)
    let group = groups.get(key);
    if (!group) {
      group = {
        market_type_id: key,
        sport_key: row.sport_key ?? null,
        wins: 0,
        losses: 0,
        pushes: 0,
        modelScores: [],
      };
      groups.set(key, group);
    }

    if (row.settlement_result === 'win') group.wins++;
    else if (row.settlement_result === 'loss') group.losses++;
    else if (row.settlement_result === 'push') group.pushes++;

    if (row.candidate_model_score !== null) {
      group.modelScores.push(row.candidate_model_score);
    } else if (row.board_model_score !== null) {
      group.modelScores.push(row.board_model_score);
    }
  }

  const marketFamilyCount = groups.size;

  // 3. Build insert rows
  const insertRows: MarketFamilyTrustInsert[] = [];
  let familiesWithMetrics = 0;

  for (const [, group] of groups.entries()) {
    const sampleSize = group.wins + group.losses + group.pushes;
    const decidedSample = group.wins + group.losses; // pushes excluded from win_rate

    const hasMetrics = sampleSize >= MIN_SAMPLE;
    if (hasMetrics) familiesWithMetrics++;

    // win_rate: wins / (wins + losses), ignoring pushes
    const win_rate = hasMetrics && decidedSample > 0
      ? group.wins / decidedSample
      : null;

    // ROI: (wins * +1 + losses * -1 + pushes * 0) / sampleSize
    const roi = hasMetrics
      ? (group.wins - group.losses) / sampleSize
      : null;

    const avg_model_score =
      group.modelScores.length > 0
        ? group.modelScores.reduce((sum, s) => sum + s, 0) / group.modelScores.length
        : null;

    const confidence_band = computeConfidenceBand(sampleSize);

    insertRows.push({
      tuning_run_id: tuningRunId,
      market_type_id: group.market_type_id,
      sport_key: group.sport_key,
      sample_size: sampleSize,
      win_count: group.wins,
      loss_count: group.losses,
      push_count: group.pushes,
      win_rate,
      roi,
      avg_model_score,
      confidence_band,
      metadata: {},
    });
  }

  // 4. Write tuning rows
  if (insertRows.length > 0) {
    await deps.marketFamilyTrust.insertTuningRun(insertRows);
  }

  // 5. Write audit log entry
  await deps.audit.record({
    entityType: 'market_family_trust',
    entityId: tuningRunId,
    action: 'market_family_trust.tuning_run.completed',
    actor,
    payload: {
      tuningRunId,
      marketFamilyCount,
      totalSettled,
      familiesWithMetrics,
    },
  });

  const durationMs = Date.now() - startedAt;

  logger.info('market-family-tuning: run complete', {
    tuningRunId,
    marketFamilyCount,
    totalSettled,
    familiesWithMetrics,
    durationMs,
  });

  return {
    tuningRunId,
    marketFamilyCount,
    totalSettled,
    familiesWithMetrics,
    durationMs,
  };
}
