import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnitTalkSupabaseClient } from '@unit-talk/db';
import type { TransitionResult } from '@unit-talk/invariants';
import { DatabaseCertificationRepository } from './certification-runtime.js';

type RpcPayload = {
  p_records: Array<Record<string, unknown>>;
  p_events: Array<Record<string, unknown>>;
};

class AtomicPropagationClient {
  readonly committedRecords: Array<Record<string, unknown>> = [];
  readonly committedEvents: Array<Record<string, unknown>> = [];
  readonly rpcCalls: Array<{ fn: string; payload: RpcPayload }> = [];
  fromCalls = 0;

  async rpc(fn: string, payload: RpcPayload) {
    this.rpcCalls.push({ fn, payload });

    if (fn !== 'insert_certification_propagation_batch') {
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    }

    const stagedRecords = [...payload.p_records];
    const stagedEvents = [...payload.p_events];
    const invalidEvent = stagedEvents.find(event => event['trigger_reason'] === 'force event failure');
    if (invalidEvent) {
      return { data: null, error: { message: 'simulated transition-event insert failure' } };
    }

    this.committedRecords.push(...stagedRecords);
    this.committedEvents.push(...stagedEvents);
    return {
      data: {
        records_inserted: stagedRecords.length,
        events_inserted: stagedEvents.length,
      },
      error: null,
    };
  }

  from() {
    this.fromCalls += 1;
    throw new Error('insertPropagationBatch must use the atomic RPC, not table inserts');
  }
}

const baseResult: TransitionResult = {
  record: {
    id: '11111111-1111-4111-8111-111111111111',
    programId: 'P1',
    domain: 'replay',
    status: 'revoked',
    evidenceSha: 'a'.repeat(64),
    mergeSha: 'b'.repeat(40),
    transitionedAt: '2026-05-27T16:00:00.000Z',
    transitionedBy: 'replay-harness',
    transitionReason: 'replay nondeterminism',
    expiresAt: null,
    revocationTrigger: 'replay_nondeterminism',
    predecessorId: '00000000-0000-4000-8000-000000000000',
    createdAt: '2026-05-27T16:00:00.000Z',
  },
  event: {
    id: '22222222-2222-4222-8222-222222222222',
    certRecordId: '11111111-1111-4111-8111-111111111111',
    programId: 'P1',
    domain: 'replay',
    fromStatus: 'active',
    toStatus: 'revoked',
    triggeredBy: 'replay-harness',
    triggerReason: 'replay nondeterminism',
    evidenceSha: 'a'.repeat(64),
    occurredAt: '2026-05-27T16:00:00.000Z',
    replaySafe: true,
  },
};

function makeResult(overrides: {
  recordId: string;
  eventId: string;
  domain: TransitionResult['record']['domain'];
  triggerReason?: string;
}): TransitionResult {
  return {
    record: {
      ...baseResult.record,
      id: overrides.recordId,
      domain: overrides.domain,
      transitionReason: overrides.triggerReason ?? baseResult.record.transitionReason,
    },
    event: {
      ...baseResult.event,
      id: overrides.eventId,
      certRecordId: overrides.recordId,
      domain: overrides.domain,
      triggerReason: overrides.triggerReason ?? baseResult.event.triggerReason,
    },
  };
}

test('insertPropagationBatch persists propagation through one atomic RPC', async () => {
  const client = new AtomicPropagationClient();
  const repository = new DatabaseCertificationRepository(
    client as unknown as UnitTalkSupabaseClient,
  );

  await repository.insertPropagationBatch([
    makeResult({
      recordId: '11111111-1111-4111-8111-111111111111',
      eventId: '22222222-2222-4222-8222-222222222222',
      domain: 'replay',
    }),
    makeResult({
      recordId: '33333333-3333-4333-8333-333333333333',
      eventId: '44444444-4444-4444-8444-444444444444',
      domain: 'divergence',
    }),
  ]);

  assert.equal(client.rpcCalls.length, 1);
  assert.equal(client.rpcCalls[0]?.fn, 'insert_certification_propagation_batch');
  assert.equal(client.fromCalls, 0);
  assert.equal(client.committedRecords.length, 2);
  assert.equal(client.committedEvents.length, 2);
});

test('insertPropagationBatch failure leaves no partial propagation persisted', async () => {
  const client = new AtomicPropagationClient();
  const repository = new DatabaseCertificationRepository(
    client as unknown as UnitTalkSupabaseClient,
  );

  await assert.rejects(
    () => repository.insertPropagationBatch([
      makeResult({
        recordId: '55555555-5555-4555-8555-555555555555',
        eventId: '66666666-6666-4666-8666-666666666666',
        domain: 'replay',
      }),
      makeResult({
        recordId: '77777777-7777-4777-8777-777777777777',
        eventId: '88888888-8888-4888-8888-888888888888',
        domain: 'divergence',
        triggerReason: 'force event failure',
      }),
    ]),
    /certification propagation batch insert failed: simulated transition-event insert failure/,
  );

  assert.equal(client.rpcCalls.length, 1);
  assert.equal(client.fromCalls, 0);
  assert.deepEqual(client.committedRecords, []);
  assert.deepEqual(client.committedEvents, []);
});
