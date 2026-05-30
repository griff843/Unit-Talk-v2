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
  const existingReceipt = await findMatchingIdempotentReceipt(
    receiptRepository,
    input.outboxId,
    input.receiptType,
    input.idempotencyKey,
  );

  if (existingReceipt !== null) {
    return {
      outboxId: input.outboxId,
      receipt: existingReceipt,
    };
  }

  let receipt: ReceiptRecord;

  try {
    receipt = await receiptRepository.record({
      outboxId: input.outboxId,
      receiptType: input.receiptType,
      status: input.status,
      channel: input.channel,
      externalId: input.externalId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
    });
  } catch (error) {
    const fallbackReceipt = await findMatchingIdempotentReceipt(
      receiptRepository,
      input.outboxId,
      input.receiptType,
      input.idempotencyKey,
    );

    if (fallbackReceipt !== null && isReceiptIdempotencyCollision(error)) {
      receipt = fallbackReceipt;
    } else {
      throw error;
    }
  }

  return {
    outboxId: input.outboxId,
    receipt,
  };
}

async function findMatchingIdempotentReceipt(
  receiptRepository: ReceiptRepository,
  outboxId: string,
  receiptType: string,
  idempotencyKey?: string | undefined,
): Promise<ReceiptRecord | null> {
  if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
    return null;
  }

  const latestReceipt = await receiptRepository.findLatestByOutboxId(
    outboxId,
    receiptType,
  );

  return latestReceipt?.idempotency_key === idempotencyKey
    ? latestReceipt
    : null;
}

function isReceiptIdempotencyCollision(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('distribution_receipts_idempotency_key_idx') ||
    error.message.includes('duplicate key value') ||
    error.message.includes('idempotency_key')
  );
}
