-- UTV2-1981: restore the previous query access paths without changing pick data.
-- Execute standalone with autocommit enabled, outside a transaction block.
-- Verify index ownership/definition before dropping; the guard may seq-scan again.
DROP INDEX CONCURRENTLY IF EXISTS public.picks_updated_at_idx;
