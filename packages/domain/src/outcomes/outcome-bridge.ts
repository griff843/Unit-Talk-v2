/**
 * Outcome Bridge — ScoredOutcome -> EvaluationRecord
 *
 * Converts outcome-layer records into evaluation-layer records
 * so that alpha-evaluation can score historical outcomes.
 *
 * Key decisions:
 *   - PUSHes are filtered (binary 0/1 required for Brier/log loss)
 *   - p_stat approximated as p_final (ScoredOutcome lacks raw stat-only prob)
 *   - stat_alpha = p_final - p_market_devig (semantically = edge_final)
 *   - blend_version tagged 'outcome-bridge-v1.0' for traceability
 */

import type { ScoredOutcome } from './types.js';
import type { EvaluationRecord } from '../evaluation/alpha-evaluation.js';
import type { BlendOutput } from '../models/stat-market-blend.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type OutcomeBridgeResult =
  | { ok: true; data: EvaluationRecord }
  | { ok: false; reason: string };

export interface OutcomeBridgeBatchResult {
  records: EvaluationRecord[];
  skipped: number;
  errors: string[];
}

// ── Bridge Functions ────────────────────────────────────────────────────────

/**
 * Bridge a single ScoredOutcome into an EvaluationRecord.
 * Returns { ok: false } for PUSHes and invalid probabilities.
 */
export function bridgeOutcomeToEvaluation(
  scored: ScoredOutcome,
  options?: { sport?: string },
): OutcomeBridgeResult {
  if (scored.p_final <= 0 || scored.p_final >= 1) {
    return { ok: false, reason: `p_final out of range (0,1): ${scored.p_final}` };
  }
  if (scored.p_market_devig <= 0 || scored.p_market_devig >= 1) {
    return { ok: false, reason: `p_market_devig out of range (0,1): ${scored.p_market_devig}` };
  }

  if (scored.outcome === 'PUSH') {
    return { ok: false, reason: 'PUSH outcomes cannot be evaluated as binary' };
  }

  const binaryOutcome: 0 | 1 = scored.outcome === 'WIN' ? 1 : 0;
  const statAlpha = round4(scored.p_final - scored.p_market_devig);
  const divergence = round4(Math.abs(scored.p_final - scored.p_market_devig));
  const divergenceDir = Math.sign(scored.p_final - scored.p_market_devig);

  const blend: BlendOutput = {
    p_final: scored.p_final,
    p_stat: scored.p_final, // Best approximation — ScoredOutcome lacks raw p_stat
    p_market: scored.p_market_devig,
    stat_weight: 0, // Unknown from historical data
    market_weight: 1, // Unknown from historical data
    stat_alpha: statAlpha,
    divergence,
    divergence_direction: divergenceDir,
    edge_vs_market: scored.edge_final,
    blend_version: 'outcome-bridge-v1.0',
  };

  const marketType = scored.market_type_key ?? `mt_${scored.market_type_id}`;

  return {
    ok: true,
    data: {
      blend,
      outcome: binaryOutcome,
      ...(options?.sport !== undefined ? { sport: options.sport } : {}),
      market_type: marketType,
    },
  };
}

/**
 * Bridge a batch of ScoredOutcomes, filtering PUSHes and invalid records.
 */
export function bridgeBatchToEvaluation(
  scored: ScoredOutcome[],
  options?: { sport?: string },
): OutcomeBridgeBatchResult {
  const records: EvaluationRecord[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (const s of scored) {
    const result = bridgeOutcomeToEvaluation(s, options);
    if (result.ok === true) {
      records.push(result.data);
    } else {
      skipped++;
      const reason = result.reason;
      if (!reason.includes('PUSH')) {
        errors.push(`${s.market_key}: ${reason}`);
      }
    }
  }

  return { records, skipped, errors };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
