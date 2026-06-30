import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalPick, WriterRole } from '@unit-talk/contracts';
import type {
  PromotionDecisionPersistenceInput,
  PromotionHistoryInsertInput,
  SettlementCreateInput,
} from './repositories.js';
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

function makeSettlementInput(
  overrides: Partial<SettlementCreateInput> = {},
): SettlementCreateInput {
  return {
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
    correctsId: null,
    payload: {},
    ...overrides,
  };
}

function makePromotionDecisionInput(
  overrides: Partial<PromotionDecisionPersistenceInput> = {},
): PromotionDecisionPersistenceInput {
  return {
    pickId: 'pick-1',
    target: 'best-bets',
    approvalStatus: 'approved',
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    promotionScore: 75,
    promotionReason: 'meets threshold',
    promotionVersion: 'test-v1',
    promotionDecidedAt: new Date().toISOString(),
    promotionDecidedBy: 'test',
    overrideAction: null,
    metadataPatch: {},
    payload: {},
    ...overrides,
  };
}

function makePromotionHistoryInput(
  overrides: Partial<PromotionHistoryInsertInput> = {},
): PromotionHistoryInsertInput {
  return {
    pickId: 'pick-1',
    target: 'best-bets',
    promotionStatus: 'qualified',
    promotionScore: 75,
    promotionReason: 'meets threshold',
    promotionVersion: 'test-v1',
    promotionDecidedAt: new Date().toISOString(),
    promotionDecidedBy: 'test',
    overrideAction: null,
    payload: {},
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

test('InMemoryPickRepository.savePick rejects invalid picks promotion constraint values', async () => {
  const repository = new InMemoryPickRepository();

  await assert.rejects(
    repository.savePick(
      makePick({
        id: 'pick-invalid-approval-status',
        approvalStatus: 'hold' as CanonicalPick['approvalStatus'],
      }),
    ),
    /Invalid picks\.approval_status/,
  );

  await assert.rejects(
    repository.savePick(
      makePick({
        id: 'pick-invalid-promotion-status',
        promotionStatus: 'pending' as CanonicalPick['promotionStatus'],
      }),
    ),
    /Invalid picks\.promotion_status/,
  );

  await assert.rejects(
    repository.savePick(
      makePick({
        id: 'pick-invalid-promotion-target',
        promotionTarget: 'strategy-room' as CanonicalPick['promotionTarget'],
      }),
    ),
    /Invalid picks\.promotion_target/,
  );
});

test('InMemoryPickRepository.saveLifecycleEvent rejects invalid writer roles', async () => {
  const repository = new InMemoryPickRepository();

  await assert.rejects(
    repository.saveLifecycleEvent({
      pickId: 'pick-1',
      fromState: 'validated',
      toState: 'queued',
      writerRole: 'reviewer' as WriterRole,
      reason: 'invalid writer role',
      createdAt: new Date().toISOString(),
    }),
    /Invalid pick_lifecycle\.writer_role/,
  );
});

test('InMemoryPickRepository.updateApprovalStatus rejects invalid picks.approval_status values', async () => {
  const repository = new InMemoryPickRepository();
  await repository.savePick(makePick({ id: 'pick-approval-update' }));

  await assert.rejects(
    repository.updateApprovalStatus('pick-approval-update', 'hold'),
    /Invalid picks\.approval_status/,
  );
});

test('InMemoryPickRepository.persistPromotionDecision rejects invalid promotion constraints without mutating pick', async () => {
  const repository = new InMemoryPickRepository();
  await repository.savePick(makePick({ id: 'pick-1' }));

  await assert.rejects(
    repository.persistPromotionDecision(
      makePromotionDecisionInput({
        promotionStatus:
          'pending' as PromotionDecisionPersistenceInput['promotionStatus'],
      }),
    ),
    /Invalid picks\.promotion_status/,
  );

  const unchanged = await repository.findPickById('pick-1');
  assert.equal(unchanged?.promotion_status, 'not_eligible');
});

test('InMemoryPickRepository.insertPromotionHistoryRow rejects invalid history target and status values', async () => {
  const repository = new InMemoryPickRepository();

  await assert.rejects(
    repository.insertPromotionHistoryRow(
      makePromotionHistoryInput({
        target: 'strategy-room' as PromotionHistoryInsertInput['target'],
      }),
    ),
    /Invalid pick_promotion_history\.target/,
  );

  await assert.rejects(
    repository.insertPromotionHistoryRow(
      makePromotionHistoryInput({
        promotionStatus:
          'pending' as PromotionHistoryInsertInput['promotionStatus'],
      }),
    ),
    /Invalid pick_promotion_history\.status/,
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
    repository.record(
      makeSettlementInput({ correctsId: 'missing-settlement' }),
    ),
    /Invalid settlement_records\.corrects_id/,
  );
});

test('InMemorySettlementRepository.record rejects invalid settlement status and confidence values', async () => {
  const repository = new InMemorySettlementRepository();

  await assert.rejects(
    repository.record(
      makeSettlementInput({
        status: 'voided' as SettlementCreateInput['status'],
      }),
    ),
    /Invalid settlement_records\.status/,
  );

  await assert.rejects(
    repository.record(
      makeSettlementInput({
        confidence: 'uncertain' as SettlementCreateInput['confidence'],
      }),
    ),
    /Invalid settlement_records\.confidence/,
  );
});

test('InMemorySettlementRepository.record preserves additive correction semantics for repeated corrects_id references', async () => {
  const repository = new InMemorySettlementRepository();
  const settledAt = new Date().toISOString();

  const original = await repository.record({
    ...makeSettlementInput({ settledAt }),
    evidenceRef: 'evidence://original',
  });

  const firstCorrection = await repository.record({
    ...makeSettlementInput({
      status: 'manual_review',
      result: null,
      confidence: 'estimated',
      evidenceRef: 'evidence://correction-1',
      notes: 'first correction',
      reviewReason: 'score change',
      settledBy: 'operator-2',
      settledAt,
      correctsId: original.id,
    }),
  });

  const secondCorrection = await repository.record({
    ...makeSettlementInput({
      status: 'manual_review',
      result: null,
      confidence: 'pending',
      evidenceRef: 'evidence://correction-2',
      notes: 'second correction',
      reviewReason: 'provider discrepancy',
      settledBy: 'operator-3',
      settledAt,
      correctsId: original.id,
    }),
  });

  assert.equal(firstCorrection.corrects_id, original.id);
  assert.equal(secondCorrection.corrects_id, original.id);
  assert.notEqual(firstCorrection.id, secondCorrection.id);
});
