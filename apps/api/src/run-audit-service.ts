import type {
  AuditLogRecord,
  AuditLogRepository,
  OutboxRecord,
  OutboxRepository,
  PickRepository,
  SystemRunRecord,
  SystemRunRepository,
} from '@unit-talk/db';
import {
  humanDeliveryTargets,
  isHumanCapperDeliveryAuthorized,
  isHumanDeliveryTarget,
  isTrackOnlyPickMetadata,
  parseGovernedTargetFromDeliveryTarget,
  readHumanCapperDeliveryAuthorization,
  type CanonicalPick,
} from '@unit-talk/contracts';
import {
  bestBetsPromotionPolicy,
  exclusiveInsightsPromotionPolicy,
  traderInsightsPromotionPolicy,
} from '@unit-talk/domain';
import {
  AwaitingApprovalBrakeError,
  enqueueDistributionWork,
  evaluateDistributionTargetGate,
  HumanDeliveryNotAuthorizedError,
  resolveDeliveryTarget,
  TrackOnlyDistributionError,
  type DistributionEnqueueResult,
} from './distribution-service.js';
import { ensurePickLifecycleState } from './lifecycle-service.js';
import { evaluateAndPersistPromotion } from './promotion-service.js';

export interface DistributionRunResult {
  run: SystemRunRecord;
  audit: AuditLogRecord;
  target: string;
  pickId: string;
}

