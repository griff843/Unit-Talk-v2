import type {
  AuditLogRecord,
  AuditLogRepository,
  OutboxRepository,
  PickRepository,
  SystemRunRecord,
  SystemRunRepository,
} from '@unit-talk/db';
import type { CanonicalPick } from '@unit-talk/contracts';
import {
  bestBetsPromotionPolicy,
  exclusiveInsightsPromotionPolicy,
  traderInsightsPromotionPolicy,
} from '@unit-talk/domain';
import { enqueueDistributionWork } from './distribution-service.js';
import { ensurePickLifecycleState } from './lifecycle-service.js';
import { evaluateAndPersistPromotion } from './promotion-service.js';

export interface DistributionRunResult {
  run: SystemRunRecord;
  audit: AuditLogRecord;
  target: string;
  pickId: string;
}

export async function enqueueDistributionWithRunTracking(
  pick: CanonicalPick,
  target: string,
  actor: string,
  pickRepository: PickRepository,
  outboxRepository: OutboxRepository,
  systemRunRepository: SystemRunRepository,
  auditLogRepository: AuditLogRepository,
): Promise<DistributionRunResult> {
  const run = await systemRunRepository.startRun({
    runType: 'distribution.enqueue',
    actor,
    details: {
      pickId: pick.id,
      target,
    },
    idempotencyKey: `${pick.id}:${target}:enqueue-run`,
  });

  try {
    const pickForDistribution =
      isGovernedTarget(target) && needsPromotionEvaluationForTarget(pick)
        ? (
            await evaluateAndPersistPromotion(
              pick.id,
              actor,
              pickRepository,
              auditLogRepository,
              promotionPolicyForTarget(target),
            )
          ).pick
        : pick;
    const queuedTransition = await ensurePickLifecycleState(
      pickRepository,
      pick.id,
      'queued',
      'ready for downstream distribution',
      'promoter',
    );
    const distribution = await enqueueDistributionWork(
      {
        ...pickForDistribution,
        lifecycleState: queuedTransition?.lifecycleState ?? pickForDistribution.lifecycleState,
      },
      outboxRepository,
      target,
    );
    const completedRun = await systemRunRepository.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        outboxId: distribution.outboxRecord.id,
        target,
        queuedLifecycleEventId: queuedTransition?.lifecycleEvent.id ?? null,
      },
    });
    const audit = await auditLogRepository.record({
      entityType: 'distribution_outbox',
      entityId: distribution.outboxRecord.id,
      action: 'distribution.enqueue',
      actor,
      payload: {
        pickId: pick.id,
        outboxId: distribution.outboxRecord.id,
        target,
      },
    });

    return {
      run: completedRun,
      audit,
      target,
      pickId: pick.id,
    };
  } catch (error) {
    await systemRunRepository.completeRun({
      runId: run.id,
      status: 'failed',
      details: {
        target,
        error: error instanceof Error ? error.message : 'unknown error',
      },
    });
    throw error;
  }
}

function isGovernedTarget(
  target: string,
): target is 'discord:best-bets' | 'discord:trader-insights' | 'discord:exclusive-insights' {
  return (
    target === 'discord:best-bets' ||
    target === 'discord:trader-insights' ||
    target === 'discord:exclusive-insights'
  );
}

function promotionPolicyForTarget(
  target: 'discord:best-bets' | 'discord:trader-insights' | 'discord:exclusive-insights',
) {
  if (target === 'discord:exclusive-insights') {
    return exclusiveInsightsPromotionPolicy;
  }

  return target === 'discord:trader-insights'
    ? traderInsightsPromotionPolicy
    : bestBetsPromotionPolicy;
}

function needsPromotionEvaluationForTarget(
  pick: CanonicalPick,
) {
  // Picks processed via the submission path are eagerly evaluated for all policies at
  // submission time. If a decision has already been recorded, skip re-evaluation — the
  // distribution gate alone determines routing based on picks.promotion_target.
  return pick.promotionDecidedAt == null;
}
