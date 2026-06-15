-- Prevent duplicate settlements per pick per source.
-- Corrections use corrects_id (self-referencing FK), so this constraint
-- only prevents the SAME source from settling the SAME pick twice.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_records_pick_source_idx
  ON settlement_records (pick_id, source)
  WHERE corrects_id IS NULL;
