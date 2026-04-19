-- =============================================================================
-- UTV2-RLS: enable row-level security on canonical public tables
--
-- Runtime services use the Supabase service role through repository interfaces.
-- Enabling RLS without anon/authenticated policies makes direct client access
-- fail closed while preserving service-role runtime access.
-- =============================================================================

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
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
    'stat_types',
    'combo_stat_types',
    'combo_stat_type_components',
    'sportsbooks',
    'provider_entity_aliases',
    'provider_market_aliases',
    'provider_book_aliases',
    'provider_offers',
    'model_registry',
    'model_health_snapshots',
    'experiment_ledger',
    'cappers',
    'events',
    'event_participants',
    'game_results',
    'alert_detections',
    'hedge_opportunities',
    'member_tiers'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);

      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute format('revoke all on table public.%I from anon', table_name);
      end if;

      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute format('revoke all on table public.%I from authenticated', table_name);
      end if;
    end if;
  end loop;
end $$;
