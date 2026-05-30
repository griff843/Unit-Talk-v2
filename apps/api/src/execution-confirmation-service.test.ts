import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInMemoryRepositoryBundle } from '@unit-talk/db';

import { confirmExecutionReceipt } from './execution-confirmation-service.js';

const baseInput = {
  pickId: '00000000-0000-4000-8000-000000000001',
  decisionRecordId: 'decision-412',
  outboxId: '00000000-0000-4000-8000-000000000002',
  intentType: 're_confirm' as const,
  idempotencyKey: 'utv2-1133:re-confirm:decision-412',
  issuedAtMs: 1_700_000_000_000,
  provenance: {
    authority: 'codex',
    reason: 'UTV2-1133 test fixture',
  },
  receipt: {
    receiptType: 'discord.message',
    status: 'sent',
    channel: 'discord:canary',
    externalId: 'discord-message-412',
    payload: {
      provider: 'discord',
      messageId: 'discord-message-412',
    },
  },
};

test('confirmExecutionReceipt appends an intent and receipt on first confirmation', async () => {
  const repositories = createInMemoryRepositoryBundle();
  assert.ok(repositories.executionIntents);

  const result = await confirmExecutionReceipt(
    {
      executionIntents: repositories.executionIntents,
      receipts: repositories.receipts,
    },
    baseInput,
  );

  assert.equal(result.alreadyConfirmed, false);
  assert.equal(result.intent.intent_type, 're_confirm');
  assert.equal(result.intent.status, 'confirmed');
  assert.equal(result.intent.idempotency_key, baseInput.idempotencyKey);
  assert.equal(result.receipt.outbox_id, baseInput.outboxId);
  assert.equal(result.receipt.idempotency_key, baseInput.idempotencyKey);
});

test('confirmExecutionReceipt reuses the existing intent and receipt for duplicate re-confirm', async () => {
  const repositories = createInMemoryRepositoryBundle();
  assert.ok(repositories.executionIntents);

  const first = await confirmExecutionReceipt(
    {
      executionIntents: repositories.executionIntents,
      receipts: repositories.receipts,
    },
    baseInput,
  );

  const second = await confirmExecutionReceipt(
    {
      executionIntents: repositories.executionIntents,
      receipts: repositories.receipts,
    },
    {
      ...baseInput,
      intentId: '00000000-0000-4000-8000-000000000099',
      issuedAtMs: baseInput.issuedAtMs + 1,
      receipt: {
        ...baseInput.receipt,
        externalId: 'discord-message-duplicate',
      },
    },
  );

  const intents = await repositories.executionIntents.findByPickId(
    baseInput.pickId,
  );

  assert.equal(second.alreadyConfirmed, true);
  assert.equal(second.intent.id, first.intent.id);
  assert.equal(second.receipt.id, first.receipt.id);
  assert.equal(second.receipt.external_id, first.receipt.external_id);
  assert.equal(intents.length, 1);
});

test('confirmExecutionReceipt rejects empty idempotency keys', async () => {
  const repositories = createInMemoryRepositoryBundle();
  assert.ok(repositories.executionIntents);

  await assert.rejects(
    confirmExecutionReceipt(
      {
        executionIntents: repositories.executionIntents,
        receipts: repositories.receipts,
      },
      {
        ...baseInput,
        idempotencyKey: '   ',
      },
    ),
    /non-empty idempotency key/,
  );
});
