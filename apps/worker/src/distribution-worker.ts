import type {
  AuditLogRepository,
  OutboxRecord,
  ReceiptRecord,
  RepositoryBundle,
  SystemRunRecord,
} from '@unit-talk/db';
import { transitionPickLifecycle } from '@unit-talk/db';

export interface DeliveryResult {
  receiptType: string;
  status: string;
  channel?: string | undefined;
  externalId?: string | undefined;
  idempotencyKey?: string | undefined;
  payload: Record<string, unknown>;
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

export type WorkerProcessResult =
  | WorkerProcessIdleResult
  | WorkerProcessSuccessResult
  | WorkerProcessSkippedResult
  | WorkerProcessFailureResult;

export async function processNextDistributionWork(
  repositories: RepositoryBundle,
  target: string,
  workerId: string,
  deliver: (outbox: OutboxRecord) => Promise<DeliveryResult>,
  options: {
    heartbeatMs?: number;
    watchdogMs?: number;
  } = {},
): Promise<WorkerProcessResult> {
  const claimed = await repositories.outbox.claimNext(target, workerId);

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

    const delivery = await deliverWithHeartbeat({
      repositories,
      outbox: claimed,
      workerId,
      deliver,
      ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
      ...(options.watchdogMs === undefined ? {} : { watchdogMs: options.watchdogMs }),
    });
    const sent = await repositories.outbox.markSent(claimed.id);
    const postedTransition = await transitionPickLifecycle(
      repositories.picks,
      claimed.pick_id,
      'posted',
      'downstream delivery confirmed',
      'poster',
    );
    const receipt = await repositories.receipts.record({
      outboxId: claimed.id,
      receiptType: delivery.receiptType,
      status: delivery.status,
      channel: delivery.channel,
      externalId: delivery.externalId,
      idempotencyKey: delivery.idempotencyKey,
      payload: delivery.payload,
    });
    const completedRun = await repositories.runs.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        outboxId: claimed.id,
        receiptId: receipt.id,
        target,
        postedLifecycleEventId: postedTransition.lifecycleEvent.id,
      },
    });
    await recordWorkerAudit(repositories.audit, {
      entityType: 'distribution_outbox',
      entityId: claimed.id,
      action: 'distribution.sent',
      actor: workerId,
      payload: {
        outboxId: claimed.id,
        receiptId: receipt.id,
        target,
        pickId: claimed.pick_id,
        postedLifecycleEventId: postedTransition.lifecycleEvent.id,
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
    const failed = await repositories.outbox.markFailed(claimed.id, errorMessage);
    const shouldDeadLetter = failed.attempt_count >= 3;
    const finalOutbox = shouldDeadLetter
      ? await repositories.outbox.markDeadLetter(claimed.id, errorMessage)
      : failed;
    const completedRun = await repositories.runs.completeRun({
      runId: run.id,
      status: 'failed',
      details: {
        outboxId: claimed.id,
        target,
        error: errorMessage,
        deadLettered: shouldDeadLetter,
      },
    });
    await recordWorkerAudit(repositories.audit, {
      entityType: 'distribution_outbox',
      entityId: claimed.id,
      action: shouldDeadLetter ? 'distribution.dead_lettered' : 'distribution.failed',
      actor: workerId,
      payload: {
        outboxId: claimed.id,
        target,
        error: errorMessage,
        deadLettered: shouldDeadLetter,
      },
    });

    return {
      status: 'failed',
      target,
      workerId,
      outbox: finalOutbox,
      run: completedRun,
    };
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
