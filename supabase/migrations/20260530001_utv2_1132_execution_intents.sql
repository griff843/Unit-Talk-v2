-- UTV2-1132 — INIT-4.1.1 ExecutionIntent Entity
--
-- Creates the canonical execution_intents table.
-- Program 4 root. All rows are append-only and immutable.
-- ExecutionIntent binds execution attempts to immutable, replay-visible
-- decision provenance before execution runtime hardening proceeds.
--
-- Constitutional guarantees:
--   1. All rows are append-only and immutable (UPDATE/DELETE prohibited by trigger).
--   2. Provenance is replay-visible via stored inputs_hash + provenance JSONB.
--   3. Reconstruction is deterministic from persisted evidence.
--   4. No wall-clock nondeterminism — issued_at_ms is caller-supplied epoch ms.
--   5. Downstream compatibility: idempotency_key supports UTV2-1133 re-confirm.
--   6. predecessor_id chain supports UTV2-1134 dead-letter recovery traversal.
--   7. No capital, treasury, or scaling surface introduced.
--   8. Program 1 certification topology is untouched.

-- ---------------------------------------------------------------------------
-- execution_intents
--
-- One row per execution intent event. predecessor_id chains the history.
-- This is the source of truth for execution intent provenance.
-- Current intent state = most recent row for a given pick_id chain.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.execution_intents (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Chain linkage: null = root intent, non-null = follow-on record
  predecessor_id      UUID        REFERENCES public.execution_intents(id) DEFERRABLE INITIALLY DEFERRED,
  -- Logical reference to the pick being executed (no FK — cross-package boundary)
  pick_id             UUID        NOT NULL,
  -- Logical reference to DecisionRecord.record_id (no FK — domain-layer only type)
  decision_record_id  TEXT        NOT NULL CHECK (length(decision_record_id) > 0),
  -- Intent classification
  intent_type         TEXT        NOT NULL CHECK (intent_type IN ('initial', 're_confirm', 'recovery')),
  -- Lifecycle status
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'dead_letter', 'recovered')),
  -- Idempotency key: unique when set, enables UTV2-1133 re-confirm without duplicate rows
  idempotency_key     TEXT        CHECK (idempotency_key IS NULL OR length(idempotency_key) > 0),
  -- SHA-256 of the serialized inputs that produced this intent (for replay)
  inputs_hash         TEXT        NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  -- Provenance: {authority, policy_version, executor_version}
  provenance          JSONB       NOT NULL,
  -- Arbitrary payload for downstream consumers
  payload             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Deterministic epoch ms from caller — no wall-clock nondeterminism
  issued_at_ms        BIGINT      NOT NULL,
  -- Append timestamp (UTC). No updated_at — this table is append-only.
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT execution_intents_provenance_not_empty CHECK (provenance != '{}'::jsonb OR intent_type = 'initial'),
  CONSTRAINT execution_intents_issued_at_positive CHECK (issued_at_ms > 0)
);

COMMENT ON TABLE public.execution_intents IS
  'Append-only ledger of execution intent events per pick. '
  'Current intent state = most recent row per pick_id. Never mutate. '
  'Program 4 root entity (INIT-4.1.1). Binds execution attempts to '
  'immutable decision provenance.';

COMMENT ON COLUMN public.execution_intents.decision_record_id IS
  'Logical reference to DecisionRecord.record_id. No FK — DecisionRecord '
  'is a domain-layer type with no DB table. Provenance enforced at domain layer.';

COMMENT ON COLUMN public.execution_intents.idempotency_key IS
  'When set, enforces idempotent re-confirm via unique partial index. '
  'Enables UTV2-1133 re-confirm receipt behavior without duplicate rows.';

COMMENT ON COLUMN public.execution_intents.inputs_hash IS
  'SHA-256 hex of the serialized inputs that produced this intent. '
  'Enables deterministic replay reconstruction.';

COMMENT ON COLUMN public.execution_intents.issued_at_ms IS
  'Deterministic epoch milliseconds from the caller. Never use now() for '
  'intent time — that would introduce wall-clock nondeterminism.';

-- ---------------------------------------------------------------------------
-- Immutability enforcement
-- Same trigger pattern as certification_records and audit_log.
-- UPDATE and DELETE are both prohibited. This table is append-only.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Primary lookup: all intents for a pick (ordered for chain reconstruction)
CREATE INDEX IF NOT EXISTS idx_execution_intents_pick_id
  ON public.execution_intents(pick_id, created_at DESC);

-- Decision provenance traversal: all intents anchored to a DecisionRecord
CREATE INDEX IF NOT EXISTS idx_execution_intents_decision_record_id
  ON public.execution_intents(decision_record_id);

-- Chain traversal: find children of a predecessor
CREATE INDEX IF NOT EXISTS idx_execution_intents_predecessor_id
  ON public.execution_intents(predecessor_id)
  WHERE predecessor_id IS NOT NULL;

-- Status filter: active intents for recovery/settlement work
CREATE INDEX IF NOT EXISTS idx_execution_intents_status
  ON public.execution_intents(status)
  WHERE status IN ('pending', 'dead_letter');

-- Idempotency enforcement (UTV2-1133): unique key when set
CREATE UNIQUE INDEX IF NOT EXISTS uidx_execution_intents_idempotency_key
  ON public.execution_intents(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
