-- UTV2-803
-- Purpose: align pick_offer_snapshots lifecycle proof with submission/approval/posting/settlement truth
-- Guardrails:
--   - do not touch provider_offer_current
--   - do not touch provider_offer_history_compact
--   - do not drop provider_offers

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
