-- UTV2-619: Fix MLB batting/pitching markets misassigned as NBA in provider_offers
-- Root cause: SGO API sometimes sends sportKey='NBA' for MLB events. Market key
-- prefixes batting_* and pitching_* are MLB-exclusive and override the SGO sport tag.

-- Step 1: Correct sport_key on provider_offers that have MLB-exclusive market keys
-- but are tagged as NBA. These prefixes cannot appear in NBA events.
UPDATE provider_offers
SET sport_key = 'MLB'
WHERE sport_key = 'NBA'
  AND (
    provider_market_key LIKE 'batting\_%' ESCAPE '\'
    OR provider_market_key LIKE 'pitching\_%' ESCAPE '\'
  );

-- Step 2: Correct sport_id on events that are tagged NBA but ALL of their linked
-- provider_offers use MLB-exclusive market key prefixes. A real NBA event will
-- always have NBA market keys (points, rebounds, assists, etc.); an event with only
-- batting_/pitching_ offers is definitively an MLB event.
UPDATE events e
SET sport_id = 'MLB'
WHERE e.sport_id = 'NBA'
  AND e.external_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM provider_offers po
    WHERE po.provider_event_id = e.external_id
      AND (
        po.provider_market_key LIKE 'batting\_%' ESCAPE '\'
        OR po.provider_market_key LIKE 'pitching\_%' ESCAPE '\'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM provider_offers po
    WHERE po.provider_event_id = e.external_id
      AND po.provider_market_key NOT LIKE 'batting\_%' ESCAPE '\'
      AND po.provider_market_key NOT LIKE 'pitching\_%' ESCAPE '\'
  );
