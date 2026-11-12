-- UTV2-1972: governed, additive 2026 WNBA participant catalog.
-- The official franchise freeze was captured from https://www.wnba.com/teams
-- on 2026-10-12. Cleveland is listed there for 2028 and is deliberately absent.
-- Team identity remains canonical in public.participants; this migration never
-- writes public.teams and introduces no provider identity.
BEGIN;

DO $seed$
DECLARE
  -- lint-override: hardcoded-uuid -- governed UUIDv5 identities must remain stable across environments.
  catalog jsonb := $catalog$[{"id":"75907305-08cc-5d4d-8bc5-8f5555e82264","externalId":"unit-talk:wnba:atlanta-dream","slug":"atlanta-dream","displayName":"Atlanta Dream","shortName":"Dream","abbreviation":"ATL","conference":"Eastern"},{"id":"d5feb346-6e14-56fd-8bc8-f376f40ac35a","externalId":"unit-talk:wnba:chicago-sky","slug":"chicago-sky","displayName":"Chicago Sky","shortName":"Sky","abbreviation":"CHI","conference":"Eastern"},{"id":"8db73de3-539f-5659-97b1-0f968bddd54b","externalId":"unit-talk:wnba:connecticut-sun","slug":"connecticut-sun","displayName":"Connecticut Sun","shortName":"Sun","abbreviation":"CON","conference":"Eastern"},{"id":"e26ce36a-2779-5ea2-91d5-ce09bf4f7af7","externalId":"unit-talk:wnba:indiana-fever","slug":"indiana-fever","displayName":"Indiana Fever","shortName":"Fever","abbreviation":"IND","conference":"Eastern"},{"id":"f1b6b85c-504a-5946-aafe-47a24519fe06","externalId":"unit-talk:wnba:new-york-liberty","slug":"new-york-liberty","displayName":"New York Liberty","shortName":"Liberty","abbreviation":"NYL","conference":"Eastern"},{"id":"7a9165ab-e4c9-57d3-bb2b-bf54c7a30221","externalId":"unit-talk:wnba:toronto-tempo","slug":"toronto-tempo","displayName":"Toronto Tempo","shortName":"Tempo","abbreviation":"TOR","conference":"Eastern"},{"id":"7b7c5b93-35f0-53cf-b3cc-418cb29e799b","externalId":"unit-talk:wnba:washington-mystics","slug":"washington-mystics","displayName":"Washington Mystics","shortName":"Mystics","abbreviation":"WAS","conference":"Eastern"},{"id":"f28cd7fb-83ff-535e-9456-912e11b53df8","externalId":"unit-talk:wnba:dallas-wings","slug":"dallas-wings","displayName":"Dallas Wings","shortName":"Wings","abbreviation":"DAL","conference":"Western"},{"id":"4197a406-7f4e-5566-a7c4-322ed9d7e11e","externalId":"unit-talk:wnba:golden-state-valkyries","slug":"golden-state-valkyries","displayName":"Golden State Valkyries","shortName":"Valkyries","abbreviation":"GSV","conference":"Western"},{"id":"173431fa-cae4-57a4-8708-163a1eafc34d","externalId":"unit-talk:wnba:las-vegas-aces","slug":"las-vegas-aces","displayName":"Las Vegas Aces","shortName":"Aces","abbreviation":"LVA","conference":"Western"},{"id":"f7e9621e-3e19-5aa4-a976-b2b33178f532","externalId":"unit-talk:wnba:los-angeles-sparks","slug":"los-angeles-sparks","displayName":"Los Angeles Sparks","shortName":"Sparks","abbreviation":"LAS","conference":"Western"},{"id":"18c9304f-fa49-56aa-abe4-358849d065a4","externalId":"unit-talk:wnba:minnesota-lynx","slug":"minnesota-lynx","displayName":"Minnesota Lynx","shortName":"Lynx","abbreviation":"MIN","conference":"Western"},{"id":"9d7fdebb-15db-5bc2-a6e6-3c95a632f631","externalId":"unit-talk:wnba:phoenix-mercury","slug":"phoenix-mercury","displayName":"Phoenix Mercury","shortName":"Mercury","abbreviation":"PHX","conference":"Western"},{"id":"d0877f5b-77b8-5657-b909-5ca06f69d3a9","externalId":"unit-talk:wnba:portland-fire","slug":"portland-fire","displayName":"Portland Fire","shortName":"Fire","abbreviation":"POR","conference":"Western"},{"id":"9f347912-95b7-53bd-8c2f-beaafdcd8766","externalId":"unit-talk:wnba:seattle-storm","slug":"seattle-storm","displayName":"Seattle Storm","shortName":"Storm","abbreviation":"SEA","conference":"Western"}]$catalog$::jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sports
    WHERE id = 'WNBA' AND display_name IS DISTINCT FROM 'WNBA'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UTV2-1972 canonical sport conflict';
  END IF;

  INSERT INTO public.sports (id, display_name, sort_order, metadata)
  SELECT 'WNBA', 'WNBA', 6, jsonb_build_object('seedIssue', 'UTV2-1972', 'source', 'governed-seed')
  WHERE NOT EXISTS (SELECT 1 FROM public.sports WHERE id = 'WNBA');

  IF EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = 'wnba'
      AND (sport_id IS DISTINCT FROM 'WNBA' OR display_name IS DISTINCT FROM 'WNBA')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UTV2-1972 canonical league conflict';
  END IF;

  INSERT INTO public.leagues (id, sport_id, display_name, country, sort_order, metadata)
  SELECT 'wnba', 'WNBA', 'WNBA', 'USA/Canada', 6,
    jsonb_build_object('seedIssue', 'UTV2-1972', 'source', 'governed-seed')
  WHERE NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = 'wnba');

  -- Reuse the governed basketball market registry. This creates availability
  -- edges only; it does not invent or modify any market or stat identity.
  INSERT INTO public.sport_market_type_availability (
    sport_id,
    market_type_id,
    active,
    sort_order
  )
  SELECT 'WNBA', nba.market_type_id, nba.active, nba.sort_order
  FROM public.sport_market_type_availability AS nba
  WHERE nba.sport_id = 'NBA'
    AND NOT EXISTS (
      SELECT 1
      FROM public.sport_market_type_availability AS existing
      WHERE existing.sport_id = 'WNBA'
        AND existing.market_type_id = nba.market_type_id
    );

  IF EXISTS (
    SELECT 1
    FROM public.participants AS p
    JOIN jsonb_to_recordset(catalog) AS s(
      id uuid, "externalId" text, slug text, "displayName" text,
      "shortName" text, abbreviation text, conference text
    ) ON p.external_id = s."externalId"
    WHERE p.participant_type IS DISTINCT FROM 'team'
       OR p.sport IS DISTINCT FROM 'WNBA'
       OR p.display_name IS DISTINCT FROM s."displayName"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'UTV2-1972 canonical external identity conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.participants AS p
    JOIN jsonb_to_recordset(catalog) AS s(
      id uuid, "externalId" text, slug text, "displayName" text,
      "shortName" text, abbreviation text, conference text
    ) ON p.id = s.id
    WHERE p.participant_type IS DISTINCT FROM 'team'
       OR p.sport IS DISTINCT FROM 'WNBA'
       OR p.external_id IS DISTINCT FROM s."externalId"
       OR p.display_name IS DISTINCT FROM s."displayName"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'UTV2-1972 governed UUID conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(catalog) AS s(
      id uuid, "externalId" text, slug text, "displayName" text,
      "shortName" text, abbreviation text, conference text
    )
    WHERE (
      SELECT count(*)
      FROM public.participants AS p
      WHERE p.participant_type = 'team'
        AND p.sport = 'WNBA'
        AND (
          p.external_id = s."externalId"
          OR lower(p.display_name) = lower(s."displayName")
        )
    ) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'UTV2-1972 ambiguous canonical participant identity';
  END IF;

  INSERT INTO public.participants (
    id,
    external_id,
    participant_type,
    sport,
    league,
    display_name,
    metadata
  )
  SELECT
    s.id,
    s."externalId",
    'team',
    'WNBA',
    'wnba',
    s."displayName",
    jsonb_build_object(
      'seedIssue', 'UTV2-1972',
      'source', 'governed-seed',
      'seededFrom', 'WNBA_OFFICIAL_TEAMS',
      'sourceUrl', 'https://www.wnba.com/teams',
      'capturedAt', '2026-10-12',
      'season', 2026,
      'franchiseSlug', s.slug,
      'shortName', s."shortName",
      'abbreviation', s.abbreviation,
      'conference', s.conference
    )
  FROM jsonb_to_recordset(catalog) AS s(
    id uuid,
    "externalId" text,
    slug text,
    "displayName" text,
    "shortName" text,
    abbreviation text,
    conference text
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.participants AS p
    WHERE p.participant_type = 'team'
      AND p.sport = 'WNBA'
      AND (
        p.external_id = s."externalId"
        OR lower(p.display_name) = lower(s."displayName")
      )
  );
END
$seed$;

COMMIT;
