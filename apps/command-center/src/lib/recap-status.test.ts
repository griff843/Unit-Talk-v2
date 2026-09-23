import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRecapEvidence, type RecapEvidence } from './recap-status';
const row = (overrides: Partial<RecapEvidence> = {}): RecapEvidence => ({ id: 'run-1', status: 'succeeded', started_at: '2026-09-20T00:00:00Z', finished_at: '2026-09-20T00:00:01Z', details: { posted: true, channel: 'channel-1' }, ...overrides });

test('a publication requires terminal success, destination and timestamp evidence', () => {
  assert.equal(summarizeRecapEvidence([row()], false).state, 'posted');
  assert.equal(summarizeRecapEvidence([row({ details: { posted: true } })], false).state, 'unavailable');
  assert.equal(summarizeRecapEvidence([row({ finished_at: null })], false).state, 'unavailable');
});
test('verified non-delivery differs from missing historical recap evidence', () => {
  assert.equal(summarizeRecapEvidence([], true).state, 'not-applicable');
  assert.equal(summarizeRecapEvidence([], false).state, 'unavailable');
});
test('a recorded refusal has a specific reason while lost responses remain unresolved', () => {
  assert.match(summarizeRecapEvidence([row({ status: 'cancelled', details: { posted: false, reason: 'kill-switch-engaged' } })], false).description, /kill switch/);
  assert.equal(summarizeRecapEvidence([row({ status: 'failed', details: { posted: false, reason: 'recap_request_outcome_unknown' } })], false).state, 'unavailable');
  assert.equal(summarizeRecapEvidence([row({ status: 'running', finished_at: null, details: {} })], false).state, 'unavailable');
});
test('a later refused retry cannot erase a previously confirmed publication', () => {
  const retry = row({ id: 'retry', started_at: '2026-09-21T00:00:00Z', status: 'cancelled', details: { posted: false, reason: 'kill-switch-engaged' } });
  assert.equal(summarizeRecapEvidence([retry, row()], false).state, 'posted');
});
