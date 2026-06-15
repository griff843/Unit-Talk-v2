-- Migration: 202604090005
-- Purpose: Sync repo truth with already-applied production optimizations.
--
-- These changes were applied directly to the live DB (not via migration) during
-- the 2026-04-07/08 storage incident response and Phase 2 tuning. This migration
-- captures them so the migration history matches production state.
--
-- All statements are idempotent — safe to apply on a DB that already has them.

-- ─────────────────────────────────────────────────────────────────────────────
-- provider_offers: BRIN index on snapshot_at
-- ─────────────────────────────────────────────────────────────────────────────
-- BRIN is far cheaper (orders of magnitude smaller) than btree on a 2M+ row
-- append-mostly table. Useful for time-range retention scans by pg_cron.
-- Complements the existing btree provider_offers_snapshot_at_idx (used for
-- point-lookups and ordered reads); this BRIN is preferred for range scans
-- covering large portions of the table.

CREATE INDEX IF NOT EXISTS idx_provider_offers_snapshot_brin
  ON public.provider_offers USING brin (snapshot_at)
  WITH (pages_per_range = 128);

-- ─────────────────────────────────────────────────────────────────────────────
-- provider_offers: aggressive autovacuum
-- ─────────────────────────────────────────────────────────────────────────────
-- 2M+ rows, high ingest rate. Low cost_delay keeps autovacuum from falling
-- behind during bulk ingest. Low scale_factor triggers vacuum sooner.

ALTER TABLE public.provider_offers SET (
  autovacuum_vacuum_cost_delay   = 2,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold    = 5000,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold   = 5000
);

-- ─────────────────────────────────────────────────────────────────────────────
-- game_results: tuned autovacuum
-- ─────────────────────────────────────────────────────────────────────────────
-- 270K+ rows, moderate update rate from grading runs.

ALTER TABLE public.game_results SET (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 10
);

-- ─────────────────────────────────────────────────────────────────────────────
-- system_runs: tuned autovacuum
-- ─────────────────────────────────────────────────────────────────────────────
-- 627K+ rows, high insert rate from every scan/materializer cycle.
-- Low threshold ensures vacuum fires early before dead tuple accumulation.

ALTER TABLE public.system_runs SET (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_threshold     = 100,
  autovacuum_vacuum_cost_delay    = 10
);
