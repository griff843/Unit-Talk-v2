-- UTV2-772 / UTV2-781 — provider_offer_history_compact create table (ledger repair, UTV2-1274)
--
-- LEDGER REPAIR (UTV2-1274): provider_offer_history_compact was created on the live
-- Supabase DB out-of-band (during the UTV2-772/781 history-compaction work) and was
-- never committed to supabase/migrations, so the repo ledger does not replay from
-- scratch. This migration reconciles the ledger: it recreates the table verbatim from
-- the live structure. It is idempotent (CREATE TABLE IF NOT EXISTS + inline constraints +
-- CREATE INDEX IF NOT EXISTS) so it is a no-op against the live DB (table already exists)
-- and creates the table on a fresh scratch DB. No production mutation; no data backfill.
-- Ordered before 202604300003 (and before pick_offer_snapshots, which FKs this table).

CREATE TABLE IF NOT EXISTS public.provider_offer_history_compact (
  snapshot_id uuid NOT NULL DEFAULT gen_random_uuid()
    CONSTRAINT provider_offer_history_compact_pkey PRIMARY KEY,
  identity_key text NOT NULL,
  provider_key text NOT NULL
    CONSTRAINT provider_offer_history_compact_provider_key_fkey REFERENCES public.sportsbooks(id),
  provider_event_id text NOT NULL,
  provider_market_key text NOT NULL,
  provider_participant_id text NULL,
  sport_key text NULL,
  bookmaker_key text NULL,
  line numeric NULL,
  over_odds integer NULL,
  under_odds integer NULL,
  devig_mode text NOT NULL
    CONSTRAINT provider_offer_history_compact_devig_mode_check
    CHECK (devig_mode = ANY (ARRAY['PAIRED'::text, 'FALLBACK_SINGLE_SIDED'::text])),
  is_opening boolean NOT NULL DEFAULT false,
  is_closing boolean NOT NULL DEFAULT false,
  snapshot_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  source_run_id uuid NULL
    CONSTRAINT provider_offer_history_compact_source_run_id_fkey REFERENCES public.system_runs(id) ON DELETE SET NULL,
  change_reason text NOT NULL
    CONSTRAINT provider_offer_history_compact_change_reason_check
    CHECK (change_reason = ANY (ARRAY['first_seen'::text, 'line_change'::text, 'odds_change'::text, 'opening_capture'::text, 'closing_capture'::text, 'proof_capture'::text, 'replay_capture'::text])),
  previous_snapshot_id uuid NULL
    CONSTRAINT provider_offer_history_compact_previous_snapshot_id_fkey
    REFERENCES public.provider_offer_history_compact(snapshot_id) ON DELETE SET NULL,
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_offer_history_compact_snapshot_idempotency_idx
  ON public.provider_offer_history_compact USING btree (snapshot_at, idempotency_key);
CREATE INDEX IF NOT EXISTS provider_offer_history_compact_event_market_snapshot_idx
  ON public.provider_offer_history_compact USING btree (provider_event_id, provider_market_key, provider_participant_id, bookmaker_key, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS provider_offer_history_compact_identity_snapshot_idx
  ON public.provider_offer_history_compact USING btree (identity_key, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS provider_offer_history_compact_opening_idx
  ON public.provider_offer_history_compact USING btree (provider_key, snapshot_at DESC) WHERE (is_opening = true);
CREATE INDEX IF NOT EXISTS provider_offer_history_compact_closing_idx
  ON public.provider_offer_history_compact USING btree (provider_key, snapshot_at DESC) WHERE (is_closing = true);

ALTER TABLE public.provider_offer_history_compact ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_offer_history_compact FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.provider_offer_history_compact TO service_role;
