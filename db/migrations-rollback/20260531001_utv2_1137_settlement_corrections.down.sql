-- Down migration: UTV2-1137 — INIT-4.2.3 Dual-Authorized Corrections
-- Reverses: 20260531001_utv2_1137_settlement_corrections.sql

DROP TRIGGER IF EXISTS trg_settlement_corrections_validate ON public.settlement_corrections;
DROP FUNCTION IF EXISTS settlement_corrections_validate();
DROP INDEX IF EXISTS settlement_corrections_record_idx;
DROP TABLE IF EXISTS public.settlement_corrections;
