import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalPick } from '@unit-talk/contracts';
import {
  InMemoryPickRepository,
  InMemorySettlementRepository,
  InMemorySubmissionRepository,
} from './runtime-repositories.js';

function makePick(
  overrides: Partial<CanonicalPick> & { id: string },
): CanonicalPick {
  return {
    submissionId: 'sub-1',
    market: 'nba-spread',
    selection: 'Lakers -3.5',
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('InMemoryPickRepository.savePick rejects invalid picks.status values', async () => {
  const repository = new InMemoryPickRepository();

  await assert.rejects(
    repository.savePick(
      makePick({
        id: 'pick-invalid-status',
        lifecycleState: 'bad-state' as CanonicalPick['lifecycleState'],
      }),
    ),
    /Invalid picks\.status/,
  );
});

test('InMemorySubmissionRepository.saveSubmissionEvent rejects empty and whitespace-only event names', async () => {
  const repository = new InMemorySubmissionRepository();

  for (const eventName of ['', '   ']) {
    await assert.rejects(
      repository.saveSubmissionEvent({
        submissionId: 'submission-1',
        eventName,
        payload: {},
        createdAt: new Date().toISOString(),
      }),
      /Invalid submission_events\.event_name/,
    );
  }
});

test('InMemorySettlementRepository.record rejects unknown corrects_id references', async () => {
  const repository = new InMemorySettlementRepository();

  await assert.rejects(
    repository.record({
      pickId: 'pick-1',
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'evidence://1',
      notes: null,
      reviewReason: null,
      settledBy: 'operator-1',
      settledAt: new Date().toISOString(),
      correctsId: 'missing-settlement',
      payload: {},
    }),
    /Invalid settlement_records\.corrects_id/,
  );
});

test('InMemorySettlementRepository.record preserves additive correction semantics for repeated corrects_id references', async () => {
  const repository = new InMemorySettlementRepository();
  const settledAt = new Date().toISOString();

  const original = await repository.record({
    pickId: 'pick-1',
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: 'evidence://original',
    notes: null,
    reviewReason: null,
    settledBy: 'operator-1',
    settledAt,
    correctsId: null,
    payload: {},
  });

  const firstCorrection = await repository.record({
    pickId: 'pick-1',
    status: 'manual_review',
    result: 'loss',
    source: 'operator',
    confidence: 'estimated',
    evidenceRef: 'evidence://correction-1',
    notes: 'first correction',
    reviewReason: 'score change',
    settledBy: 'operator-2',
    settledAt,
    correctsId: original.id,
    payload: {},
  });

  const secondCorrection = await repository.record({
    pickId: 'pick-1',
    status: 'manual_review',
    result: 'push',
    source: 'operator',
    confidence: 'pending',
    evidenceRef: 'evidence://correction-2',
    notes: 'second correction',
    reviewReason: 'provider discrepancy',
    settledBy: 'operator-3',
    settledAt,
    correctsId: original.id,
    payload: {},
  });

  assert.equal(firstCorrection.corrects_id, original.id);
  assert.equal(secondCorrection.corrects_id, original.id);
  assert.notEqual(firstCorrection.id, secondCorrection.id);
});
