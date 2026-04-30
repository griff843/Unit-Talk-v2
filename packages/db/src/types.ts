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
  alertLevels,
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
  providerCycleFreshnessStatuses,
  providerIngestionFailureCategories,
  providerIngestionFailureScopes,
  providerCycleProofStatuses,
  providerCycleStageStatuses,
  providerOfferStageStatuses,
  systemRunStatuses,
  writerRoles,
} from './schema.js';

import type { Tables } from './database.types.js';
import type { MarketUniverseRow as MarketUniverseRowStub } from './market-universe-repository.js';

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
export type ProviderOfferStageStatus = (typeof providerOfferStageStatuses)[number];
export type ProviderCycleStageStatus = (typeof providerCycleStageStatuses)[number];
export type ProviderCycleFreshnessStatus = (typeof providerCycleFreshnessStatuses)[number];
export type ProviderCycleProofStatus = (typeof providerCycleProofStatuses)[number];
export type ProviderIngestionFailureCategory = (typeof providerIngestionFailureCategories)[number];
export type ProviderIngestionFailureScope = (typeof providerIngestionFailureScopes)[number];
export type ParticipantType = (typeof participantTypes)[number];
export type EventStatus = (typeof eventStatuses)[number];
export type EventParticipantRole = (typeof eventParticipantRoles)[number];
export type MarketTypeId = (typeof marketTypes)[number];
export type ModelStatus = (typeof modelStatuses)[number];
export type ExperimentRunType = (typeof experimentRunTypes)[number];
export type ExperimentStatus = (typeof experimentStatuses)[number];
export type AlertLevel = (typeof alertLevels)[number];

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
export type ModelHealthSnapshotRow = Tables<'model_health_snapshots'>;

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

export interface ProviderOfferHistoryCompactRow {
  snapshot_id: string;
  identity_key: string;
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  sport_key: string | null;
  bookmaker_key: string | null;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  devig_mode: 'PAIRED' | 'FALLBACK_SINGLE_SIDED';
  is_opening: boolean;
  is_closing: boolean;
  snapshot_at: string;
  observed_at: string;
  source_run_id: string | null;
  change_reason:
    | 'first_seen'
    | 'line_change'
    | 'odds_change'
    | 'opening_capture'
    | 'closing_capture'
    | 'proof_capture'
    | 'replay_capture';
  previous_snapshot_id: string | null;
  changed_fields: Record<string, unknown>;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

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

/** @see {@link ModelHealthSnapshotRow} */
export type ModelHealthSnapshotRecord = ModelHealthSnapshotRow;

// ---------------------------------------------------------------------------
// market_universe types (stubbed — database.types.ts not yet regenerated)
// TODO: regenerate via pnpm supabase:types once Supabase connectivity restores
// ---------------------------------------------------------------------------

/** Row shape for market_universe table (Phase 2 UTV2-459 migration). */
export type MarketUniverseRow = MarketUniverseRowStub;

/** Backward-compatible record alias. */
export type MarketUniverseRecord = MarketUniverseRow;

// ---------------------------------------------------------------------------
// pick_candidates types (stubbed — Phase 2 UTV2-460 migration)
// TODO: regenerate via pnpm supabase:types once Supabase connectivity restores
// ---------------------------------------------------------------------------

/** Filter details jsonb structure — canonical shape from contract §5.5 */
export interface PickCandidateFilterDetails {
  missing_canonical_identity: boolean;
  stale_price_data: boolean;
  unsupported_market_family: boolean;
  missing_participant_linkage: boolean;
  invalid_odds_structure: boolean;
  duplicate_suppressed: boolean;
  freshness_window_failed: boolean;
}

/** Row shape for pick_candidates table (Phase 2 UTV2-460 migration). */
export interface PickCandidateRow {
  id: string;                          // uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
  universe_id: string;                 // uuid NOT NULL FK → market_universe
  status: string;                      // text NOT NULL DEFAULT 'pending'
  rejection_reason: string | null;     // text NULL — first failing filter key
  filter_details: PickCandidateFilterDetails | null; // jsonb NULL — §5.5 canonical shape
  model_score: number | null;          // numeric NULL — Phase 3 placeholder, must remain NULL in Phase 2
  model_tier: string | null;           // text NULL — Phase 3 placeholder, must remain NULL in Phase 2
  model_confidence: number | null;     // numeric NULL — Phase 3 placeholder, must remain NULL in Phase 2
  selection_rank: number | null;       // integer NULL — Phase 4: rank within the qualified pool (1 = highest). NULL = not yet ranked.
  is_board_candidate: boolean;         // boolean NOT NULL DEFAULT false — Phase 4: true if in the pre-scarcity board pool for current cycle.
  shadow_mode: boolean;                // boolean NOT NULL DEFAULT true — must remain true in Phase 2
  pick_id: string | null;              // uuid NULL FK → picks — must remain NULL in Phase 2
  scan_run_id: string | null;          // text NULL — provenance: ID of scan cycle that last wrote this row
  provenance: Record<string, unknown> | null; // jsonb NULL — scan version, filter set version, timestamp
  expires_at: string | null;           // timestamptz NULL — set from event starts_at if known
  created_at: string;                  // timestamptz NOT NULL DEFAULT now()
  updated_at: string;                  // timestamptz NOT NULL DEFAULT now()
}

/** Backward-compatible record alias. */
export type PickCandidateRecord = PickCandidateRow;

export type ExecutionQualityReport = {
  providerKey: string;
  sportKey: string | null;
  marketFamily: string;
  sampleSize: number;
  avgEntryLine: number | null;
  avgClosingLine: number | null;
  avgLineDelta: number | null;
  winRate: number | null;
  roi: number | null;
};

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
  source_run_id?: string | null;
};

