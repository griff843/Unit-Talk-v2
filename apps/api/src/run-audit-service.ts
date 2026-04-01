import type {
  AuditLogRecord,
  AuditLogRepository,
  OutboxRecord,
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
import { enqueueDistributionWork, type DistributionEnqueueResult } from './distribution-service.js';
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
    // Try atomic path (lifecycle + outbox in single Postgres transaction),
    // fall back to sequential for InMemory mode.
    let outboxRecord: OutboxRecord;
    let queuedLifecycleEventId: string | null = null;

    try {
      // Atomic path: lifecycle transition + outbox enqueue in one transaction.
      // Validation (target-disabled, promotion checks) is done by
      // enqueueDistributionWork — we call it in the catch fallback only.
      const { buildDistributionWorkItem } = await import('@unit-talk/domain');
      const workItem = buildDistributionWorkItem(pickForDistribution, target);

      const atomicResult = await outboxRepository.enqueueDistributionAtomic({
        pickId: pick.id,
        fromState: pickForDistribution.lifecycleState,
        toState: 'queued',
        writerRole: 'promoter',
        reason: 'ready for downstream distribution',
        lifecycleCreatedAt: new Date().toISOString(),
        outboxTarget: target,
        outboxPayload: workItem.payload,
        outboxIdempotencyKey: workItem.idempotencyKey,
      });

      if (!atomicResult) {
        // Pick already transitioned — find existing outbox record
        const existing = await outboxRepository.findByPickAndTarget(pick.id, target);
        if (!existing) throw new Error('Pick already queued but no outbox record found');
        outboxRecord = existing;
      } else {
        outboxRecord = atomicResult.outbox;
        queuedLifecycleEventId = atomicResult.lifecycleEvent.id;
      }
    } catch {
      // Sequential fallback (InMemory mode or RPC not deployed).
      // enqueueDistributionWork handles validation + outbox insert.
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

      if ('enqueued' in distribution) {
        const completedRun = await systemRunRepository.completeRun({
          runId: run.id,
          status: 'succeeded',
          details: { target, reason: 'target-disabled' },
        });
        const audit = await auditLogRepository.record({
          entityType: 'distribution_outbox',
          entityId: run.id,
          action: 'distribution.enqueue',
          actor,
          payload: { pickId: pick.id, target, skipped: true, reason: 'target-disabled' },
        });
        return { run: completedRun, audit, target, pickId: pick.id };
      }

      outboxRecord = (distribution as DistributionEnqueueResult).outboxRecord;
      queuedLifecycleEventId = queuedTransition?.lifecycleEvent.id ?? null;
    }

    const completedRun = await systemRunRepository.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        outboxId: outboxRecord.id,
        target,
        queuedLifecycleEventId,
      },
    });
    const audit = await auditLogRepository.record({
      entityType: 'distribution_outbox',
      entityId: outboxRecord.id,
      action: 'distribution.enqueue',
      actor,
      payload: {
        pickId: pick.id,
        outboxId: outboxRecord.id,
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
