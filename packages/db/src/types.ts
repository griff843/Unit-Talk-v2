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
  alertDetectionMarketTypes,
  alertDetectionTiers,
  approvalStatuses,
  eventParticipantRoles,
  eventStatuses,
  hedgeOpportunityPriorities,
  hedgeOpportunityTypes,
  marketTypes,
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
export type AlertDetectionTier = (typeof alertDetectionTiers)[number];
export type AlertDetectionMarketType = (typeof alertDetectionMarketTypes)[number];
export type HedgeOpportunityType = (typeof hedgeOpportunityTypes)[number];
export type HedgeOpportunityPriority = (typeof hedgeOpportunityPriorities)[number];
export type SettlementStatus = (typeof settlementStatuses)[number];
export type SettlementResult = (typeof settlementResults)[number];
export type SettlementSource = (typeof settlementSources)[number];
export type SettlementConfidence = (typeof settlementConfidences)[number];
export type SystemRunStatus = (typeof systemRunStatuses)[number];
export type ParticipantType = (typeof participantTypes)[number];
export type EventStatus = (typeof eventStatuses)[number];
export type EventParticipantRole = (typeof eventParticipantRoles)[number];
export type MarketTypeId = (typeof marketTypes)[number];

export type SubmissionRow = Tables<'submissions'>;
export type SubmissionEventRow = Tables<'submission_events'>;
export type PickRow = Tables<'picks'>;
export type PickLifecycleRow = Tables<'pick_lifecycle'>;
export type PickPromotionHistoryRow = Tables<'pick_promotion_history'>;
export type DistributionOutboxRow = Tables<'distribution_outbox'>;
export type DistributionReceiptRow = Tables<'distribution_receipts'>;
export type AlertDetectionRow = Tables<'alert_detections'>;
export type HedgeOpportunityRow = Tables<'hedge_opportunities'>;
export type SettlementRecordRow = Tables<'settlement_records'>;
export type SystemRunRow = Tables<'system_runs'>;
export type AuditLogRow = Tables<'audit_log'>;
export type ParticipantRow = Tables<'participants'>;
export type ParticipantMembershipRow = Tables<'participant_memberships'>;
export type GradeResultRow = Tables<'game_results'>;

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

/** @see {@link AlertDetectionRow} */
export type AlertDetectionRecord = AlertDetectionRow;

/** @see {@link HedgeOpportunityRow} */
export type HedgeOpportunityRecord = HedgeOpportunityRow;

/** @see {@link ProviderOfferRow} */
export type ProviderOfferRecord = ProviderOfferRow;

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

/** @see {@link GradeResultRow} */
export type GradeResultRecord = GradeResultRow;

// ---------------------------------------------------------------------------
// Reference data types (not generated — tables added in migration 008)
// ---------------------------------------------------------------------------

export interface SportRow {
  id: string;
  display_name: string;
  sort_order: number;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Generated type widens devig_mode to string (Supabase does not narrow CHECK constraints).
// We re-narrow here because the CHECK constraint and application code both enforce the union.
export type ProviderOfferRow = Omit<Tables<'provider_offers'>, 'devig_mode'> & {
  devig_mode: 'PAIRED' | 'FALLBACK_SINGLE_SIDED';
};

export interface SportMarketTypeRow {
  id: string;
  sport_id: string;
  market_type: MarketTypeId;
  sort_order: number;
  created_at: string;
}

export interface StatTypeRow {
  id: string;
  sport_id: string;
  name: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface SportsbookRow {
  id: string;
  display_name: string;
  sort_order: number;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CapperRow {
  id: string;
  display_name: string;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  sport_id: string;
  event_name: string;
  event_date: string;
  status: EventStatus;
  external_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EventParticipantRow {
  id: string;
  event_id: string;
  participant_id: string;
  role: EventParticipantRole;
  created_at: string;
}

// member_tiers is defined here as a manual interface because the migration
// (202603200017_member_tiers.sql) may not yet be reflected in database.types.ts.
// After applying the migration and running `pnpm supabase:types`, this can be
// replaced with `Tables<'member_tiers'>`.
export interface MemberTierRow {
  id: string;
  discord_id: string;
  discord_username: string | null;
  tier: string;
  effective_from: string;
  effective_until: string | null;
  source: string;
  changed_by: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** @see {@link MemberTierRow} */
export type MemberTierRecord = MemberTierRow;

