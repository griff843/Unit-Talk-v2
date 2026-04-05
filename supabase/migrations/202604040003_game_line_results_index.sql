-- Migration: add partial unique index for game-line results (null participant_id)
--
-- The game_results.participant_id column has always been nullable (no NOT NULL constraint).
-- However, standard UNIQUE(event_id, participant_id, market_key, source) does not deduplicate
-- rows with NULL participant_id because NULL != NULL in PostgreSQL.
--
-- This index prevents duplicate game-line results (ML, spread, game total) where
-- participant_id IS NULL — one row per (event, market, source) for game-level markets.

CREATE UNIQUE INDEX game_results_game_line_unique_idx
  ON game_results (event_id, market_key, source)
  WHERE participant_id IS NULL;
