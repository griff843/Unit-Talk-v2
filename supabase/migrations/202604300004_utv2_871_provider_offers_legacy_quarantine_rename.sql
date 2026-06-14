-- UTV2-871 — rename provider_offers -> provider_offers_legacy_quarantine (ledger repair, UTV2-1274)
--
-- LEDGER REPAIR (UTV2-1274): on the live Supabase DB the legacy provider_offers table was
-- renamed out-of-band to provider_offers_legacy_quarantine (post UTV2-781/803 cutover; the
-- cutover migration 202604291003 explicitly left provider_offers in place). The rename was
-- never committed, so 202605090003_utv2_871_provider_offers_quarantine_prune_fix.sql (which
-- targets provider_offers_legacy_quarantine) cannot replay from scratch. This migration
-- records that out-of-band rename, ordered immediately before the 871 prune-fix.
--
-- Guarded + idempotent: renames only when provider_offers still exists AND the quarantine
-- table does not — a no-op against live (already renamed) and against a fresh scratch DB on
-- re-run. The rename preserves the original constraint/index names (provider_offers_pkey,
-- provider_offers_devig_mode_check, etc.), matching live. No production mutation; no backfill.
--
-- NOTE: any residual index/column drift between the repo-built provider_offers and the live
-- provider_offers_legacy_quarantine is reconciled in follow-up slices guided by the parity
-- compare; this slice unblocks the apply phase.

DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'provider_offers'
      )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'provider_offers_legacy_quarantine'
      )
  THEN
    ALTER TABLE public.provider_offers RENAME TO provider_offers_legacy_quarantine;
  END IF;
END
$$;
