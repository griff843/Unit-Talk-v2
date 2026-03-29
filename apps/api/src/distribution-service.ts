import type { CanonicalPick } from '@unit-talk/contracts';
import {
  type TargetRegistryEntry,
  isTargetEnabled,
  resolveTargetRegistry,
} from '@unit-talk/contracts';
import type { OutboxRecord, OutboxRepository } from '@unit-talk/db';
import { buildDistributionWorkItem } from '@unit-talk/domain';

export interface DistributionEnqueueResult {
  enqueued: true;
  pickId: string;
  target: string;
  outboxRecord: OutboxRecord;
}

export interface DistributionEnqueueSkippedResult {
  enqueued: false;
  reason: 'target-disabled';
  target: string;
}

export async function enqueueDistributionWork(
  pick: CanonicalPick,
  outboxRepository: OutboxRepository,
  target: string,
  registry?: TargetRegistryEntry[],
): Promise<DistributionEnqueueResult | DistributionEnqueueSkippedResult> {
  const effectiveRegistry = registry ?? resolveTargetRegistry();
  const requestedPromotionTarget = parseGovernedPromotionTarget(target);

  if (requestedPromotionTarget && !isTargetEnabled(requestedPromotionTarget, effectiveRegistry)) {
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

  const workItem = buildDistributionWorkItem(pick, target);
  const outboxRecord = await outboxRepository.enqueue({
    pickId: workItem.pickId,
    target: workItem.target,
    payload: workItem.payload,
    idempotencyKey: workItem.idempotencyKey,
  });

  return {
    enqueued: true,
    pickId: pick.id,
    target,
    outboxRecord,
  } satisfies DistributionEnqueueResult;
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
