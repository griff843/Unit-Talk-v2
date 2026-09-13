import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionSubmissionGuard } from '../lib/submission-guard';

test('a synchronous lock refuses repeated clicks while a request is in flight', () => {
  const guard = createSessionSubmissionGuard();
  assert.equal(guard.acquire(), 'acquired');
  assert.equal(guard.acquire(), 'in-flight');
  assert.equal(guard.acquire(), 'in-flight');
});

test('a failed request can be retried once its finally block releases the lock', () => {
  const guard = createSessionSubmissionGuard();
  assert.equal(guard.acquire(), 'acquired');
  guard.release();
  assert.equal(guard.acquire(), 'acquired');
  assert.equal(guard.acquire(), 'in-flight');
});

test('a completed request does not create a client duplicate-admission policy', () => {
  const guard = createSessionSubmissionGuard();
  assert.equal(guard.acquire(), 'acquired');
  guard.release();
  // A deliberate subsequent submission reaches authoritative API idempotency.
  // No book, price, capper, event date, or stake defines uniqueness in this guard.
  assert.equal(guard.acquire(), 'acquired');
});

test('remounting starts an idle guard without consulting persisted pick identities', () => {
  const first = createSessionSubmissionGuard();
  assert.equal(first.acquire(), 'acquired');
  first.release();
  const remounted = createSessionSubmissionGuard();
  assert.equal(remounted.acquire(), 'acquired');
});

test('an idle release is harmless and does not prevent the next request', () => {
  const guard = createSessionSubmissionGuard();
  guard.release();
  assert.equal(guard.acquire(), 'acquired');
});

test('the lock stays held across a pending submission await and rejects rapid clicks', async () => {
  const guard = createSessionSubmissionGuard();
  let finishRequest: (() => void) | undefined;
  const pendingRequest = new Promise<void>((resolve) => { finishRequest = resolve; });
  const submission = (async () => {
    assert.equal(guard.acquire(), 'acquired');
    try {
      await pendingRequest;
    } finally {
      guard.release();
    }
  })();
  await Promise.resolve();
  assert.equal(guard.acquire(), 'in-flight');
  assert.equal(guard.acquire(), 'in-flight');
  assert.ok(finishRequest);
  finishRequest();
  await submission;
  assert.equal(guard.acquire(), 'acquired');
});

test('a rejected submission preserves its error while finally releases for retry', async () => {
  const guard = createSessionSubmissionGuard();
  const originalError = new Error('submission response unavailable');
  const submit = async () => {
    assert.equal(guard.acquire(), 'acquired');
    try {
      await Promise.reject(originalError);
    } finally {
      guard.release();
    }
  };
  await assert.rejects(submit(), (error: unknown) => {
    assert.strictEqual(error, originalError);
    return true;
  });
  assert.equal(guard.acquire(), 'acquired');
});
