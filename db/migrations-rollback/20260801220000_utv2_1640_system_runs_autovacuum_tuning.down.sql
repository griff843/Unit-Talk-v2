-- Rollback for UTV2-1640 Phase A: system_runs autovacuum/autoanalyze tuning
-- This reverses supabase/migrations/20260801220000_utv2_1640_system_runs_autovacuum_tuning.sql
--
-- IRREVERSIBLE: not because the change itself can't be undone functionally --
-- the SET statement below restores the exact pre-existing values
-- (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05,
-- both baked into 00000000000000_baseline_live_schema.sql's original
-- CREATE TABLE) -- but because Postgres's ALTER TABLE ... SET does not update
-- an existing reloption key in place: it removes the named keys from
-- pg_class.reloptions and re-appends them at the end of the array, changing
-- their position permanently. Verified empirically (temp-table reproduction,
-- 2026-08-01, against a throwaway session-local object, no production
-- mutation): a table created with WITH (a, b, c, d) in that literal order,
-- then ALTER ... SET (a, b), then ALTER ... SET (a, b) again with different
-- values, ends up with reloptions ordered [c, d, a, b] -- never [a, b, c, d]
-- again. Since the schema round-trip drill compares a pg_dump-rendered DDL
-- hash (which renders reloptions in their pg_class array order), no down
-- script built from ALTER TABLE SET/RESET can ever reproduce a byte-identical
-- pre-up hash once a reloption key that predates this migration is touched.
-- This is a mechanical limitation of hash-based schema verification against
-- ALTER-based reloption changes, not evidence the change is functionally
-- unsafe or unreversed. Constitutional rollback procedure: PITR.
-- Refer to docs/05_operations/DB_ROLLBACK_RUNBOOK.md.
--
-- The statement below IS the correct, tested functional reversal (restores
-- the true pre-existing values, not the cluster default -- RESET would have
-- overshot past the pre-existing override to 0.2/0.1, which system_runs was
-- never actually in). It was verified against production via pg_class.reloptions
-- readback during Phase A; only the byte-identical-DDL bar is unreachable.

ALTER TABLE public.system_runs SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);
