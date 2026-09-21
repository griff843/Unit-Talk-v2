import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { observeSettlementRecap } from './settlement-recap-observation.js';
function details(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test('recap evidence exists before delivery and retains pick, settlement, destination and outcome', async () => {
  const { runs } = createInMemoryRepositoryBundle();
  const outcome = await observeSettlementRecap('pick-1', 'settlement-1', runs, async () => {
    const before = await runs.listByType('recap.post');
    assert.equal(before.length, 1);
    assert.equal(before[0]?.status, 'running');
    assert.equal(details(before[0]?.details)['pickId'], 'pick-1');
    return { posted: true, channel: 'channel-1', messageId: 'message-1' };
  });
  assert.deepEqual(outcome, { posted: true });
  const [after] = await runs.listByType('recap.post');
  assert.equal(after?.status, 'succeeded');
  assert.ok(after?.finished_at);
  assert.deepEqual(after?.details, { recapKind: 'settlement-pick', pickId: 'pick-1', settlementRecordId: 'settlement-1', pickCount: 1, posted: true, channel: 'channel-1', messageId: 'message-1' });
});

test('a kill-switch refusal and HTTP failure retain distinct durable reasons', async () => {
  const { runs } = createInMemoryRepositoryBundle();
  await observeSettlementRecap('pick-1', 'settlement-1', runs, async () => ({ posted: false, reason: 'kill-switch-engaged' }));
  await observeSettlementRecap('pick-2', 'settlement-2', runs, async () => ({ posted: false, reason: 'discord_post_failed_403', failed: true, channel: 'channel-1' }));
  const records = await runs.listByType('recap.post');
  assert.equal(records.find((row) => details(row.details)['pickId'] === 'pick-1')?.status, 'cancelled');
  assert.equal(details(records.find((row) => details(row.details)['pickId'] === 'pick-1')?.details)['reason'], 'kill-switch-engaged');
  assert.equal(records.find((row) => details(row.details)['pickId'] === 'pick-2')?.status, 'failed');
  assert.equal(details(records.find((row) => details(row.details)['pickId'] === 'pick-2')?.details)['reason'], 'discord_post_failed_403');
});

test('lost responses remain uncertain rather than falsely confirming non-delivery', async () => {
  const { runs } = createInMemoryRepositoryBundle();
  const outcome = await observeSettlementRecap('pick-1', 'settlement-1', runs, async () => { throw new Error('connection lost'); });
  assert.deepEqual(outcome, { posted: false, reason: 'recap_request_outcome_unknown' });
  assert.equal(details((await runs.listByType('recap.post'))[0]?.details)['reason'], 'recap_request_outcome_unknown');
});

test('an unavailable provenance store refuses a new delivery attempt', async () => {
  const { runs } = createInMemoryRepositoryBundle();
  runs.startRun = async () => { throw new Error('DB unavailable'); };
  let attempted = false;
  const outcome = await observeSettlementRecap('pick-1', 'settlement-1', runs, async () => { attempted = true; return { posted: true }; });
  assert.equal(attempted, false);
  assert.deepEqual(outcome, { posted: false, reason: 'recap_provenance_unavailable' });
});

test('persistence failure after an accepted post leaves unresolved evidence and preserves the actual outcome', async () => {
  const { runs } = createInMemoryRepositoryBundle();
  runs.completeRun = async () => { throw new Error('DB unavailable'); };
  const warnings: string[] = [];
  const outcome = await observeSettlementRecap('pick-1', 'settlement-1', runs, async () => ({ posted: true, channel: 'channel-1' }), (message) => warnings.push(message));
  assert.deepEqual(outcome, { posted: true });
  assert.equal((await runs.listByType('recap.post'))[0]?.status, 'running');
  assert.match(warnings[0] ?? '', /remains unresolved/);
});
