UPDATE market_universe mu
SET participant_id = p.id
FROM participants p
WHERE mu.participant_id IS NULL
  AND mu.provider_participant_id IS NOT NULL
  AND p.external_id = mu.provider_participant_id;;
