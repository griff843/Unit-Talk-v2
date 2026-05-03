-- Unit Talk V2 — Least-Privilege Postgres Role Model
-- UTV2-789 | Reproducible SQL — apply to the Hetzner self-hosted Postgres
--
-- This file defines group roles (NOLOGIN) and their grants.
-- Login roles with passwords are provisioned separately by provision-roles.sh.
-- Apply with: psql $DATABASE_URL -f scripts/postgres/roles.sql
--
-- Idempotent: safe to re-apply after schema changes.

BEGIN;

-- ─── Group roles (no login) ───────────────────────────────────────────────────

DO $$ BEGIN
  CREATE ROLE app_user NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE ingestion_writer NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE scanner_user NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE metrics_user NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE migration_owner NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Schema access ────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO app_user, ingestion_writer, scanner_user, metrics_user;
GRANT ALL ON SCHEMA public TO migration_owner;

-- ─── app_user — runtime API server, worker, alert-agent ──────────────────────
-- Owns the pick pipeline, outbox, receipts, settlements, and audit trail.

GRANT SELECT, INSERT, UPDATE ON TABLE
  picks,
  pick_reviews,
  pick_lifecycle,
  distribution_outbox,
  distribution_receipts,
  submission_events,
  settlement_records,
  alert_detections,
  hedge_opportunities,
  syndicate_board,
  audit_log,
  system_runs,
  member_tiers
TO app_user;

-- Read reference data required by the app pipeline
GRANT SELECT ON TABLE
  cappers,
  events,
  event_participants,
  players,
  teams,
  leagues,
  sports,
  sportsbooks,
  market_types,
  market_families,
  market_family_trust,
  stat_types,
  selection_types,
  combo_stat_types,
  combo_stat_type_components,
  sport_market_types,
  sport_market_type_availability,
  provider_book_aliases,
  provider_entity_aliases,
  provider_market_aliases,
  market_universe,
  pick_candidates,
  provider_offers,
  provider_offer_current
TO app_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ─── ingestion_writer — ingestor service ─────────────────────────────────────
-- Writes provider data, reference data, and game data.
-- Does not touch picks, outbox, or receipts.

GRANT SELECT, INSERT, UPDATE ON TABLE
  provider_offers,
  provider_offer_staging,
  provider_offer_history,
  provider_offer_current,
  provider_cycle_status,
  events,
  event_participants,
  player_team_assignments,
  players,
  teams,
  leagues,
  sports,
  sportsbooks,
  cappers,
  market_types,
  market_families,
  market_family_trust,
  stat_types,
  selection_types,
  combo_stat_types,
  combo_stat_type_components,
  sport_market_types,
  sport_market_type_availability,
  provider_book_aliases,
  provider_entity_aliases,
  provider_market_aliases,
  system_runs
TO ingestion_writer;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ingestion_writer;

-- ─── scanner_user — pick scanner and scoring services ────────────────────────
-- Reads ingestion data. Writes pick candidates only.
-- Cannot touch picks, outbox, distribution, or settlements directly.

GRANT SELECT ON TABLE
  provider_offers,
  provider_offer_current,
  market_universe,
  events,
  event_participants,
  players,
  teams,
  leagues,
  sports,
  market_types,
  market_families,
  stat_types,
  selection_types,
  picks
TO scanner_user;

GRANT SELECT, INSERT, UPDATE ON TABLE
  pick_candidates
TO scanner_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scanner_user;

-- ─── metrics_user — read-only observability access ───────────────────────────
-- Used by dashboards, monitoring scripts, and command-center queries.
-- No write access to any table.

GRANT SELECT ON TABLE
  system_runs,
  distribution_receipts,
  distribution_outbox,
  picks,
  provider_offers,
  pick_candidates,
  alert_detections,
  settlement_records,
  audit_log,
  member_tiers
TO metrics_user;

-- ─── migration_owner — DDL and schema management only ────────────────────────
-- Not used by any runtime service. Applied only during maintenance windows.

GRANT ALL ON ALL TABLES IN SCHEMA public TO migration_owner;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO migration_owner;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO migration_owner;

-- ─── Default privileges for future tables ────────────────────────────────────
-- Ensures new tables created by migration_owner are accessible to the runtime roles.

ALTER DEFAULT PRIVILEGES FOR ROLE migration_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE migration_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO ingestion_writer;

ALTER DEFAULT PRIVILEGES FOR ROLE migration_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO scanner_user, metrics_user;

ALTER DEFAULT PRIVILEGES FOR ROLE migration_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user, ingestion_writer, scanner_user;

COMMIT;
