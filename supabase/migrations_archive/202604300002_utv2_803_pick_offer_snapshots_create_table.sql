-- UTV2-803 — pick_offer_snapshots create table (ledger repair, UTV2-1274)
--
-- LEDGER REPAIR (UTV2-1274): pick_offer_snapshots was created on the live Supabase DB
-- out-of-band (UTV2-803/868 recovery era) and never committed to supabase/migrations.
-- The committed migration 202604300003_utv2_803_pick_offer_snapshots_posting_kind.sql
-- assumes the table already exists (it deletes legacy rows and swaps the snapshot_kind
-- CHECK), so the repo ledger does not replay from scratch. This migration reconciles the
-- ledger by recreating the table verbatim from the live structure, ordered immediately
-- before 202604300003. It is idempotent (CREATE TABLE IF NOT EXISTS + inline constraints +
-- CREATE INDEX IF NOT EXISTS) so it is a no-op against live and creates the table on a
-- fresh scratch DB. The snapshot_kind CHECK is intentionally owned by 202604300003.
-- FKs require provider_offer_history_compact (202604291004) to already exist.
-- No production mutation; no data backfill.

CREATE TABLE IF NOT EXISTS public.pick_offer_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid()
    CONSTRAINT pick_offer_snapshots_pkey PRIMARY KEY,
  pick_id uuid NOT NULL
    CONSTRAINT pick_offer_snapshots_pick_id_fkey REFERENCES public.picks(id) ON DELETE CASCADE,
  settlement_record_id uuid NULL
    CONSTRAINT pick_offer_snapshots_settlement_record_id_fkey REFERENCES public.settlement_records(id) ON DELETE SET NULL,
  snapshot_kind text NOT NULL,
  provider_key text NOT NULL
    CONSTRAINT pick_offer_snapshots_provider_key_fkey REFERENCES public.sportsbooks(id),
  provider_event_id text NOT NULL,
  provider_market_key text NOT NULL,
  provider_participant_id text NULL,
  bookmaker_key text NULL,
  identity_key text NOT NULL,
  line numeric NULL,
  over_odds integer NULL,
  under_odds integer NULL,
  devig_mode text NOT NULL
    CONSTRAINT pick_offer_snapshots_devig_mode_check
    CHECK (devig_mode = ANY (ARRAY['PAIRED'::text, 'FALLBACK_SINGLE_SIDED'::text])),
  source_snapshot_at timestamptz NULL,
  captured_at timestamptz NOT NULL,
  source_run_id uuid NULL
    CONSTRAINT pick_offer_snapshots_source_run_id_fkey REFERENCES public.system_runs(id) ON DELETE SET NULL,
  source_compact_snapshot_id uuid NULL
    CONSTRAINT pick_offer_snapshots_source_compact_snapshot_id_fkey
    REFERENCES public.provider_offer_history_compact(snapshot_id) ON DELETE SET NULL,
  source_current_identity_key text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS pick_offer_snapshots_event_market_idx
  ON public.pick_offer_snapshots USING btree (provider_event_id, provider_market_key, provider_participant_id, bookmaker_key);
CREATE INDEX IF NOT EXISTS pick_offer_snapshots_pick_captured_idx
  ON public.pick_offer_snapshots USING btree (pick_id, captured_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pick_offer_snapshots_pick_kind_idx
  ON public.pick_offer_snapshots USING btree (pick_id, snapshot_kind);

ALTER TABLE public.pick_offer_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pick_offer_snapshots FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.pick_offer_snapshots TO service_role;
