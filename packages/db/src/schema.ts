export const submissionStatuses = [
  'received',
  'validated',
  'rejected',
  'materialized',
] as const;

export const pickStatuses = [
  'draft',
  'validated',
  'queued',
  'posted',
  'settled',
  'voided',
] as const;

export const writerRoles = [
  'submitter',
  'promoter',
  'poster',
  'settler',
  'operator_override',
] as const;

export const outboxStatuses = [
  'pending',
  'processing',
  'sent',
  'failed',
  'dead_letter',
] as const;

export const alertDetectionTiers = ['watch', 'notable', 'alert-worthy'] as const;

export const alertDetectionMarketTypes = [
  'spread',
  'total',
  'moneyline',
  'player_prop',
] as const;

export const hedgeOpportunityTypes = ['arbitrage', 'middle', 'hedge'] as const;

export const hedgeOpportunityPriorities = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

export const settlementResults = [
  'win',
  'loss',
  'push',
  'void',
  'cancelled',
] as const;

export const settlementStatuses = ['settled', 'manual_review'] as const;

export const settlementSources = ['operator', 'api', 'feed', 'grading'] as const;

export const settlementConfidences = ['confirmed', 'estimated', 'pending'] as const;

export const systemRunStatuses = [
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const approvalStatuses = [
  'pending',
  'approved',
  'rejected',
  'voided',
  'expired',
] as const;

export const promotionStatuses = [
  'not_eligible',
  'eligible',
  'qualified',
  'promoted',
  'suppressed',
  'expired',
] as const;

export const promotionTargets = [
  'best-bets',
  'trader-insights',
  'exclusive-insights',
] as const;

export const promotionOverrideActions = [
  'force_promote',
  'suppress',
  'suppress_from_best_bets',
] as const;

export const participantTypes = ['player', 'team', 'league', 'event'] as const;

export const eventStatuses = [
  'scheduled',
  'in_progress',
  'completed',
  'postponed',
  'cancelled',
] as const;

export const eventParticipantRoles = ['home', 'away', 'competitor'] as const;

export const marketTypes = [
  'player-prop',
  'moneyline',
  'spread',
  'total',
  'team-total',
] as const;

export const modelStatuses = ['champion', 'challenger', 'staged', 'archived'] as const;

export const experimentRunTypes = ['training', 'eval', 'backtest', 'calibration'] as const;

export const experimentStatuses = ['running', 'completed', 'failed', 'cancelled'] as const;

export const alertLevels = ['none', 'warning', 'critical'] as const;

export interface TableDefinition {
  name: string;
  purpose: string;
  owner: 'api' | 'worker' | 'operator-web' | 'smart-form' | 'discord-bot' | 'platform' | 'ingestor';
}

export const canonicalSchema: TableDefinition[] = [
  {
    name: 'submissions',
    purpose: 'Captures inbound V2 intake requests before canonical pick creation.',
    owner: 'api',
  },
  {
    name: 'submission_events',
    purpose: 'Records auditable submission-level events.',
    owner: 'api',
  },
  {
    name: 'picks',
    purpose: 'Stores canonical picks after validation and materialization.',
    owner: 'api',
  },
  {
    name: 'pick_lifecycle',
    purpose: 'Stores lifecycle transitions and authority-bearing actions.',
    owner: 'api',
  },
  {
    name: 'pick_promotion_history',
    purpose: 'Stores additive promotion decisions, overrides, and board-target history.',
    owner: 'api',
  },
  {
    name: 'distribution_outbox',
    purpose: 'Queues downstream distribution work away from synchronous request handling.',
    owner: 'worker',
  },
  {
    name: 'distribution_receipts',
    purpose: 'Captures delivery receipts from downstream channels.',
    owner: 'discord-bot',
  },
  {
    name: 'settlement_records',
    purpose: 'Stores authoritative grading outcomes for picks.',
    owner: 'api',
  },
  {
    name: 'system_runs',
    purpose: 'Tracks long-running jobs and operational runs.',
    owner: 'worker',
  },
  {
    name: 'audit_log',
    purpose: 'Stores durable audit events for sensitive actions.',
    owner: 'platform',
  },
  {
    name: 'alert_detections',
    purpose: 'Stores classified AlertAgent line movement detections and notification state.',
    owner: 'api',
  },
  {
    name: 'hedge_opportunities',
    purpose: 'Stores classified hedge, middle, and arbitrage opportunities.',
    owner: 'api',
  },
  {
    name: 'participants',
    purpose: 'Stores canonical participant identities across sports entities.',
    owner: 'api',
  },
  {
    name: 'participant_memberships',
    purpose: 'Stores historical participant-to-parent relationships.',
    owner: 'api',
  },
  {
    name: 'leagues',
    purpose: 'Canonical league definitions layered above the legacy sport-scoped taxonomy.',
    owner: 'platform',
  },
  {
    name: 'teams',
    purpose: 'First-class canonical team records linked to leagues.',
    owner: 'platform',
  },
  {
    name: 'players',
    purpose: 'First-class canonical player identities decoupled from provider labels.',
    owner: 'platform',
  },
  {
    name: 'player_team_assignments',
    purpose: 'Effective-dated player-to-team roster history.',
    owner: 'api',
  },
  {
    name: 'sports',
    purpose: 'Canonical sport definitions with ordering and activation state.',
    owner: 'platform',
  },
  {
    name: 'selection_types',
    purpose: 'Sport-agnostic wager side semantics such as over/under and home/away.',
    owner: 'platform',
  },
  {
    name: 'market_families',
    purpose: 'Top-level canonical grouping for market taxonomy.',
    owner: 'platform',
  },
  {
    name: 'market_types',
    purpose: 'Canonical market definitions resolved across providers and consumers.',
    owner: 'platform',
  },
  {
    name: 'sport_market_type_availability',
    purpose: 'Declares which canonical market types are active for each sport.',
    owner: 'platform',
  },
  {
    name: 'sport_market_types',
    purpose: 'Maps which market types are available per sport.',
    owner: 'platform',
  },
  {
    name: 'stat_types',
    purpose: 'Stat types available per sport for player-prop markets.',
    owner: 'platform',
  },
  {
    name: 'combo_stat_types',
    purpose: 'Canonical combo stat definitions such as PRA and Points + Assists.',
    owner: 'platform',
  },
  {
    name: 'combo_stat_type_components',
    purpose: 'Defines the component stat makeup for each combo stat type.',
    owner: 'platform',
  },
  {
    name: 'sportsbooks',
    purpose: 'Canonical sportsbook definitions.',
    owner: 'platform',
  },
  {
    name: 'provider_entity_aliases',
    purpose: 'Maps provider-specific team and player identities into canonical entities.',
    owner: 'ingestor',
  },
  {
    name: 'provider_market_aliases',
    purpose: 'Maps provider-specific market keys into canonical market taxonomy.',
    owner: 'ingestor',
  },
  {
    name: 'provider_book_aliases',
    purpose: 'Maps provider-specific book identifiers into canonical sportsbook ids.',
    owner: 'ingestor',
  },
  {
    name: 'provider_offers',
    purpose: 'Stores normalized external provider odds snapshots for market intelligence.',
    owner: 'ingestor',
  },
  {
    name: 'cappers',
    purpose: 'Registered cappers authorized to submit picks.',
    owner: 'platform',
  },
  {
    name: 'events',
    purpose: 'Sporting events with date, status, and sport linkage.',
    owner: 'api',
  },
  {
    name: 'event_participants',
    purpose: 'Links participants to events with role designation.',
    owner: 'api',
  },
  {
    name: 'game_results',
    purpose: 'Stores final stat values used by the automated grading lane.',
    owner: 'api',
  },
];
