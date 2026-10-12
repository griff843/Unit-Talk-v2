-- UTV2-1972 rollback: remove only rows created and tagged by the governed WNBA
-- seed. Pre-existing WNBA sport, league, market-availability, and participant
-- identities are preserved.
BEGIN;

SELECT p.id
FROM public.participants AS p
WHERE p.id = ANY (ARRAY[
  '75907305-08cc-5d4d-8bc5-8f5555e82264'::uuid,
  'd5feb346-6e14-56fd-8bc8-f376f40ac35a'::uuid,
  '8db73de3-539f-5659-97b1-0f968bddd54b'::uuid,
  'e26ce36a-2779-5ea2-91d5-ce09bf4f7af7'::uuid,
  'f1b6b85c-504a-5946-aafe-47a24519fe06'::uuid,
  '7a9165ab-e4c9-57d3-bb2b-bf54c7a30221'::uuid,
  '7b7c5b93-35f0-53cf-b3cc-418cb29e799b'::uuid,
  'f28cd7fb-83ff-535e-9456-912e11b53df8'::uuid,
  '4197a406-7f4e-5566-a7c4-322ed9d7e11e'::uuid,
  '173431fa-cae4-57a4-8708-163a1eafc34d'::uuid,
  'f7e9621e-3e19-5aa4-a976-b2b33178f532'::uuid,
  '18c9304f-fa49-56aa-abe4-358849d065a4'::uuid,
  '9d7fdebb-15db-5bc2-a6e6-3c95a632f631'::uuid,
  'd0877f5b-77b8-5657-b909-5ca06f69d3a9'::uuid,
  '9f347912-95b7-53bd-8c2f-beaafdcd8766'::uuid
]::uuid[])
  AND p.metadata->>'seedIssue' = 'UTV2-1972'
ORDER BY p.id
FOR UPDATE;

DO $rollback$
DECLARE
  governed_ids uuid[] := ARRAY[
    '75907305-08cc-5d4d-8bc5-8f5555e82264'::uuid,
    'd5feb346-6e14-56fd-8bc8-f376f40ac35a'::uuid,
    '8db73de3-539f-5659-97b1-0f968bddd54b'::uuid,
    'e26ce36a-2779-5ea2-91d5-ce09bf4f7af7'::uuid,
    'f1b6b85c-504a-5946-aafe-47a24519fe06'::uuid,
    '7a9165ab-e4c9-57d3-bb2b-bf54c7a30221'::uuid,
    '7b7c5b93-35f0-53cf-b3cc-418cb29e799b'::uuid,
    'f28cd7fb-83ff-535e-9456-912e11b53df8'::uuid,
    '4197a406-7f4e-5566-a7c4-322ed9d7e11e'::uuid,
    '173431fa-cae4-57a4-8708-163a1eafc34d'::uuid,
    'f7e9621e-3e19-5aa4-a976-b2b33178f532'::uuid,
    '18c9304f-fa49-56aa-abe4-358849d065a4'::uuid,
    '9d7fdebb-15db-5bc2-a6e6-3c95a632f631'::uuid,
    'd0877f5b-77b8-5657-b909-5ca06f69d3a9'::uuid,
    '9f347912-95b7-53bd-8c2f-beaafdcd8766'::uuid
  ];
  reference record;
  is_referenced boolean;
BEGIN
  -- Refuse before DELETE even for cascading relationships. The row lock above
  -- also prevents a concurrent FK insert from slipping between scan and delete.
  FOR reference IN
    SELECT
      constraint_row.conrelid::regclass AS relation_name,
      source_attribute.attname AS column_name
    FROM pg_constraint AS constraint_row
    CROSS JOIN LATERAL unnest(
      constraint_row.conkey,
      constraint_row.confkey
    ) AS key_pair(source_number, target_number)
    JOIN pg_attribute AS source_attribute
      ON source_attribute.attrelid = constraint_row.conrelid
     AND source_attribute.attnum = key_pair.source_number
    JOIN pg_attribute AS target_attribute
      ON target_attribute.attrelid = constraint_row.confrelid
     AND target_attribute.attnum = key_pair.target_number
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.participants'::regclass
      AND target_attribute.attname = 'id'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1
         FROM %s
         WHERE %I = ANY ($1)
           AND %I IN (
             SELECT p.id
             FROM public.participants AS p
             WHERE p.metadata->>''seedIssue'' = ''UTV2-1972''
           )
       )',
      reference.relation_name,
      reference.column_name,
      reference.column_name
    ) INTO is_referenced USING governed_ids;

    IF is_referenced THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'UTV2-1972 rollback refused: seeded participant is referenced';
    END IF;
  END LOOP;
END
$rollback$;

DELETE FROM public.participants AS p
WHERE p.id = ANY (ARRAY[
  '75907305-08cc-5d4d-8bc5-8f5555e82264'::uuid,
  'd5feb346-6e14-56fd-8bc8-f376f40ac35a'::uuid,
  '8db73de3-539f-5659-97b1-0f968bddd54b'::uuid,
  'e26ce36a-2779-5ea2-91d5-ce09bf4f7af7'::uuid,
  'f1b6b85c-504a-5946-aafe-47a24519fe06'::uuid,
  '7a9165ab-e4c9-57d3-bb2b-bf54c7a30221'::uuid,
  '7b7c5b93-35f0-53cf-b3cc-418cb29e799b'::uuid,
  'f28cd7fb-83ff-535e-9456-912e11b53df8'::uuid,
  '4197a406-7f4e-5566-a7c4-322ed9d7e11e'::uuid,
  '173431fa-cae4-57a4-8708-163a1eafc34d'::uuid,
  'f7e9621e-3e19-5aa4-a976-b2b33178f532'::uuid,
  '18c9304f-fa49-56aa-abe4-358849d065a4'::uuid,
  '9d7fdebb-15db-5bc2-a6e6-3c95a632f631'::uuid,
  'd0877f5b-77b8-5657-b909-5ca06f69d3a9'::uuid,
  '9f347912-95b7-53bd-8c2f-beaafdcd8766'::uuid
]::uuid[])
  AND p.metadata->>'seedIssue' = 'UTV2-1972';

-- Availability rows have no metadata of their own. They can only have been
-- created by this migration when the parent WNBA sport was also created and
-- tagged by this migration; a pre-existing sport therefore protects all of its
-- pre-existing availability rows.
DELETE FROM public.sport_market_type_availability AS availability
USING public.sports AS sport
WHERE availability.sport_id = 'WNBA'
  AND sport.id = 'WNBA'
  AND sport.metadata->>'seedIssue' = 'UTV2-1972';

DELETE FROM public.leagues AS league
WHERE league.id = 'wnba'
  AND league.sport_id = 'WNBA'
  AND league.metadata->>'seedIssue' = 'UTV2-1972';

DELETE FROM public.sports AS sport
WHERE sport.id = 'WNBA'
  AND sport.metadata->>'seedIssue' = 'UTV2-1972';

COMMIT;
