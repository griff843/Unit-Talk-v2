-- Add stake_units column to settlement_records
ALTER TABLE settlement_records
  ADD COLUMN IF NOT EXISTS stake_units NUMERIC;

-- Trigger function: auto-populate stake_units from picks at insert time
CREATE OR REPLACE FUNCTION settlement_records_populate_stake_units()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stake_units IS NULL THEN
    SELECT COALESCE(p.stake_units, (p.metadata->>'stakeUnits')::numeric)
      INTO NEW.stake_units
      FROM picks p
      WHERE p.id = NEW.pick_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_records_stake_units ON settlement_records;

CREATE TRIGGER trg_settlement_records_stake_units
  BEFORE INSERT ON settlement_records
  FOR EACH ROW
  EXECUTE FUNCTION settlement_records_populate_stake_units();
;
