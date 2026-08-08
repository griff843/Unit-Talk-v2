-- Rollback for 20260803230000_utv2_1540_command_center_ledger_repair.sql
--
-- ⚠ READ THIS BEFORE RUNNING ON PRODUCTION ⚠
--
-- The forward migration is a LEDGER REPAIR, not a table creation. On production these two
-- tables already existed (with real data: 16 rows in command_center_delivery_mappings, 1 row
-- in command_center_game_threads as of 2026-08-03) and the forward migration is registered
-- as already-applied rather than executed. Running this rollback against production would
-- therefore DROP TABLES THE FORWARD MIGRATION NEVER CREATED and DESTROY LIVE DATA.
--
-- Correct rollback on PRODUCTION is ledger-only — deregister the version, touch no schema:
--
--     supabase migration repair --status reverted 20260803230000
--
-- The DROP statements below are the correct rollback for a SCRATCH / PARITY database, where
-- the forward migration genuinely did create these tables from nothing. That is the only
-- context in which they may be run.
--
-- Reverse dependency order: command_center_delivery_mappings carries an FK to
-- command_center_game_threads, so it is dropped first.

DROP TABLE IF EXISTS public.command_center_delivery_mappings;
DROP TABLE IF EXISTS public.command_center_game_threads;

-- Triggers and indexes are owned by the tables and are dropped with them; set_updated_at()
-- is a baseline function shared with many other tables and is deliberately left in place.
