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
  experimentRunTypes,
  experimentStatuses,
  eventParticipantRoles,
  eventStatuses,
  hedgeOpportunityPriorities,
  hedgeOpportunityTypes,
  marketTypes,
  modelStatuses,
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
export type ModelStatus = (typeof modelStatuses)[number];
export type ExperimentRunType = (typeof experimentRunTypes)[number];
export type ExperimentStatus = (typeof experimentStatuses)[number];

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
export type LeagueRow = Tables<'leagues'>;
export type TeamRow = Tables<'teams'>;
export type PlayerRow = Tables<'players'>;
export type PlayerTeamAssignmentRow = Tables<'player_team_assignments'>;
export type GradeResultRow = Tables<'game_results'>;
export type MemberTierRow = Tables<'member_tiers'>;
export type ModelRegistryRow = Tables<'model_registry'>;
export type ExperimentLedgerRow = Tables<'experiment_ledger'>;

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

/** @see {@link LeagueRow} */
export type LeagueRecord = LeagueRow;

/** @see {@link TeamRow} */
export type TeamRecord = TeamRow;

/** @see {@link PlayerRow} */
export type PlayerRecord = PlayerRow;

/** @see {@link PlayerTeamAssignmentRow} */
export type PlayerTeamAssignmentRecord = PlayerTeamAssignmentRow;

/** @see {@link GradeResultRow} */
export type GradeResultRecord = GradeResultRow;

/** @see {@link MemberTierRow} */
export type MemberTierRecord = MemberTierRow;

/** @see {@link ModelRegistryRow} */
export type ModelRegistryRecord = ModelRegistryRow;

/** @see {@link ExperimentLedgerRow} */
export type ExperimentLedgerRecord = ExperimentLedgerRow;

// ---------------------------------------------------------------------------
// Pick review types (not generated — table added in migration 018)
// ---------------------------------------------------------------------------

// Decision values are deliberately different from approval_status values.
// approve/deny/hold/return are human decisions; pending/approved/rejected
// are system gate states. pick_reviews drives approval_status, not vice versa.
export type PickReviewDecision = 'approve' | 'deny' | 'hold' | 'return';

export interface PickReviewRecord {
  id: string;
  pick_id: string;
  decision: PickReviewDecision;
  reason: string;
  decided_by: string;
  decided_at: string;
  created_at: string;
}

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
  canonical_key: string;
  display_name: string;
  short_label: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface SelectionTypeRow {
  id: string;
  display_name: string;
  sort_order: number;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MarketFamilyRow {
  id: string;
  display_name: string;
  sort_order: number;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MarketCatalogTypeRow {
  id: string;
  market_family_id: string;
  selection_type_id: string;
  display_name: string;
  short_label: string;
  requires_line: boolean;
  requires_participant: boolean;
  active: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SportMarketTypeAvailabilityRow {
  sport_id: string;
  market_type_id: string;
  active: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ComboStatTypeRow {
  id: string;
  sport_id: string;
  market_type_id: string;
  display_name: string;
  short_label: string;
  active: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ComboStatTypeComponentRow {
  combo_stat_type_id: string;
  stat_type_id: string;
  weight: number;
  created_at: string;
}

export interface ProviderEntityAliasRow {
  id: string;
  provider: string;
  entity_kind: 'team' | 'player' | 'participant';
  provider_entity_key: string;
  provider_entity_id: string | null;
  provider_display_name: string;
  participant_id: string | null;
  team_id: string | null;
  player_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProviderMarketAliasRow {
  id: string;
  provider: string;
  provider_market_key: string;
  provider_display_name: string;
  market_type_id: string;
  sport_id: string | null;
  stat_type_id: string | null;
  combo_stat_type_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProviderBookAliasRow {
  id: string;
  provider: string;
  provider_book_key: string;
  provider_display_name: string;
  sportsbook_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

