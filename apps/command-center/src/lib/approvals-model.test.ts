import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageHoursFrom,
  classifyApproval,
  compareApprovalLabels,
  type ApprovalRowInput,
} from './approvals-model';

function row(overrides: Partial<ApprovalRowInput>): ApprovalRowInput {
  return {
    id: 'p1',
    queue: 'review',
    status: 'validated',
    approvalStatus: 'pending',
    createdAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

test('awaiting_approval lifecycle status is Approvalable', () => {
  assert.equal(classifyApproval(row({ status: 'awaiting_approval' })).label, 'Approvalable');
});

test('governanceQueueState awaiting_approval is Approvalable even off the held queue', () => {
  const result = classifyApproval(row({ queue: 'held', governanceQueueState: 'awaiting_approval' }));
  assert.equal(result.label, 'Approvalable');
});

test('held picks without governance state are Needs PM with hold reason surfaced', () => {
  const result = classifyApproval(row({ queue: 'held', holdReason: 'line moved' }));
  assert.equal(result.label, 'Needs PM');
  assert.ok(result.reason.includes('line moved'));
});

test('review queue default is Needs Review', () => {
  assert.equal(classifyApproval(row({})).label, 'Needs Review');
});

test('terminal lifecycle statuses are Blocked', () => {
  for (const status of ['voided', 'rejected', 'expired', 'settled']) {
    assert.equal(classifyApproval(row({ status })).label, 'Blocked', status);
  }
});

test('denied approval status is Blocked even in awaiting queue', () => {
  const result = classifyApproval(row({ queue: 'awaiting_approval', approvalStatus: 'denied' }));
  assert.equal(result.label, 'Blocked');
});

test('ageHoursFrom computes floor hours and tolerates bad input', () => {
  const now = Date.parse('2026-07-06T12:30:00.000Z');
  assert.equal(ageHoursFrom('2026-07-06T00:00:00.000Z', now), 12);
  assert.equal(ageHoursFrom(null, now), null);
  assert.equal(ageHoursFrom('garbage', now), null);
});

test('compareApprovalLabels orders Approvalable first, Blocked last', () => {
  const labels = ['Blocked', 'Needs Review', 'Approvalable', 'Needs PM'] as const;
  const sorted = [...labels].sort(compareApprovalLabels);
  assert.deepEqual(sorted, ['Approvalable', 'Needs PM', 'Needs Review', 'Blocked']);
});
