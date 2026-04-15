import type {
  AuditLogRepository,
  OutboxRecord,
  ReceiptRecord,
  RepositoryBundle,
  SystemRunRecord,
} from '@unit-talk/db';
import { transitionPickLifecycle } from '@unit-talk/db';
import { checkRolloutControls, type TargetRegistryEntry } from '@unit-talk/contracts';

export interface DeliveryResult {
  receiptType: string;
  status: DeliveryOutcome;
  channel?: string | undefined;
  externalId?: string | undefined;
  idempotencyKey?: string | undefined;
  reason?: string | undefined;
  payload: Record<string, unknown>;
}

export type DeliveryOutcome = 'sent' | 'retryable-failure' | 'terminal-failure';

/**
 * Only picks from these sources are eligible for live Discord delivery.
 * All other sources (proof, test, synthetic) are blocked at claim time.
 */
const LIVE_SOURCES = new Set(['smart-form', 'discord', 'api', 'alert-agent', 'board-construction']);

/**
 * Event name patterns that indicate synthetic/test picks.
 * Picks with matching eventName metadata are blocked from delivery
 * even if their source is live.
 */
const SYNTHETIC_EVENT_PATTERNS = [
  /^system generated/i,
  /^unique event/i,
  /^live test/i,
  /^guard test/i,
  /^board.*test/i,
  /^test event/i,
  /^proof/i,
];

function isSyntheticEvent(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  const eventName = typeof metadata['eventName'] === 'string' ? metadata['eventName'] : '';
  if (!eventName) return false; // missing eventName is not conclusively synthetic
  return SYNTHETIC_EVENT_PATTERNS.some((pattern) => pattern.test(eventName));
}

export interface WorkerProcessIdleResult {
  status: 'idle';
  target: string;
  workerId: string;
}

export interface WorkerProcessSuccessResult {
  status: 'sent';
  target: string;
  workerId: string;
  outbox: OutboxRecord;
  receipt: ReceiptRecord;
  run: SystemRunRecord;
}

export interface WorkerProcessSkippedResult {
  status: 'skipped';
  target: string;
  workerId: string;
  outbox: OutboxRecord;
  run: SystemRunRecord;
}

export interface WorkerProcessFailureResult {
  status: 'failed';
  target: string;
  workerId: string;
  outbox: OutboxRecord;
  run: SystemRunRecord;
}

export interface WorkerProcessCircuitOpenResult {
  status: 'circuit-open';
  target: string;
  workerId: string;
}

export interface WorkerProcessTargetDisabledResult {
  status: 'target-disabled';
  target: string;
  workerId: string;
}

export interface WorkerProcessRolloutSkipResult {
  status: 'rollout-skip';
  target: string;
  workerId: string;
  outbox: OutboxRecord;
  receipt: ReceiptRecord;
  run: SystemRunRecord;
  reason: 'rollout-pct' | 'sport-filter';
}

export type WorkerProcessResult =
  | WorkerProcessIdleResult
  | WorkerProcessSuccessResult
  | WorkerProcessSkippedResult
  | WorkerProcessFailureResult
  | WorkerProcessCircuitOpenResult
  | WorkerProcessTargetDisabledResult
  | WorkerProcessRolloutSkipResult;

