-- Rollback for UTV2-1244: remove the provider_event_id + snapshot_at index
-- This reverses supabase/migrations/20260609001_utv2_1244_provider_offer_history_event_snapshot_index.sql
--
-- Production note: use DROP INDEX CONCURRENTLY to avoid an AccessExclusiveLock
-- on the 713K-row table during rollback. The CONCURRENTLY form cannot run inside
-- a transaction — run it as a standalone statement via the Supabase CLI, not the
-- REST migration API.
--
-- Schema round-trip drill (scratch Postgres): uses the non-CONCURRENTLY form below
-- because the drill runs each statement inside a psql invocation outside a transaction.

DROP INDEX IF EXISTS idx_provider_offer_history_event_snapshot;
