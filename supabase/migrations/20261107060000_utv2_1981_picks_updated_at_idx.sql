-- UTV2-1981: support the keyset population guard's watermark and change probe.
-- Production gets the index first out of band by CREATE INDEX CONCURRENTLY
-- under Griff's separate authorization. This file is then a validated no-op:
-- the guard confirms the out-of-band index is valid before recording history.
-- FAIL-CLOSED-PRECONDITION: public.picks_updated_at_idx
DO $$
BEGIN
  IF to_regclass('public.picks_updated_at_idx') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class idx
    JOIN pg_catalog.pg_index i ON i.indexrelid = idx.oid
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE idx.oid = to_regclass('public.picks_updated_at_idx')
      AND idx.relkind = 'i'
      AND i.indrelid = to_regclass('public.picks')
      AND am.amname = 'btree'
      AND i.indnkeyatts = 1 AND i.indnatts = 1
      AND a.attname = 'updated_at' AND NOT a.attisdropped
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND NOT i.indisexclusion
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42P07',
      MESSAGE = 'public.picks_updated_at_idx exists but is not a valid ready nonunique btree on public.picks(updated_at)';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS picks_updated_at_idx ON public.picks (updated_at);