export async function processNextDistributionWork(
  repositories: RepositoryBundle,
  target: string,
  workerId: string,
  deliver: (outbox: OutboxRecord) => Promise<DeliveryResult>,
  options: {
    heartbeatMs?: number;
    watchdogMs?: number;
    targetRegistry?: TargetRegistryEntry[];
    /**
     * Persistence mode controls atomic vs sequential claim/confirm paths.
     * - 'database': uses claimNextAtomic / confirmDeliveryAtomic (SELECT FOR UPDATE SKIP LOCKED).
     *   Throws on RPC failure — no silent fallback in production.
     * - 'in_memory': uses sequential claimNext / markSent (safe for tests, not for concurrent workers).
     * Default: 'database' (fail-closed).
     */
    persistenceMode?: 'database' | 'in_memory';
  } = {},
): Promise<WorkerProcessResult> {
  const persistenceMode = options.persistenceMode ?? 'database';

  // Mode-aware claim: atomic in database mode (no silent fallback), sequential in in-memory mode.
  let claimed: OutboxRecord | null;
  if (persistenceMode === 'in_memory') {
    claimed = await repositories.outbox.claimNext(target, workerId);
  } else {
    // Hard failure in database mode — missing or broken RPC is not silently tolerated.
    claimed = await repositories.outbox.claimNextAtomic(target, workerId);
  }

  if (!claimed) {
    return {
      status: 'idle',
      target,
      workerId,
    };
  }

  const run = await repositories.runs.startRun({
    runType: 'distribution.process',
    actor: workerId,
    details: {
      outboxId: claimed.id,
      target,
    },
    idempotencyKey: `${claimed.id}:${workerId}:distribution-process`,
  });

  try {
    const pick = await repositories.picks.findPickById(claimed.pick_id);
    if (pick?.status === 'settled' || pick?.status === 'voided') {
      const skipped = await repositories.outbox.markSent(claimed.id);
      const completedRun = await repositories.runs.completeRun({
        runId: run.id,
        status: 'succeeded',
        details: {
          outboxId: claimed.id,
          target,
          pickId: claimed.pick_id,
          skipped: true,
          reason: `pick is already ${pick.status}`,
        },
      });
      await recordWorkerAudit(repositories.audit, {
        entityType: 'distribution_outbox',
        entityId: claimed.id,
        action: 'distribution.skipped',
        actor: workerId,
        payload: {
          outboxId: claimed.id,
          target,
          pickId: claimed.pick_id,
          reason: `pick is already ${pick.status}`,
        },
      });

      return {
        status: 'skipped',
        target,
        workerId,
        outbox: skipped,
        run: completedRun,
      };
    }

    // Block non-live sources from delivery (proof, test, synthetic picks)
    if (pick && !LIVE_SOURCES.has(pick.source)) {
      await repositories.outbox.markDeadLetter(claimed.id, `proof-pick-blocked: source '${pick.source}' is not a live source`);
      const completedRun = await repositories.runs.completeRun({
        runId: run.id,
        status: 'succeeded',
        details: {
          outboxId: claimed.id,
          target,
          pickId: claimed.pick_id,
          blocked: true,
          reason: `source '${pick.source}' is not in LIVE_SOURCES`,
        },
      });
      await recordWorkerAudit(repositories.audit, {
        entityType: 'distribution_outbox',
        entityId: claimed.id,
        action: 'distribution.blocked',
        actor: workerId,
        payload: {
          outboxId: claimed.id,
          target,
          pickId: claimed.pick_id,
          source: pick.source,
          reason: 'proof-pick-blocked',
        },
      });

      return {
        status: 'skipped',
        target,
        workerId,
        outbox: { ...claimed, status: 'dead_letter' } as OutboxRecord,
        run: completedRun,
      };
    }

    // Block picks with synthetic/test event names from delivery
    const pickMetadata = (pick?.metadata ?? null) as Record<string, unknown> | null;
    if (pick && isSyntheticEvent(pickMetadata)) {
      const eventName = typeof pickMetadata?.['eventName'] === 'string' ? pickMetadata['eventName'] : '(missing)';
      await repositories.outbox.markDeadLetter(claimed.id, `synthetic-event-blocked: eventName '${eventName}'`);
      const completedRun = await repositories.runs.completeRun({
        runId: run.id,
        status: 'succeeded',
        details: {
          outboxId: claimed.id,
          target,
          pickId: claimed.pick_id,
          blocked: true,
          reason: `synthetic event: '${eventName}'`,
        },
      });
      await recordWorkerAudit(repositories.audit, {
        entityType: 'distribution_outbox',
        entityId: claimed.id,
        action: 'distribution.blocked',
        actor: workerId,
        payload: {
          outboxId: claimed.id,
          target,
          pickId: claimed.pick_id,
          eventName,
          reason: 'synthetic-event-blocked',
        },
      });

      return {
        status: 'skipped',
        target,
        workerId,
        outbox: { ...claimed, status: 'dead_letter' } as OutboxRecord,
        run: completedRun,
      };
    }

    // Rollout controls check
    if (options.targetRegistry) {
      const promotionTarget = target.startsWith('discord:') ? target.slice('discord:'.length) : target;
      const pickSport = typeof pickMetadata?.['sport'] === 'string' ? pickMetadata['sport'] : null;
      const rolloutCheck = checkRolloutControls(claimed.pick_id, promotionTarget, pickSport, options.targetRegistry);
      if (!rolloutCheck.allowed) {
        const sent = await repositories.outbox.markSent(claimed.id);
        const receipt = await repositories.receipts.record({
          outboxId: claimed.id,
          receiptType: 'worker.rollout-skip',
          status: 'sent',
          channel: `rollout-skip:${target}`,
          payload: { reason: rolloutCheck.skipReason, pickId: claimed.pick_id, target },
        });
        const completedRun = await repositories.runs.completeRun({
          runId: run.id,
          status: 'succeeded',
          details: {
            outboxId: claimed.id,
            target,
            pickId: claimed.pick_id,
            rolloutSkip: true,
            reason: rolloutCheck.skipReason,
          },
        });
        await recordWorkerAudit(repositories.audit, {
          entityType: 'distribution_outbox',
          entityId: claimed.id,
          action: 'distribution.rollout-skip',
          actor: workerId,
          payload: {
            outboxId: claimed.id,
            target,
            pickId: claimed.pick_id,
            reason: rolloutCheck.skipReason,
          },
        });
        return {
          status: 'rollout-skip',
          target,
          workerId,
          outbox: sent,
          receipt,
          run: completedRun,
          reason: rolloutCheck.skipReason!,
        };
      }
    }

    const delivery = await deliverWithHeartbeat({
      repositories,
      outbox: claimed,
      workerId,
      deliver,
      ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
      ...(options.watchdogMs === undefined ? {} : { watchdogMs: options.watchdogMs }),
    });
    if (delivery.status === 'terminal-failure') {
      return handleFailedDelivery({
        repositories,
        runId: run.id,
        claimed,
        target,
        workerId,
        errorMessage: delivery.reason ?? 'terminal failure',
        deadLetterImmediately: true,
      });
    }

    if (delivery.status === 'retryable-failure') {
      return handleFailedDelivery({
        repositories,
        runId: run.id,
        claimed,
        target,
        workerId,
        errorMessage: delivery.reason ?? 'retryable failure',
        deadLetterImmediately: false,
      });
    }

    // Mode-aware confirm: atomic in database mode (no silent fallback), sequential in in-memory mode.
    let sent: OutboxRecord;
    let receipt: ReceiptRecord;
    let postedLifecycleEventId: string | null = null;

    if (persistenceMode === 'in_memory') {
      // Sequential path for test/in-memory mode.
      sent = await repositories.outbox.markSent(claimed.id);
      const postedTransition = await transitionPickLifecycle(
        repositories.picks,
        claimed.pick_id,
        'posted',
        'downstream delivery confirmed',
        'poster',
      );
      receipt = await repositories.receipts.record({
        outboxId: claimed.id,
        receiptType: delivery.receiptType,
        status: delivery.status as 'sent' | 'failed',
        channel: delivery.channel ?? '',
        externalId: delivery.externalId ?? undefined,
        idempotencyKey: delivery.idempotencyKey ?? `${claimed.id}:receipt`,
        payload: delivery.payload ?? {},
      });
      await repositories.audit.record({
        entityType: 'distribution_outbox',
        entityId: claimed.id,
        action: 'distribution.sent',
        actor: workerId,
        payload: { outboxId: claimed.id, target, pickId: claimed.pick_id },
      });
      postedLifecycleEventId = postedTransition?.lifecycleEvent.id ?? null;
    } else {
    // Atomic confirm — throws on RPC failure, no silent fallback in production.
    const confirmResult = await repositories.outbox.confirmDeliveryAtomic({
        outboxId: claimed.id,
        pickId: claimed.pick_id,
        workerId,
        receiptType: delivery.receiptType,
        receiptStatus: delivery.status,
        receiptChannel: delivery.channel ?? '',
        receiptExternalId: delivery.externalId ?? null,
        receiptIdempotencyKey: delivery.idempotencyKey ?? `${claimed.id}:receipt`,
        receiptPayload: delivery.payload ?? {},
        lifecycleFromState: 'queued',
        lifecycleToState: 'posted',
        lifecycleWriterRole: 'poster',
        lifecycleReason: 'downstream delivery confirmed',
        auditAction: 'distribution.sent',
        auditPayload: {
          outboxId: claimed.id,
          target,
          pickId: claimed.pick_id,
        },
      });

      sent = confirmResult.outbox;
      receipt = confirmResult.receipt ?? ({} as ReceiptRecord);
      postedLifecycleEventId = confirmResult.lifecycleEvent?.id ?? null;
    }

    const completedRun = await repositories.runs.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        outboxId: claimed.id,
        receiptId: receipt.id,
        target,
        postedLifecycleEventId,
      },
    });

    return {
      status: 'sent',
      target,
      workerId,
      outbox: sent,
      receipt,
      run: completedRun,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown delivery error';
    return handleFailedDelivery({
      repositories,
      runId: run.id,
      claimed,
      target,
      workerId,
      errorMessage,
      deadLetterImmediately: false,
    });
  }
}

