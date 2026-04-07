-- UTV2-398 Phase 1: Add picks.player_id as nullable FK to players
--
-- Additive migration — no existing data is removed or modified.
-- Backfill is handled by the companion script scripts/utv2-398-backfill-player-id.ts
--
-- Rollback: ALTER TABLE picks DROP COLUMN player_id;

ALTER TABLE picks
  ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES players(id);

-- Backfill: resolve player_id via provider_entity_aliases where the old
-- participant_id maps to a canonical players row.
UPDATE picks p
SET player_id = pea.player_id
FROM provider_entity_aliases pea
WHERE p.participant_id = pea.participant_id
  AND pea.player_id IS NOT NULL
  AND p.player_id IS NULL;

COMMENT ON COLUMN picks.player_id IS
  'Canonical player FK (players table). Populated on new picks when player identity '
  'is known at submission time. participant_id (old system) preserved for backward '
  'compatibility during Phase 1 transition.';
