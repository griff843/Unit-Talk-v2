-- UTV2-1972: governed, additive 2026 WNBA participant catalog.
-- The official franchise freeze was captured from https://www.wnba.com/teams
-- on 2026-10-12. Cleveland is listed there for 2028 and is deliberately absent.
-- Team identity remains canonical in public.participants; this migration never
-- writes public.teams and introduces no provider identity.
BEGIN;

DO $seed$
DECLARE
  -- lint-override: hardcoded-uuid -- governed UUIDv5 identities must remain stable across environments.
  catalog jsonb := $catalog$[{"id":"c0fa5bc8-30d0-56a6-b265-1baa5778cd1f","externalId":"unit-talk:wnba:atlanta-dream","slug":"atlanta-dream","displayName":"Atlanta Dream","shortName":"Dream","abbreviation":"ATL","conference":"Eastern"},{"id":"59f76962-c222-5e9c-bc30-67e7bbaaf524","externalId":"unit-talk:wnba:chicago-sky","slug":"chicago-sky","displayName":"Chicago Sky","shortName":"Sky","abbreviation":"CHI","conference":"Eastern"},{"id":"08e883a0-2f78-56c0-8ba0-6ddccdb1a615","externalId":"unit-talk:wnba:connecticut-sun","slug":"connecticut-sun","displayName":"Connecticut Sun","shortName":"Sun","abbreviation":"CON","conference":"Eastern"},{"id":"e548c6b6-44ad-5dae-8977-5ea0e23e7691","externalId":"unit-talk:wnba:indiana-fever","slug":"indiana-fever","displayName":"Indiana Fever","shortName":"Fever","abbreviation":"IND","conference":"Eastern"},{"id":"194e5e5b-3b5f-5c11-82da-3afc662e8972","externalId":"unit-talk:wnba:new-york-liberty","slug":"new-york-liberty","displayName":"New York Liberty","shortName":"Liberty","abbreviation":"NYL","conference":"Eastern"},{"id":"ed9242cd-8188-5b7d-b187-4d9658dcade0","externalId":"unit-talk:wnba:toronto-tempo","slug":"toronto-tempo","displayName":"Toronto Tempo","shortName":"Tempo","abbreviation":"TOR","conference":"Eastern"},{"id":"99f4f632-a531-5d35-8410-ed30b0d82733","externalId":"unit-talk:wnba:washington-mystics","slug":"washington-mystics","displayName":"Washington Mystics","shortName":"Mystics","abbreviation":"WAS","conference":"Eastern"},{"id":"73ac7b96-d082-5ab6-8b0a-7c792331a6be","externalId":"unit-talk:wnba:dallas-wings","slug":"dallas-wings","displayName":"Dallas Wings","shortName":"Wings","abbreviation":"DAL","conference":"Western"},{"id":"2235e78d-43fb-56ec-b68d-fc6e7ed910dd","externalId":"unit-talk:wnba:golden-state-valkyries","slug":"golden-state-valkyries","displayName":"Golden State Valkyries","shortName":"Valkyries","abbreviation":"GSV","conference":"Western"},{"id":"193e2297-4de0-5523-81dd-540acfa5ccc6","externalId":"unit-talk:wnba:las-vegas-aces","slug":"las-vegas-aces","displayName":"Las Vegas Aces","shortName":"Aces","abbreviation":"LVA","conference":"Western"},{"id":"c075c102-a873-5b6f-b2f3-dae2b70bc207","externalId":"unit-talk:wnba:los-angeles-sparks","slug":"los-angeles-sparks","displayName":"Los Angeles Sparks","shortName":"Sparks","abbreviation":"LAS","conference":"Western"},{"id":"1408d5a9-593f-5ab5-b606-5d527dbe6cfd","externalId":"unit-talk:wnba:minnesota-lynx","slug":"minnesota-lynx","displayName":"Minnesota Lynx","shortName":"Lynx","abbreviation":"MIN","conference":"Western"},{"id":"364693b2-aa0d-587c-9024-1a6b7e6e0b5a","externalId":"unit-talk:wnba:phoenix-mercury","slug":"phoenix-mercury","displayName":"Phoenix Mercury","shortName":"Mercury","abbreviation":"PHX","conference":"Western"},{"id":"0206969a-f1f9-5122-aadd-2af77c3e3b5e","externalId":"unit-talk:wnba:portland-fire","slug":"portland-fire","displayName":"Portland Fire","shortName":"Fire","abbreviation":"POR","conference":"Western"},{"id":"9785af36-9db6-507d-85c0-5f25907c949c","externalId":"unit-talk:wnba:seattle-storm","slug":"seattle-storm","displayName":"Seattle Storm","shortName":"Storm","abbreviation":"SEA","conference":"Western"}]$catalog$::jsonb;
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
