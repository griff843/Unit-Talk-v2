import type { CanonicalPick } from './picks.js';

export interface DistributionWorkItem {
  pickId: string;
  target: string;
  status: 'pending';
  attemptCount: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export function createDistributionWorkItem(
  pick: CanonicalPick,
  target: string,
): DistributionWorkItem {
  return {
    pickId: pick.id,
    target,
    status: 'pending',
    attemptCount: 0,
    payload: {
      pickId: pick.id,
      submissionId: pick.submissionId,
      market: pick.market,
      selection: pick.selection,
      line: pick.line,
      odds: pick.odds,
      // WORK-2026092901: the member-facing embed renders units from the payload
      // it was enqueued with. Omitting them rendered every official pick with no
      // stake at all, which the membership contract requires (§3.3).
      stakeUnits: pick.stakeUnits ?? null,
      source: pick.source,
      lifecycleState: pick.lifecycleState,
      metadata: pick.metadata,
    },
    idempotencyKey: `${pick.id}:${target}:distribution`,
  };
}
