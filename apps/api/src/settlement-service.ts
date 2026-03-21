import {
  validateSettlementRequest,
  type SettlementRequest,
} from '@unit-talk/contracts';
import {
  classifyLoss,
  computeSettlementSummary,
  resolveEffectiveSettlement,
  summarizeLossAttributions,
  type EffectiveSettlement,
  type LossAttributionOutput,
  type LossAttributionSummary,
  type SettlementInput,
  type SettlementSummary,
} from '@unit-talk/domain';
import type {
  AuditLogRecord,
  AuditLogRepository,
  PickLifecycleRecord,
  PickRecord,
  PickRepository,
  SettlementRecord,
  SettlementRepository,
} from '@unit-talk/db';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { ApiError } from './errors.js';

export interface RecordSettlementResult {
  pickRecord: PickRecord;
  settlementRecord: SettlementRecord;
  lifecycleEvent: PickLifecycleRecord | null;
  auditRecords: AuditLogRecord[];
  finalLifecycleState: PickRecord['status'];
  downstream: SettlementDownstreamBundle;
}

export interface SettlementDownstreamBundle {
  effectiveSettlement: EffectiveSettlement | null;
  settlementSummary: SettlementSummary;
  lossAttribution: LossAttributionOutput | null;
  lossAttributionSummary: LossAttributionSummary | null;
  unresolvedReason: string | null;
}

export async function recordPickSettlement(
  pickId: string,
  request: SettlementRequest,
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
    audit: AuditLogRepository;
  },
): Promise<RecordSettlementResult> {
  const validation = validateSettlementRequest(request);
  if (!validation.ok) {
    throw new ApiError(
      400,
      'INVALID_SETTLEMENT_REQUEST',
      validation.errors.join(', '),
    );
  }

  if (request.source === 'feed') {
    throw new ApiError(
      409,
      'AUTOMATED_SETTLEMENT_NOT_ALLOWED',
      'Automated settlement input is blocked until a separate written and ratified contract authorizes feed-triggered writes.',
    );
  }

  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    throw new ApiError(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  if (request.status === 'manual_review') {
    return recordManualReview(pick, request, repositories);
  }

  if (pick.status === 'posted') {
    return recordInitialSettlement(pick, request, repositories);
  }

  if (pick.status === 'settled') {
    return recordSettlementCorrection(pick, request, repositories);
  }

  throw new ApiError(
    409,
    'SETTLEMENT_NOT_ALLOWED',
    `Pick ${pickId} must be in posted or settled state; found ${pick.status}`,
  );
}

async function recordManualReview(
  pick: PickRecord,
  request: SettlementRequest,
  repositories: {
    settlements: SettlementRepository;
    audit: AuditLogRepository;
  },
): Promise<RecordSettlementResult> {
  if (pick.status !== 'posted') {
    throw new ApiError(
      409,
      'MANUAL_REVIEW_NOT_ALLOWED',
      `Manual review requires posted state; found ${pick.status}`,
    );
  }

  const settledAt = new Date().toISOString();
  const settlementRecord = await repositories.settlements.record({
    pickId: pick.id,
    status: 'manual_review',
    result: null,
    source: request.source,
    confidence: request.confidence,
    evidenceRef: request.evidenceRef,
    notes: request.notes ?? null,
    reviewReason: request.reviewReason ?? null,
    settledBy: request.settledBy,
    settledAt,
    payload: {
      requestStatus: request.status,
    },
  });

  const downstream = await computeSettlementDownstreamBundle(
    pick,
    repositories.settlements,
  );

  const audit = await repositories.audit.record({
    entityType: 'settlement_records',
    entityId: settlementRecord.id,
    entityRef: pick.id,
    action: 'settlement.manual_review',
    actor: request.settledBy,
    payload: {
      pickId: pick.id,
      settlementRecordId: settlementRecord.id,
      reviewReason: request.reviewReason,
      evidenceRef: request.evidenceRef,
      downstream,
    },
  });

  return {
    pickRecord: pick,
    settlementRecord,
    lifecycleEvent: null,
    auditRecords: [audit],
    finalLifecycleState: pick.status,
    downstream,
  };
}

async function recordInitialSettlement(
  pick: PickRecord,
  request: SettlementRequest,
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
    audit: AuditLogRepository;
  },
): Promise<RecordSettlementResult> {
  const settledAt = new Date().toISOString();
  const settlementRecord = await repositories.settlements.record({
    pickId: pick.id,
    status: 'settled',
    result: request.result ?? null,
    source: request.source,
    confidence: request.confidence,
    evidenceRef: request.evidenceRef,
    notes: request.notes ?? null,
    reviewReason: null,
    settledBy: request.settledBy,
    settledAt,
    payload: {
      requestStatus: request.status,
      correction: false,
    },
  });

  const transitioned = await transitionPickLifecycle(
    repositories.picks,
    pick.id,
    'settled',
    'settlement recorded',
    'settler',
  );
  const updatedPick = await repositories.picks.findPickById(pick.id);
  if (!updatedPick) {
    throw new ApiError(500, 'PICK_NOT_FOUND_AFTER_SETTLEMENT', pick.id);
  }

  const downstream = await computeSettlementDownstreamBundle(
    updatedPick,
    repositories.settlements,
  );

  const audit = await repositories.audit.record({
    entityType: 'settlement_records',
    entityId: settlementRecord.id,
    entityRef: pick.id,
    action: 'settlement.recorded',
    actor: request.settledBy,
    payload: {
      pickId: pick.id,
      settlementRecordId: settlementRecord.id,
      result: request.result,
      source: request.source,
      confidence: request.confidence,
      evidenceRef: request.evidenceRef,
      settledLifecycleEventId: transitioned.lifecycleEvent.id,
      downstream,
    },
  });

  return {
    pickRecord: updatedPick,
    settlementRecord,
    lifecycleEvent: transitioned.lifecycleEvent,
    auditRecords: [audit],
    finalLifecycleState: updatedPick.status,
    downstream,
  };
}

