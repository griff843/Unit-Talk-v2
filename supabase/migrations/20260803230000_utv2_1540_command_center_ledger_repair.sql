-- UTV2-1540: Live Schema Parity ledger repair for the two Command Center tables.
--
-- `public.command_center_game_threads` and `public.command_center_delivery_mappings`
-- exist on live Supabase (zfzdnfwdarxucxtaojxm) with real production data but have no
-- migration file, no entry in Supabase's migration history, and no generated-types entry.
-- They were created directly against the live database, out of band.
--
-- This migration captures the exact live DDL so the repo can be replayed from scratch to
-- reach live truth, closing the deny-by-default Live Schema Parity gate (UTV2-1274) for
-- these two relations. Same defect class as UTV2-1447 (G-24), different tables.
--
-- The DDL below was read out of pg_attribute / pg_constraint / pg_indexes / pg_trigger /
-- pg_class / pg_policies on 2026-08-03, read-only. Nothing here mutates production: the
-- tables already exist, so on production this migration is registered as already-applied
-- via `supabase migration repair --status applied 20260803230000` rather than executed.
-- Every statement is still written IF NOT EXISTS so a scratch-DB replay reaches the same
-- schema and a re-run is a no-op.
--
-- Ordering note: command_center_game_threads is created first because
-- command_center_delivery_mappings carries an FK to it.

