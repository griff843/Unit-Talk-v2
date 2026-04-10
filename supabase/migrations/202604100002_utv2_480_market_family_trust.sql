-- UTV2-480 P6-02: Market-family trust table — tuning output storage
CREATE TABLE public.market_family_trust (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tuning_run_id    uuid        NOT NULL,
  market_type_id   text        NOT NULL,
  sport_key        text        NULL,
  sample_size      integer     NOT NULL,
  win_count        integer     NOT NULL,
  loss_count       integer     NOT NULL,
  push_count       integer     NOT NULL,
  win_rate         numeric     NULL,  -- null when sample_size < MIN_SAMPLE
  roi              numeric     NULL,  -- null when sample_size < MIN_SAMPLE
  avg_model_score  numeric     NULL,
  confidence_band  text        NULL,  -- 'low'|'medium'|'high' derived from sample_size
  computed_at      timestamptz NOT NULL DEFAULT now(),
  metadata         jsonb       NOT NULL DEFAULT '{}'
);

CREATE INDEX ON public.market_family_trust (tuning_run_id);
CREATE INDEX ON public.market_family_trust (market_type_id, computed_at DESC);
GRANT SELECT, INSERT ON public.market_family_trust TO service_role;
COMMENT ON TABLE public.market_family_trust IS
  'UTV2-480: Per-run tuning output. One row per market_type_id per tuning run. Read-only after insert.';
