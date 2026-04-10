import type { CanonicalPick, PickSource } from '@unit-talk/contracts';
import type { OutboxRecord, OutboxRepository } from '@unit-talk/db';
import { buildDistributionWorkItem } from '@unit-talk/domain';
import { isTargetEnabled, resolveTargetRegistry, type TargetRegistryEntry } from '@unit-talk/contracts';

export interface DistributionEnqueueResult {
  pickId: string;
  target: string;
  outboxRecord: OutboxRecord;
}

export interface DistributionSkippedResult {
  enqueued: false;
  reason: 'target-disabled' | 'duplicate-pending';
  target: string;
  existingOutboxId?: string;
}

/**
 * Phase 7A governance brake: pick sources that must NOT auto-enqueue for
 * distribution on submission. These are autonomous non-human producers whose
 * picks must land in `awaiting_approval` and wait for operator review before
 * any queueing.
 *
 * This set is the single source of truth for the brake — consulted by
 * `submit-pick-controller` (primary enforcement) and used to reason about
 * defense-in-depth guards in `run-audit-service` and `enqueueDistributionWork`.
 *
 * NOTE: `board-construction` is intentionally NOT in this set. The governed
 * board path is already operator-triggered — it is not an autonomous producer
 * and must retain its existing queueing behavior. Phase 7A repo-truth
 * correction (PM, 2026-04-10) explicitly excludes board-construction from
 * the non-human brake bucket.
 */
export const GOVERNANCE_BRAKE_SOURCES: ReadonlySet<PickSource> = new Set<PickSource>([
  'system-pick-scanner',
  'alert-agent',
  'model-driven',
]);

export function isGovernanceBrakeSource(source: PickSource): boolean {
  return GOVERNANCE_BRAKE_SOURCES.has(source);
}

/**
 * Thrown when a caller attempts to enqueue a pick whose lifecycle state is
 * `awaiting_approval`. Picks in this state must go through operator approval
 * (which transitions to `queued` via the review controller) before any
 * distribution path is allowed to run.
 */
export class AwaitingApprovalBrakeError extends Error {
  public readonly pickId: string;
  public readonly target: string;

  constructor(pickId: string, target: string) {
    super(
      `Distribution blocked: pick ${pickId} is in awaiting_approval lifecycle state. ` +
        `Target ${target} cannot be enqueued until operator review advances the pick to queued.`,
    );
    this.name = 'AwaitingApprovalBrakeError';
    this.pickId = pickId;
    this.target = target;
  }
}

/**
 * Terminal outbox statuses that allow a new enqueue for the same pick+target.
 * Rows in these states represent completed or abandoned delivery attempts.
 */
const ACTIVE_OUTBOX_STATUSES = ['pending', 'processing'] as const;

export function resolveDeliveryTarget(
  target: string,
  env: { UNIT_TALK_APP_ENV?: string } = process.env,
) {
  // In local/dev execution we preserve business truth on picks.promotion_target, but
  // delivery itself must fail-closed to discord:canary so nothing reaches a live lane.
  if (
    env.UNIT_TALK_APP_ENV === 'local' &&
    target.startsWith('discord:') &&
    target !== 'discord:canary'
  ) {
    return 'discord:canary';
  }

  return target;
}

export async function enqueueDistributionWork(
  pick: CanonicalPick,
  outboxRepository: OutboxRepository,
  target: string,
  targetRegistry?: TargetRegistryEntry[],
): Promise<DistributionEnqueueResult | DistributionSkippedResult> {
  const registry = targetRegistry ?? resolveTargetRegistry();
  const requestedPromotionTarget = parseGovernedPromotionTarget(target);
  const resolvedTarget = resolveDeliveryTarget(target);

  // Phase 7A governance brake: refuse to enqueue picks that are currently
  // parked in `awaiting_approval`. Defense-in-depth — the primary brake is
  // at the controller level, this catches any path that bypasses it.
  if (pick.lifecycleState === 'awaiting_approval') {
    throw new AwaitingApprovalBrakeError(pick.id, target);
  }

  if (requestedPromotionTarget && !isTargetEnabled(requestedPromotionTarget, registry)) {
    return { enqueued: false, reason: 'target-disabled', target };
  }

  if (
    requestedPromotionTarget &&
    (pick.promotionStatus !== 'qualified' && pick.promotionStatus !== 'promoted')
  ) {
    throw new Error(
      `${formatTargetLabel(requestedPromotionTarget)} routing is blocked: pick is not qualified for ${requestedPromotionTarget}`,
    );
  }

  if (requestedPromotionTarget && pick.promotionTarget !== requestedPromotionTarget) {
    throw new Error(
      `${formatTargetLabel(requestedPromotionTarget)} routing is blocked: pick promotion target is not ${requestedPromotionTarget}`,
    );
  }

  // Idempotency guard: reject enqueue if a pending or processing row already exists
  const existingActive = await outboxRepository.findByPickAndTarget(
    pick.id,
    resolvedTarget,
    ACTIVE_OUTBOX_STATUSES,
  );

  if (existingActive) {
    return {
      enqueued: false,
      reason: 'duplicate-pending',
      target,
      existingOutboxId: existingActive.id,
    };
  }

  const workItem = buildDistributionWorkItem(pick, resolvedTarget);
  const outboxRecord = await outboxRepository.enqueue({
    pickId: workItem.pickId,
    target: workItem.target,
    payload: workItem.payload,
    idempotencyKey: workItem.idempotencyKey,
  });

  return {
    pickId: pick.id,
    target: resolvedTarget,
    outboxRecord,
  };
}

function parseGovernedPromotionTarget(target: string) {
  if (!target.startsWith('discord:')) {
    return null;
  }

  const channelTarget = target.slice('discord:'.length);
  if (
    channelTarget === 'best-bets' ||
    channelTarget === 'trader-insights' ||
    channelTarget === 'exclusive-insights'
  ) {
    return channelTarget;
  }

  return null;
}

function formatTargetLabel(target: 'best-bets' | 'trader-insights' | 'exclusive-insights') {
  if (target === 'best-bets') {
    return 'Best Bets';
  }

  if (target === 'trader-insights') {
    return 'Trader Insights';
  }

  return 'Exclusive Insights';
}
