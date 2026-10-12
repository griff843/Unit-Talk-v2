-- WORK-2026101203 rollback: remove only the exact WNBA reference identities
-- introduced by the governed catalog after refusing any downstream use.
BEGIN;

SELECT p.id
FROM public.participants AS p
WHERE p.id = ANY (ARRAY[
  '75907305-08cc-5d4d-8bc5-8f5555e82264'::uuid, 'd5feb346-6e14-56fd-8bc8-f376f40ac35a'::uuid,
  '8db73de3-539f-5659-97b1-0f968bddd54b'::uuid, 'f28cd7fb-83ff-535e-9456-912e11b53df8'::uuid,
  '4197a406-7f4e-5566-a7c4-322ed9d7e11e'::uuid, 'e26ce36a-2779-5ea2-91d5-ce09bf4f7af7'::uuid,
  '173431fa-cae4-57a4-8708-163a1eafc34d'::uuid, 'f7e9621e-3e19-5aa4-a976-b2b33178f532'::uuid,
  '18c9304f-fa49-56aa-abe4-358849d065a4'::uuid, 'f1b6b85c-504a-5946-aafe-47a24519fe06'::uuid,
  '9d7fdebb-15db-5bc2-a6e6-3c95a632f631'::uuid, 'd0877f5b-77b8-5657-b909-5ca06f69d3a9'::uuid,
  '9f347912-95b7-53bd-8c2f-beaafdcd8766'::uuid, '7a9165ab-e4c9-57d3-bb2b-bf54c7a30221'::uuid,
  '7b7c5b93-35f0-53cf-b3cc-418cb29e799b'::uuid
]::uuid[])
  AND p.metadata->>'seedIssue' = 'WORK-2026101203'
ORDER BY p.id
FOR UPDATE;

SELECT availability.market_type_id
FROM public.sport_market_type_availability AS availability
WHERE availability.sport_id = 'WNBA'
ORDER BY availability.market_type_id
FOR UPDATE;

SELECT league.id FROM public.leagues AS league WHERE league.id = 'wnba' FOR UPDATE;
SELECT sport.id FROM public.sports AS sport WHERE sport.id = 'WNBA' FOR UPDATE;

DO $rollback$
DECLARE
  reference record;
  is_referenced boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sport_market_type_availability
    WHERE sport_id = 'WNBA'
      AND market_type_id <> ALL (ARRAY[
        'moneyline', 'spread', 'game_total_ou', 'team_total_ou',
        '1h_moneyline', '1h_spread', '1h_total_ou', '2h_moneyline', '2h_spread', '2h_total_ou',
        '1q_moneyline', '1q_spread', '1q_total_ou', '2q_moneyline', '2q_spread', '2q_total_ou',
        '3q_moneyline', '3q_spread', '3q_total_ou', '4q_moneyline', '4q_spread', '4q_total_ou'
      ]::text[])
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 rollback refused: unowned WNBA market availability exists';
  END IF;

  FOR reference IN
    SELECT constraint_row.conrelid::regclass AS relation_name, source_attribute.attname AS column_name
    FROM pg_constraint AS constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey, constraint_row.confkey)
      AS key_pair(source_number, target_number)
    JOIN pg_attribute AS source_attribute
      ON source_attribute.attrelid = constraint_row.conrelid AND source_attribute.attnum = key_pair.source_number
    JOIN pg_attribute AS target_attribute
      ON target_attribute.attrelid = constraint_row.confrelid AND target_attribute.attnum = key_pair.target_number
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.participants'::regclass
      AND target_attribute.attname = 'id'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s WHERE %I IN (
        SELECT id FROM public.participants
        WHERE id = ANY ($1) AND metadata->>''seedIssue'' = ''WORK-2026101203''
      ))', reference.relation_name, reference.column_name
    ) INTO is_referenced USING ARRAY[
      '75907305-08cc-5d4d-8bc5-8f5555e82264'::uuid, 'd5feb346-6e14-56fd-8bc8-f376f40ac35a'::uuid,
      '8db73de3-539f-5659-97b1-0f968bddd54b'::uuid, 'f28cd7fb-83ff-535e-9456-912e11b53df8'::uuid,
      '4197a406-7f4e-5566-a7c4-322ed9d7e11e'::uuid, 'e26ce36a-2779-5ea2-91d5-ce09bf4f7af7'::uuid,
      '173431fa-cae4-57a4-8708-163a1eafc34d'::uuid, 'f7e9621e-3e19-5aa4-a976-b2b33178f532'::uuid,
      '18c9304f-fa49-56aa-abe4-358849d065a4'::uuid, 'f1b6b85c-504a-5946-aafe-47a24519fe06'::uuid,
      '9d7fdebb-15db-5bc2-a6e6-3c95a632f631'::uuid, 'd0877f5b-77b8-5657-b909-5ca06f69d3a9'::uuid,
      '9f347912-95b7-53bd-8c2f-beaafdcd8766'::uuid, '7a9165ab-e4c9-57d3-bb2b-bf54c7a30221'::uuid,
      '7b7c5b93-35f0-53cf-b3cc-418cb29e799b'::uuid
    ]::uuid[];
    IF is_referenced THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 rollback refused: seeded participant is referenced';
    END IF;
  END LOOP;

  FOR reference IN
    SELECT constraint_row.conrelid::regclass AS relation_name, source_attribute.attname AS column_name
    FROM pg_constraint AS constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey, constraint_row.confkey)
      AS key_pair(source_number, target_number)
    JOIN pg_attribute AS source_attribute
      ON source_attribute.attrelid = constraint_row.conrelid AND source_attribute.attnum = key_pair.source_number
    JOIN pg_attribute AS target_attribute
      ON target_attribute.attrelid = constraint_row.confrelid AND target_attribute.attnum = key_pair.target_number
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.leagues'::regclass
      AND target_attribute.attname = 'id'
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', reference.relation_name, reference.column_name)
      INTO is_referenced USING 'wnba';
    IF is_referenced THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 rollback refused: WNBA league is referenced';
    END IF;
  END LOOP;

  FOR reference IN
    SELECT constraint_row.conrelid::regclass AS relation_name, source_attribute.attname AS column_name
    FROM pg_constraint AS constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey, constraint_row.confkey)
      AS key_pair(source_number, target_number)
    JOIN pg_attribute AS source_attribute
      ON source_attribute.attrelid = constraint_row.conrelid AND source_attribute.attnum = key_pair.source_number
    JOIN pg_attribute AS target_attribute
      ON target_attribute.attrelid = constraint_row.confrelid AND target_attribute.attnum = key_pair.target_number
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.sports'::regclass
      AND target_attribute.attname = 'id'
      AND constraint_row.conrelid NOT IN (
        'public.leagues'::regclass,
        'public.sport_market_type_availability'::regclass
      )
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', reference.relation_name, reference.column_name)
      INTO is_referenced USING 'WNBA';
    IF is_referenced THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WORK-2026101203 rollback refused: WNBA sport is referenced';
    END IF;
  END LOOP;