function getEnqueueAtomicFallbackReason(err: unknown): 'in_memory_sentinel' | null {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('enqueueDistributionAtomic is not supported in InMemory mode')) {
    return 'in_memory_sentinel';
  }
  // All other errors (PGRST202, schema-cache miss, network failures, DB constraints)
  // must rethrow — sequential fallback on real DB risks partial durable writes.
  return null;
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
  const resolvedTarget = resolveDeliveryTarget(target);

  // Phase 7A governance brake: re-fetch the pick to get the authoritative
  // lifecycle state from the DB, then refuse to run the enqueue pipeline if
  // the pick is parked in `awaiting_approval`. This is defense-in-depth — the
  // caller (submit-pick-controller) already gates based on source, but any
  // other helper path that reaches this function must also be safe.
  const currentPick = await pickRepository.findPickById(pick.id);

  // UTV2-1672 TRACK_ONLY_ATOMIC_GUARD_START
  // This guard must remain before promotion evaluation and, critically, before
  // enqueueDistributionAtomic(). The persisted row is authoritative: callers
  // can hold stale or spoofed CanonicalPick objects, while the database record
  // determines whether distribution is prohibited.
  if (
    currentPick &&
    isRecord(currentPick.metadata) &&
    isTrackOnlyPickMetadata(currentPick.metadata)
  ) {
    throw new TrackOnlyDistributionError(pick.id, resolvedTarget);
  }
  // UTV2-1672 TRACK_ONLY_ATOMIC_GUARD_END

  // UTV2-1923 HUMAN_DELIVERY_ATOMIC_GUARD_START
  // The same reasoning as the Track Only guard above, for the human capper
  // target. It matters here specifically because the happy path below is the
  // ATOMIC one: `enqueueDistributionAtomic` writes the lifecycle transition
  // and the outbox row in one transaction WITHOUT calling
  // `enqueueDistributionWork`, so the authorization guard inside that function
  // is only reached on the InMemory sequential fallback. Without this check a
  // production enqueue to the human target would consult no authorization at
  // all. The persisted row is authoritative; a caller's in-memory
  // `CanonicalPick` is not.
  if (isHumanDeliveryTarget(parseGovernedTargetFromDeliveryTarget(resolvedTarget) ?? '')) {
    const persistedMetadata = isRecord(currentPick?.metadata) ? currentPick.metadata : null;
    if (!isHumanCapperDeliveryAuthorized(persistedMetadata)) {
      throw new HumanDeliveryNotAuthorizedError(pick.id, resolvedTarget);
    }
  }
  // UTV2-1923 HUMAN_DELIVERY_ATOMIC_GUARD_END

  const currentLifecycleState =
    currentPick?.status ?? pick.lifecycleState;
  if (currentLifecycleState === 'awaiting_approval') {
    const brakeRun = await systemRunRepository.startRun({
      runType: 'distribution.enqueue',
      actor,
      details: {
        pickId: pick.id,
        target: resolvedTarget,
        skipped: true,
        reason: 'governance-brake-awaiting-approval',
      },
      idempotencyKey: `${pick.id}:${resolvedTarget}:awaiting-approval-brake`,
    });
    const completedBrakeRun = await systemRunRepository.completeRun({
      runId: brakeRun.id,
      status: 'failed',
      details: {
        target: resolvedTarget,
        reason: 'governance-brake-awaiting-approval',
      },
    });
    await auditLogRepository.record({
      entityType: 'distribution_outbox',
      entityId: completedBrakeRun.id,
      action: 'distribution.enqueue.blocked',
      actor,
      payload: {
        pickId: pick.id,
        target: resolvedTarget,
        reason: 'governance-brake-awaiting-approval',
        lifecycleState: 'awaiting_approval',
      },
    });
    throw new AwaitingApprovalBrakeError(pick.id, resolvedTarget);
  }

  const run = await systemRunRepository.startRun({
    runType: 'distribution.enqueue',
    actor,
    details: {
      pickId: pick.id,
      target: resolvedTarget,
    },
    idempotencyKey: `${pick.id}:${resolvedTarget}:enqueue-run`,
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
    const targetGate = evaluateDistributionTargetGate(target);
    if (!targetGate.ok) {
      const completedRun = await systemRunRepository.completeRun({
        runId: run.id,
        status: 'succeeded',
        details: { target: resolvedTarget, reason: targetGate.reason },
      });
      const audit = await auditLogRepository.record({
        entityType: 'distribution_outbox',
        entityId: run.id,
        action: 'distribution.enqueue',
        actor,
        payload: { pickId: pick.id, target: resolvedTarget, skipped: true, reason: targetGate.reason },
      });
      return { run: completedRun, audit, target: resolvedTarget, pickId: pick.id };
    }

    // Try atomic path (lifecycle + outbox in single Postgres transaction),
    // fall back to sequential for InMemory mode.
    let outboxRecord: OutboxRecord;
    let queuedLifecycleEventId: string | null = null;

    try {
      // Atomic path: lifecycle transition + outbox enqueue in one transaction.
      // Validation (target-disabled, promotion checks) is done by
      // enqueueDistributionWork — we call it in the catch fallback only.
      const { buildDistributionWorkItem } = await import('@unit-talk/domain');
      const workItem = buildDistributionWorkItem(pickForDistribution, resolvedTarget);

      const atomicResult = await outboxRepository.enqueueDistributionAtomic({
        pickId: pick.id,
        fromState: pickForDistribution.lifecycleState,
        toState: 'queued',
        writerRole: 'promoter',
        reason: 'ready for downstream distribution',
        lifecycleCreatedAt: new Date().toISOString(),
        outboxTarget: resolvedTarget,
        outboxPayload: workItem.payload,
        outboxIdempotencyKey: workItem.idempotencyKey,
      });

      if (!atomicResult) {
        // Pick already transitioned — find existing outbox record
        const existing = await outboxRepository.findByPickAndTarget(pick.id, resolvedTarget);
        if (!existing) throw new Error('Pick already queued but no outbox record found');
        outboxRecord = existing;
      } else {
        outboxRecord = atomicResult.outbox;
        queuedLifecycleEventId = atomicResult.lifecycleEvent.id;
      }
    } catch (err) {
      // Sequential fallback is only safe in InMemory mode (tests/dev).
      // Real database errors (constraint violations, network timeouts, PGRST202,
      // schema-cache misses) must rethrow — silent fallback risks partial
      // durable writes and double-enqueue on the real DB.
      if (!getEnqueueAtomicFallbackReason(err)) throw err;
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
          details: { target: resolvedTarget, reason: 'target-disabled' },
        });
        const audit = await auditLogRepository.record({
          entityType: 'distribution_outbox',
          entityId: run.id,
          action: 'distribution.enqueue',
          actor,
          payload: { pickId: pick.id, target: resolvedTarget, skipped: true, reason: 'target-disabled' },
        });
        return { run: completedRun, audit, target: resolvedTarget, pickId: pick.id };
      }

      outboxRecord = (distribution as DistributionEnqueueResult).outboxRecord;
      queuedLifecycleEventId = queuedTransition?.lifecycleEvent.id ?? null;
    }

    const completedRun = await systemRunRepository.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        outboxId: outboxRecord.id,
        target: resolvedTarget,
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
        target: resolvedTarget,
      },
    });

    return {
      run: completedRun,
      audit,
      target: resolvedTarget,
      pickId: pick.id,
    };
  } catch (error) {
    await systemRunRepository.completeRun({
      runId: run.id,
      status: 'failed',
      details: {
        target: resolvedTarget,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// UTV2-1923: human capper delivery release (W3 — the second key)
// ---------------------------------------------------------------------------

export interface HumanCapperDeliveryReleaseResult {
  run: SystemRunRecord;
  audit: AuditLogRecord;
  target: string;
  pickId: string;
  /** False when a control refused the release without erroring — e.g. the registry has the target disabled. */
  enqueued: boolean;
  reason?: string;
}

/**
 * UTV2-1923 (revised): which lifecycle state this release leaves from, and
 * under whose authority.
 *
 * There are exactly two lawful entries, and they are NOT interchangeable:
 *
 *   `submission`  — the CANONICAL path for an authorized human capper. The
 *                   pick leaves `validated` under the `promoter` role at
 *                   submission time. No operator stands between the capper and
 *                   the member-facing post, because for a human capper there is
 *                   nothing for an operator to decide: the server already
 *                   decided, from its own allow-list, that this capper's picks
 *                   are deliverable.
 *
 *   `approval`    — the RECOVERY path only. It leaves `awaiting_approval` under
 *                   `operator_override`. A human capper pick does not enter
 *                   `awaiting_approval` on the canonical path, so this entry
 *                   exists for a pick an operator has deliberately parked, and
 *                   for nothing else.
 *
 * `approval` is the default so that every pre-existing caller keeps its exact
 * previous behaviour and a new caller must state which door it is using.
 */
export type HumanCapperDeliveryReleaseEntry = 'approval' | 'submission';

interface HumanCapperDeliveryReleaseEntrySpec {
  fromState: 'awaiting_approval' | 'validated';
  writerRole: 'operator_override' | 'promoter';
  runIdempotencySuffix: string;
}

const HUMAN_DELIVERY_RELEASE_ENTRIES: Readonly<
  Record<HumanCapperDeliveryReleaseEntry, HumanCapperDeliveryReleaseEntrySpec>
> = {
  approval: {
    fromState: 'awaiting_approval',
    writerRole: 'operator_override',
    runIdempotencySuffix: 'human-delivery-release',
  },
  submission: {
    fromState: 'validated',
    writerRole: 'promoter',
    runIdempotencySuffix: 'human-delivery-submit',
  },
};

/**
 * Release an authorized human capper pick into the governed member-facing
 * delivery target, atomically, with a run and an audit record for both
 * outcomes. `entry` selects which lifecycle door it leaves by — see
 * `HumanCapperDeliveryReleaseEntry`. The canonical human capper path is
 * `submission`; `approval` is an operator recovery door.
 *
 * This is deliberately NOT `enqueueDistributionWithRunTracking`. That function
 * exists to serve the model/board lane, where an enqueue is the downstream
 * consequence of a scoring decision and an `awaiting_approval` pick is by
 * definition not yet approved. Nothing here is scored, and — on the canonical
 * `submission` entry — nothing here is approved either; the server's own
 * allow-list already decided. What both entries share is the reason this is
 * one transaction: the lifecycle move and the outbox row must land together,
 * or a pick reaches `queued` with nothing to deliver.
 *
 * Every control still applies, and each is re-read from the persisted row
 * rather than trusted from the caller:
 *
 *   1. the pick must not be Track Only;
 *   2. the pick must carry a server delivery authorization (key one);
 *   3. the pick must actually be in `awaiting_approval` (key two is being
 *      turned right now, and cannot be turned twice);
 *   4. the registry must have the target enabled;
 *   5. the worker's own DB kill switch still gates the actual send.
 */
export async function releaseHumanCapperDeliveryWithRunTracking(
  pickId: string,
  actor: string,
  reason: string,
  pickRepository: PickRepository,
  outboxRepository: OutboxRepository,
  systemRunRepository: SystemRunRepository,
  auditLogRepository: AuditLogRepository,
  entry: HumanCapperDeliveryReleaseEntry = 'approval',
): Promise<HumanCapperDeliveryReleaseResult> {
  const entrySpec = HUMAN_DELIVERY_RELEASE_ENTRIES[entry];
  const target = `discord:${humanDeliveryTargets[0]}`;
  const resolvedTarget = resolveDeliveryTarget(target);

  const currentPick = await pickRepository.findPickById(pickId);
  if (!currentPick) {
    throw new Error(`Human capper delivery release failed: pick ${pickId} not found`);
  }

  const persistedMetadata = isRecord(currentPick.metadata) ? currentPick.metadata : null;

  // UTV2-1923 HUMAN_DELIVERY_RELEASE_GUARD_START
  if (isTrackOnlyPickMetadata(persistedMetadata)) {
    throw new TrackOnlyDistributionError(pickId, resolvedTarget);
  }
  if (!isHumanCapperDeliveryAuthorized(persistedMetadata)) {
    throw new HumanDeliveryNotAuthorizedError(pickId, resolvedTarget);
  }
  if (currentPick.status !== entrySpec.fromState) {
    throw new Error(
      `Human capper delivery release failed: pick ${pickId} is ${currentPick.status}, not ${entrySpec.fromState}`,
    );
  }
  // UTV2-1923 HUMAN_DELIVERY_RELEASE_GUARD_END

  const authorization = readHumanCapperDeliveryAuthorization(persistedMetadata);
  const run = await systemRunRepository.startRun({
    runType: 'distribution.enqueue',
    actor,
    details: {
      pickId,
      target: resolvedTarget,
      lane: 'human-capper-delivery',
      entry,
      capperId: authorization?.capperId ?? null,
    },
    idempotencyKey: `${pickId}:${resolvedTarget}:${entrySpec.runIdempotencySuffix}`,
  });

  const targetGate = evaluateDistributionTargetGate(target);
  if (!targetGate.ok) {
    const completedRun = await systemRunRepository.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: { target: resolvedTarget, reason: targetGate.reason },
    });
    const audit = await auditLogRepository.record({
      entityType: 'distribution_outbox',
      entityId: run.id,
      entityRef: pickId,
      action: 'distribution.enqueue',
      actor,
      payload: {
        pickId,
        target: resolvedTarget,
        lane: 'human-capper-delivery',
        entry,
        skipped: true,
        reason: targetGate.reason,
      },
    });
    return {
      run: completedRun,
      audit,
      target: resolvedTarget,
      pickId,
      enqueued: false,
      reason: targetGate.reason,
    };
  }

  try {
    const canonicalPick = mapPickRecordToCanonicalPickForDelivery(currentPick);
    const { buildDistributionWorkItem: buildWorkItem } = await import('@unit-talk/domain');
    const workItem = buildWorkItem(canonicalPick, resolvedTarget);

    let outboxRecord: OutboxRecord;
    try {
      const atomicResult = await outboxRepository.enqueueDistributionAtomic({
        pickId,
        fromState: entrySpec.fromState,
        toState: 'queued',
        writerRole: entrySpec.writerRole,
        reason,
        lifecycleCreatedAt: new Date().toISOString(),
        outboxTarget: resolvedTarget,
        outboxPayload: workItem.payload,
        outboxIdempotencyKey: workItem.idempotencyKey,
      });

      if (!atomicResult) {
        const existing = await outboxRepository.findByPickAndTarget(pickId, resolvedTarget);
        if (!existing) {
          throw new Error('Pick already released but no outbox record found');
        }
        outboxRecord = existing;
      } else {
        outboxRecord = atomicResult.outbox;
      }
    } catch (err) {
      // Same rule as the model lane: the sequential fallback is only safe in
      // InMemory mode. A real database error must rethrow rather than risk a
      // partial durable write.
      if (!getEnqueueAtomicFallbackReason(err)) throw err;
      await ensurePickLifecycleState(
        pickRepository,
        pickId,
        'queued',
        reason,
        entrySpec.writerRole,
      );
      const queuedPick = await pickRepository.findPickById(pickId);
      const distribution = await enqueueDistributionWork(
        mapPickRecordToCanonicalPickForDelivery(queuedPick ?? currentPick),
        outboxRepository,
        resolvedTarget,
      );
      if ('enqueued' in distribution) {
        const completedRun = await systemRunRepository.completeRun({
          runId: run.id,
          status: 'succeeded',
          details: { target: resolvedTarget, reason: distribution.reason },
        });
        const audit = await auditLogRepository.record({
          entityType: 'distribution_outbox',
          entityId: run.id,
          entityRef: pickId,
          action: 'distribution.enqueue',
          actor,
          payload: {
            pickId,
            target: resolvedTarget,
            lane: 'human-capper-delivery',
            entry,
            skipped: true,
            reason: distribution.reason,
          },
        });
        return {
          run: completedRun,
          audit,
          target: resolvedTarget,
          pickId,
          enqueued: false,
          reason: distribution.reason,
        };
      }
      outboxRecord = distribution.outboxRecord;
    }

    const completedRun = await systemRunRepository.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: { target: resolvedTarget, outboxId: outboxRecord.id },
    });
    const audit = await auditLogRepository.record({
      entityType: 'distribution_outbox',
      entityId: outboxRecord.id,
      entityRef: pickId,
      action: 'distribution.enqueue',
      actor,
      payload: {
        pickId,
        target: resolvedTarget,
        lane: 'human-capper-delivery',
        outboxId: outboxRecord.id,
        capperId: authorization?.capperId ?? null,
        authority: authorization?.authority ?? null,
        entry,
        releasedBy: actor,
      },
    });

    return { run: completedRun, audit, target: resolvedTarget, pickId, enqueued: true };
  } catch (error) {
    await systemRunRepository.completeRun({
      runId: run.id,
      status: 'failed',
      details: {
        target: resolvedTarget,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    await auditLogRepository.record({
      entityType: 'distribution_outbox',
      entityId: run.id,
      entityRef: pickId,
      action: 'distribution.enqueue.failed',
      actor,
      payload: {
        pickId,
        target: resolvedTarget,
        lane: 'human-capper-delivery',
        entry,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

function mapPickRecordToCanonicalPickForDelivery(
  pick: import('@unit-talk/db').PickRecord,
): CanonicalPick {
  return {
    id: pick.id,
    submissionId: pick.submission_id ?? '',
    market: pick.market,
    selection: pick.selection,
    line: pick.line ?? undefined,
    odds: pick.odds ?? undefined,
    stakeUnits: pick.stake_units ?? undefined,
    confidence: pick.confidence ?? undefined,
    source: pick.source as CanonicalPick['source'],
    approvalStatus: pick.approval_status as CanonicalPick['approvalStatus'],
    promotionStatus: pick.promotion_status as CanonicalPick['promotionStatus'],
    promotionTarget: (pick.promotion_target ?? undefined) as CanonicalPick['promotionTarget'],
    lifecycleState: pick.status as CanonicalPick['lifecycleState'],
    metadata: isRecord(pick.metadata) ? pick.metadata : {},
    createdAt: pick.created_at,
  };
}
