-- UTV2-1136: INIT-4.2.2 — settlement_records Immutability Trigger
--
-- Enforces append-only semantics on settlement_records at the DB layer.
-- UPDATE and DELETE on existing rows are rejected unconditionally.
-- Corrections must be new INSERT rows with corrects_id pointing to the
-- original — they are never mutations of existing rows.
--
-- Error code: P0001 (plpgsql RAISE EXCEPTION)
-- Error message prefix: SETTLEMENT_RECORD_IMMUTABLE
-- Fires: BEFORE UPDATE OR DELETE ON public.settlement_records

CREATE OR REPLACE FUNCTION settlement_records_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'SETTLEMENT_RECORD_IMMUTABLE: settlement_records row (id=%) cannot be updated. Submit a correction INSERT with corrects_id instead.',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'SETTLEMENT_RECORD_IMMUTABLE: settlement_records row (id=%) cannot be deleted. The settlement ledger is append-only.',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_records_immutable ON public.settlement_records;

CREATE TRIGGER trg_settlement_records_immutable
  BEFORE UPDATE OR DELETE ON public.settlement_records
  FOR EACH ROW
  EXECUTE FUNCTION settlement_records_immutable();

COMMENT ON FUNCTION settlement_records_immutable() IS
  'UTV2-1136: Enforces append-only semantics. Updates and deletes are rejected; corrections must be new rows with corrects_id set.';
