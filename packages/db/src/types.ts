// =============================================================================
// types.ts
//
// Application-friendly type aliases derived from database.types.ts.
//
// Rules:
// - Status/enum union types are derived from schema.ts (single source of truth
//   for valid values that are also checked in SQL).
// - Row types are derived from database.types.ts (mirrors the SQL schema).
// - The `*Record` aliases below exist for backward compatibility with existing
//   application code. New code should prefer the `*Row` types from database.types.ts.
// =============================================================================

import {
  approvalStatuses,
  outboxStatuses,
  participantTypes,
  pickStatuses,
  settlementConfidences,
  settlementSources,
  settlementStatuses,
  promotionOverrideActions,
  promotionStatuses,
  promotionTargets,
  settlementResults,
  submissionStatuses,
  systemRunStatuses,
  writerRoles,
} from './schema.js';

import type { Tables } from './database.types.js';

// ---------------------------------------------------------------------------
// Enum / status union types
// Derived from schema.ts so that TypeScript and SQL share the same value sets.
// ---------------------------------------------------------------------------

export type SubmissionStatus = (typeof submissionStatuses)[number];
export type PickStatus = (typeof pickStatuses)[number];
export type ApprovalStatus = (typeof approvalStatuses)[number];
export type PromotionStatus = (typeof promotionStatuses)[number];
export type PromotionTarget = (typeof promotionTargets)[number];
export type PromotionOverrideAction = (typeof promotionOverrideActions)[number];
export type WriterRole = (typeof writerRoles)[number];
export type OutboxStatus = (typeof outboxStatuses)[number];
export type SettlementStatus = (typeof settlementStatuses)[number];
export type SettlementResult = (typeof settlementResults)[number];
export type SettlementSource = (typeof settlementSources)[number];
export type SettlementConfidence = (typeof settlementConfidences)[number];
export type SystemRunStatus = (typeof systemRunStatuses)[number];
export type ParticipantType = (typeof participantTypes)[number];

export type SubmissionRow = Tables<'submissions'>;
export type SubmissionEventRow = Tables<'submission_events'>;
export type PickRow = Tables<'picks'>;
export type PickLifecycleRow = Tables<'pick_lifecycle'>;
export type PickPromotionHistoryRow = Tables<'pick_promotion_history'>;
export type DistributionOutboxRow = Tables<'distribution_outbox'>;
export type DistributionReceiptRow = Tables<'distribution_receipts'>;
export type SettlementRecordRow = Tables<'settlement_records'>;
export type SystemRunRow = Tables<'system_runs'>;
export type AuditLogRow = Tables<'audit_log'>;
export type ParticipantRow = Tables<'participants'>;
export type ParticipantMembershipRow = Tables<'participant_memberships'>;

// ---------------------------------------------------------------------------
// Record aliases (backward-compatible names used by existing application code)
// ---------------------------------------------------------------------------

/** @see {@link SubmissionRow} */
export type SubmissionRecord = SubmissionRow;

/** @see {@link SubmissionEventRow} */
export type SubmissionEventRecord = SubmissionEventRow;

/** @see {@link PickRow} */
export type PickRecord = PickRow;

/** @see {@link PickLifecycleRow} */
export type PickLifecycleRecord = PickLifecycleRow;

/** @see {@link PickPromotionHistoryRow} */
export type PromotionHistoryRecord = PickPromotionHistoryRow;

/** @see {@link DistributionOutboxRow} */
export type OutboxRecord = DistributionOutboxRow;

/** @see {@link DistributionReceiptRow} */
export type ReceiptRecord = DistributionReceiptRow;

/** @see {@link SettlementRecordRow} */
export type SettlementRecord = SettlementRecordRow;

/** @see {@link SystemRunRow} */
export type SystemRunRecord = SystemRunRow;

/** @see {@link AuditLogRow} */
export type AuditLogRecord = AuditLogRow;

/** @see {@link ParticipantRow} */
export type ParticipantRecord = ParticipantRow;

/** @see {@link ParticipantMembershipRow} */
export type ParticipantMembershipRecord = ParticipantMembershipRow;
