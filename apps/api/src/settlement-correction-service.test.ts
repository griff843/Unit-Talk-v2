import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  recordDualAuthorizedCorrection,
  type SettlementCorrectionRepository,
} from './settlement-correction-service.js';
import type {
  AuditLogCreateInput,
  AuditLogRow,
  SettlementCreateInput,
  SettlementRecord,
  AuditLogRepository,
  SettlementRepository,
} from '@unit-talk/db';
import type {
  SettlementCorrectionInput,
  SettlementCorrectionRecord,
} from '@unit-talk/domain';

// ── InMemory stubs ────────────────────────────────────────────────────────────

function makeSettlementRepo(): SettlementRepository & { records: SettlementRecord[] } {
  const records: SettlementRecord[] = [];
  let counter = 0;
  return {
    records,
    async record(input: SettlementCreateInput) {
      const row = {
        id: `sr-${++counter}`,
        pick_id: input.pickId,
        status: input.status,
        result: input.result ?? null,
        source: input.source,
        confidence: input.confidence,
        evidence_ref: input.evidenceRef,
        notes: input.notes ?? null,
        review_reason: input.reviewReason ?? null,
        settled_by: input.settledBy,
        settled_at: input.settledAt,
        corrects_id: input.correctsId ?? null,
        payload: input.payload,
        created_at: new Date().toISOString(),
        stake_units: null,
      } as SettlementRecord;
      records.push(row);
      return row;
    },
    async settlePickAtomic() { throw new Error('not implemented'); },
    async findLatestForPick() { return null; },
    async listByPick() { return []; },
    async listRecent() { return []; },
  };
}

function makeCorrectionRepo(): SettlementCorrectionRepository & { records: SettlementCorrectionRecord[] } {
  const records: SettlementCorrectionRecord[] = [];
  let counter = 0;
  return {
    records,
    async create(input) {
      const row: SettlementCorrectionRecord = {
        id: `sc-${++counter}`,
        settlement_record_id: input.settlement_record_id,
        prior_record_id: input.prior_record_id,
        authorizer_1: input.authorizer_1,
        authorizer_2: input.authorizer_2,
        justification: input.justification,
        correction_at: new Date().toISOString(),
        audit_event_id: input.audit_event_id ?? null,
      };
      records.push(row);
      return row;
    },
    async findBySettlementRecord() { return null; },
  };
}

function makeAuditRepo(): AuditLogRepository & { records: AuditLogRow[] } {
  const records: AuditLogRow[] = [];
  let counter = 0;
  return {
    records,
    async record(input: AuditLogCreateInput) {
      const row = {
        id: `al-${++counter}`,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        entity_ref: input.entityRef ?? null,
        action: input.action,
        actor: input.actor ?? null,
        payload: input.payload,
        created_at: new Date().toISOString(),
      } as AuditLogRow;
      records.push(row);
      return row;
    },
    async listRecentByEntityType() { return []; },
  };
}

const VALID_INPUT: SettlementCorrectionInput = {
  prior_record_id: 'prior-uuid',
  pick_id: 'pick-uuid',
  result: 'win',
  source: 'manual',
  confidence: 'confirmed',
  evidence_ref: 'evidence-001',
  settled_by: 'user-a',
  settled_at: '2026-05-31T00:00:00Z',
  authorization: {
    authorizer_1: 'user-a',
    authorizer_2: 'user-b',
    justification: 'Correcting data entry error',
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test('recordDualAuthorizedCorrection — succeeds with valid dual auth', async () => {
  const settlements = makeSettlementRepo();
  const corrections = makeCorrectionRepo();
  const audit = makeAuditRepo();

  const result = await recordDualAuthorizedCorrection(VALID_INPUT, {
    settlements,
    corrections,
    audit,
  });

  assert.ok(result.settlementRecord.id);
  assert.equal(result.settlementRecord.corrects_id, 'prior-uuid');
  assert.equal(result.settlementRecord.pick_id, 'pick-uuid');

  assert.ok(result.correctionRecord.id);
  assert.equal(result.correctionRecord.authorizer_1, 'user-a');
  assert.equal(result.correctionRecord.authorizer_2, 'user-b');
  assert.equal(result.correctionRecord.settlement_record_id, result.settlementRecord.id);
  assert.equal(result.correctionRecord.prior_record_id, 'prior-uuid');

  assert.equal(audit.records.length, 1);
  assert.equal(audit.records[0]!.action, 'DUAL_AUTHORIZED_CORRECTION_RECORDED');
  assert.equal(audit.records[0]!.entity_type, 'settlement_correction');
});

test('recordDualAuthorizedCorrection — rejects single-approver correction', async () => {
  const settlements = makeSettlementRepo();
  const corrections = makeCorrectionRepo();
  const audit = makeAuditRepo();

  await assert.rejects(
    () =>
      recordDualAuthorizedCorrection(
        {
          ...VALID_INPUT,
          authorization: {
            authorizer_1: 'same-user',
            authorizer_2: 'same-user',
            justification: 'attempting single-approver correction',
          },
        },
        { settlements, corrections, audit },
      ),
    /DUAL_AUTH_VIOLATION/,
  );

  // No DB writes on validation failure
  assert.equal(settlements.records.length, 0);
  assert.equal(corrections.records.length, 0);
  assert.equal(audit.records.length, 0);
});

test('recordDualAuthorizedCorrection — rejects missing justification', async () => {
  const settlements = makeSettlementRepo();
  const corrections = makeCorrectionRepo();
  const audit = makeAuditRepo();

  await assert.rejects(
    () =>
      recordDualAuthorizedCorrection(
        {
          ...VALID_INPUT,
          authorization: {
            ...VALID_INPUT.authorization,
            justification: '',
          },
        },
        { settlements, corrections, audit },
      ),
    /DUAL_AUTH_VIOLATION/,
  );

  assert.equal(settlements.records.length, 0);
});

test('recordDualAuthorizedCorrection — sets corrects_id on settlement record', async () => {
  const settlements = makeSettlementRepo();
  const corrections = makeCorrectionRepo();
  const audit = makeAuditRepo();

  const result = await recordDualAuthorizedCorrection(VALID_INPUT, {
    settlements,
    corrections,
    audit,
  });

  assert.equal(result.settlementRecord.corrects_id, VALID_INPUT.prior_record_id);
});

test('recordDualAuthorizedCorrection — lineage includes all required fields', async () => {
  const settlements = makeSettlementRepo();
  const corrections = makeCorrectionRepo();
  const audit = makeAuditRepo();

  const result = await recordDualAuthorizedCorrection(VALID_INPUT, {
    settlements,
    corrections,
    audit,
  });

  const lineage = JSON.parse(result.lineage) as Record<string, unknown>;
  assert.ok(lineage.correction_id);
  assert.equal(lineage.prior_record_id, 'prior-uuid');
  assert.equal(lineage.authorizer_1, 'user-a');
  assert.equal(lineage.authorizer_2, 'user-b');
});

test('recordDualAuthorizedCorrection — audit payload references correction record', async () => {
  const settlements = makeSettlementRepo();
  const corrections = makeCorrectionRepo();
  const audit = makeAuditRepo();

  const result = await recordDualAuthorizedCorrection(VALID_INPUT, {
    settlements,
    corrections,
    audit,
  });

  const auditPayload = audit.records[0]!.payload as Record<string, unknown>;
  assert.equal(auditPayload.correction_record_id, result.correctionRecord.id);
  assert.equal(auditPayload.settlement_record_id, result.settlementRecord.id);
});