async function recordSettlementCorrection(
  pick: PickRecord,
  request: SettlementRequest,
  repositories: {
    settlements: SettlementRepository;
    audit: AuditLogRepository;
  },
): Promise<RecordSettlementResult> {
  const latest = await repositories.settlements.findLatestForPick(pick.id);
  if (!latest) {
    throw new ApiError(
      409,
      'SETTLEMENT_CORRECTION_NOT_ALLOWED',
      `Pick ${pick.id} is settled but has no prior settlement record`,
    );
  }

  const settledAt = new Date().toISOString();
  const settlementRecord = await repositories.settlements.record({
    pickId: pick.id,
    status: 'settled',
    result: request.result ?? null,
    source: request.source,
    confidence: request.confidence,
    evidenceRef: request.evidenceRef,
    notes: request.notes ?? null,
    reviewReason: null,
    settledBy: request.settledBy,
    settledAt,
    correctsId: latest.id,
    payload: {
      requestStatus: request.status,
      correction: true,
      priorSettlementRecordId: latest.id,
    },
  });

  const downstream = await computeSettlementDownstreamBundle(
    pick,
    repositories.settlements,
  );

  const audit = await repositories.audit.record({
    entityType: 'settlement_records',
    entityId: settlementRecord.id,
    entityRef: pick.id,
    action: 'settlement.corrected',
    actor: request.settledBy,
    payload: {
      pickId: pick.id,
      settlementRecordId: settlementRecord.id,
      correctsId: latest.id,
      result: request.result,
      source: request.source,
      confidence: request.confidence,
      evidenceRef: request.evidenceRef,
      downstream,
    },
  });

  return {
    pickRecord: pick,
    settlementRecord,
    lifecycleEvent: null,
    auditRecords: [audit],
    finalLifecycleState: pick.status,
    downstream,
  };
}

async function computeSettlementDownstreamBundle(
  pick: PickRecord,
  settlements: SettlementRepository,
): Promise<SettlementDownstreamBundle> {
  const records = await settlements.listByPick(pick.id);
  const resolved = resolveEffectiveSettlement(
    records.map(mapSettlementRecordToInput),
  );

  if (!resolved.ok) {
    return {
      effectiveSettlement: null,
      settlementSummary: computeSettlementSummary([]),
      lossAttribution: null,
      lossAttributionSummary: null,
      unresolvedReason: resolved.reason,
    };
  }

  const lossAttribution = computeLossAttributionForPick(pick, resolved.settlement);

  return {
    effectiveSettlement: resolved.settlement,
    settlementSummary: computeSettlementSummary([resolved.settlement]),
    lossAttribution,
    lossAttributionSummary: lossAttribution
      ? summarizeLossAttributions([lossAttribution])
      : null,
    unresolvedReason: null,
  };
}

function mapSettlementRecordToInput(record: SettlementRecord): SettlementInput {
  return {
    id: record.id,
    pick_id: record.pick_id,
    status: record.status as SettlementInput['status'],
    result: record.result,
    confidence: record.confidence,
    corrects_id: record.corrects_id,
    settled_at: record.settled_at,
  };
}

function computeLossAttributionForPick(
  pick: PickRecord,
  settlement: EffectiveSettlement,
): LossAttributionOutput | null {
  if (settlement.status !== 'settled' || settlement.result !== 'loss') {
    return null;
  }

  const input = readLossAttributionInput(pick.metadata);
  return classifyLoss(input);
}

function readLossAttributionInput(metadata: unknown) {
  const record = asRecord(metadata);
  const attribution = asRecord(record?.lossAttribution) ?? record;

  return {
    ev: readNumber(attribution?.ev) ?? 0,
    clv_at_bet:
      readNumber(attribution?.clv_at_bet) ??
      readNumber(attribution?.clvAtBet) ??
      0,
    clv_at_close:
      readNumber(attribution?.clv_at_close) ??
      readNumber(attribution?.clvAtClose) ??
      0,
    has_feature_snapshot:
      readBoolean(attribution?.has_feature_snapshot) ??
      readBoolean(attribution?.hasFeatureSnapshot) ??
      false,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