export interface ProviderOfferStagingRow {
  id: string;
  run_id: string;
  provider_key: string;
  league: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  sport_key: string | null;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  devig_mode: 'PAIRED' | 'FALLBACK_SINGLE_SIDED';
  is_opening: boolean;
  is_closing: boolean;
  snapshot_at: string;
  idempotency_key: string;
  bookmaker_key: string | null;
  identity_key: string;
  merge_status: ProviderOfferStageStatus;
  merge_error: string | null;
  merged_at: string | null;
  created_at: string;
}

export interface ProviderCycleStatusRow {
  run_id: string;
  provider_key: string;
  league: string;
  cycle_snapshot_at: string;
  stage_status: ProviderCycleStageStatus;
  freshness_status: ProviderCycleFreshnessStatus;
  proof_status: ProviderCycleProofStatus;
  staged_count: number;
  merged_count: number;
  duplicate_count: number;
  failure_category: ProviderIngestionFailureCategory | null;
  failure_scope: ProviderIngestionFailureScope | null;
  affected_provider_key: string | null;
  affected_sport_key: string | null;
  affected_market_key: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ProviderHealthState = 'healthy' | 'degraded' | 'fail';

export interface ProviderOfferCurrentRow extends ProviderOfferRecord {
  cycle_run_id: string | null;
  cycle_stage_status: ProviderCycleStageStatus | null;
  cycle_freshness_status: ProviderCycleFreshnessStatus | null;
  cycle_proof_status: ProviderCycleProofStatus | null;
  cycle_failure_category: ProviderIngestionFailureCategory | null;
  cycle_failure_scope: ProviderIngestionFailureScope | null;
  cycle_affected_provider_key: string | null;
  cycle_affected_sport_key: string | null;
  cycle_affected_market_key: string | null;
  cycle_updated_at: string | null;
  provider_health_state: ProviderHealthState;
}

export type PickOfferSnapshotKind =
  | 'submission'
  | 'approval'
  | 'posting'
  | 'closing_for_clv'
  | 'settlement_proof';

export interface PickOfferSnapshotRow {
  id: string;
  pick_id: string;
  settlement_record_id: string | null;
  snapshot_kind: PickOfferSnapshotKind;
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  bookmaker_key: string | null;
  identity_key: string;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  devig_mode: 'PAIRED' | 'FALLBACK_SINGLE_SIDED';
  source_snapshot_at: string | null;
  captured_at: string;
  source_run_id: string | null;
  source_compact_snapshot_id: string | null;
  source_current_identity_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

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

