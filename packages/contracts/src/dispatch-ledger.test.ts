import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discordMessageNonce,
  dispatchLedgerActions as a,
  isDispatchAmbiguous,
  readDispatchLedger,
} from './dispatch-ledger.js';

const receipt = {
  receiptType: 'discord.message',
  channel: '100000000000000002',
  externalId: 'm-1',
  idempotencyKey: 'o-1:discord:official-picks:receipt',
  payload: { messageId: 'm-1' },
};

test('an empty ledger is clean and starts at attempt 1', () => {
  const state = readDispatchLedger([]);
  assert.deepEqual(state, {
    lastAttempt: 0,
    nextAttempt: 1,
    unresolvedAttempts: [],
    delivered: null,
    malformed: 0,
  });
  assert.equal(isDispatchAmbiguous(state), false);
});

test('a started attempt with no outcome is ambiguous', () => {
  const state = readDispatchLedger([{ action: a.started, payload: { attempt: 1 } }]);
  assert.deepEqual(state.unresolvedAttempts, [1]);
  assert.equal(state.nextAttempt, 2);
  assert.equal(isDispatchAmbiguous(state), true);
});

test('not_created resolves its attempt', () => {
  const state = readDispatchLedger([
    { action: a.started, payload: { attempt: 1 } },
    { action: a.notCreated, payload: { attempt: 1 } },
  ]);
  assert.equal(isDispatchAmbiguous(state), false);
  assert.equal(state.nextAttempt, 2);
});

test('an outcome for a different attempt does not resolve this one', () => {
  const state = readDispatchLedger([
    { action: a.started, payload: { attempt: 1 } },
    { action: a.started, payload: { attempt: 2 } },
    { action: a.notCreated, payload: { attempt: 2 } },
  ]);
  assert.deepEqual(state.unresolvedAttempts, [1]);
  assert.equal(isDispatchAmbiguous(state), true);
});

test('reconciled-through clears every attempt up to and including throughAttempt, not later ones', () => {
  const through1 = readDispatchLedger([
    { action: a.started, payload: { attempt: 1 } },
    { action: a.reconciled, payload: { throughAttempt: 1 } },
  ]);
  assert.equal(isDispatchAmbiguous(through1), false);
  assert.equal(through1.nextAttempt, 2);

  const later = readDispatchLedger([
    { action: a.started, payload: { attempt: 1 } },
    { action: a.reconciled, payload: { throughAttempt: 1 } },
    { action: a.started, payload: { attempt: 2 } },
  ]);
  assert.deepEqual(later.unresolvedAttempts, [2]);
  assert.equal(isDispatchAmbiguous(later), true);
});

test('a delivered record wins: the state is not ambiguous and carries the receipt', () => {
  const state = readDispatchLedger([
    { action: a.started, payload: { attempt: 1 } },
    { action: a.started, payload: { attempt: 2 } },
    { action: a.delivered, payload: { attempt: 2, receipt } },
  ]);
  assert.equal(state.delivered?.attempt, 2);
  assert.equal(state.delivered?.receipt.externalId, 'm-1');
  assert.equal(isDispatchAmbiguous(state), false, 'delivered means confirm, never re-post');
});

test('the latest delivered attempt is the one kept', () => {
  const state = readDispatchLedger([
    { action: a.delivered, payload: { attempt: 3, receipt: { ...receipt, externalId: 'm-3' } } },
    { action: a.delivered, payload: { attempt: 1, receipt } },
  ]);
  assert.equal(state.delivered?.receipt.externalId, 'm-3');
});

test('malformed rows count and make the state ambiguous', () => {
  for (const row of [
    { action: a.started, payload: {} },
    { action: a.started, payload: { attempt: 0 } },
    { action: a.started, payload: { attempt: 1.5 } },
    { action: a.started, payload: { attempt: '1' } },
    { action: a.notCreated, payload: null },
    { action: a.delivered, payload: { attempt: 1 } },
    { action: a.delivered, payload: { attempt: 1, receipt: { ...receipt, externalId: '' } } },
    { action: a.reconciled, payload: { throughAttempt: -1 } },
  ]) {
    const state = readDispatchLedger([row]);
    assert.equal(state.malformed, 1, JSON.stringify(row));
    assert.equal(isDispatchAmbiguous(state), true, JSON.stringify(row));
  }
});

test('unrelated actions are ignored', () => {
  const state = readDispatchLedger([
    { action: 'distribution.sent', payload: {} },
    { action: a.ambiguous, payload: { reason: 'x' } },
  ]);
  assert.equal(isDispatchAmbiguous(state), false);
  assert.equal(state.malformed, 0);
});

test('discordMessageNonce is deterministic, dash-free and at most 25 characters', () => {
  const id = '3447bb03-1234-4abc-9def-0123456789ab';
  const nonce = discordMessageNonce(id);
  assert.equal(nonce, discordMessageNonce(id));
  assert.ok(nonce.length <= 25);
  assert.ok(!nonce.includes('-'));
  assert.notEqual(nonce, discordMessageNonce('684ba33f-1234-4abc-9def-0123456789ab'));
});