-- ─────────────────────────────────────────────────────────────────────────────
-- command_center_game_threads — Discord forum-thread-per-game tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.command_center_game_threads (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  guild_id           text        NOT NULL,
  forum_channel_id   text        NOT NULL,
  thread_id          text        NOT NULL,
  internal_game_id   text        NOT NULL,
  sport              text        NOT NULL,
  league             text,
  event_id           uuid,
  provider_event_id  text,
  starts_at          timestamptz,
  thread_title       text        NOT NULL,
  status             text        NOT NULL DEFAULT 'active'::text,
  idempotency_key    text        NOT NULL,
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by         text,
  updated_by         text,
  created_at         timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at         timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  away_team          text,
  home_team          text,
  thread_url         text,
  source             text,
  last_synced_at     timestamptz,
  CONSTRAINT command_center_game_threads_pkey PRIMARY KEY (id),
  CONSTRAINT command_center_game_threads_game_unique UNIQUE (guild_id, internal_game_id),
  CONSTRAINT command_center_game_threads_thread_unique UNIQUE (guild_id, thread_id),
  CONSTRAINT command_center_game_threads_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT command_center_game_threads_status_check CHECK (
    status = ANY (ARRAY[
      'pre_game'::text, 'live'::text, 'final'::text, 'archived'::text,
      'canceled'::text, 'cancelled'::text, 'postponed'::text, 'active'::text
    ])
  ),
  CONSTRAINT command_center_game_threads_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS command_center_game_threads_guild_idx
  ON public.command_center_game_threads USING btree (guild_id);
CREATE INDEX IF NOT EXISTS command_center_game_threads_event_idx
  ON public.command_center_game_threads USING btree (event_id);
CREATE INDEX IF NOT EXISTS command_center_game_threads_status_idx
  ON public.command_center_game_threads USING btree (status);
CREATE INDEX IF NOT EXISTS command_center_game_threads_provider_event_idx
  ON public.command_center_game_threads USING btree (guild_id, provider_event_id)
  WHERE (provider_event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS command_center_game_threads_starts_at_idx
  ON public.command_center_game_threads USING btree (guild_id, starts_at)
  WHERE (starts_at IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- command_center_delivery_mappings — guild/channel/thread delivery-receipt mapping
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.command_center_delivery_mappings (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  guild_id            text        NOT NULL,
  pick_id             uuid,
  outbox_id           uuid,
  receipt_id          uuid,
  game_thread_id      uuid,
  internal_game_id    text,
  provider_event_id   text,
  surface             text        NOT NULL,
  target              text        NOT NULL,
  channel_id          text        NOT NULL,
  thread_id           text,
  discord_message_id  text,
  delivery_status     text        NOT NULL DEFAULT 'sent'::text,
  idempotency_key     text        NOT NULL,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by          text,
  updated_by          text,
  created_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT command_center_delivery_mappings_pkey PRIMARY KEY (id),
  CONSTRAINT command_center_delivery_mappings_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT command_center_delivery_mappings_status_check CHECK (
    delivery_status = ANY (ARRAY[
      'pending'::text, 'sent'::text, 'failed'::text,
      'suppressed'::text, 'already_posted'::text
    ])
  ),
  CONSTRAINT command_center_delivery_mappings_surface_check CHECK (
    surface = ANY (ARRAY[
      'official-card'::text, 'official-card-alerts'::text, 'game-thread'::text,
      'verified-record'::text, 'alert'::text, 'premium-alert'::text,
      'staff-log'::text, 'ledger'::text
    ])
  ),
  CONSTRAINT command_center_delivery_mappings_pick_id_fkey
    FOREIGN KEY (pick_id) REFERENCES public.picks(id) ON DELETE SET NULL,
  CONSTRAINT command_center_delivery_mappings_outbox_id_fkey
    FOREIGN KEY (outbox_id) REFERENCES public.distribution_outbox(id) ON DELETE SET NULL,
  CONSTRAINT command_center_delivery_mappings_receipt_id_fkey
    FOREIGN KEY (receipt_id) REFERENCES public.distribution_receipts(id) ON DELETE SET NULL,
  CONSTRAINT command_center_delivery_mappings_game_thread_id_fkey
    FOREIGN KEY (game_thread_id) REFERENCES public.command_center_game_threads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS command_center_delivery_mappings_guild_idx
  ON public.command_center_delivery_mappings USING btree (guild_id);
CREATE INDEX IF NOT EXISTS command_center_delivery_mappings_pick_idx
  ON public.command_center_delivery_mappings USING btree (pick_id);
CREATE INDEX IF NOT EXISTS command_center_delivery_mappings_outbox_idx
  ON public.command_center_delivery_mappings USING btree (outbox_id);
CREATE INDEX IF NOT EXISTS command_center_delivery_mappings_receipt_idx
  ON public.command_center_delivery_mappings USING btree (receipt_id);
CREATE INDEX IF NOT EXISTS command_center_delivery_mappings_provider_event_idx
  ON public.command_center_delivery_mappings USING btree (guild_id, provider_event_id)
  WHERE (provider_event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS command_center_delivery_mappings_thread_idx
  ON public.command_center_delivery_mappings USING btree (guild_id, thread_id)
  WHERE (thread_id IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers — both live tables carry one; set_updated_at() is baseline.
-- CREATE TRIGGER has no IF NOT EXISTS before PG 14, and this repo targets a version
-- where it is still absent, so guard on pg_trigger explicitly.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'command_center_game_threads_set_updated_at'
      AND tgrelid = 'public.command_center_game_threads'::regclass
  ) THEN
    CREATE TRIGGER command_center_game_threads_set_updated_at
      BEFORE UPDATE ON public.command_center_game_threads
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'command_center_delivery_mappings_set_updated_at'
      AND tgrelid = 'public.command_center_delivery_mappings'::regclass
  ) THEN
    CREATE TRIGGER command_center_delivery_mappings_set_updated_at
      BEFORE UPDATE ON public.command_center_delivery_mappings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
--
-- Live has relrowsecurity = true on BOTH tables and ZERO policies in pg_policies.
-- That combination is deliberate, not an oversight: with RLS enabled and no policy,
-- every non-superuser role without BYPASSRLS is denied, so only service_role reaches
-- these tables. Replaying without ENABLE ROW LEVEL SECURITY would produce a scratch
-- schema that is strictly more permissive than production and would still report drift.
-- No policy is created here, because creating one would diverge from live.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.command_center_game_threads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.command_center_delivery_mappings  ENABLE ROW LEVEL SECURITY;
