-- UTV2-803
-- Purpose: align pick_offer_snapshots lifecycle proof with submission/approval/posting/settlement truth
-- Guardrails:
--   - do not touch provider_offer_current
--   - do not touch provider_offer_history_compact
--   - do not drop provider_offers
--
-- RECOVERY NOTE (UTV2-868): This file was applied to the live Supabase DB on or around 2026-04-30
-- via out-of-band path (dashboard or CLI) without being committed to the repo.
-- The SQL below is recovered verbatim from supabase_migrations.schema_migrations.statements.
-- The migration is already applied live — this file reconciles the repo ledger only.

delete from public.pick_offer_snapshots
where snapshot_kind = 'queue';

alter table public.pick_offer_snapshots
  drop constraint if exists pick_offer_snapshots_snapshot_kind_check;

alter table public.pick_offer_snapshots
  add constraint pick_offer_snapshots_snapshot_kind_check
  check (
    snapshot_kind in (
      'submission',
      'approval',
      'posting',
      'closing_for_clv',
      'settlement_proof'
    )
  );
