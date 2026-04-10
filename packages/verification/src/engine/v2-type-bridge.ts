/**
 * V2 Type Bridge — maps V1 verification types to V2 equivalents.
 *
 * The R1-R5 verification engine was built against V1's LifecyclePick type.
 * V2 uses CanonicalPick + PickRecord. This bridge provides compatible types
 * so the engine code requires minimal changes.
 *
 * This file is the ONLY place where V1↔V2 type mapping lives.
 */

import type { CanonicalPick, PickLifecycleState, WriterRole } from '@unit-talk/contracts';

/**
 * V1-compatible LifecyclePick — maps to V2's pick record shape.
 * Used by IsolatedPickStore and ReplayLifecycleRunner.
 */
export interface LifecyclePick {
  id: string;
  created_at: string;
  updated_at: string;
  status: PickLifecycleState;
  promotion_status: string | null;
  promotion_target: string | null;
  promotion_queued_at: string | null;
  promotion_posted_at: string | null;
  posted_to_discord: boolean;
  discord_message_id: string | null;
  settlement_status: string | null;
  settlement_result: string | null;
  settlement_source: string | null;
  settled_at: string | null;
  tier: string | null;
  confidence: number | null;
  meta: Record<string, unknown>;
  blocked_reason: string | null;
  blocked_at: string | null;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
}

/**
 * V1-compatible LifecycleStage — maps to V2's PickLifecycleState.
 */
export type LifecycleStage = PickLifecycleState;

/**
 * Re-export WriterRole unchanged (same in V1 and V2).
 */
export type { WriterRole };

/**
 * V2 allowed transitions — from packages/db/src/lifecycle.ts
 *
 * Phase 7A (UTV2-491): `awaiting_approval` added. Must stay in sync with the
 * canonical FSM in packages/db/src/lifecycle.ts. If this mirror drifts, the
 * TypeScript compiler will flag it as a missing key in Record<PickLifecycleState, ...>.
 */
const allowedTransitions: Record<PickLifecycleState, PickLifecycleState[]> = {
  draft: ['validated', 'voided'],
  validated: ['queued', 'awaiting_approval', 'voided'],
  awaiting_approval: ['queued', 'voided'],
  queued: ['posted', 'voided'],
  posted: ['settled', 'voided'],
  settled: [],
  voided: [],
};

export function getAllowedTransitions(fromState: PickLifecycleState): PickLifecycleState[] {
  return allowedTransitions[fromState] ?? [];
}

/**
 * Convert a V2 CanonicalPick to a V1-compatible LifecyclePick.
 * Used when feeding V2 picks into the verification engine.
 */
export function canonicalToLifecyclePick(pick: CanonicalPick): LifecyclePick {
  const now = new Date().toISOString();
  return {
    id: pick.id,
    created_at: pick.createdAt,
    updated_at: now,
    status: pick.lifecycleState,
    promotion_status: pick.promotionStatus ?? null,
    promotion_target: pick.promotionTarget ?? null,
    promotion_queued_at: null,
    promotion_posted_at: null,
    posted_to_discord: pick.lifecycleState === 'posted' || pick.lifecycleState === 'settled',
    discord_message_id: null,
    settlement_status: pick.lifecycleState === 'settled' ? 'settled' : null,
    settlement_result: null,
    settlement_source: null,
    settled_at: null,
    tier: null,
    confidence: pick.confidence ?? null,
    meta: pick.metadata,
    blocked_reason: null,
    blocked_at: null,
    source: pick.source,
    market: pick.market,
    selection: pick.selection,
    line: pick.line ?? null,
    odds: pick.odds ?? null,
  };
}
