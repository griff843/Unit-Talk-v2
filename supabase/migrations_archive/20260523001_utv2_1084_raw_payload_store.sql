-- UTV2-1084: Raw Provider Payload Store (Pre-Transformation Hashing)
-- Append-only table for raw provider payloads with SHA-256 hash captured
-- before any normalization/transformation step.
--
-- Immutability enforced at DB level: UPDATE and DELETE are blocked by triggers.
-- This is part of WS-1.1 Immutable Market Truth substrate.

CREATE TABLE IF NOT EXISTS raw_payloads (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT        NOT NULL,
  league       TEXT        NOT NULL,
  run_id       UUID        NOT NULL,
  kind         TEXT        NOT NULL CHECK (kind IN ('odds', 'results')),
  payload_hash TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  snapshot_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutability: block all mutations after insert

CREATE OR REPLACE FUNCTION raw_payloads_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'raw_payloads rows are immutable — no UPDATE or DELETE allowed (UTV2-1084)';
END;
$$;

CREATE TRIGGER raw_payloads_no_update
  BEFORE UPDATE ON raw_payloads
  FOR EACH ROW EXECUTE FUNCTION raw_payloads_immutable();

CREATE TRIGGER raw_payloads_no_delete
  BEFORE DELETE ON raw_payloads
  FOR EACH ROW EXECUTE FUNCTION raw_payloads_immutable();

-- Indexes for freshness queries and hash deduplication

CREATE INDEX raw_payloads_provider_league_snapshot_idx
  ON raw_payloads (provider_key, league, snapshot_at DESC);

CREATE INDEX raw_payloads_run_id_idx
  ON raw_payloads (run_id);

CREATE INDEX raw_payloads_hash_idx
  ON raw_payloads (payload_hash);

-- Row-level security: read-only for authenticated, insert for service role

ALTER TABLE raw_payloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY raw_payloads_select
  ON raw_payloads FOR SELECT
  USING (true);

CREATE POLICY raw_payloads_insert_service
  ON raw_payloads FOR INSERT
  WITH CHECK (true);
