import type { CanonicalPick } from '@unit-talk/contracts';
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
 * Terminal outbox statuses that allow a new enqueue for the same pick+target.
 * Rows in these states represent completed or abandoned delivery attempts.
 */
const ACTIVE_OUTBOX_STATUSES = ['pending', 'processing'] as const;

export async function enqueueDistributionWork(
  pick: CanonicalPick,
  outboxRepository: OutboxRepository,
  target: string,
  targetRegistry?: TargetRegistryEntry[],
): Promise<DistributionEnqueueResult | DistributionSkippedResult> {
  const registry = targetRegistry ?? resolveTargetRegistry();
  const requestedPromotionTarget = parseGovernedPromotionTarget(target);

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
    target,
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

  const workItem = buildDistributionWorkItem(pick, target);
  const outboxRecord = await outboxRepository.enqueue({
    pickId: workItem.pickId,
    target: workItem.target,
    payload: workItem.payload,
    idempotencyKey: workItem.idempotencyKey,
  });

  return {
    pickId: pick.id,
    target,
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
