export const canonicalTables = [
  'submissions',
  'submission_events',
  'picks',
  'pick_lifecycle',
  'pick_promotion_history',
  'distribution_outbox',
  'distribution_receipts',
  'settlement_records',
  'system_runs',
  'audit_log',
  'participants',
  'participant_memberships',
  'leagues',
  'teams',
  'players',
  'player_team_assignments',
  'sports',
  'selection_types',
  'market_families',
  'market_types',
  'sport_market_type_availability',
  'sport_market_types',
  'stat_types',
  'combo_stat_types',
  'combo_stat_type_components',
  'sportsbooks',
  'provider_entity_aliases',
  'provider_market_aliases',
  'provider_book_aliases',
  'provider_offers',
  'cappers',
  'events',
  'event_participants',
  'game_results',
  'alert_detections',
  'hedge_opportunities',
  'member_tiers',
] as const;

export type CanonicalTable = (typeof canonicalTables)[number];

export * from './client.js';
export * from './database.types.js';
export * from './lifecycle.js';
export * from './repositories.js';
export * from './runtime-repositories.js';
export * from './schema.js';
export * from './types.js';
export * from './writer-authority.js';
