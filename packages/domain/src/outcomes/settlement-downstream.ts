/**
 * Settlement Downstream — compute accounting truth from settlement records.
 *
 * V2-native pure computation module. No I/O, no DB, no side effects.
 *
 * Given settlement records (potentially with corrections via corrects_id),
 * resolve the effective settlement for each pick and compute aggregate
 * accounting summaries (hit rate, flat-bet ROI, result distribution).
 */

import { computeFlatBetROI } from './outcome-resolver.js';
import type { Outcome } from './outcome-resolver.js';

// ── Types ───────────────────────────────────────────────────────────────────

/** Minimal settlement record shape needed for downstream computation. */
export interface SettlementInput {
  id: string;
  pick_id: string;
  status: 'settled' | 'manual_review';
  result: string | null; // 'win' | 'loss' | 'push' | 'void' | 'cancelled' | null
  confidence: string; // 'confirmed' | 'estimated' | 'pending'
  corrects_id: string | null;
  settled_at: string; // ISO 8601
}

/** The effective settlement for a single pick after resolving correction chains. */
export interface EffectiveSettlement {
  pick_id: string;
  effective_record_id: string;
  result: string | null;
  status: 'settled' | 'manual_review';
  confidence: string;
  settled_at: string;
  correction_depth: number; // 0 = original, 1+ = correction chain length
  is_final: boolean; // true if status='settled' and confidence='confirmed'
}

/** Result of resolving effective settlement — fail-closed discriminated union. */
export type ResolveResult =
  | { ok: true; settlement: EffectiveSettlement }
  | { ok: false; reason: string };

/** Aggregate settlement summary across multiple picks. */
export interface SettlementSummary {
  total_records: number;
  total_picks: number;
  by_result: Record<string, number>; // win/loss/push/void/cancelled counts
  by_status: Record<string, number>; // settled/manual_review counts
  by_confidence: Record<string, number>;
  hit_rate_pct: number; // wins / (wins + losses) * 100
  flat_bet_roi: {
    roi_pct: number;
    total_wagered: number;
    total_profit: number;
  };
  correction_count: number; // number of records that are corrections
  pending_review_count: number; // picks in manual_review
}

// ── Functions ───────────────────────────────────────────────────────────────

/**
 * Given all settlement records for a single pick (potentially with corrections),
 * resolve the effective (latest) settlement.
 *
 * Correction chain: each correction references the prior via corrects_id.
 * The effective settlement is the record at the end of the chain.
 *
 * Fail-closed: returns { ok: false, reason } if the chain is broken or empty.
 */
export function resolveEffectiveSettlement(
  records: SettlementInput[],
): ResolveResult {
  if (records.length === 0) {
    return { ok: false, reason: 'NO_RECORDS' };
  }

  if (records.length === 1) {
    const r = records[0]!;
    return {
      ok: true,
      settlement: {
        pick_id: r.pick_id,
        effective_record_id: r.id,
        result: r.result,
        status: r.status,
        confidence: r.confidence,
        settled_at: r.settled_at,
        correction_depth: 0,
        is_final: r.status === 'settled' && r.confidence === 'confirmed',
      },
    };
  }

  // Build correction chain: find records that are corrections (have corrects_id)
  const byId = new Map<string, SettlementInput>();
  const correctedBy = new Map<string, SettlementInput>(); // corrects_id → correcting record
  for (const r of records) {
    byId.set(r.id, r);
    if (r.corrects_id !== null) {
      correctedBy.set(r.corrects_id, r);
    }
  }

  // Find the root record (one that is not corrected by anything and has no corrects_id,
  // OR the one at the start of the chain)
  const roots = records.filter((r) => r.corrects_id === null);
  if (roots.length === 0) {
    return { ok: false, reason: 'NO_ROOT_RECORD' };
  }
  if (roots.length > 1) {
    return { ok: false, reason: 'MULTIPLE_ROOT_RECORDS' };
  }

  // Walk the chain from root to tip
  let current: SettlementInput = roots[0]!;
  let depth = 0;
  const visited = new Set<string>();

  while (correctedBy.has(current.id)) {
    visited.add(current.id);
    const next = correctedBy.get(current.id)!;
    if (visited.has(next.id)) {
      return { ok: false, reason: 'CIRCULAR_CORRECTION_CHAIN' };
    }
    current = next;
    depth++;
  }

  return {
    ok: true,
    settlement: {
      pick_id: current.pick_id,
      effective_record_id: current.id,
      result: current.result,
      status: current.status,
      confidence: current.confidence,
      settled_at: current.settled_at,
      correction_depth: depth,
      is_final: current.status === 'settled' && current.confidence === 'confirmed',
    },
  };
}

/**
 * Compute an aggregate settlement summary from effective settlements.
 *
 * Input: effective settlements (one per pick, already resolved from chains).
 * Output: accounting truth — result distribution, hit rate, flat-bet ROI.
 */
export function computeSettlementSummary(
  settlements: EffectiveSettlement[],
): SettlementSummary {
  const total_picks = settlements.length;

  const by_result: Record<string, number> = {};
  const by_status: Record<string, number> = {};
  const by_confidence: Record<string, number> = {};
  let correction_count = 0;
  let pending_review_count = 0;

  // Collect outcomes for ROI computation
  const outcomes: Outcome[] = [];

  for (const s of settlements) {
    // Count by result
    const resultKey = s.result ?? 'null';
    by_result[resultKey] = (by_result[resultKey] ?? 0) + 1;

    // Count by status
    by_status[s.status] = (by_status[s.status] ?? 0) + 1;

    // Count by confidence
    by_confidence[s.confidence] = (by_confidence[s.confidence] ?? 0) + 1;

    // Count corrections
    if (s.correction_depth > 0) correction_count++;

    // Count pending review
    if (s.status === 'manual_review') pending_review_count++;

    // Map to Outcome for ROI (only settled results with win/loss/push)
    if (s.status === 'settled' && s.result !== null) {
      const mapped = mapResultToOutcome(s.result);
      if (mapped !== null) {
        outcomes.push(mapped);
      }
    }
  }

  // Hit rate: wins / (wins + losses)
  const wins = by_result['win'] ?? 0;
  const losses = by_result['loss'] ?? 0;
  const decidedTotal = wins + losses;
  const hit_rate_pct =
    decidedTotal > 0 ? round4((wins / decidedTotal) * 100) : 0;

  // Flat-bet ROI
  const flat_bet_roi = computeFlatBetROI(outcomes);

  return {
    total_records: settlements.reduce(
      (sum, s) => sum + 1 + s.correction_depth,
      0,
    ),
    total_picks,
    by_result,
    by_status,
    by_confidence,
    hit_rate_pct,
    flat_bet_roi,
    correction_count,
    pending_review_count,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapResultToOutcome(result: string): Outcome | null {
  switch (result) {
    case 'win':
      return 'WIN';
    case 'loss':
      return 'LOSS';
    case 'push':
      return 'PUSH';
    default:
      return null; // void, cancelled → not included in ROI
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