END
$rollback$;

DELETE FROM public.participants AS p
WHERE p.id = ANY (ARRAY[
  '75907305-08cc-5d4d-8bc5-8f5555e82264'::uuid, 'd5feb346-6e14-56fd-8bc8-f376f40ac35a'::uuid,
  '8db73de3-539f-5659-97b1-0f968bddd54b'::uuid, 'f28cd7fb-83ff-535e-9456-912e11b53df8'::uuid,
  '4197a406-7f4e-5566-a7c4-322ed9d7e11e'::uuid, 'e26ce36a-2779-5ea2-91d5-ce09bf4f7af7'::uuid,
  '173431fa-cae4-57a4-8708-163a1eafc34d'::uuid, 'f7e9621e-3e19-5aa4-a976-b2b33178f532'::uuid,
  '18c9304f-fa49-56aa-abe4-358849d065a4'::uuid, 'f1b6b85c-504a-5946-aafe-47a24519fe06'::uuid,
  '9d7fdebb-15db-5bc2-a6e6-3c95a632f631'::uuid, 'd0877f5b-77b8-5657-b909-5ca06f69d3a9'::uuid,
  '9f347912-95b7-53bd-8c2f-beaafdcd8766'::uuid, '7a9165ab-e4c9-57d3-bb2b-bf54c7a30221'::uuid,
  '7b7c5b93-35f0-53cf-b3cc-418cb29e799b'::uuid
]::uuid[])
  AND p.metadata->>'seedIssue' = 'WORK-2026101203';

DELETE FROM public.sport_market_type_availability
WHERE sport_id = 'WNBA'
  AND market_type_id = ANY (ARRAY[
    'moneyline', 'spread', 'game_total_ou', 'team_total_ou',
    '1h_moneyline', '1h_spread', '1h_total_ou', '2h_moneyline', '2h_spread', '2h_total_ou',
    '1q_moneyline', '1q_spread', '1q_total_ou', '2q_moneyline', '2q_spread', '2q_total_ou',
    '3q_moneyline', '3q_spread', '3q_total_ou', '4q_moneyline', '4q_spread', '4q_total_ou'
  ]::text[]);

DELETE FROM public.leagues
WHERE id = 'wnba' AND sport_id = 'WNBA' AND display_name = 'WNBA'
  AND country IS NULL AND sort_order = 10 AND active = true AND metadata = '{}'::jsonb;

DELETE FROM public.sports
WHERE id = 'WNBA' AND display_name = 'WNBA'
  AND sort_order = 10 AND active = true AND metadata = '{}'::jsonb;

COMMIT;
