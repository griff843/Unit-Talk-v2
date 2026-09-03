CREATE TABLE IF NOT EXISTS public.execution_intents (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_id      UUID        REFERENCES public.execution_intents(id) DEFERRABLE INITIALLY DEFERRED,
  pick_id             UUID        NOT NULL,
  decision_record_id  TEXT        NOT NULL CHECK (length(decision_record_id) > 0),
  intent_type         TEXT        NOT NULL CHECK (intent_type IN ('initial', 're_confirm', 'recovery')),
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'dead_letter', 'recovered')),
  idempotency_key     TEXT        CHECK (idempotency_key IS NULL OR length(idempotency_key) > 0),
  inputs_hash         TEXT        NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  provenance          JSONB       NOT NULL,
  payload             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  issued_at_ms        BIGINT      NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT execution_intents_issued_at_positive CHECK (issued_at_ms > 0)
);

CREATE OR REPLACE FUNCTION public.execution_intents_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'execution_intents is append-only: % prohibited on row %',
    TG_OP, COALESCE(OLD.id::TEXT, '?');
END;
$$;

DROP TRIGGER IF EXISTS execution_intents_no_update ON public.execution_intents;
CREATE TRIGGER execution_intents_no_update
  BEFORE UPDATE ON public.execution_intents
  FOR EACH ROW EXECUTE FUNCTION public.execution_intents_immutable();

DROP TRIGGER IF EXISTS execution_intents_no_delete ON public.execution_intents;
CREATE TRIGGER execution_intents_no_delete
  BEFORE DELETE ON public.execution_intents
  FOR EACH ROW EXECUTE FUNCTION public.execution_intents_immutable();

CREATE INDEX IF NOT EXISTS idx_execution_intents_pick_id
  ON public.execution_intents(pick_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_intents_decision_record_id
  ON public.execution_intents(decision_record_id);

CREATE INDEX IF NOT EXISTS idx_execution_intents_predecessor_id
  ON public.execution_intents(predecessor_id)
  WHERE predecessor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_execution_intents_status
  ON public.execution_intents(status)
  WHERE status IN ('pending', 'dead_letter');

CREATE UNIQUE INDEX IF NOT EXISTS uidx_execution_intents_idempotency_key
  ON public.execution_intents(idempotency_key)
  WHERE idempotency_key IS NOT NULL;;
