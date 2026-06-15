-- UTV2-437: Add created_at index to audit_log for efficient retention pruning
--
-- audit_log has no index on created_at. Any retention DELETE performs a full
-- sequential scan — at scale this causes timeouts and table locks.
--
-- CONCURRENTLY means this builds without locking the table for reads/writes.
-- Safe to apply on a live DB.

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log (created_at DESC);
