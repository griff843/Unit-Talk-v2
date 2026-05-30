import { createHash, randomUUID } from 'node:crypto';

import type {
  ExecutionIntentRepository,
  ExecutionIntentRow,
  ExecutionIntentStatus,
  ExecutionIntentType,
  ReceiptRecord,
  ReceiptRepository,
} from '@unit-talk/db';

import { recordDistributionReceipt } from './distribution-receipt-service.js';

export interface ExecutionConfirmationRepositories {
  executionIntents: ExecutionIntentRepository;
  receipts: ReceiptRepository;
}

export interface ConfirmExecutionReceiptInput {
  pickId: string;
  decisionRecordId: string;
  outboxId: string;
  intentType: ExecutionIntentType;
  intentStatus?: ExecutionIntentStatus | undefined;
  predecessorId?: string | null | undefined;
  intentId?: string | undefined;
  idempotencyKey: string;
  issuedAtMs: number;
  provenance: Record<string, unknown>;
  payload?: Record<string, unknown> | undefined;
  receipt: {
    receiptType: string;
    status: string;
    channel?: string | undefined;
    externalId?: string | undefined;
    payload: Record<string, unknown>;
  };
}

export interface ConfirmExecutionReceiptResult {
  intent: ExecutionIntentRow;
  receipt: ReceiptRecord;
  alreadyConfirmed: boolean;
}

export async function confirmExecutionReceipt(
  repositories: ExecutionConfirmationRepositories,
  input: ConfirmExecutionReceiptInput,
): Promise<ConfirmExecutionReceiptResult> {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const existingIntent =
    await repositories.executionIntents.findByIdempotencyKey(idempotencyKey);

  if (existingIntent !== null) {
    const receipt = await recordDistributionReceipt(repositories.receipts, {
      outboxId: input.outboxId,
      receiptType: input.receipt.receiptType,
      status: input.receipt.status,
      channel: input.receipt.channel,
      externalId: input.receipt.externalId,
      idempotencyKey,
      payload: input.receipt.payload,
    });

    return {
      intent: existingIntent,
      receipt: receipt.receipt,
      alreadyConfirmed: true,
    };
  }

  const intent = await appendIntentIdempotently(
    repositories.executionIntents,
    {
      id: input.intentId ?? randomUUID(),
      predecessor_id: input.predecessorId ?? null,
      pick_id: input.pickId,
      decision_record_id: input.decisionRecordId,
      intent_type: input.intentType,
      status: input.intentStatus ?? 'confirmed',
      idempotency_key: idempotencyKey,
      inputs_hash: computeExecutionInputsHash(input),
      provenance: input.provenance,
      payload: input.payload ?? {},
      issued_at_ms: input.issuedAtMs,
    },
    idempotencyKey,
  );

  const receipt = await recordDistributionReceipt(repositories.receipts, {
    outboxId: input.outboxId,
    receiptType: input.receipt.receiptType,
    status: input.receipt.status,
    channel: input.receipt.channel,
    externalId: input.receipt.externalId,
    idempotencyKey,
    payload: input.receipt.payload,
  });

  return {
    intent,
    receipt: receipt.receipt,
    alreadyConfirmed: false,
  };
}

function requireIdempotencyKey(idempotencyKey: string): string {
  const normalized = idempotencyKey.trim();
  if (normalized === '') {
    throw new Error('Execution confirmation requires a non-empty idempotency key');
  }
  return normalized;
}

async function appendIntentIdempotently(
  repository: ExecutionIntentRepository,
  input: Parameters<ExecutionIntentRepository['append']>[0],
  idempotencyKey: string,
): Promise<ExecutionIntentRow> {
  try {
    return await repository.append(input);
  } catch (error) {
    const existing = await repository.findByIdempotencyKey(idempotencyKey);
    if (existing !== null && isExecutionIntentIdempotencyCollision(error)) {
      return existing;
    }
    throw error;
  }
}

function isExecutionIntentIdempotencyCollision(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('uidx_execution_intents_idempotency_key') ||
    error.message.includes('duplicate key value') ||
    error.message.includes('idempotency_key')
  );
}

function computeExecutionInputsHash(input: ConfirmExecutionReceiptInput): string {
  return createHash('sha256')
    .update(stableStringify({
      decisionRecordId: input.decisionRecordId,
      intentType: input.intentType,
      pickId: input.pickId,
      receipt: input.receipt,
    }))
    .digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
