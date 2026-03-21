import type { OutboxRecord, OutboxRepository } from '@unit-talk/db';

export interface ClaimedOutboxWork {
  workerId: string;
  target: string;
  outboxRecord: OutboxRecord | null;
}

export async function claimDistributionWork(
  outboxRepository: OutboxRepository,
  target: string,
  workerId: string,
): Promise<ClaimedOutboxWork> {
  const outboxRecord = await outboxRepository.claimNext(target, workerId);

  return {
    workerId,
    target,
    outboxRecord,
  };
}

export async function completeDistributionWork(
  outboxRepository: OutboxRepository,
  outboxId: string,
): Promise<OutboxRecord> {
  return outboxRepository.markSent(outboxId);
}

export async function failDistributionWork(
  outboxRepository: OutboxRepository,
  outboxId: string,
  errorMessage: string,
  retryDelayMinutes = 5,
): Promise<OutboxRecord> {
  const nextAttemptAt = new Date(
    Date.now() + retryDelayMinutes * 60 * 1000,
  ).toISOString();

  return outboxRepository.markFailed(outboxId, errorMessage, nextAttemptAt);
}
