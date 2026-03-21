import type { ReceiptRecord, ReceiptRepository } from '@unit-talk/db';

export interface DistributionReceiptResult {
  outboxId: string;
  receipt: ReceiptRecord;
}

export async function recordDistributionReceipt(
  receiptRepository: ReceiptRepository,
  input: {
    outboxId: string;
    receiptType: string;
    status: string;
    channel?: string | undefined;
    externalId?: string | undefined;
    idempotencyKey?: string | undefined;
    payload: Record<string, unknown>;
  },
): Promise<DistributionReceiptResult> {
  const receipt = await receiptRepository.record({
    outboxId: input.outboxId,
    receiptType: input.receiptType,
    status: input.status,
    channel: input.channel,
    externalId: input.externalId,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
  });

  return {
    outboxId: input.outboxId,
    receipt,
  };
}
