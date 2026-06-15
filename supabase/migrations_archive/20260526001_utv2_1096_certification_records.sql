-- UTV2-1096 — Certification Entity and Lifecycle States
-- Creates the constitutional DB layer for Program 1 certification tracking.
-- All records are append-only. State transitions produce new rows.
-- UPDATE and DELETE are prohibited by trigger — same pattern as audit_log.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.certification_domain AS ENUM (
    'replay',
    'invariant',
    'divergence',
    'quarantine',
    'proof_lineage',
    'freshness',
    'cert_evidence'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.certification_status AS ENUM (
    'pending',
    'active',
    'suspended',
    'revoked',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.revocation_trigger AS ENUM (
    'replay_nondeterminism',
    'invariant_gap',
    'proof_corruption',
    'divergence_leakage',
    'quarantine_bypass',
    'stale_replay_acceptance',
    'evidence_invalidation',
    'dependency_revoked',
    'manual_governance'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- certification_records
--
-- One row per state transition. predecessor_id chains the history.
-- This is the source of truth for current certification state.
-- Current state = most recent row per (program_id, domain).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.certification_records (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id         TEXT        NOT NULL CHECK (program_id IN ('P1','P2','P3','P4','P5')),
  domain             public.certification_domain NOT NULL,
  status             public.certification_status NOT NULL,
  -- SHA256 of the proof bundle that supports this certification state
  evidence_sha       TEXT        NOT NULL CHECK (length(evidence_sha) = 64),
  -- Git merge SHA that anchors this certification to code truth
  merge_sha          TEXT        NOT NULL CHECK (merge_sha ~ '^[0-9a-f]{40}$'),
  transitioned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  transitioned_by    TEXT        NOT NULL,
  transition_reason  TEXT        NOT NULL CHECK (length(transition_reason) > 0),
  -- Null means this certification does not expire by clock; only revoked/dependency
  expires_at         TIMESTAMPTZ,
  -- Populated only when status = 'revoked'
  revocation_trigger public.revocation_trigger,
  -- Previous row in the chain for this (program_id, domain)
  predecessor_id     UUID        REFERENCES public.certification_records(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT revoked_requires_trigger CHECK (
    (status = 'revoked') = (revocation_trigger IS NOT NULL)
  )
);

COMMENT ON TABLE public.certification_records IS
  'Append-only ledger of certification state transitions per domain per program. '
  'Current state = most recent row per (program_id, domain). Never mutate.';

-- ---------------------------------------------------------------------------
-- Immutability enforcement (same pattern as audit_log)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.certification_records_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'certification_records is append-only: % prohibited on row %',
    TG_OP, COALESCE(OLD.id::TEXT, '?');
END;
$$;

DROP TRIGGER IF EXISTS certification_records_no_update ON public.certification_records;
CREATE TRIGGER certification_records_no_update
  BEFORE UPDATE ON public.certification_records
  FOR EACH ROW EXECUTE FUNCTION public.certification_records_immutable();

DROP TRIGGER IF EXISTS certification_records_no_delete ON public.certification_records;
CREATE TRIGGER certification_records_no_delete
  BEFORE DELETE ON public.certification_records
  FOR EACH ROW EXECUTE FUNCTION public.certification_records_immutable();

-- ---------------------------------------------------------------------------
-- certification_transition_events
--
-- Structured audit trail. One row per transition, always written alongside
-- the certification_records insert. Append-only, same immutability guarantee.
-- These are the replay evidence for certification state reconstruction.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.certification_transition_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cert_record_id      UUID        NOT NULL REFERENCES public.certification_records(id),
  program_id          TEXT        NOT NULL,
  domain              public.certification_domain NOT NULL,
  from_status         public.certification_status,  -- NULL for initial 'pending'
  to_status           public.certification_status NOT NULL,
  triggered_by        TEXT        NOT NULL,
  trigger_reason      TEXT        NOT NULL CHECK (length(trigger_reason) > 0),
  evidence_sha        TEXT        CHECK (evidence_sha IS NULL OR length(evidence_sha) = 64),
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- True asserted at insert time: this event is replay-safe
  replay_safe         BOOLEAN     NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE public.certification_transition_events IS
  'Immutable audit trail for certification state transitions. '
  'Used for replay reconstruction of certification history. Never mutate.';

CREATE OR REPLACE FUNCTION public.certification_transition_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'certification_transition_events is append-only: % prohibited on row %',
    TG_OP, COALESCE(OLD.id::TEXT, '?');
END;
$$;

DROP TRIGGER IF EXISTS cert_events_no_update ON public.certification_transition_events;
CREATE TRIGGER cert_events_no_update
  BEFORE UPDATE ON public.certification_transition_events
  FOR EACH ROW EXECUTE FUNCTION public.certification_transition_events_immutable();

DROP TRIGGER IF EXISTS cert_events_no_delete ON public.certification_transition_events;
CREATE TRIGGER cert_events_no_delete
  BEFORE DELETE ON public.certification_transition_events
  FOR EACH ROW EXECUTE FUNCTION public.certification_transition_events_immutable();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_cert_records_program_domain
  ON public.certification_records(program_id, domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cert_records_status
  ON public.certification_records(status)
  WHERE status IN ('active', 'suspended', 'pending');

CREATE INDEX IF NOT EXISTS idx_cert_records_predecessor
  ON public.certification_records(predecessor_id)
  WHERE predecessor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cert_events_domain_occurred
  ON public.certification_transition_events(program_id, domain, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- current_certification_state view
--
-- Most recent row per (program_id, domain) — the live certification state.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.current_certification_state AS
SELECT DISTINCT ON (program_id, domain)
  id,
  program_id,
  domain,
  status,
  evidence_sha,
  merge_sha,
  transitioned_at,
  transitioned_by,
  transition_reason,
  expires_at,
  revocation_trigger,
  predecessor_id,
  created_at
FROM public.certification_records
ORDER BY program_id, domain, created_at DESC;

COMMENT ON VIEW public.current_certification_state IS
  'Live certification state: most recent record per (program_id, domain). Read-only.';
