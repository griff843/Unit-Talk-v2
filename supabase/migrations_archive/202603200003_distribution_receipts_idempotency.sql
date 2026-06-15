-- =============================================================================
-- Distribution Receipts Idempotency
-- Migration: 202603200003_distribution_receipts_idempotency
-- Track: Supabase / Schema
--
-- Purpose
-- -------
-- Adds an idempotency_key to distribution_receipts to support the distribution
-- contract requirement: "Discord-facing operations must be idempotent."
--
-- The distribution_outbox already uses an idempotency_key for enqueue
-- deduplication. This migration establishes the same pattern for receipt
-- recording so that:
--   - A delivery attempt that records a receipt more than once produces only
--     one receipt row (caller supplies the same key both times).
--   - Downstream reconciliation can join on idempotency_key to detect and
--     skip duplicate receipt inserts at the application layer.
--
-- The key is optional (nullable) to preserve backwards compatibility with
-- receipt rows that predate this migration or do not require deduplication.
--
-- Rollback notes
-- --------------
-- DROP INDEX IF EXISTS distribution_receipts_idempotency_key_idx;
-- ALTER TABLE public.distribution_receipts DROP COLUMN IF EXISTS idempotency_key;
-- =============================================================================

alter table public.distribution_receipts
  add column if not exists idempotency_key text;

create unique index if not exists distribution_receipts_idempotency_key_idx
  on public.distribution_receipts(idempotency_key)
  where idempotency_key is not null;
