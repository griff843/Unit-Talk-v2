-- UTV2-1085 — INIT-1.1.2: Immutable OddsSnapshot Table and Triggers
-- WS-1.1 Immutable Market Truth substrate
-- Every observed price is an immutable, lineage-complete snapshot.
-- Closes catastrophic gap #6: provider_offer_current overwrote odds in place.

-- ─────────────────────────────────────────────────────────────
-- Main snapshot table
-- ─────────────────────────────────────────────────────────────

CREATE TABLE odds_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key      TEXT        NOT NULL,
  market_key        TEXT        NOT NULL,
  league            TEXT        NOT NULL,
  run_id            UUID        NOT NULL,
  raw_payload_id    UUID        REFERENCES raw_payloads(id),
  snapshot_at       TIMESTAMPTZ NOT NULL,
  price_blob        JSONB       NOT NULL,
  prior_snapshot_id UUID        REFERENCES odds_snapshots(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- Immutability trigger — rejects UPDATE and DELETE on odds_snapshots
-- ─────────────────────────────────────────────────────────────

CREATE FUNCTION odds_snapshots_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'odds_snapshots rows are immutable — no UPDATE or DELETE allowed (UTV2-1085)';
END;
$$;

CREATE TRIGGER trg_odds_snapshots_immutable
  BEFORE UPDATE OR DELETE ON odds_snapshots
  FOR EACH ROW EXECUTE FUNCTION odds_snapshots_immutable();

-- ─────────────────────────────────────────────────────────────
-- Correction table — append-only, never mutates prior snapshots
-- ─────────────────────────────────────────────────────────────

CREATE TABLE odds_snapshot_corrections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     UUID        NOT NULL REFERENCES odds_snapshots(id),
  new_snapshot_id UUID        NOT NULL REFERENCES odds_snapshots(id),
  corrected_by    TEXT        NOT NULL,
  reason          TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────

CREATE INDEX idx_odds_snapshots_provider_league_run
  ON odds_snapshots (provider_key, league, run_id);

CREATE INDEX idx_odds_snapshots_snapshot_at
  ON odds_snapshots (snapshot_at DESC);

CREATE INDEX idx_odds_snapshots_raw_payload_id
  ON odds_snapshots (raw_payload_id)
  WHERE raw_payload_id IS NOT NULL;

CREATE INDEX idx_odds_snapshots_prior_snapshot_id
  ON odds_snapshots (prior_snapshot_id)
  WHERE prior_snapshot_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────

ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds_snapshot_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON odds_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service role full access" ON odds_snapshot_corrections
  FOR ALL TO service_role USING (true) WITH CHECK (true);;
