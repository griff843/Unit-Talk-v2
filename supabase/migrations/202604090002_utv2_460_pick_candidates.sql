-- UTV2-460: pick_candidates — Phase 2 evaluation layer
-- Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md
-- Depends on: UTV2-459 (market_universe table must exist)

CREATE TABLE pick_candidates (
  id                uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  universe_id       uuid          NOT NULL REFERENCES market_universe(id),
  status            text          NOT NULL DEFAULT 'pending',
  rejection_reason  text          NULL,
  filter_details    jsonb         NULL,
  model_score       numeric       NULL,
  model_tier        text          NULL,
  model_confidence  numeric       NULL,
  shadow_mode       boolean       NOT NULL DEFAULT true,
  pick_id           uuid          NULL,
  scan_run_id       text          NULL,
  provenance        jsonb         NULL,
  expires_at        timestamptz   NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

-- Upsert path: one active candidate per universe row
CREATE UNIQUE INDEX pick_candidates_universe_id
  ON pick_candidates (universe_id);

-- Status reads for board scan and Phase 3
CREATE INDEX pick_candidates_status
  ON pick_candidates (status);

-- Expiry sweep
CREATE INDEX pick_candidates_expires
  ON pick_candidates (expires_at)
  WHERE expires_at IS NOT NULL;

-- Conversion audit (Phase 4+)
CREATE INDEX pick_candidates_pick_id
  ON pick_candidates (pick_id)
  WHERE pick_id IS NOT NULL;
