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
  'sports',
  'sport_market_types',
  'stat_types',
  'sportsbooks',
  'provider_offers',
  'cappers',
  'events',
  'event_participants',
  'game_results',
  'alert_detections',
  'hedge_opportunities',
] as const;

export type CanonicalTable = (typeof canonicalTables)[number];

export * from './client.js';
export * from './database.types.js';
export * from './lifecycle.js';
export * from './repositories.js';
export * from './runtime-repositories.js';
export * from './schema.js';
export * from './types.js';
