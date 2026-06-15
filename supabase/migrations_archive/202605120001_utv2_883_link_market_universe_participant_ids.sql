-- UTV2-883: Backfill participant_id for market_universe rows where provider_participant_id
-- matches participants.external_id but participant_id was not populated at write time.
--
-- Root cause: the market-universe-materializer resolves participant_id via the
-- provider_entity_aliases table, but 490 players exist in participants without a
-- corresponding alias row. This leaves their market_universe rows with participant_id NULL
-- even though the canonical participant record exists.
--
-- Non-destructive: only updates rows where participant_id IS NULL.
-- Idempotent: re-running is safe (WHERE guard prevents double-writes).

UPDATE market_universe mu
SET participant_id = p.id
FROM participants p
WHERE mu.participant_id IS NULL
  AND mu.provider_participant_id IS NOT NULL
  AND p.external_id = mu.provider_participant_id;
