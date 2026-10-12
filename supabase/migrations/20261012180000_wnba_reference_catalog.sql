-- WORK-2026101203: governed 2026 WNBA reference catalog.
-- NO-PRECONDITION-REQUIRED: additive data seed; all identity preconditions are row-level conflict guards.
-- Source evidence and reconciliation details are frozen in
-- packages/db/src/wnba-participant-roster.json. Existing participant identities
-- are preserved; conflicting or ambiguous identities refuse the transaction.
BEGIN;

DO $seed$
DECLARE
  -- lint-override: hardcoded-uuid -- governed UUIDv5 identities must remain stable across environments.
  catalog jsonb := $catalog$[{"id":"75907305-08cc-5d4d-8bc5-8f5555e82264","externalId":"unit-talk:wnba:atlanta-dream","stableKey":"atlanta-dream","displayName":"Atlanta Dream","abbreviation":"ATL","conference":"Eastern","country":"US"},{"id":"d5feb346-6e14-56fd-8bc8-f376f40ac35a","externalId":"unit-talk:wnba:chicago-sky","stableKey":"chicago-sky","displayName":"Chicago Sky","abbreviation":"CHI","conference":"Eastern","country":"US"},{"id":"8db73de3-539f-5659-97b1-0f968bddd54b","externalId":"unit-talk:wnba:connecticut-sun","stableKey":"connecticut-sun","displayName":"Connecticut Sun","abbreviation":"CON","conference":"Eastern","country":"US"},{"id":"f28cd7fb-83ff-535e-9456-912e11b53df8","externalId":"unit-talk:wnba:dallas-wings","stableKey":"dallas-wings","displayName":"Dallas Wings","abbreviation":"DAL","conference":"Western","country":"US"},{"id":"4197a406-7f4e-5566-a7c4-322ed9d7e11e","externalId":"unit-talk:wnba:golden-state-valkyries","stableKey":"golden-state-valkyries","displayName":"Golden State Valkyries","abbreviation":"GSV","conference":"Western","country":"US"},{"id":"e26ce36a-2779-5ea2-91d5-ce09bf4f7af7","externalId":"unit-talk:wnba:indiana-fever","stableKey":"indiana-fever","displayName":"Indiana Fever","abbreviation":"IND","conference":"Eastern","country":"US"},{"id":"173431fa-cae4-57a4-8708-163a1eafc34d","externalId":"unit-talk:wnba:las-vegas-aces","stableKey":"las-vegas-aces","displayName":"Las Vegas Aces","abbreviation":"LVA","conference":"Western","country":"US"},{"id":"f7e9621e-3e19-5aa4-a976-b2b33178f532","externalId":"unit-talk:wnba:los-angeles-sparks","stableKey":"los-angeles-sparks","displayName":"Los Angeles Sparks","abbreviation":"LAS","conference":"Western","country":"US"},{"id":"18c9304f-fa49-56aa-abe4-358849d065a4","externalId":"unit-talk:wnba:minnesota-lynx","stableKey":"minnesota-lynx","displayName":"Minnesota Lynx","abbreviation":"MIN","conference":"Western","country":"US"},{"id":"f1b6b85c-504a-5946-aafe-47a24519fe06","externalId":"unit-talk:wnba:new-york-liberty","stableKey":"new-york-liberty","displayName":"New York Liberty","abbreviation":"NYL","conference":"Eastern","country":"US"},{"id":"9d7fdebb-15db-5bc2-a6e6-3c95a632f631","externalId":"unit-talk:wnba:phoenix-mercury","stableKey":"phoenix-mercury","displayName":"Phoenix Mercury","abbreviation":"PHX","conference":"Western","country":"US"},{"id":"d0877f5b-77b8-5657-b909-5ca06f69d3a9","externalId":"unit-talk:wnba:portland-fire","stableKey":"portland-fire","displayName":"Portland Fire","abbreviation":"PDX","conference":"Western","country":"US"},{"id":"9f347912-95b7-53bd-8c2f-beaafdcd8766","externalId":"unit-talk:wnba:seattle-storm","stableKey":"seattle-storm","displayName":"Seattle Storm","abbreviation":"SEA","conference":"Western","country":"US"},{"id":"7a9165ab-e4c9-57d3-bb2b-bf54c7a30221","externalId":"unit-talk:wnba:toronto-tempo","stableKey":"toronto-tempo","displayName":"Toronto Tempo","abbreviation":"TOR","conference":"Eastern","country":"CA"},{"id":"7b7c5b93-35f0-53cf-b3cc-418cb29e799b","externalId":"unit-talk:wnba:washington-mystics","stableKey":"washington-mystics","displayName":"Washington Mystics","abbreviation":"WAS","conference":"Eastern","country":"US"}]$catalog$::jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sports
    WHERE id = 'WNBA'
      AND (display_name IS DISTINCT FROM 'WNBA' OR sort_order IS DISTINCT FROM 10
        OR active IS DISTINCT FROM true OR metadata IS DISTINCT FROM '{}'::jsonb)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 WNBA sport identity conflict';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = 'wnba'
      AND (sport_id IS DISTINCT FROM 'WNBA' OR display_name IS DISTINCT FROM 'WNBA'
        OR country IS NOT NULL OR sort_order IS DISTINCT FROM 10
        OR active IS DISTINCT FROM true OR metadata IS DISTINCT FROM '{}'::jsonb)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 WNBA league identity conflict';
  END IF;

  IF EXISTS (
    WITH expected(market_type_id, sort_order) AS (
      VALUES
        ('moneyline', 1), ('spread', 2), ('game_total_ou', 3), ('team_total_ou', 4),
        ('1h_moneyline', 50), ('1h_spread', 51), ('1h_total_ou', 52),
        ('2h_moneyline', 53), ('2h_spread', 54), ('2h_total_ou', 55),
        ('1q_moneyline', 60), ('1q_spread', 61), ('1q_total_ou', 62),
        ('2q_moneyline', 63), ('2q_spread', 64), ('2q_total_ou', 65),
        ('3q_moneyline', 66), ('3q_spread', 67), ('3q_total_ou', 68),
        ('4q_moneyline', 69), ('4q_spread', 70), ('4q_total_ou', 71)
    )
    SELECT 1
    FROM public.sport_market_type_availability AS actual
    LEFT JOIN expected USING (market_type_id)
    WHERE actual.sport_id = 'WNBA'
      AND (expected.market_type_id IS NULL OR actual.sort_order IS DISTINCT FROM expected.sort_order
        OR actual.active IS DISTINCT FROM true OR actual.metadata IS DISTINCT FROM '{}'::jsonb)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 WNBA market availability conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('moneyline'), ('spread'), ('game_total_ou'), ('team_total_ou'),
      ('1h_moneyline'), ('1h_spread'), ('1h_total_ou'), ('2h_moneyline'), ('2h_spread'), ('2h_total_ou'),
      ('1q_moneyline'), ('1q_spread'), ('1q_total_ou'), ('2q_moneyline'), ('2q_spread'), ('2q_total_ou'),
      ('3q_moneyline'), ('3q_spread'), ('3q_total_ou'), ('4q_moneyline'), ('4q_spread'), ('4q_total_ou')
    ) AS required(id)
    LEFT JOIN public.market_types AS market_type ON market_type.id = required.id
    WHERE market_type.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 required market type is missing';
  END IF;

  INSERT INTO public.sports (id, display_name, sort_order, active, metadata)
  SELECT 'WNBA', 'WNBA', 10, true, '{}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.sports WHERE id = 'WNBA');

  INSERT INTO public.leagues (id, sport_id, display_name, country, active, sort_order, metadata)
  SELECT 'wnba', 'WNBA', 'WNBA', NULL, true, 10, '{}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = 'wnba');

  INSERT INTO public.sport_market_type_availability
    (sport_id, market_type_id, active, sort_order, metadata)
  SELECT 'WNBA', expected.market_type_id, true, expected.sort_order, '{}'::jsonb
  FROM (VALUES
    ('moneyline', 1), ('spread', 2), ('game_total_ou', 3), ('team_total_ou', 4),
    ('1h_moneyline', 50), ('1h_spread', 51), ('1h_total_ou', 52),
    ('2h_moneyline', 53), ('2h_spread', 54), ('2h_total_ou', 55),
    ('1q_moneyline', 60), ('1q_spread', 61), ('1q_total_ou', 62),
    ('2q_moneyline', 63), ('2q_spread', 64), ('2q_total_ou', 65),
    ('3q_moneyline', 66), ('3q_spread', 67), ('3q_total_ou', 68),
    ('4q_moneyline', 69), ('4q_spread', 70), ('4q_total_ou', 71)
  ) AS expected(market_type_id, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sport_market_type_availability AS actual
    WHERE actual.sport_id = 'WNBA' AND actual.market_type_id = expected.market_type_id
  );

  IF EXISTS (
    SELECT 1
    FROM public.participants AS p
    JOIN jsonb_to_recordset(catalog) AS s(
      id uuid, "externalId" text, "stableKey" text, "displayName" text,
      abbreviation text, conference text, country text
    ) ON p.external_id = s."externalId"
    WHERE p.participant_type IS DISTINCT FROM 'team'
       OR p.sport IS DISTINCT FROM 'WNBA'
       OR p.display_name IS DISTINCT FROM s."displayName"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 canonical external identity conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.participants AS p
    JOIN jsonb_to_recordset(catalog) AS s(
      id uuid, "externalId" text, "stableKey" text, "displayName" text,
      abbreviation text, conference text, country text
    ) ON p.id = s.id
    WHERE p.participant_type IS DISTINCT FROM 'team'
       OR p.sport IS DISTINCT FROM 'WNBA'
       OR p.external_id IS DISTINCT FROM s."externalId"
       OR p.display_name IS DISTINCT FROM s."displayName"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 governed UUID conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(catalog) AS s(
      id uuid, "externalId" text, "stableKey" text, "displayName" text,
      abbreviation text, conference text, country text
    )
    WHERE (
      SELECT count(*) FROM public.participants AS p
      WHERE p.participant_type = 'team' AND p.sport = 'WNBA'
        AND (p.external_id = s."externalId" OR lower(p.display_name) = lower(s."displayName"))
    ) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 ambiguous canonical participant identity';
  END IF;

  INSERT INTO public.participants
    (id, external_id, participant_type, sport, league, display_name, metadata)
  SELECT
    s.id, s."externalId", 'team', 'WNBA', 'wnba', s."displayName",
    jsonb_build_object(
      'seedIssue', 'WORK-2026101203', 'source', 'governed-seed',
      'seededFrom', 'WNBA_OFFICIAL', 'season', 2026, 'stableKey', s."stableKey",
      'abbreviation', s.abbreviation, 'conference', s.conference, 'country', s.country
    )
  FROM jsonb_to_recordset(catalog) AS s(
    id uuid, "externalId" text, "stableKey" text, "displayName" text,
    abbreviation text, conference text, country text
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.participants AS p
    WHERE p.participant_type = 'team' AND p.sport = 'WNBA'
      AND (p.external_id = s."externalId" OR lower(p.display_name) = lower(s."displayName"))
  );
END
$seed$;

COMMIT;
