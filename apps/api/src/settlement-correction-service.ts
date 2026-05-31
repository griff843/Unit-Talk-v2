/**
 * Settlement Correction Service — dual-authorized correction creation.
 *
 * Enforces at the service boundary:
 *   1. Dual authorization validated before any DB write
 *   2. Correction row created in settlement_records (with corrects_id)
 *   3. Authorization record created in settlement_corrections
 *   4. AuditEvent emitted referencing the correction record
 *
 * Fail-closed: throws on any dual-auth violation before touching the DB.
 */

import {
  validateSettlementCorrectionInput,
  buildCorrectionLineage,
  type SettlementCorrectionInput,
  type SettlementCorrectionRecord,
} from '@unit-talk/domain';
import type {
  AuditLogRecord,
  AuditLogRepository,
  SettlementRecord,
  SettlementRepository,
  SettlementSource,
  SettlementConfidence,
} from '@unit-talk/db';
import { ApiError } from './errors.js';

// ── Repository interface for settlement_corrections ──────────────────────────

export interface SettlementCorrectionCreateInput {
  readonly settlement_record_id: string;
  readonly prior_record_id: string;
  readonly authorizer_1: string;
  readonly authorizer_2: string;
  readonly justification: string;
  readonly audit_event_id?: string | null;
}

export interface SettlementCorrectionRepository {
  create(input: SettlementCorrectionCreateInput): Promise<SettlementCorrectionRecord>;
  findBySettlementRecord(settlementRecordId: string): Promise<SettlementCorrectionRecord | null>;
}

// ── Service result ────────────────────────────────────────────────────────────

export interface RecordCorrectionResult {
  readonly correctionRecord: SettlementCorrectionRecord;
  readonly settlementRecord: SettlementRecord;
  readonly auditRecord: AuditLogRecord;
  readonly lineage: string;
}

// ── Core function ─────────────────────────────────────────────────────────────

export async function recordDualAuthorizedCorrection(
  input: SettlementCorrectionInput,
  repositories: {
    settlements: SettlementRepository;
    corrections: SettlementCorrectionRepository;
    audit: AuditLogRepository;
  },
): Promise<RecordCorrectionResult> {
  // 1. Validate dual authorization — fail closed before any DB write
  const validation = validateSettlementCorrectionInput(input);
  if (!validation.ok) {
    throw new ApiError(
      400,
      'DUAL_AUTH_VIOLATION',
      `Settlement correction rejected: ${validation.errors.join('; ')}`,
    );
  }

  // 2. Create the correction row in settlement_records (corrects_id set)
  const settlementRecord = await repositories.settlements.record({
    pickId: input.pick_id,
    status: 'manual_review',
    result: input.result,
    source: input.source as SettlementSource,
    confidence: input.confidence as SettlementConfidence,
    evidenceRef: input.evidence_ref,
    notes: input.notes ?? null,
    settledBy: input.settled_by,
    settledAt: input.settled_at,
    correctsId: input.prior_record_id,
    payload: {
      correction: true,
      authorizer_1: input.authorization.authorizer_1,
      authorizer_2: input.authorization.authorizer_2,
    },
  });

  // 3. Create the dual-authorization record
  const lineage = buildCorrectionLineage(input, settlementRecord.id);

  const correctionRecord = await repositories.corrections.create({
    settlement_record_id: settlementRecord.id,
    prior_record_id: input.prior_record_id,
    authorizer_1: input.authorization.authorizer_1,
    authorizer_2: input.authorization.authorizer_2,
    justification: input.authorization.justification,
  });

  // 4. Emit AuditEvent referencing the correction record
  const auditRecord = await repositories.audit.record({
    entityType: 'settlement_correction',
    entityId: correctionRecord.id,
    entityRef: input.pick_id,
    action: 'DUAL_AUTHORIZED_CORRECTION_RECORDED',
    actor: `${input.authorization.authorizer_1}+${input.authorization.authorizer_2}`,
    payload: {
      settlement_record_id: settlementRecord.id,
      correction_record_id: correctionRecord.id,
      prior_record_id: input.prior_record_id,
      lineage,
    },
  });

  return {
    correctionRecord,
    settlementRecord,
    auditRecord,
    lineage,
  };
}