async function deliverWithHeartbeat(input: {
  repositories: RepositoryBundle;
  outbox: OutboxRecord;
  workerId: string;
  deliver: (outbox: OutboxRecord) => Promise<DeliveryResult>;
  heartbeatMs?: number;
  watchdogMs?: number;
}) {
  let heartbeat: NodeJS.Timeout | undefined;

  if ((input.heartbeatMs ?? 0) > 0) {
    heartbeat = setInterval(() => {
      void input.repositories.outbox.touchClaim(input.outbox.id, input.workerId).catch(() => {});
    }, input.heartbeatMs);
  }

  try {
    if ((input.watchdogMs ?? 0) > 0) {
      return await withWatchdog(input.deliver(input.outbox), input.watchdogMs!);
    }

    return await input.deliver(input.outbox);
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

function withWatchdog<T>(promise: Promise<T>, watchdogMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`worker watchdog exceeded ${watchdogMs}ms`));
    }, watchdogMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

/** Base delay for exponential backoff in milliseconds (5 seconds). */
const RETRY_BASE_DELAY_MS = 5_000;

/** Maximum number of retry attempts before dead-lettering. */
const MAX_RETRY_ATTEMPTS = 3;

function computeNextAttemptAt(attemptCount: number): string {
  // Exponential backoff: 5s, 10s, 20s, ...
  const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attemptCount);
  return new Date(Date.now() + delayMs).toISOString();
}

