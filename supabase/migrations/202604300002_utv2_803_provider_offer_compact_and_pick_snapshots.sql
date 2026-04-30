-- UTV2-803
-- Purpose: create compact provider-offer history plus immutable pick-linked
-- proof snapshots, and dual-write compact deltas from staged provider merges.
-- Guardrails:
--   - do not retire legacy provider_offers in this slice
--   - do not rewrite provider identity semantics
--   - compact history stores meaningful changes only

CREATE TABLE IF NOT EXISTS public.provider_offer_history_compact (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key text NOT NULL,
  provider_key text NOT NULL REFERENCES public.sportsbooks(id),
  provider_event_id text NOT NULL,
  provider_market_key text NOT NULL,
  provider_participant_id text NULL,
  sport_key text NULL,
  bookmaker_key text NULL,
  line numeric NULL,
  over_odds integer NULL,
  under_odds integer NULL,
  devig_mode text NOT NULL CHECK (devig_mode IN ('PAIRED', 'FALLBACK_SINGLE_SIDED')),
  is_opening boolean NOT NULL DEFAULT false,
  is_closing boolean NOT NULL DEFAULT false,
  snapshot_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  source_run_id uuid NULL REFERENCES public.system_runs(id) ON DELETE SET NULL,
  change_reason text NOT NULL CHECK (
    change_reason IN (
      'first_seen',
      'line_change',
      'odds_change',
      'opening_capture',
      'closing_capture',
      'proof_capture',
      'replay_capture'
    )
  ),
  previous_snapshot_id uuid NULL REFERENCES public.provider_offer_history_compact(snapshot_id) ON DELETE SET NULL,
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.provider_offer_history_compact ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_offer_history_compact FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS provider_offer_history_compact_snapshot_idempotency_idx
  ON public.provider_offer_history_compact (snapshot_at, idempotency_key);

CREATE INDEX IF NOT EXISTS provider_offer_history_compact_identity_snapshot_idx
  ON public.provider_offer_history_compact (identity_key, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS provider_offer_history_compact_event_market_snapshot_idx
  ON public.provider_offer_history_compact (
    provider_event_id,
    provider_market_key,
    provider_participant_id,
    bookmaker_key,
    snapshot_at DESC
  );

CREATE INDEX IF NOT EXISTS provider_offer_history_compact_opening_idx
  ON public.provider_offer_history_compact (provider_key, snapshot_at DESC)
  WHERE is_opening = true;

CREATE INDEX IF NOT EXISTS provider_offer_history_compact_closing_idx
  ON public.provider_offer_history_compact (provider_key, snapshot_at DESC)
  WHERE is_closing = true;

CREATE TABLE IF NOT EXISTS public.pick_offer_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id uuid NOT NULL REFERENCES public.picks(id) ON DELETE CASCADE,
  settlement_record_id uuid NULL REFERENCES public.settlement_records(id) ON DELETE SET NULL,
  snapshot_kind text NOT NULL CHECK (
    snapshot_kind IN ('submission', 'approval', 'queue', 'closing_for_clv', 'settlement_proof')
  ),
  provider_key text NOT NULL REFERENCES public.sportsbooks(id),
  provider_event_id text NOT NULL,
  provider_market_key text NOT NULL,
  provider_participant_id text NULL,
  bookmaker_key text NULL,
  identity_key text NOT NULL,
  line numeric NULL,
  over_odds integer NULL,
  under_odds integer NULL,
  devig_mode text NOT NULL CHECK (devig_mode IN ('PAIRED', 'FALLBACK_SINGLE_SIDED')),
  source_snapshot_at timestamptz NULL,
  captured_at timestamptz NOT NULL,
  source_run_id uuid NULL REFERENCES public.system_runs(id) ON DELETE SET NULL,
  source_compact_snapshot_id uuid NULL REFERENCES public.provider_offer_history_compact(snapshot_id) ON DELETE SET NULL,
  source_current_identity_key text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.pick_offer_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pick_offer_snapshots FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS pick_offer_snapshots_pick_kind_idx
  ON public.pick_offer_snapshots (pick_id, snapshot_kind);

CREATE INDEX IF NOT EXISTS pick_offer_snapshots_pick_captured_idx
  ON public.pick_offer_snapshots (pick_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS pick_offer_snapshots_event_market_idx
  ON public.pick_offer_snapshots (
    provider_event_id,
    provider_market_key,
    provider_participant_id,
    bookmaker_key
  );

CREATE OR REPLACE FUNCTION public.merge_provider_offer_staging_cycle(
  p_run_id uuid,
  p_max_rows integer,
  p_identity_strategy text
)
RETURNS TABLE (
  processed_count integer,
  merged_count integer,
  duplicate_count integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_max_rows IS NULL OR p_max_rows <= 0 THEN
    RAISE EXCEPTION 'p_max_rows must be > 0';
  END IF;

  IF p_identity_strategy <> 'provider_event_market_participant_book' THEN
    RAISE EXCEPTION
      'unsupported provider-offer identity strategy: % (line/sport/taxonomy semantics remain explicit decisions)',
      p_identity_strategy;
  END IF;

  PERFORM public.ensure_provider_offer_history_partitions(
    (
      SELECT min(snapshot_at)::date
      FROM public.provider_offer_staging
      WHERE run_id = p_run_id
        AND merge_status = 'pending'
    ),
    (
      SELECT max(snapshot_at)::date
      FROM public.provider_offer_staging
      WHERE run_id = p_run_id
        AND merge_status = 'pending'
    )
  );

  RETURN QUERY
  WITH candidates AS (
    SELECT *
    FROM public.provider_offer_staging
    WHERE run_id = p_run_id
      AND merge_status = 'pending'
    ORDER BY created_at ASC, id ASC
    LIMIT p_max_rows
  ),
  current_before AS (
    SELECT current_offer.*
    FROM public.provider_offer_current current_offer
    JOIN (
      SELECT DISTINCT identity_key
      FROM candidates
    ) candidate_keys
      ON candidate_keys.identity_key = current_offer.identity_key
  ),
  previous_compact AS (
    SELECT DISTINCT ON (identity_key)
      snapshot_id,
      identity_key
    FROM public.provider_offer_history_compact
    WHERE identity_key IN (SELECT identity_key FROM candidates)
    ORDER BY identity_key, snapshot_at DESC, observed_at DESC, created_at DESC
  ),
  inserted_history AS (
    INSERT INTO public.provider_offer_history (
      id,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      idempotency_key,
      bookmaker_key,
      source_run_id,
      created_at
    )
    SELECT
      id,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      idempotency_key,
      bookmaker_key,
      run_id,
      created_at
    FROM candidates
    ON CONFLICT (snapshot_at, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  ),
  compact_candidates AS (
    SELECT
      candidates.identity_key,
      candidates.provider_key,
      candidates.provider_event_id,
      candidates.provider_market_key,
      candidates.provider_participant_id,
      candidates.sport_key,
      candidates.bookmaker_key,
      candidates.line,
      candidates.over_odds,
      candidates.under_odds,
      candidates.devig_mode,
      candidates.is_opening,
      candidates.is_closing,
      candidates.snapshot_at,
      candidates.run_id AS source_run_id,
      candidates.idempotency_key,
      candidates.created_at,
      previous_compact.snapshot_id AS previous_snapshot_id,
      CASE
        WHEN current_before.identity_key IS NULL THEN 'first_seen'
        WHEN candidates.line IS DISTINCT FROM current_before.line THEN 'line_change'
        WHEN candidates.over_odds IS DISTINCT FROM current_before.over_odds
          OR candidates.under_odds IS DISTINCT FROM current_before.under_odds THEN 'odds_change'
        WHEN candidates.is_opening = true AND COALESCE(current_before.is_opening, false) = false THEN 'opening_capture'
        WHEN candidates.is_closing = true AND COALESCE(current_before.is_closing, false) = false THEN 'closing_capture'
        ELSE NULL
      END AS change_reason,
      jsonb_strip_nulls(
        jsonb_build_object(
          'line', CASE
            WHEN current_before.identity_key IS NULL OR candidates.line IS DISTINCT FROM current_before.line
            THEN jsonb_build_object('previous', current_before.line, 'next', candidates.line)
            ELSE NULL
          END,
          'over_odds', CASE
            WHEN current_before.identity_key IS NULL OR candidates.over_odds IS DISTINCT FROM current_before.over_odds
            THEN jsonb_build_object('previous', current_before.over_odds, 'next', candidates.over_odds)
            ELSE NULL
          END,
          'under_odds', CASE
            WHEN current_before.identity_key IS NULL OR candidates.under_odds IS DISTINCT FROM current_before.under_odds
            THEN jsonb_build_object('previous', current_before.under_odds, 'next', candidates.under_odds)
            ELSE NULL
          END,
          'is_opening', CASE
            WHEN current_before.identity_key IS NULL OR candidates.is_opening IS DISTINCT FROM current_before.is_opening
            THEN jsonb_build_object('previous', current_before.is_opening, 'next', candidates.is_opening)
            ELSE NULL
          END,
          'is_closing', CASE
            WHEN current_before.identity_key IS NULL OR candidates.is_closing IS DISTINCT FROM current_before.is_closing
            THEN jsonb_build_object('previous', current_before.is_closing, 'next', candidates.is_closing)
            ELSE NULL
          END
        )
      ) AS changed_fields
    FROM candidates
    LEFT JOIN current_before
      ON current_before.identity_key = candidates.identity_key
    LEFT JOIN previous_compact
      ON previous_compact.identity_key = candidates.identity_key
  ),
  inserted_compact AS (
    INSERT INTO public.provider_offer_history_compact (
      identity_key,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      bookmaker_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      observed_at,
      source_run_id,
      change_reason,
      previous_snapshot_id,
      changed_fields,
      idempotency_key,
      metadata,
      created_at
    )
    SELECT
      identity_key,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      bookmaker_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      created_at,
      source_run_id,
      change_reason,
      previous_snapshot_id,
      changed_fields,
      idempotency_key,
      '{}'::jsonb,
      created_at
    FROM compact_candidates
    WHERE change_reason IS NOT NULL
    ON CONFLICT (snapshot_at, idempotency_key) DO NOTHING
    RETURNING snapshot_id
  ),
  current_upsert AS (
    INSERT INTO public.provider_offer_current (
      identity_key,
      id,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      idempotency_key,
      bookmaker_key,
      source_run_id,
      created_at,
      updated_at
    )
    SELECT DISTINCT ON (
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''),
      COALESCE(bookmaker_key, '')
    )
      identity_key,
      id,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      idempotency_key,
      bookmaker_key,
      run_id,
      created_at,
      timezone('utc', now())
    FROM candidates
    ORDER BY
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''),
      COALESCE(bookmaker_key, ''),
      snapshot_at DESC,
      created_at DESC,
      id DESC
    ON CONFLICT (identity_key) DO UPDATE
    SET
      id = EXCLUDED.id,
      provider_key = EXCLUDED.provider_key,
      provider_event_id = EXCLUDED.provider_event_id,
      provider_market_key = EXCLUDED.provider_market_key,
      provider_participant_id = EXCLUDED.provider_participant_id,
      sport_key = EXCLUDED.sport_key,
      line = EXCLUDED.line,
      over_odds = EXCLUDED.over_odds,
      under_odds = EXCLUDED.under_odds,
      devig_mode = EXCLUDED.devig_mode,
      is_opening = EXCLUDED.is_opening,
      is_closing = EXCLUDED.is_closing,
      snapshot_at = EXCLUDED.snapshot_at,
      idempotency_key = EXCLUDED.idempotency_key,
      bookmaker_key = EXCLUDED.bookmaker_key,
      source_run_id = EXCLUDED.source_run_id,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at
    WHERE (
      EXCLUDED.snapshot_at,
      EXCLUDED.created_at,
      EXCLUDED.id
    ) >= (
      public.provider_offer_current.snapshot_at,
      public.provider_offer_current.created_at,
      public.provider_offer_current.id
    )
    RETURNING identity_key
  ),
  updated AS (
    UPDATE public.provider_offer_staging staged
    SET
      merge_status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM inserted_history
          WHERE inserted_history.idempotency_key = staged.idempotency_key
        ) THEN 'merged'
        ELSE 'duplicate'
      END,
      merged_at = timezone('utc', now()),
      merge_error = NULL
    FROM candidates
    WHERE staged.id = candidates.id
    RETURNING staged.merge_status
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE merge_status = 'merged')::integer,
    count(*) FILTER (WHERE merge_status = 'duplicate')::integer
  FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_provider_offer_staging_cycle(uuid, integer, text) FROM anon, authenticated;
