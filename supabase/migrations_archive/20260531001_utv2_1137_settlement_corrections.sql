-- UTV2-1137: INIT-4.2.3 — Dual-Authorized Corrections
--
-- Creates settlement_corrections table to record dual-authorization for
-- every correction made to the settlement ledger.
--
-- A correction is a new settlement_records row with corrects_id set (per UTV2-1136).
-- This table carries:
--   - The dual-authorization identities (two distinct authorizers required)
--   - Justification for the correction
--   - Lineage reference to the prior record
--   - Timestamp and optional audit_event_id
--
-- Invariants enforced:
--   1. authorizer_1 != authorizer_2 (CHECK constraint)
--   2. settlement_record_id must reference a correction row (corrects_id IS NOT NULL)
--   3. prior_record_id must match the settlement_record's corrects_id

CREATE TABLE IF NOT EXISTS public.settlement_corrections (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_record_id UUID        NOT NULL REFERENCES public.settlement_records(id),
  prior_record_id      UUID        NOT NULL REFERENCES public.settlement_records(id),
  authorizer_1         TEXT        NOT NULL,
  authorizer_2         TEXT        NOT NULL,
  justification        TEXT        NOT NULL,
  correction_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audit_event_id       UUID        NULL,

  CONSTRAINT settlement_corrections_distinct_authorizers
    CHECK (authorizer_1 != authorizer_2)
);

COMMENT ON TABLE public.settlement_corrections IS
  'UTV2-1137: Dual-authorization records for settlement corrections. authorizer_1 and authorizer_2 must be distinct identities.';

COMMENT ON COLUMN public.settlement_corrections.settlement_record_id IS
  'The new settlement_records row (with corrects_id set) created by this correction.';

COMMENT ON COLUMN public.settlement_corrections.prior_record_id IS
  'The settlement_records row being corrected — must match settlement_record.corrects_id.';

COMMENT ON COLUMN public.settlement_corrections.audit_event_id IS
  'Populated after the AuditEvent is emitted for this correction.';

-- One correction record per settlement_record
CREATE UNIQUE INDEX IF NOT EXISTS settlement_corrections_record_idx
  ON public.settlement_corrections(settlement_record_id);

-- Validate: settlement_record must be a correction row and prior_record_id must match
CREATE OR REPLACE FUNCTION settlement_corrections_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_corrects_id UUID;
BEGIN
  SELECT corrects_id INTO v_corrects_id
  FROM public.settlement_records
  WHERE id = NEW.settlement_record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SETTLEMENT_CORRECTION_RECORD_NOT_FOUND: settlement_record (id=%) does not exist.',
      NEW.settlement_record_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_corrects_id IS NULL THEN
    RAISE EXCEPTION
      'SETTLEMENT_CORRECTION_NOT_A_CORRECTION: settlement_record (id=%) has corrects_id=NULL. Only correction rows (corrects_id IS NOT NULL) may have a settlement_corrections record.',
      NEW.settlement_record_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_corrects_id != NEW.prior_record_id THEN
    RAISE EXCEPTION
      'SETTLEMENT_CORRECTION_LINEAGE_MISMATCH: settlement_record corrects_id (%) does not match prior_record_id (%).',
      v_corrects_id, NEW.prior_record_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_corrections_validate ON public.settlement_corrections;

CREATE TRIGGER trg_settlement_corrections_validate
  BEFORE INSERT ON public.settlement_corrections
  FOR EACH ROW
  EXECUTE FUNCTION settlement_corrections_validate();

COMMENT ON FUNCTION settlement_corrections_validate() IS
  'UTV2-1137: Validates that a settlement_corrections record references a real correction row and that prior_record_id matches corrects_id.';