async function handleFailedDelivery(input: {
  repositories: RepositoryBundle;
  runId: string;
  claimed: OutboxRecord;
  target: string;
  workerId: string;
  errorMessage: string;
  deadLetterImmediately: boolean;
}): Promise<WorkerProcessFailureResult> {
  if (input.deadLetterImmediately) {
    // Terminal failure: dead-letter immediately
    const finalOutbox = await input.repositories.outbox.markDeadLetter(
      input.claimed.id,
      input.errorMessage,
    );
    const completedRun = await input.repositories.runs.completeRun({
      runId: input.runId,
      status: 'failed',
      details: {
        outboxId: input.claimed.id,
        target: input.target,
        error: input.errorMessage,
        deadLettered: true,
        terminalFailure: true,
      },
    });
    await recordWorkerAudit(input.repositories.audit, {
      entityType: 'distribution_outbox',
      entityId: input.claimed.id,
      action: 'distribution.dead_lettered',
      actor: input.workerId,
      payload: {
        outboxId: input.claimed.id,
        target: input.target,
        error: input.errorMessage,
        deadLettered: true,
        terminalFailure: true,
      },
    });

    return {
      status: 'failed',
      target: input.target,
      workerId: input.workerId,
      outbox: finalOutbox,
      run: completedRun,
    };
  }

  // Retryable failure: increment attempt_count and compute backoff
  const currentAttempt = (input.claimed.attempt_count ?? 0) + 1;
  const nextAttemptAt = computeNextAttemptAt(currentAttempt);

  // markFailed sets status to 'pending', clears claimed_by/claimed_at,
  // increments attempt_count, and sets next_attempt_at for backoff
  const failed = await input.repositories.outbox.markFailed(
    input.claimed.id,
    input.errorMessage,
    nextAttemptAt,
  );

  const shouldDeadLetter = failed.attempt_count >= MAX_RETRY_ATTEMPTS;

  if (shouldDeadLetter) {
    const finalOutbox = await input.repositories.outbox.markDeadLetter(
      input.claimed.id,
      input.errorMessage,
    );
    const completedRun = await input.repositories.runs.completeRun({
      runId: input.runId,
      status: 'failed',
      details: {
        outboxId: input.claimed.id,
        target: input.target,
        error: input.errorMessage,
        attemptCount: failed.attempt_count,
        deadLettered: true,
        terminalFailure: false,
      },
    });
    await recordWorkerAudit(input.repositories.audit, {
      entityType: 'distribution_outbox',
      entityId: input.claimed.id,
      action: 'distribution.dead_lettered',
      actor: input.workerId,
      payload: {
        outboxId: input.claimed.id,
        target: input.target,
        error: input.errorMessage,
        attemptCount: failed.attempt_count,
        deadLettered: true,
        terminalFailure: false,
        reason: `exceeded ${MAX_RETRY_ATTEMPTS} retry attempts`,
      },
    });

    return {
      status: 'failed',
      target: input.target,
      workerId: input.workerId,
      outbox: finalOutbox,
      run: completedRun,
    };
  }

  // Row is now pending with backoff — log the retry transition
  const completedRun = await input.repositories.runs.completeRun({
    runId: input.runId,
    status: 'failed',
    details: {
      outboxId: input.claimed.id,
      target: input.target,
      error: input.errorMessage,
      attemptCount: failed.attempt_count,
      nextAttemptAt,
      deadLettered: false,
      terminalFailure: false,
      retryScheduled: true,
    },
  });
  await recordWorkerAudit(input.repositories.audit, {
    entityType: 'distribution_outbox',
    entityId: input.claimed.id,
    action: 'distribution.retry_scheduled',
    actor: input.workerId,
    payload: {
      outboxId: input.claimed.id,
      target: input.target,
      error: input.errorMessage,
      attemptCount: failed.attempt_count,
      nextAttemptAt,
      retryScheduled: true,
    },
  });

  return {
    status: 'failed',
    target: input.target,
    workerId: input.workerId,
    outbox: failed,
    run: completedRun,
  };
}

async function recordWorkerAudit(
  auditRepository: AuditLogRepository,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    actor: string;
    payload: Record<string, unknown>;
  },
) {
  return auditRepository.record({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actor: input.actor,
    payload: input.payload,
  });
}
